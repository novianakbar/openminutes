import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { ensureDefaultSummaryTemplates } from "./summaryTemplates";

export type SummarySourceType = "meeting" | "audio_summary";

export async function listSummaryGroups(
  sourceType: SummarySourceType,
  sourceId: string,
) {
  const summaries = await db
    .select()
    .from(schema.summaries)
    .where(
      and(
        eq(schema.summaries.sourceType, sourceType),
        eq(schema.summaries.sourceId, sourceId),
      ),
    )
    .orderBy(
      desc(schema.summaries.createdAt),
      desc(schema.summaries.version),
    );

  const groups = new Map<
    string,
    {
      templateKey: string;
      latest: (typeof summaries)[number];
      history: typeof summaries;
    }
  >();

  for (const summary of summaries) {
    const existing = groups.get(summary.templateKey);
    if (!existing) {
      groups.set(summary.templateKey, {
        templateKey: summary.templateKey,
        latest: summary,
        history: [summary],
      });
      continue;
    }
    existing.history.push(summary);
  }

  return [...groups.values()];
}

export async function createSummaryVersion(input: {
  sourceType: SummarySourceType;
  sourceId: string;
  templateKey: string;
  triggeredByUserId: string;
}) {
  await ensureDefaultSummaryTemplates();
  const [template] = await db
    .select()
    .from(schema.summaryTemplates)
    .where(
      and(
        eq(schema.summaryTemplates.key, input.templateKey),
        eq(schema.summaryTemplates.enabled, true),
      ),
    )
    .limit(1);
  if (!template) return null;

  const [latest] = await db
    .select()
    .from(schema.summaries)
    .where(
      and(
        eq(schema.summaries.sourceType, input.sourceType),
        eq(schema.summaries.sourceId, input.sourceId),
        eq(schema.summaries.templateKey, input.templateKey),
      ),
    )
    .orderBy(desc(schema.summaries.version), desc(schema.summaries.createdAt))
    .limit(1);

  const [summary] = await db
    .insert(schema.summaries)
    .values({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      templateKey: input.templateKey,
      version: (latest?.version ?? 0) + 1,
      status: "processing",
      error: null,
      triggeredByUserId: input.triggeredByUserId,
      updatedAt: new Date(),
    })
    .returning();

  return summary;
}
