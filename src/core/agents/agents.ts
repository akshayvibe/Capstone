import type { AgentIntent, AgentPayload, AgentResult } from '../../types/index.js';

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

/** Placeholder: environment / infra monitoring agent (future real implementation). */
export class EnvironmentAgent extends BaseAgent {
  public readonly name = 'EnvironmentAgent';
  public readonly intent: AgentIntent = 'monitor';

  protected async run(payload: AgentPayload): Promise<Omit<AgentResult, 'agent' | 'intent' | 'durationMs'>> {
    const chunks = payload.context?.retrievedChunks.length ?? 0;
    return {
      success: true,
      summary: `[EnvironmentAgent:mock] environment check for "${payload.prompt}" (dryRun=${payload.options.dryRun}, contextChunks=${chunks})`,
      data: { healthy: true, contextChunks: chunks },
    };
  }
}
