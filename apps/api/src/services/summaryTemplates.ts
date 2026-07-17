import { asc, eq } from "drizzle-orm";
import { DEFAULT_SUMMARY_TEMPLATES } from "@openminutes/shared";
import { db, schema } from "../db";

export async function ensureDefaultSummaryTemplates() {
  for (const template of DEFAULT_SUMMARY_TEMPLATES) {
    await db
      .insert(schema.summaryTemplates)
      .values({
        ...template,
        updatedAt: new Date(),
      })
      .onConflictDoNothing();
  }
}

export async function listSummaryTemplates({ enabledOnly = false } = {}) {
  await ensureDefaultSummaryTemplates();
  const query = db
    .select()
    .from(schema.summaryTemplates)
    .orderBy(asc(schema.summaryTemplates.sortOrder), asc(schema.summaryTemplates.name));
  if (enabledOnly) {
    return query.where(eq(schema.summaryTemplates.enabled, true));
  }
  return query;
}
