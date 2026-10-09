"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseAgent = void 0;
/**
 * Shared timing helper so concrete agents stay thin.
 * Open/Closed: extend behaviour by subclassing, not by modifying callers.
 */
class BaseAgent {
    async execute(payload) {
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
exports.BaseAgent = BaseAgent;
