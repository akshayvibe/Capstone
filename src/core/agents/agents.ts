/**
 * Agent registry barrel.
 *
 * The orchestrator and CLI import concrete agents from here so the
 * internal file layout can evolve without touching callers.
 */

export { BaseAgent, type IAgent } from './base/BaseAgent.js';
export { CodeAgent } from './code/CodeAgent.js';
export { SecurityAgent } from './security/SecurityAgent.js';
export { EnvironmentAgent } from './environment/EnvironmentAgent.js';
