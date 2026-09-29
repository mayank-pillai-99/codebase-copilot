import { z } from 'zod';

export const chatRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Ask a question about the code')
    .max(2_000, 'Questions are limited to 2,000 characters'),
  sessionId: z.uuid().optional(),
});

/** A retrieved chunk offered to the model as [marker]. */
export const chatSourceSchema = z.object({
  marker: z.number().int().positive(),
  chunkId: z.uuid(),
  path: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  label: z.string().nullable(),
});

export const chatCitationSchema = z.object({
  marker: z.number().int().positive(),
  path: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  label: z.string().nullable(),
});

export const chatMessageSchema = z.object({
  id: z.uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  flagged: z.boolean(),
  citations: z.array(chatCitationSchema),
  createdAt: z.iso.datetime(),
});

export const chatSessionSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  updatedAt: z.iso.datetime(),
});

export const chatSessionResponseSchema = z.object({
  session: chatSessionSummarySchema.extend({ snapshotId: z.uuid() }),
  messages: z.array(chatMessageSchema),
});

export const chatSessionListResponseSchema = z.object({
  sessions: z.array(chatSessionSummarySchema),
});

/**
 * Server-Sent Events emitted by POST /api/snapshots/:id/chat, in order:
 * session → sources → token* → done, or error at any point.
 */
export const chatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), sessionId: z.uuid() }),
  z.object({ type: z.literal('sources'), sources: z.array(chatSourceSchema) }),
  z.object({ type: z.literal('token'), text: z.string() }),
  z.object({
    type: z.literal('done'),
    messageId: z.uuid(),
    /** Final text with invalid citation markers removed. */
    content: z.string(),
    citations: z.array(chatCitationSchema),
    /** True when the model cited sources it wasn't given (those markers were removed). */
    flagged: z.boolean(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatSource = z.infer<typeof chatSourceSchema>;
export type ChatCitation = z.infer<typeof chatCitationSchema>;
export type ChatMessageDto = z.infer<typeof chatMessageSchema>;
export type ChatSessionSummary = z.infer<typeof chatSessionSummarySchema>;
export type ChatEvent = z.infer<typeof chatEventSchema>;
