import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import { auth } from "../auth";
import { db, schema } from "../db";

const settingsSchema = z.object({
  provider: z.enum(["deepgram", "openai_compatible"]),
  apiKey: z.string().nullable().default(null),
  baseUrl: z.string().url().nullable().default(null),
  model: z.string().nullable().default(null),
  language: z.string().min(2).max(10).default("id"),
});

const defaultSettings = {
  provider: "deepgram",
  apiKey: null,
  baseUrl: null,
  model: null,
  language: "id",
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
}
