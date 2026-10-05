import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import {
  BaseChatModel,
  type BaseChatModelParams,
} from '@langchain/core/language_models/chat_models';
import { AIMessage, AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';

const API = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiChatFields extends BaseChatModelParams {
  apiKey: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  fetch?: typeof fetch;
}

/** Carries the HTTP status so callers can tell overload (503) from rate limits (429). */
class GeminiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`[${status}] ${message}`);
    this.name = 'GeminiRequestError';
  }
}

/**
 * A LangChain chat model for Gemini, calling the REST streaming endpoint directly.
 *
 * LangChain's own Gemini integration is built on Google's deprecated
 * `@google/generative-ai` SDK, which failed to parse streams from current models in
 * production and then crashed the process with an unhandled promise rejection. This
 * client parses the server-sent events itself, never leaves a promise unobserved, and
 * reports errors with their HTTP status.
 */
export class GeminiChat extends BaseChatModel {
  readonly model: string;
  private readonly apiKey: string;
  private readonly temperature: number;
  private readonly maxOutputTokens: number;
  private readonly doFetch: typeof fetch;

  constructor(fields: GeminiChatFields) {
    super(fields);
    this.apiKey = fields.apiKey;
    this.model = fields.model;
    this.temperature = fields.temperature ?? 0.2;
    this.maxOutputTokens = fields.maxOutputTokens ?? 2_048;
    this.doFetch = fields.fetch ?? fetch;
  }

  _llmType(): string {
    return 'gemini-rest';
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const res = await this.doFetch(`${API}/models/${this.model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(this.requestBody(messages)),
      signal: options.signal ?? null,
    });
    if (!res.ok || !res.body) {
      const detail = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new GeminiRequestError(res.status, detail?.error?.message ?? res.statusText);
    }

    for await (const event of readServerSentEvents(res.body)) {
      const parsed = parseEvent(event);
      if (parsed.error) throw new GeminiRequestError(parsed.error.code, parsed.error.message);
      if (!parsed.text) continue;
      const chunk = new ChatGenerationChunk({
        text: parsed.text,
        message: new AIMessageChunk({ content: parsed.text }),
      });
      yield chunk;
      await runManager?.handleLLMNewToken(parsed.text);
    }
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    let text = '';
    for await (const chunk of this._streamResponseChunks(messages, options, runManager)) {
      text += chunk.text;
    }
    return { generations: [{ text, message: new AIMessage(text) }] };
  }

  private requestBody(messages: BaseMessage[]) {
    const system = messages.filter((m) => m.getType() === 'system').map(textOf);
    const turns = messages
      .filter((m) => m.getType() !== 'system')
      .map((m) => ({
        role: m.getType() === 'ai' ? 'model' : 'user',
        parts: [{ text: textOf(m) }],
      }));
    return {
      ...(system.length && { systemInstruction: { parts: [{ text: system.join('\n\n') }] } }),
      contents: turns,
      generationConfig: { temperature: this.temperature, maxOutputTokens: this.maxOutputTokens },
    };
  }
}

function textOf(message: BaseMessage): string {
  return typeof message.content === 'string' ? message.content : message.text;
}

/** Splits a text/event-stream body into event data payloads (handles \n and \r\n). */
export async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of body) {
    // Normalize the whole buffer: a \r\n can be split across two network chunks.
    buffer = (buffer + decoder.decode(bytes, { stream: true })).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const data = dataOf(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (data) yield data;
      boundary = buffer.indexOf('\n\n');
    }
  }
  const rest = dataOf(buffer);
  if (rest) yield rest;
}

function dataOf(block: string): string {
  return block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
}

interface ParsedEvent {
  text: string;
  error?: { code: number; message: string };
}

/**
 * Pulls answer text out of one streamed response. Thought parts are skipped, and
 * events without text (usage metadata, a final finishReason) are ignored rather
 * than treated as failures.
 */
export function parseEvent(data: string): ParsedEvent {
  let json: {
    candidates?: {
      content?: { parts?: { text?: string; thought?: boolean }[] };
      finishReason?: string;
    }[];
    promptFeedback?: { blockReason?: string };
    error?: { code?: number; message?: string };
  };
  try {
    json = JSON.parse(data);
  } catch {
    return {
      text: '',
      error: { code: 502, message: 'Unreadable data in the model response stream' },
    };
  }
  if (json.error) {
    return {
      text: '',
      error: { code: json.error.code ?? 500, message: json.error.message ?? 'error' },
    };
  }
  if (json.promptFeedback?.blockReason) {
    return {
      text: '',
      error: { code: 400, message: `Request blocked: ${json.promptFeedback.blockReason}` },
    };
  }
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return {
    text: parts
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join(''),
  };
}
