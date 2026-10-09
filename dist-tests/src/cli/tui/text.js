"use strict";
/**
 * Plain-text layout helpers (width math on unstyled text; the TUI applies
 * ANSI styles per line at draw time so measurement stays exact).
 *
 * Width is counted in UTF-16 code units minus nothing — CJK/emoji count as
 * their code-unit length, which can misalign by a column on exotic input.
 * Accepted trade-off for zero dependencies; ASCII (the common case) is exact.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.wrapLine = wrapLine;
exports.fit = fit;
/** Greedy word wrap. Long words are hard-broken. Newlines are preserved. */
function wrapLine(text, width) {
    if (width <= 0)
        return [text];
    const out = [];
    for (const paragraph of text.split('\n')) {
        if (paragraph.length === 0) {
            out.push('');
            continue;
        }
        const words = paragraph.split(/ +/).filter((w) => w.length > 0);
        let current = '';
        for (const word of words) {
            if (word.length > width) {
                // Hard-break an overlong word (flush current line first).
                if (current.length > 0) {
                    out.push(current);
                    current = '';
                }
                for (let i = 0; i < word.length; i += width) {
                    out.push(word.slice(i, i + width));
                }
                continue;
            }
            const next = current.length === 0 ? word : `${current} ${word}`;
            if (next.length <= width) {
                current = next;
            }
            else {
                out.push(current);
                current = word;
            }
        }
        // current is empty only when the last word exactly filled its chunks
        // (whitespace-only paragraphs have no words and still need one line).
        if (current.length > 0 || words.length === 0)
            out.push(current);
    }
    return out;
}
/** Pad with spaces or hard-truncate to exactly `width` columns. */
function fit(text, width) {
    if (width <= 0)
        return '';
    if (text.length <= width)
        return text + ' '.repeat(width - text.length);
    if (width <= 1)
        return text.slice(0, width);
    return `${text.slice(0, width - 1)}…`;
}
