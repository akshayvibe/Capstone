"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LayaRouter = void 0;
const errors_js_1 = require("../../utils/errors.js");
const layaWire_js_1 = require("./layaWire.js");
/** Bound question set. `as const` keeps choice labels literal for inference. */
const ROUTING_QUESTIONS = {
    route: {
        type: 'choice',
        instructions: 'Which specialist agent should own this software task?',
        criteria: {
            analyze: 'code analysis, review, refactor, lint, explain, typescript, functions, bugs',
            secure: 'security audit, vulnerabilities, CVE, XSS, injection, SAST, pen test, threats',
            monitor: 'environment monitoring, health, uptime, metrics, logs, deploy, infra, docker, containers',
        },
    },
    urgency: {
        type: 'noul',
        instructions: 'Is this request urgent, time-sensitive, or blocking (outage, incident, deadline)?',
    },
    complexity: {
        type: 'score',
        instructions: 'How complex is this request to fulfil?',
        criteria: ['low', 'medium', 'high'],
    },
};
const VALID_INTENTS = ['analyze', 'secure', 'monitor'];
function isAgentIntent(value) {
    return VALID_INTENTS.includes(value);
}
function clamp01(n) {
    if (!Number.isFinite(n))
        return 0.5;
    if (n < 0)
        return 0;
    if (n > 1)
        return 1;
    return n;
}
function toComplexityLevel(score) {
    const rounded = Math.round(score);
    if (rounded <= 0)
        return 0;
    if (rounded >= 2)
        return 2;
    return 1;
}
class LayaRouter {
    url;
    timeout;
    injectedDecider;
    injectedClient;
    deciderPromise = null;
    constructor(deps = {}) {
        this.url = deps.url ?? process.env['LAYA_SIDECAR_URL'] ?? 'http://127.0.0.1:8000';
        this.timeout = deps.timeout ?? 3000;
        this.injectedDecider = deps.decider;
        this.injectedClient = deps.client;
    }
    /** Single decision round for one natural-language CLI request. */
    async decide(prompt) {
        const decider = await this.getDecider();
        let raw;
        try {
            raw = await decider(prompt);
        }
        catch (err) {
            if ((0, layaWire_js_1.isLayaShapedError)(err)) {
                throw new errors_js_1.LayaUnavailableError(`Laya sidecar request failed (${err.code}): ${err.message}`, {
                    url: this.url,
                    code: err.code,
                });
            }
            throw err;
        }
        return LayaRouter.normalize(raw);
    }
    /**
     * Resolve the bound decider, preferring `laya-http-client` and degrading
     * to the vendored wire transport. Resolved once and cached.
     */
    getDecider() {
        if (this.deciderPromise !== null)
            return this.deciderPromise;
        this.deciderPromise = (async () => {
            if (this.injectedDecider !== undefined)
                return this.injectedDecider;
            if (this.injectedClient !== undefined) {
                const client = this.injectedClient;
                return async (state) => ({
                    model: 'injected-client',
                    answers: (0, layaWire_js_1.validateRoutingAnswers)((await client.request({ state, questions: ROUTING_QUESTIONS })).answers),
                });
            }
            // Primary: the official typed client (loads under bun / tsx).
            try {
                const mod = await Promise.resolve().then(() => __importStar(require('laya-http-client')));
                const decider = mod.createDecider({
                    url: this.url,
                    timeout: this.timeout,
                    questions: ROUTING_QUESTIONS,
                });
                return async (state) => {
                    const res = await decider(state);
                    const answers = {
                        route: {
                            choice: res.answers.route.choice,
                            confidence: res.answers.route.confidence,
                            probabilities: { ...res.answers.route.probabilities },
                        },
                        urgency: { noul: res.answers.urgency.noul, confidence: res.answers.urgency.confidence },
                        complexity: { score: res.answers.complexity.score, confidence: res.answers.complexity.confidence },
                    };
                    return { model: res.model, answers };
                };
            }
            catch {
                // Stock Node.js cannot require the package's raw-TS entrypoint —
                // use the wire-compatible fetch transport instead.
                const wire = (0, layaWire_js_1.createWireClient)({ url: this.url, timeout: this.timeout });
                return async (state) => ({
                    model: 'laya-wire-fallback',
                    answers: (0, layaWire_js_1.validateRoutingAnswers)((await wire.request({ state, questions: ROUTING_QUESTIONS })).answers),
                });
            }
        })();
        return this.deciderPromise;
    }
    /** Validate + normalize a raw decider payload into the strict outcome type. */
    static normalize(raw) {
        if (!isAgentIntent(raw.answers.route.choice)) {
            throw new errors_js_1.LayaUnavailableError(`Laya returned an unknown route choice: "${raw.answers.route.choice}"`, {
                choice: raw.answers.route.choice,
            });
        }
        return {
            intent: raw.answers.route.choice,
            intentConfidence: raw.answers.route.confidence,
            intentProbabilities: { ...raw.answers.route.probabilities },
            urgency: clamp01(raw.answers.urgency.noul),
            urgencyConfidence: raw.answers.urgency.confidence,
            complexity: toComplexityLevel(raw.answers.complexity.score),
            complexityConfidence: raw.answers.complexity.confidence,
            model: raw.model,
        };
    }
}
exports.LayaRouter = LayaRouter;
