"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderResponse = renderResponse;
/** Print one orchestrator response to stdout (human or JSON). Logs stay on stderr. */
function renderResponse(response, opts) {
    if (opts.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
    }
    console.log(`\nHELIX trace ${response.traceId} (${response.durationMs}ms)`);
    console.log(`prompt : ${response.prompt}`);
    console.log(`intents: ${response.intents.join(', ') || '(none)'}${response.dryRun ? ' [dry-run]' : ''}\n`);
    if (response.results.length === 0) {
        console.log('(no agents executed — see routing above)\n');
        return;
    }
    for (const r of response.results) {
        const icon = r.success ? '✔' : '✘';
        console.log(`${icon} [${r.agent}/${r.intent}] ${r.summary} (${r.durationMs}ms)`);
    }
    console.log('');
}
