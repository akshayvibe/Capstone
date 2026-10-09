"use strict";
/**
 * Static code analysis agent powered by tree-sitter.
 *
 * Discovers supported source files, parses them with web-tree-sitter,
 * and runs a registry of AST-based rules to detect bugs, logical issues,
 * and code-quality problems.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeAgent = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const BaseAgent_js_1 = require("../base/BaseAgent.js");
const report_js_1 = require("../report.js");
const TreeSitterParser_js_1 = require("./parser/TreeSitterParser.js");
const fileDiscovery_js_1 = require("./fileDiscovery.js");
const index_js_1 = require("./rules/index.js");
const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
class CodeAgent extends BaseAgent_js_1.BaseAgent {
    name = 'CodeAgent';
    intent = 'analyze';
    async run(payload) {
        const report = (0, report_js_1.emptyReport)(this.name, this.intent);
        const rootPath = process.cwd();
        const maxFiles = parsePositiveInt(process.env['HELIX_CODE_MAX_FILES'], DEFAULT_MAX_FILES);
        const priorityFiles = payload.context?.retrievedChunks.map((chunk) => chunk.filePath) ?? [];
        let filePaths;
        try {
            filePaths = await (0, fileDiscovery_js_1.discoverSourceFiles)({ rootPath, maxFiles, priorityFiles });
        }
        catch (err) {
            return {
                success: false,
                summary: `Could not discover source files: ${err instanceof Error ? err.message : String(err)}`,
                data: report,
            };
        }
        const parseFailures = [];
        let parsedCount = 0;
        for (const filePath of filePaths) {
            let source;
            try {
                source = await promises_1.default.readFile(filePath, 'utf8');
            }
            catch (err) {
                parseFailures.push(`${node_path_1.default.relative(rootPath, filePath)}: ${err instanceof Error ? err.message : String(err)}`);
                continue;
            }
            const parsed = await (0, TreeSitterParser_js_1.parseFile)(filePath, source, { maxFileBytes: DEFAULT_MAX_FILE_BYTES });
            if ('reason' in parsed) {
                parseFailures.push(`${node_path_1.default.relative(rootPath, filePath)}: ${parsed.reason}`);
                (0, report_js_1.addIssue)(report, {
                    id: `${this.name}:parse-failure:${filePath}`,
                    ruleId: 'parse-failure',
                    title: 'Could not parse file',
                    message: parsed.reason,
                    severity: 'info',
                    category: 'code-quality',
                    location: { filePath },
                    evidence: parsed.reason,
                });
                continue;
            }
            parsedCount += 1;
            for (const rule of index_js_1.codeRules) {
                if (rule.languages.length > 0 && !rule.languages.includes(parsed.language))
                    continue;
                try {
                    const ruleIssues = rule.check(parsed);
                    for (const issue of ruleIssues) {
                        (0, report_js_1.addIssue)(report, issue);
                    }
                }
                catch (err) {
                    (0, report_js_1.addIssue)(report, {
                        id: `${this.name}:rule-error:${rule.id}:${filePath}`,
                        ruleId: 'rule-error',
                        title: `Rule ${rule.id} failed`,
                        message: err instanceof Error ? err.message : String(err),
                        severity: 'info',
                        category: 'code-quality',
                        location: { filePath },
                        evidence: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            parsed.tree.delete();
        }
        report.filesScanned = parsedCount;
        if (parseFailures.length > 0) {
            (0, report_js_1.attachRawEvidence)(report, { parseFailures }, payload.options.verbose);
        }
        if (parsedCount === 0 && filePaths.length > 0) {
            (0, report_js_1.addToolUnavailable)(report, 'tree-sitter', 'No source files could be parsed; check grammar files are present.');
        }
        return {
            success: true,
            summary: (0, report_js_1.formatSummary)(report),
            data: report,
        };
    }
}
exports.CodeAgent = CodeAgent;
function parsePositiveInt(raw, fallback) {
    if (raw === undefined || raw.trim().length === 0)
        return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed))
        return fallback;
    return parsed;
}
