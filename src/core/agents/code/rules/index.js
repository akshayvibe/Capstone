"use strict";
/**
 * Code analysis rule registry.
 *
 * Adding a new rule is a single import + array entry; the rule engine
 * discovers rules from this registry at runtime.
 */
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.codeRules = void 0;
const syntaxErrors_js_1 = require("./syntaxErrors.js");
const looseEquality_js_1 = require("./looseEquality.js");
const emptyCatch_js_1 = require("./emptyCatch.js");
const unreachableCode_js_1 = require("./unreachableCode.js");
const consoleStatements_js_1 = require("./consoleStatements.js");
const varUsage_js_1 = require("./varUsage.js");
const anyType_js_1 = require("./anyType.js");
const floatingPromises_js_1 = require("./floatingPromises.js");
const functionMetrics_js_1 = require("./functionMetrics.js");
exports.codeRules = [
    syntaxErrors_js_1.syntaxErrorsRule,
    looseEquality_js_1.looseEqualityRule,
    emptyCatch_js_1.emptyCatchRule,
    unreachableCode_js_1.unreachableCodeRule,
    consoleStatements_js_1.consoleStatementsRule,
    varUsage_js_1.varUsageRule,
    anyType_js_1.anyTypeRule,
    floatingPromises_js_1.floatingPromisesRule,
    functionMetrics_js_1.functionMetricsRule,
];
__exportStar(require("./types.js"), exports);
