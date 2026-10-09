import type { AgentIntent, AgentPayload, AgentResult } from '../../../types/index.js';

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
