"use strict";
/**
 * Thin wrapper around web-tree-sitter that loads grammars, parses files,
 * and exposes a typed rule-evaluation context.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSupportedExtension = void 0;
exports.parseFile = parseFile;
const web_tree_sitter_1 = __importDefault(require("web-tree-sitter"));
const grammars_js_1 = require("./grammars.js");
Object.defineProperty(exports, "isSupportedExtension", { enumerable: true, get: function () { return grammars_js_1.isSupportedExtension; } });
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024; // 1 MB
async function parseFile(filePath, source, options = {}) {
    if (source.length > (options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)) {
        return { filePath, reason: 'file exceeds size budget' };
    }
    const language = (0, grammars_js_1.extensionToLanguage)(filePath);
    if (language === undefined) {
        return { filePath, reason: 'unsupported file extension' };
    }
    try {
        const lang = await (0, grammars_js_1.loadLanguage)(language);
        const parser = new web_tree_sitter_1.default();
        parser.setLanguage(lang);
        const tree = parser.parse(source);
        return { filePath, language, source, tree };
    }
    catch (err) {
        return {
            filePath,
            reason: err instanceof Error ? err.message : String(err),
        };
    }
}
