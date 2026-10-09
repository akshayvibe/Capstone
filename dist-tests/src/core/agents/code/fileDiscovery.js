"use strict";
/**
 * Source-file discovery for the CodeAgent.
 *
 * Scans a root directory, applies ignore patterns compatible with
 * ProjectIndexer, and returns a bounded list of supported source files.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverSourceFiles = discoverSourceFiles;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const grammars_js_1 = require("./parser/grammars.js");
const DEFAULT_IGNORE_PATTERNS = [
    /node_modules/,
    /\/dist\//,
    /\/dist-tests\//,
    /\/\.git\//,
    /\/coverage\//,
    /\.min\./,
    /\.d\.ts$/,
];
async function discoverSourceFiles(options) {
    const normalizedPriority = new Set((options.priorityFiles ?? []).map((p) => node_path_1.default.resolve(options.rootPath, p)));
    const found = [];
    const ignored = new Set();
    const patterns = options.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS;
    async function walk(dir) {
        if (found.length >= options.maxFiles)
            return;
        let entries;
        try {
            entries = await promises_1.default.readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (found.length >= options.maxFiles)
                return;
            const fullPath = node_path_1.default.join(dir, entry.name);
            if (patterns.some((pattern) => pattern.test(fullPath))) {
                continue;
            }
            if (entry.isDirectory()) {
                await walk(fullPath);
            }
            else if (entry.isFile() && (0, grammars_js_1.isSupportedExtension)(fullPath)) {
                found.push(fullPath);
            }
        }
    }
    await walk(options.rootPath);
    // Sort: priority files first, then alphabetical.
    found.sort((a, b) => {
        const aPriority = normalizedPriority.has(a);
        const bPriority = normalizedPriority.has(b);
        if (aPriority && !bPriority)
            return -1;
        if (!aPriority && bPriority)
            return 1;
        return a.localeCompare(b);
    });
    // Build ignored count for observability if needed; currently unused.
    void ignored;
    return found.slice(0, options.maxFiles);
}
