"use strict";
/**
 * Grammar resolution for web-tree-sitter.
 *
 * Maps file extensions to prebuilt WASM grammar files shipped by
 * `tree-sitter-wasms`. All grammars are loaded lazily and cached.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extensionToLanguage = extensionToLanguage;
exports.loadLanguage = loadLanguage;
exports.isSupportedExtension = isSupportedExtension;
const node_path_1 = __importDefault(require("node:path"));
const web_tree_sitter_1 = __importDefault(require("web-tree-sitter"));
// When running from dist/, the wasm files live in node_modules at project root.
const GRAMMAR_DIR = node_path_1.default.resolve(__dirname, '../../../../../../node_modules/tree-sitter-wasms/out');
function extensionToLanguage(filePath) {
    const ext = node_path_1.default.extname(filePath).toLowerCase();
    switch (ext) {
        case '.ts':
            return 'typescript';
        case '.tsx':
            return 'tsx';
        case '.js':
            return 'javascript';
        case '.jsx':
            return 'jsx';
        default:
            return undefined;
    }
}
const grammarFileName = {
    typescript: 'tree-sitter-typescript.wasm',
    tsx: 'tree-sitter-tsx.wasm',
    javascript: 'tree-sitter-javascript.wasm',
    jsx: 'tree-sitter-javascript.wasm',
};
const languageCache = new Map();
async function loadLanguage(language) {
    const cached = languageCache.get(language);
    if (cached)
        return cached;
    await web_tree_sitter_1.default.init();
    const wasmPath = node_path_1.default.join(GRAMMAR_DIR, grammarFileName[language]);
    const lang = await web_tree_sitter_1.default.Language.load(wasmPath);
    languageCache.set(language, lang);
    return lang;
}
function isSupportedExtension(filePath) {
    return extensionToLanguage(filePath) !== undefined;
}
