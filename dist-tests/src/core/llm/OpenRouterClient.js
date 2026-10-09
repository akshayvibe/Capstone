"use strict";
/**
 * OpenRouter chat client.
 *
 * Thin wrapper over the OpenAI SDK pointed at OpenRouter's compatible
 * endpoint. Used by the interactive chat loop to turn user prompts,
 * RAG context, and agent reports into natural-language responses.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenRouterClient = void 0;
const openai_1 = __importDefault(require("openai"));
class OpenRouterClient {
    client;
    model;
    timeoutMs;
    constructor(options = {}) {
        if (options.apiKey === undefined || options.apiKey.length === 0) {
            throw new Error('OpenRouter API key is required (set OPENROUTER_API_KEY).');
        }
        this.client = new openai_1.default({
            apiKey: options.apiKey,
            baseURL: options.baseURL ?? 'https://openrouter.ai/api/v1',
            timeout: options.timeoutMs ?? 60_000,
            defaultHeaders: {
                'HTTP-Referer': 'https://github.com/helix-cli',
                'X-Title': 'HELIX',
            },
        });
        this.model = options.model ?? 'openai/gpt-4o-mini';
        this.timeoutMs = options.timeoutMs ?? 60_000;
    }
    async complete(messages) {
        try {
            const params = {
                model: this.model,
                messages: messages,
                temperature: 0.3,
                max_tokens: 2048,
            };
            const response = await this.client.chat.completions.create(params, {
                timeout: this.timeoutMs,
            });
            const choice = response.choices[0];
            const content = choice?.message?.content;
            if (content === null || content === undefined || content.length === 0) {
                return { ok: false, message: 'OpenRouter returned an empty response.' };
            }
            return {
                ok: true,
                message: content,
                model: response.model ?? this.model,
                usage: response.usage
                    ? {
                        prompt_tokens: response.usage.prompt_tokens,
                        completion_tokens: response.usage.completion_tokens,
                        total_tokens: response.usage.total_tokens,
                    }
                    : undefined,
            };
        }
        catch (err) {
            return {
                ok: false,
                message: err instanceof Error ? err.message : String(err),
            };
        }
    }
}
exports.OpenRouterClient = OpenRouterClient;
