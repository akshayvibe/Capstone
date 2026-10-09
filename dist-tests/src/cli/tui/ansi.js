"use strict";
/** Minimal ANSI helpers for the full-screen terminal UI. No dependencies. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLEAR_LINE = exports.SHOW_CURSOR = exports.HIDE_CURSOR = exports.ALT_EXIT = exports.ALT_ENTER = exports.GRAY = exports.CYAN = exports.BLUE = exports.YELLOW = exports.GREEN = exports.RED = exports.DIM = exports.BOLD = exports.RESET = void 0;
exports.moveTo = moveTo;
exports.spinnerAt = spinnerAt;
exports.RESET = '\x1b[0m';
exports.BOLD = '\x1b[1m';
exports.DIM = '\x1b[2m';
exports.RED = '\x1b[31m';
exports.GREEN = '\x1b[32m';
exports.YELLOW = '\x1b[33m';
exports.BLUE = '\x1b[34m';
exports.CYAN = '\x1b[36m';
exports.GRAY = '\x1b[90m';
/** Enter/exit the alternate screen buffer (leaves scrollback untouched). */
exports.ALT_ENTER = '\x1b[?1049h';
exports.ALT_EXIT = '\x1b[?1049l';
exports.HIDE_CURSOR = '\x1b[?25l';
exports.SHOW_CURSOR = '\x1b[?25h';
/** Erase from cursor to end of line. */
exports.CLEAR_LINE = '\x1b[K';
/** 1-based cursor positioning. */
function moveTo(row, col) {
    return `\x1b[${Math.max(1, row)};${Math.max(1, col)}H`;
}
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
/** Braille spinner frame for a millisecond timestamp. */
function spinnerAt(nowMs) {
    const frame = SPINNER_FRAMES[Math.floor(nowMs / 120) % SPINNER_FRAMES.length];
    return frame ?? '⠋';
}
