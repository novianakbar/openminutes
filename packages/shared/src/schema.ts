import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// --- Tabel better-auth (nama model & field mengikuti better-auth 1.6 + plugin admin & api-key) ---

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role"),
  banned: boolean("banned"),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const apikey = pgTable("apikey", {
  id: text("id").primaryKey(),
  configId: text("config_id").notNull().default("default"),
  name: text("name"),
  start: text("start"),
  prefix: text("prefix"),
  key: text("key").notNull(),
  referenceId: text("reference_id").notNull(),
  refillInterval: integer("refill_interval"),
  refillAmount: integer("refill_amount"),
  lastRefillAt: timestamp("last_refill_at"),
  enabled: boolean("enabled").default(true),
  rateLimitEnabled: boolean("rate_limit_enabled").default(true),
  rateLimitTimeWindow: integer("rate_limit_time_window"),
  rateLimitMax: integer("rate_limit_max"),
  requestCount: integer("request_count").default(0),
  remaining: integer("remaining"),
  lastRequest: timestamp("last_request"),
  expiresAt: timestamp("expires_at"),
  permissions: text("permissions"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// --- Tabel aplikasi ---

// Konfigurasi transcription global (satu baris, id selalu 1), diatur admin dari UI.
export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  provider: text("provider").notNull().default("deepgram"),
  apiKey: text("api_key"),
  baseUrl: text("base_url"),
  model: text("model"),
  language: text("language").notNull().default("id"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const meetings = pgTable("meetings", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .references(() => user.id)
    .notNull(),
  title: text("title").notNull(),
  platform: text("platform").notNull(),
  externalMeetingId: text("external_meeting_id").notNull(),
  meetingUrl: text("meeting_url").notNull(),
  mode: text("mode").notNull().default("post_meeting"),
  language: text("language").notNull().default("id"),
  botName: text("bot_name").notNull(),
  status: text("status").notNull().default("pending"),
  scheduledStartAt: timestamp("scheduled_start_at"),
  containerId: text("container_id"),
  audioObjectKey: text("audio_object_key"),
  durationSec: integer("duration_sec"),
  realtimeTranscriptStatus: text("realtime_transcript_status"),
  realtimeTranscriptError: text("realtime_transcript_error"),
  realtimeFinalizedAt: timestamp("realtime_finalized_at"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const meetingStatusEvents = pgTable("meeting_status_events", {
  id: serial("id").primaryKey(),
  meetingId: uuid("meeting_id")
    .references(() => meetings.id)
    .notNull(),
  status: text("status").notNull(),
  message: text("message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const transcriptSegments = pgTable("transcript_segments", {
  id: serial("id").primaryKey(),
  meetingId: uuid("meeting_id")
    .references(() => meetings.id)
    .notNull(),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  speaker: text("speaker"),
  text: text("text").notNull(),
});

export const meetingScreenshots = pgTable("meeting_screenshots", {
  id: serial("id").primaryKey(),
  meetingId: uuid("meeting_id")
    .references(() => meetings.id)
    .notNull(),
  objectKey: text("object_key").notNull(),
  capturedAtMs: integer("captured_at_ms").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  hash: text("hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
