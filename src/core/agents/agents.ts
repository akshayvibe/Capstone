import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentIntent, AgentPayload, AgentResult } from '../../types/index.js';

const execFileAsync = promisify(execFile);
const DOCKER_TIMEOUT_MS = 10_000;

interface DockerContainer {
  name: string;
  image: string;
  status: string;
}

/**
 * Minimal contract every specialized sub-agent must satisfy.
 * Interface Segregation: agents only depend on `execute(payload)`.
 */
export interface IAgent {
  readonly name: string;
  readonly intent: AgentIntent;
  execute(payload: AgentPayload): Promise<AgentResult>;
}

/**
 * Shared timing helper so concrete agents stay thin.
 * Open/Closed: extend behaviour by subclassing, not by modifying callers.
 */
export abstract class BaseAgent implements IAgent {
  public abstract readonly name: string;
  public abstract readonly intent: AgentIntent;

  protected abstract run(payload: AgentPayload): Promise<Omit<AgentResult, 'agent' | 'intent' | 'durationMs'>>;

  public async execute(payload: AgentPayload): Promise<AgentResult> {
    const started = Date.now();
    const partial = await this.run(payload);
    return {
      agent: this.name,
      intent: this.intent,
      durationMs: Date.now() - started,
      ...partial,
    };
  }
}

/** Placeholder: static code analysis agent (future real implementation). */
export class CodeAgent extends BaseAgent {
  public readonly name = 'CodeAgent';
  public readonly intent: AgentIntent = 'analyze';

  protected async run(payload: AgentPayload): Promise<Omit<AgentResult, 'agent' | 'intent' | 'durationMs'>> {
    const chunks = payload.context?.retrievedChunks.length ?? 0;
    return {
      success: true,
      summary: `[CodeAgent:mock] analyzed prompt "${payload.prompt}" (dryRun=${payload.options.dryRun}, contextChunks=${chunks})`,
      data: { filesScanned: 0, findings: [], contextChunks: chunks },
    };
  }
}

/** Placeholder: security scanning agent (future real implementation). */
export class SecurityAgent extends BaseAgent {
  public readonly name = 'SecurityAgent';
  public readonly intent: AgentIntent = 'secure';

  protected async run(payload: AgentPayload): Promise<Omit<AgentResult, 'agent' | 'intent' | 'durationMs'>> {
    const chunks = payload.context?.retrievedChunks.length ?? 0;
    return {
      success: true,
      summary: `[SecurityAgent:mock] security scan for "${payload.prompt}" (dryRun=${payload.options.dryRun}, contextChunks=${chunks})`,
      data: { vulnerabilities: [], contextChunks: chunks },
    };
  }
}

/** Placeholder: environment / infra monitoring agent with live Docker inspection. */
export class EnvironmentAgent extends BaseAgent {
  public readonly name = 'EnvironmentAgent';
  public readonly intent: AgentIntent = 'monitor';

  protected async run(payload: AgentPayload): Promise<Omit<AgentResult, 'agent' | 'intent' | 'durationMs'>> {
    const chunks = payload.context?.retrievedChunks.length ?? 0;
    if (/(docker|container|compose|k8s|kubectl|kubernetes|podman)/i.test(payload.prompt)) {
      return this.dockerStatus(chunks);
    }
    return {
      success: true,
      summary: `[EnvironmentAgent:mock] environment check for "${payload.prompt}" (dryRun=${payload.options.dryRun}, contextChunks=${chunks})`,
      data: { healthy: true, contextChunks: chunks },
    };
  }

  /**
   * Run `docker ps` (fixed argv, no shell — no injection surface) and report
   * what is actually running. A missing CLI/daemon is itself the answer, so
   * this still resolves successfully with `dockerAvailable: false`.
   */
  private async dockerStatus(
    chunks: number,
  ): Promise<Omit<AgentResult, 'agent' | 'intent' | 'durationMs'>> {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync('docker', ['ps', '--format', '{{.Names}}\t{{.Image}}\t{{.Status}}'], {
        timeout: DOCKER_TIMEOUT_MS,
        windowsHide: true,
      }));
    } catch (err: unknown) {
      const reason = firstLine(err instanceof Error ? err.message : String(err));
      return {
        success: true,
        summary: `Could not list Docker containers: ${reason}`,
        data: { containers: [], dockerAvailable: false, contextChunks: chunks },
      };
    }
    const containers: DockerContainer[] = [];
    for (const line of stdout.split('\n')) {
      const parts = line.split('\t').map((p) => p.trim());
      const [name = '', image = '', status = ''] = parts;
      if (name.length === 0) continue;
      containers.push({ name, image, status });
    }
    if (containers.length === 0) {
      return {
        success: true,
        summary: 'No running Docker containers.',
        data: { containers, dockerAvailable: true, contextChunks: chunks },
      };
    }
    const listed = containers.map((c) => `${c.name} (${c.image || 'unknown image'} — ${c.status || 'no status'})`);
    return {
      success: true,
      summary: `Running Docker containers (${containers.length}): ${listed.join('; ')}`,
      data: { containers, dockerAvailable: true, contextChunks: chunks },
    };
  }
}

/** First non-empty line of a message, capped — keeps summaries one line. */
function firstLine(message: string, maxChars = 160): string {
  const line = message
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (line === undefined) return 'unknown error';
  return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line;
}
