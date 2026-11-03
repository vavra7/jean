import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  value: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ProviderSchema = z.union([z.literal("nvidia"), z.literal("ollama")]);
export type Provider = z.infer<typeof ProviderSchema>;

export const ModelSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  provider: ProviderSchema,
  externalModelId: z.string(),
  createdAt: z.preprocess((v) => (v instanceof Date ? v.toISOString() : v), z.string().datetime()),
});

export type Model = z.infer<typeof ModelSchema>;

export const CreateModelSchema = z.object({
  provider: ProviderSchema,
  externalModelId: z.string().min(1),
  label: z.string().optional(),
});

export type CreateModel = z.infer<typeof CreateModelSchema>;

export const ModelListSchema = z.array(ModelSchema);
export type ModelList = z.infer<typeof ModelListSchema>;

export const ModelTestRequestSchema = z.object({
  provider: ProviderSchema,
  externalModelId: z.string().min(1),
});

export type ModelTestRequest = z.infer<typeof ModelTestRequestSchema>;

export const ModelTestResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

export type ModelTestResponse = z.infer<typeof ModelTestResponseSchema>;

export const ThreadSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  selectedProvider: z.string().nullable(),
  selectedExternalModelId: z.string().nullable(),
  createdAt: z.preprocess((v) => (v instanceof Date ? v.toISOString() : v), z.string().datetime()),
  updatedAt: z.preprocess((v) => (v instanceof Date ? v.toISOString() : v), z.string().datetime()),
});

export type Thread = z.infer<typeof ThreadSchema>;

export const CreateThreadSchema = z.object({
  title: z.string().optional(),
});

export type CreateThread = z.infer<typeof CreateThreadSchema>;

export const ThreadListSchema = z.array(ThreadSchema);
export type ThreadList = z.infer<typeof ThreadListSchema>;

export const SwitchThreadModelSchema = z.object({
  provider: ProviderSchema,
  externalModelId: z.string().min(1),
});

export type SwitchThreadModel = z.infer<typeof SwitchThreadModelSchema>;

export const MessageSchema = z.object({
  id: z.string().uuid(),
  role: z.union([z.literal("user"), z.literal("assistant")]),
  content: z.string(),
  model: z.string().nullable(),
  interrupted: z.boolean(),
  createdAt: z.preprocess((v) => (v instanceof Date ? v.toISOString() : v), z.string().datetime()),
});

export type Message = z.infer<typeof MessageSchema>;

export const MessageListSchema = z.array(MessageSchema);
export type MessageList = z.infer<typeof MessageListSchema>;

export const SendMessageSchema = z.object({
  content: z.string().min(1),
});

export type SendMessage = z.infer<typeof SendMessageSchema>;

export const SessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  expiresAt: z.string().datetime(),
});

export type Session = z.infer<typeof SessionSchema>;

export const AuthMeSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
  isAdmin: z.boolean(),
});

export type AuthMe = z.infer<typeof AuthMeSchema>;
