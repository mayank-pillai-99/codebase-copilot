import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { PromptMessage } from '../chat/prompt';

/** The narrow interface chat needs from an LLM, so providers (and test fakes) can swap. */
export interface ChatModel {
  readonly model: string;
  /** Streams answer text. Rejects on provider errors; stops early when `signal` aborts. */
  stream(messages: PromptMessage[], signal?: AbortSignal): AsyncIterable<string>;
}

export class ChatModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatModelError';
  }
}

/** Gemini through LangChain's ChatGoogleGenerativeAI. */
export function createGeminiChatModel(options: { apiKey: string; model: string }): ChatModel {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: options.apiKey,
    model: options.model,
    temperature: 0.2,
    maxOutputTokens: 2_048,
    maxRetries: 2,
  });

  return {
    model: options.model,
    async *stream(messages, signal) {
      let stream;
      try {
        stream = await llm.stream(messages.map(toLangChain), { signal });
      } catch (err) {
        throw new ChatModelError(describe(err));
      }
      try {
        for await (const chunk of stream) {
          const text = typeof chunk.content === 'string' ? chunk.content : chunk.text;
          if (text) yield text;
        }
      } catch (err) {
        if (signal?.aborted) return;
        throw new ChatModelError(describe(err));
      }
    },
  };
}

function toLangChain(message: PromptMessage): BaseMessage {
  if (message.role === 'system') return new SystemMessage(message.content);
  if (message.role === 'assistant') return new AIMessage(message.content);
  return new HumanMessage(message.content);
}

function describe(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/429|quota|rate/i.test(text))
    return 'The AI service is busy (rate limit). Try again in a minute.';
  if (/API key|permission|403|401/i.test(text))
    return 'The AI service rejected the request. Check the API key.';
  return 'The AI service failed to answer. Please try again.';
}
