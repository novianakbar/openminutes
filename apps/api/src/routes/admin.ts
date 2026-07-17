import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "../auth";
import { db, schema } from "../db";
import {
  ensureDefaultSummaryTemplates,
  listSummaryTemplates,
} from "../services/summaryTemplates";

const settingsSchema = z.object({
  provider: z.enum(["deepgram", "openai_compatible"]),
  apiKey: z.string().nullable().default(null),
  baseUrl: z.string().url().nullable().default(null),
  model: z.string().nullable().default(null),
  language: z.string().min(2).max(10).default("id"),
});

const summarySettingsSchema = z.object({
  apiKey: z.string().nullable().default(null),
  baseUrl: z.string().url().nullable().default(null),
  model: z.string().nullable().default(null),
});

const templateKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9_-]*[a-z0-9]$/);

const summaryTemplateCreateSchema = z.object({
  key: templateKeySchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  systemPrompt: z.string().trim().min(1).max(8000),
  userPrompt: z.string().trim().min(1).max(12000),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
});

const summaryTemplateUpdateSchema = summaryTemplateCreateSchema
  .omit({ key: true })
  .partial();

const defaultSettings = {
  provider: "deepgram",
  apiKey: null,
  baseUrl: null,
  model: null,
  language: "id",
};

const defaultSummarySettings = {
  apiKey: null,
  baseUrl: null,
  model: null,
};

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req, reply) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    if (session.user.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }
  });

  app.get("/settings", async () => {
    const [row] = await db.select().from(schema.appSettings).limit(1);
    if (!row) return defaultSettings;
    const { id: _id, updatedAt: _updatedAt, ...settings } = row;
    return settings;
  });

  app.put("/settings", async (req, reply) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    await db
      .insert(schema.appSettings)
      .values({ id: 1, ...parsed.data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.appSettings.id,
        set: { ...parsed.data, updatedAt: new Date() },
    });
    return parsed.data;
  });

  app.get("/summary-settings", async () => {
    const [row] = await db.select().from(schema.summarySettings).limit(1);
    if (!row) return defaultSummarySettings;
    const { id: _id, updatedAt: _updatedAt, ...settings } = row;
    return settings;
  });

  app.put("/summary-settings", async (req, reply) => {
    const parsed = summarySettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    await db
      .insert(schema.summarySettings)
      .values({ id: 1, ...parsed.data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.summarySettings.id,
        set: { ...parsed.data, updatedAt: new Date() },
      });
    return parsed.data;
  });

  app.get("/summary-templates", async () => {
    return listSummaryTemplates();
  });

  app.post("/summary-templates", async (req, reply) => {
    await ensureDefaultSummaryTemplates();
    const parsed = summaryTemplateCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    try {
      const [template] = await db
        .insert(schema.summaryTemplates)
        .values({ ...parsed.data, updatedAt: new Date() })
        .returning();
      return reply.code(201).send(template);
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        return reply.code(409).send({ error: "Template key already exists" });
      }
      throw err;
    }
  });

  app.patch("/summary-templates/:key", async (req, reply) => {
    await ensureDefaultSummaryTemplates();
    const key = templateKeySchema.safeParse((req.params as { key: string }).key);
    if (!key.success) return reply.code(400).send({ error: "Invalid template key" });
    const parsed = summaryTemplateUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const [template] = await db
      .update(schema.summaryTemplates)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(schema.summaryTemplates.key, key.data))
      .returning();
    if (!template) return reply.code(404).send({ error: "Template not found" });
    return template;
  });

  app.delete("/summary-templates/:key", async (req, reply) => {
    await ensureDefaultSummaryTemplates();
    const key = templateKeySchema.safeParse((req.params as { key: string }).key);
    if (!key.success) return reply.code(400).send({ error: "Invalid template key" });

    const [template] = await db
      .delete(schema.summaryTemplates)
      .where(eq(schema.summaryTemplates.key, key.data))
      .returning();
    if (!template) return reply.code(404).send({ error: "Template not found" });
    return { key: key.data, deleted: true };
  });
}
