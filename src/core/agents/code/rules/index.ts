/**
 * Code analysis rule registry.
 *
 * Adding a new rule is a single import + array entry; the rule engine
 * discovers rules from this registry at runtime.
 */

import type { CodeRule } from './types.js';
import { syntaxErrorsRule } from './syntaxErrors.js';
import { looseEqualityRule } from './looseEquality.js';
import { emptyCatchRule } from './emptyCatch.js';
import { unreachableCodeRule } from './unreachableCode.js';
import { consoleStatementsRule } from './consoleStatements.js';
import { varUsageRule } from './varUsage.js';
import { anyTypeRule } from './anyType.js';
import { floatingPromisesRule } from './floatingPromises.js';
import { functionMetricsRule } from './functionMetrics.js';

export const codeRules: readonly CodeRule[] = [
  syntaxErrorsRule,
  looseEqualityRule,
  emptyCatchRule,
  unreachableCodeRule,
  consoleStatementsRule,
  varUsageRule,
  anyTypeRule,
  floatingPromisesRule,
  functionMetricsRule,
];

export * from './types.js';
