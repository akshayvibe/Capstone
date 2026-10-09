/**
 * OpenRouter chat client.
 *
 * Thin wrapper over the OpenAI SDK pointed at OpenRouter's compatible
 * endpoint. Used by the interactive chat loop to turn user prompts,
 * RAG context, and agent reports into natural-language responses.
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';

export interface OpenRouterClientOptions {
  apiKey?: string | undefined;
  baseURL?: string | undefined;
  model?: string | undefined;
  timeoutMs?: number | undefined;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionResult {
  ok: true;
  message: string;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
}

export interface ChatCompletionError {
  ok: false;
  message: string;
}

export type ChatCompletionResponse = ChatCompletionResult | ChatCompletionError;

export class OpenRouterClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly timeoutMs: number;

  public constructor(options: OpenRouterClientOptions = {}) {
    if (options.apiKey === undefined || options.apiKey.length === 0) {
      throw new Error('OpenRouter API key is required (set OPENROUTER_API_KEY).');
    }
    this.client = new OpenAI({
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

  public async complete(messages: readonly ChatMessage[]): Promise<ChatCompletionResponse> {
    try {
      const params: OpenAI.Chat.ChatCompletionCreateParams = {
        model: this.model,
        messages: messages as ChatCompletionMessageParam[],
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
    } catch (err: unknown) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
