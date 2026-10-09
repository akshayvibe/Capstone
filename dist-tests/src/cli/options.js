"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TIMEOUT_MS = void 0;
exports.normalizeOptions = normalizeOptions;
exports.intentsFromOptions = intentsFromOptions;
const errors_js_1 = require("../utils/errors.js");
exports.DEFAULT_TIMEOUT_MS = 30_000;
/** Normalize raw commander options into a validated CliOptions object. */
function normalizeOptions(raw) {
    let timeoutMs = exports.DEFAULT_TIMEOUT_MS;
    if (raw.timeout !== undefined) {
        const parsed = Number(raw.timeout);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new errors_js_1.CliValidationError(`Invalid --timeout value: "${raw.timeout}". Expected a positive number of ms.`);
        }
        timeoutMs = Math.floor(parsed);
    }
    return {
        analyze: raw.analyze === true,
        secure: raw.secure === true,
        monitor: raw.monitor === true,
        verbose: raw.verbose === true,
        json: raw.json === true,
        dryRun: raw.dryRun === true,
        timeoutMs,
    };
}
/** Derive explicit intents from flags; empty => let orchestrator infer. */
function intentsFromOptions(opts) {
    const intents = [];
    if (opts.analyze)
        intents.push('analyze');
    if (opts.secure)
        intents.push('secure');
    if (opts.monitor)
        intents.push('monitor');
    return intents;
}
