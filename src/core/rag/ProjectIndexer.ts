/**
 * ProjectIndexer — ChromaDB-backed Retrieval-Augmented Generation (RAG).
 *
 * Responsibilities (SRP):
 *  1. `indexProject()` — walk the working tree, chunk source + docs,
 *     and upsert them into a ChromaDB collection.
 *  2. `retrieveContext()` — semantic top-K lookup for a user query,
 *     returning `RetrievedChunk[]` for prompt injection into sub-agents.
 *
 * Resilience: ChromaDB is best-effort. When the server is unreachable
 * (or a query fails), the indexer flips into in-memory fallback mode:
 * docs are still kept in `memoryDocs` and `retrieveContext` degrades to
 * deterministic keyword-overlap ranking instead of throwing. `dispatch()`
 * must never fail because retrieval did — check `fallbackMode`.
 *
 * Embedding: defaults to the dependency-free `HashEmbeddingFunction`
 * (offline, deterministic). Inject any `EmbeddingFunction` — e.g.
 * `DefaultEmbeddingFunction` from `@chroma-core/default-embed` — via
 * deps for production semantic quality. The *same* function instance
 * must be used for indexing and querying (passed to both
 * `getOrCreateCollection` calls implicitly via this class).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { ChromaClient } from 'chromadb';
import type { Collection, EmbeddingFunction, Metadata } from 'chromadb';
import type winston from 'winston';
import type {
  IndexStats,
  ProjectFileLanguage,
  ProjectFileMetadata,
  RetrievedChunk,
} from '../../types/index.js';
import { HashEmbeddingFunction } from './HashEmbeddingFunction.js';

export interface ProjectIndexerDeps {
  /** Pre-built client (tests / shared connections). Built from host/port/ssl when omitted. */
  client?: ChromaClient | undefined;
  chromaHost?: string | undefined;
  chromaPort?: number | undefined;
  chromaSsl?: boolean | undefined;
  /** Target collection name. */
  collectionName?: string | undefined;
  /** Repository root to index. Defaults to `process.cwd()`. */
  rootDir?: string | undefined;
  /** Embedding function. Defaults to offline `HashEmbeddingFunction`. */
  embeddingFunction?: EmbeddingFunction | undefined;
  logger?: winston.Logger | undefined;
  /** Lines per chunk. Defaults to 60. */
  chunkLines?: number | undefined;
  /** Overlapping lines between consecutive chunks. Defaults to 10. */
  chunkOverlap?: number | undefined;
  /** Max file size in bytes (larger files skipped). Defaults to 256 KiB. */
  maxFileBytes?: number | undefined;
}

const DEFAULT_COLLECTION = 'helix_project';
const BATCH_SIZE = 100;
const DEFAULT_CHUNK_LINES = 60;
const DEFAULT_CHUNK_OVERLAP = 10;
const DEFAULT_MAX_FILE_BYTES = 256 * 1024;

const INDEXABLE_EXTS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.json',
  '.md',
  '.mdx',
  '.txt',
  '.yml',
  '.yaml',
]);

const IGNORED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.git',
  '.next',
  'coverage',
  'target',
  'vendor',
  'venv',
  '__pycache__',
  '.turbo',
]);

interface MemoryDoc {
  id: string;
  document: string;
  metadata: ProjectFileMetadata;
}

export function languageForExtension(ext: string): ProjectFileLanguage {
  switch (ext.toLowerCase()) {
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.json':
      return 'json';
    case '.md':
    case '.mdx':
    case '.txt':
      return 'markdown';
    case '.yml':
    case '.yaml':
      return 'yaml';
    default:
      return 'other';
  }
}

export class ProjectIndexer {
  private readonly client: ChromaClient;
  private readonly collectionName: string;
  private readonly rootDir: string;
  private readonly embeddingFunction: EmbeddingFunction;
  private readonly logger: winston.Logger | undefined;
  private readonly chunkLines: number;
  private readonly chunkOverlap: number;
  private readonly maxFileBytes: number;

  private collection: Collection | null = null;
  private collectionReady = false;
  private fallback = false;
  private readonly memoryDocs = new Map<string, MemoryDoc>();

  public constructor(deps: ProjectIndexerDeps = {}) {
    this.client =
      deps.client ??
      new ChromaClient({
        host: deps.chromaHost ?? process.env['CHROMA_HOST'] ?? '127.0.0.1',
        port: deps.chromaPort ?? Number(process.env['CHROMA_PORT'] ?? 8000),
        ssl: deps.chromaSsl ?? (process.env['CHROMA_SSL'] === '1' || process.env['CHROMA_SSL'] === 'true'),
      });
    this.collectionName = deps.collectionName ?? process.env['CHROMA_COLLECTION'] ?? DEFAULT_COLLECTION;
    this.rootDir = resolve(deps.rootDir ?? process.cwd());
    this.embeddingFunction = deps.embeddingFunction ?? new HashEmbeddingFunction();
    this.logger = deps.logger;
    this.chunkLines = deps.chunkLines ?? DEFAULT_CHUNK_LINES;
    this.chunkOverlap = deps.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
    this.maxFileBytes = deps.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  /** True when ChromaDB is unreachable and keyword fallback is active. */
  public get fallbackMode(): boolean {
    return this.fallback;
  }

  public get name(): string {
    return this.collectionName;
  }

  /**
   * Resolve (or create) the ChromaDB collection. Returns `null` and flips
   * into fallback mode when the server is unreachable — never throws.
   */
  public async ensureCollection(): Promise<Collection | null> {
    if (this.collectionReady && this.collection !== null) return this.collection;
    try {
      this.collection = await this.client.getOrCreateCollection({
        name: this.collectionName,
        embeddingFunction: this.embeddingFunction,
      });
      this.collectionReady = true;
      this.fallback = false;
      return this.collection;
    } catch (err: unknown) {
      this.collection = null;
      this.collectionReady = false;
      this.fallback = true;
      this.logger?.warn('ChromaDB unreachable — indexer running in in-memory fallback mode', {
        collection: this.collectionName,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Walk `rootDir`, chunk indexable files, and upsert them.
   * Idempotent: chunk ids are stable (`<relPath>#chunk-<n>`), so
   * re-indexing overwrites rather than duplicates.
   */
  public async indexProject(rootDir?: string): Promise<IndexStats> {
    const root = resolve(rootDir ?? this.rootDir);
    const files = await this.collectFiles(root);
    const docs: MemoryDoc[] = [];
    let filesIndexed = 0;
    for (const abs of files) {
      const chunks = await this.chunkFile(root, abs);
      if (chunks.length === 0) continue;
      filesIndexed += 1;
      for (const c of chunks) {
        docs.push(c);
        this.memoryDocs.set(c.id, c);
      }
    }

    const collection = await this.ensureCollection();
    let chunksUpserted = 0;
    let fallbackMode = this.fallback;
    if (collection !== null) {
      try {
        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
          const batch = docs.slice(i, i + BATCH_SIZE);
          await collection.upsert({
            ids: batch.map((d) => d.id),
            documents: batch.map((d) => d.document),
            metadatas: batch.map(
              (d): Metadata => ({
                filePath: d.metadata.filePath,
                language: d.metadata.language,
                chunkIndex: d.metadata.chunkIndex,
                totalChunks: d.metadata.totalChunks,
              }),
            ),
          });
          chunksUpserted += batch.length;
        }
      } catch (err: unknown) {
        // Mid-index outage: keep memory docs, degrade gracefully.
        fallbackMode = true;
        this.fallback = true;
        this.logger?.warn('ChromaDB upsert failed mid-index — keeping in-memory docs only', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.logger?.info('Project indexing complete', {
      root,
      collection: this.collectionName,
      filesScanned: files.length,
      filesIndexed,
      chunksUpserted,
      fallbackMode,
    });
    return { filesScanned: files.length, filesIndexed, chunksUpserted, collection: this.collectionName, fallbackMode };
  }

  /**
   * Return the top-K most relevant codebase chunks for a user query.
   * Never throws: on any vector-store failure it degrades to keyword
   * ranking over in-memory docs (possibly empty → `[]`).
   */
  public async retrieveContext(query: string, nResults = 5): Promise<RetrievedChunk[]> {
    const k = Math.max(1, Math.floor(nResults));
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    // Lazy best-effort indexing so ad-hoc `dispatch()` calls still recall code.
    if (this.memoryDocs.size === 0) {
      try {
        await this.indexProject();
      } catch {
        // Indexing already degrades internally; ignore here.
      }
    }

    const collection = await this.ensureCollection();
    if (collection !== null && !this.fallback) {
      try {
        const res = await collection.query({
          queryTexts: [trimmed],
          nResults: k,
          include: ['documents', 'metadatas', 'distances'],
        });
        const chunks = ProjectIndexer.toChunks(res.ids[0], res.documents[0], res.metadatas[0], res.distances[0]);
        if (chunks.length > 0) return chunks;
        // Empty collection (e.g. fresh DB): fall through to keyword ranking.
      } catch (err: unknown) {
        this.fallback = true;
        this.logger?.warn('ChromaDB query failed — falling back to keyword ranking', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return this.keywordFallback(trimmed, k);
  }

  /**
   * Render chunks as bounded prompt text:
   * `--- <filePath> (chunk i/n) ---\n<document>`, truncated to `maxChars`.
   */
  public formatContext(chunks: readonly RetrievedChunk[], maxChars = 8000): string {
    if (chunks.length === 0) return '';
    const parts: string[] = [];
    let used = 0;
    for (const c of chunks) {
      const header = `--- ${c.filePath} (chunk ${c.metadata.chunkIndex + 1}/${c.metadata.totalChunks}) ---\n`;
      const remaining = maxChars - used - header.length;
      if (remaining <= 0) break;
      const body = c.document.length > remaining ? `${c.document.slice(0, remaining)}\n…[truncated]` : c.document;
      parts.push(`${header}${body}`);
      used += header.length + body.length + 1;
    }
    return parts.join('\n');
  }

  // -- internals -----------------------------------------------------------

  private static toChunks(
    ids: string[] | undefined,
    documents: (string | null)[] | undefined,
    metadatas: (Metadata | null)[] | undefined,
    distances: (number | null)[] | undefined,
  ): RetrievedChunk[] {
    if (ids === undefined || ids.length === 0) return [];
    const out: RetrievedChunk[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      const document = documents?.[i];
      if (id === undefined || document === undefined || document === null) continue;
      const meta = ProjectIndexer.parseMetadata(metadatas?.[i], id);
      const distance = distances?.[i];
      out.push({
        id,
        document,
        filePath: meta.filePath,
        language: meta.language,
        ...(distance === undefined || distance === null ? {} : { distance }),
        metadata: meta,
      });
    }
    return out;
  }

  private static parseMetadata(meta: Metadata | null | undefined, id: string): ProjectFileMetadata {
    const fallback: ProjectFileMetadata = {
      filePath: ProjectIndexer.filePathFromId(id),
      language: 'other',
      chunkIndex: 0,
      totalChunks: 1,
    };
    if (meta === undefined || meta === null) return fallback;
    const filePath = typeof meta['filePath'] === 'string' ? meta['filePath'] : fallback.filePath;
    const languageRaw = typeof meta['language'] === 'string' ? meta['language'] : 'other';
    const chunkIndex = typeof meta['chunkIndex'] === 'number' ? meta['chunkIndex'] : 0;
    const totalChunks = typeof meta['totalChunks'] === 'number' ? meta['totalChunks'] : 1;
    return { filePath, language: ProjectIndexer.asLanguage(languageRaw), chunkIndex, totalChunks };
  }

  private static asLanguage(raw: string): ProjectFileLanguage {
    switch (raw) {
      case 'typescript':
      case 'javascript':
      case 'json':
      case 'markdown':
      case 'yaml':
      case 'text':
        return raw;
      default:
        return 'other';
    }
  }

  private static filePathFromId(id: string): string {
    const hash = id.lastIndexOf('#chunk-');
    return hash > 0 ? id.slice(0, hash) : id;
  }

  /** Deterministic keyword-overlap ranking over in-memory docs. */
  private keywordFallback(query: string, k: number): RetrievedChunk[] {
    const terms = new Set(query.toLowerCase().split(/[^a-z0-9_]+/g).filter((t) => t.length > 2));
    if (terms.size === 0 || this.memoryDocs.size === 0) return [];
    const scored: { doc: MemoryDoc; score: number }[] = [];
    for (const doc of this.memoryDocs.values()) {
      const haystack = `${doc.metadata.filePath} ${doc.document}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (haystack.includes(term)) score += term.length >= 6 ? 2 : 1;
      }
      if (score > 0) scored.push({ doc, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map(({ doc }) => ({
      id: doc.id,
      document: doc.document,
      filePath: doc.metadata.filePath,
      language: doc.metadata.language,
      metadata: doc.metadata,
    }));
  }

  private async collectFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        // Skip dotfiles/dirs (`.git`, `.env`, …) — never source.
        if (entry.name.startsWith('.')) continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          await walk(abs);
        } else if (entry.isFile()) {
          if (!INDEXABLE_EXTS.has(extname(entry.name).toLowerCase())) continue;
          try {
            const info = await stat(abs);
            if (info.size > this.maxFileBytes) continue;
          } catch {
            continue;
          }
          out.push(abs);
        }
      }
    };
    await walk(root);
    out.sort();
    return out;
  }

  private async chunkFile(root: string, abs: string): Promise<MemoryDoc[]> {
    let raw: string;
    try {
      raw = await readFile(abs, 'utf8');
    } catch {
      return [];
    }
    if (raw.includes('\0')) return []; // binary masquerading as text
    const rel = relative(root, abs) || abs;
    const lines = raw.split('\n');
    // Small files: single chunk (skip windowing overhead).
    if (lines.length <= this.chunkLines) {
      const text = raw.trimEnd();
      if (text.trim().length === 0) return [];
      return [
        {
          id: `${rel}#chunk-0`,
          document: text,
          metadata: { filePath: rel, language: languageForExtension(extname(abs)), chunkIndex: 0, totalChunks: 1 },
        },
      ];
    }
    const step = Math.max(1, this.chunkLines - this.chunkOverlap);
    const chunks: MemoryDoc[] = [];
    let index = 0;
    for (let start = 0; start < lines.length; start += step) {
      const slice = lines.slice(start, start + this.chunkLines).join('\n').trimEnd();
      if (slice.trim().length > 0) {
        chunks.push({
          id: `${rel}#chunk-${index}`,
          document: slice,
          metadata: { filePath: rel, language: languageForExtension(extname(abs)), chunkIndex: index, totalChunks: 1 },
        });
        index += 1;
      }
      if (start + this.chunkLines >= lines.length) break;
    }
    for (const c of chunks) c.metadata.totalChunks = chunks.length;
    return chunks;
  }
}
