"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HashEmbeddingFunction = void 0;
/**
 * Deterministic, dependency-free embedding function for HELIX.
 *
 * Hashes whitespace/punctuation-delimited tokens into a fixed-dimension
 * vector and L2-normalizes it, so cosine similarity approximates token
 * overlap. This is intentionally *not* a semantic embedding — it exists so
 * `ProjectIndexer` works offline (no ONNX download, no API key) and so
 * unit tests stay deterministic.
 *
 * Production swap: pass `DefaultEmbeddingFunction` from
 * `@chroma-core/default-embed` (or an OpenAI/cohere EF) into
 * `ProjectIndexer` instead. The indexer depends only on the
 * `EmbeddingFunction` interface, so the swap is one constructor argument.
 */
class HashEmbeddingFunction {
    name = 'helix-hash-embed';
    dim;
    constructor(dim = 384) {
        if (!Number.isInteger(dim) || dim <= 0) {
            throw new Error(`HashEmbeddingFunction dim must be a positive integer, got ${dim}`);
        }
        this.dim = dim;
    }
    defaultSpace() {
        return 'cosine';
    }
    supportedSpaces() {
        return ['cosine', 'l2'];
    }
    async generate(texts) {
        return texts.map((t) => this.embedOne(t));
    }
    embedOne(text) {
        const vec = new Array(this.dim).fill(0);
        const tokens = text.toLowerCase().split(/[^a-z0-9_]+/g).filter((t) => t.length > 0);
        if (tokens.length === 0) {
            vec[0] = 1;
            return vec;
        }
        for (const token of tokens) {
            const h = HashEmbeddingFunction.fnv1a(token);
            // Two near-independent projections reduce bucket collisions:
            // a count bucket plus a signed bucket.
            const idx = h % this.dim;
            vec[idx] = (vec[idx] ?? 0) + 1;
            const signIdx = (h >>> 8) % this.dim;
            const sign = (h & 1) === 0 ? 0.5 : -0.5;
            vec[signIdx] = (vec[signIdx] ?? 0) + sign;
        }
        // L2-normalize so cosine similarity is a dot product.
        let norm = 0;
        for (const v of vec)
            norm += (v ?? 0) * (v ?? 0);
        norm = Math.sqrt(norm) || 1;
        return vec.map((v) => (v ?? 0) / norm);
    }
    /** 32-bit FNV-1a hash — fast, stable across runs and platforms. */
    static fnv1a(s) {
        let h = 0x81_1c_9d_c5;
        for (let i = 0; i < s.length; i += 1) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01_00_01_93);
        }
        return h >>> 0;
    }
}
exports.HashEmbeddingFunction = HashEmbeddingFunction;
