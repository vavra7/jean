import { FastifyInstance } from "fastify";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { getPool } from "../db/index.js";
import { requireAuthHandler } from "../auth.js";
import { buildProviderRegistry } from "../providers/index.js";
import { getEnv } from "../env.js";
import { buildSystemPrompt } from "../system-prompt.js";
import { camelizeKeys } from "../lib/camelize.js";

const IdParamsSchema = z.object({
  id: z.string().uuid(),
});

const SendMessageSchema = z.object({
  content: z.string().min(1),
});

const NO_MODEL = "NO_MODEL";
const MODEL_DELIMITER = "/";

function modelString(provider: string, externalModelId: string): string {
  return `${provider}${MODEL_DELIMITER}${externalModelId}`;
}

function getRegistry() {
  const env = getEnv();
  return buildProviderRegistry({
    NVIDIA_BASE_URL: env.NVIDIA_BASE_URL,
    NVIDIA_API_KEY: env.NVIDIA_API_KEY,
    OLLAMA_BASE_URL: env.OLLAMA_BASE_URL,
  });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerMessagesRoutes(app: FastifyInstance): void {
  const typed = app
    .withTypeProvider<ZodTypeProvider>()
    .setValidatorCompiler(validatorCompiler)
    .setSerializerCompiler(serializerCompiler);

  typed.post(
    "/api/threads/:id/messages",
    {
      schema: {
        params: IdParamsSchema,
        body: SendMessageSchema,
      },
    },
    async (req, reply) => {
      const auth = await requireAuthHandler(req.cookies);
      if ("status" in auth) {
        return reply.status(401).send({ error: "not authenticated" });
      }

      const { content } = req.body;
      const pool = getPool();

      // Resolve the thread and its model snapshot (ownership → 404).
      const { rows: threads } = await pool.query(
        `SELECT id, user_id, selected_provider AS selectedProvider,
                 selected_external_model_id AS selectedExternalModelId
           FROM threads
          WHERE id = $1`,
        [req.params.id],
      );
      const thread = threads[0] ? camelizeKeys(threads[0]) : undefined;
      if (!thread || thread.userId !== auth.user.id) {
        return reply.status(404).send({ error: "thread not found" });
      }

      if (!thread.selectedProvider || !thread.selectedExternalModelId) {
        return reply.status(400).send({ code: NO_MODEL, error: NO_MODEL });
      }

      // Persist the user message first.
      const { rows: userRows } = await pool.query(
        `INSERT INTO messages (thread_id, role, content, model)
         VALUES ($1, 'user', $2, NULL)
         RETURNING id`,
        [req.params.id, content],
      );

      // Build history for the system prompt (recent messages).
      const { rows: history } = await pool.query(
        `SELECT role, content, model, interrupted, created_at
           FROM messages
          WHERE thread_id = $1
          ORDER BY created_at ASC, id ASC
          LIMIT 200`,
        [req.params.id],
      );

      const systemPrompt = await buildSystemPrompt(auth.user.id, {
        displayName: auth.user.displayName,
        date: todayISO(),
      });

      const providerImpl = getRegistry().get(thread.selectedProvider);
      const upstream = providerImpl.buildChatRequest({
        model: thread.selectedExternalModelId,
        messages: [
          { role: "system", content: systemPrompt },
          ...history.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        ],
        stream: true,
      });

      // SSE response.
      const stream = reply.raw as NodeJS.WritableStream & {
        writeHead(status: number, headers: Record<string, string>): void;
        write(chunk: string): boolean;
        end(): void;
      };
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      let aborted = false;
      let partialText = "";
      let assistantMessageId: string | null = null;

      const controller = new AbortController();
      req.raw.on("close", () => {
        if (!aborted) {
          aborted = true;
          controller.abort();
        }
      });

      try {
        const res = await fetch(upstream.url, {
          method: "POST",
          headers: upstream.headers,
          body: JSON.stringify(upstream.body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          let err: Error;
          try {
            const parsed = JSON.parse(body);
            const msg = parsed?.error ?? parsed?.message ?? body;
            err = new Error(typeof msg === "string" ? msg : body);
          } catch {
            err = new Error(body);
          }
          // NVIDIA org hint on 404/410/451.
          if ([404, 410, 451].includes(res.status)) {
            (err as any).hint = "model not enabled for this NVIDIA org";
          }
          throw err;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          throw new Error("no response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIdx);
            buffer = buffer.slice(newlineIdx + 1);
            const events = providerImpl.parseLine(line);
            for (const event of events) {
              if (event.reasoning) {
                stream.write(`event: reasoning\ndata: ${JSON.stringify({ delta: event.reasoning })}\n\n`);
              } else if (event.text) {
                partialText += event.text;
                stream.write(`event: token\ndata: ${JSON.stringify({ delta: event.text })}\n\n`);
              } else if (event.done) {
                // Persist the assistant message on completion.
                const { rows } = await pool.query(
                  `INSERT INTO messages (thread_id, role, content, model)
                   VALUES ($1, 'assistant', $2, $3)
                   RETURNING id`,
                  [req.params.id, partialText, modelString(thread.selectedProvider, thread.selectedExternalModelId)],
                );
                assistantMessageId = rows[0].id;
                stream.write(
                  `event: done\ndata: ${JSON.stringify({ messageId: assistantMessageId, interrupted: false })}\n\n`,
                );
                stream.end();
                return;
              }
            }
          }
        }

        // Stream ended without a done event → treat as interrupted partial.
        if (partialText) {
          const { rows } = await pool.query(
            `INSERT INTO messages (thread_id, role, content, model, interrupted)
             VALUES ($1, 'assistant', $2, $3, true)
             RETURNING id`,
            [req.params.id, partialText, modelString(thread.selectedProvider, thread.selectedExternalModelId)],
          );
          assistantMessageId = rows[0].id;
        }
        stream.write(
          `event: done\ndata: ${JSON.stringify({ messageId: assistantMessageId, interrupted: true })}\n\n`,
        );
        stream.end();
        return;
      } catch (err) {
        const e = err as Error & { hint?: string };
        if (aborted) {
          // Stop: persist the partial with interrupted = true.
          if (partialText) {
            const { rows } = await pool.query(
              `INSERT INTO messages (thread_id, role, content, model, interrupted)
               VALUES ($1, 'assistant', $2, $3, true)
               RETURNING id`,
              [req.params.id, partialText, modelString(thread.selectedProvider, thread.selectedExternalModelId)],
            );
            assistantMessageId = rows[0].id;
            stream.write(
              `event: done\ndata: ${JSON.stringify({ messageId: assistantMessageId, interrupted: true })}\n\n`,
            );
          }
          return;
        }

        // Provider error. Persist any partial text, then emit error.
        if (partialText) {
          const { rows } = await pool.query(
            `INSERT INTO messages (thread_id, role, content, model, interrupted)
             VALUES ($1, 'assistant', $2, $3, true)
             RETURNING id`,
            [req.params.id, partialText, modelString(thread.selectedProvider, thread.selectedExternalModelId)],
          );
          assistantMessageId = rows[0].id;
          stream.write(
            `event: done\ndata: ${JSON.stringify({ messageId: assistantMessageId, interrupted: true })}\n\n`,
          );
        }

        const message = e.message ?? String(e);
        stream.write(
          `event: error\ndata: ${JSON.stringify({
            message,
            code: e.name === "ProviderError" ? "PROVIDER_ERROR" : "PROVIDER_ERROR",
            hint: e.hint,
          })}\n\n`,
        );
        return;
      } finally {
        try {
          stream.end();
        } catch {
          // ignore
        }
      }
    },
  );
}

