const env = (key: string, fallback: string) => process.env[key] ?? fallback;
const optionalEnv = (key: string) => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};
const listEnv = (key: string, fallback: string) =>
  env(key, fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const botVncMode = env("BOT_VNC_MODE", "host").toLowerCase();

export const config = {
  port: Number(env("PORT", "3000")),
  databaseUrl: env(
    "DATABASE_URL",
    "postgres://openminutes:openminutes@localhost:5432/openminutes",
  ),
  redisUrl: env("REDIS_URL", "redis://localhost:6379"),
  minio: {
    endpoint: env("MINIO_ENDPOINT", "localhost"),
    port: Number(env("MINIO_PORT", "9000")),
    accessKey: env("MINIO_ACCESS_KEY", "minio"),
    secretKey: env("MINIO_SECRET_KEY", "minio12345"),
    bucket: env("MINIO_BUCKET", "recordings"),
  },
  internalToken: env("INTERNAL_TOKEN", "dev-internal-token"),
  baseUrl: env("BETTER_AUTH_URL", "http://localhost:3000"),
  authSecret: env(
    "BETTER_AUTH_SECRET",
    "dev-secret-ganti-di-production-min-32-karakter!",
  ),
  webOrigins: listEnv("WEB_ORIGIN", "http://localhost:5173"),
  botImage: env("BOT_IMAGE", "openminutes-bot:dev"),
  botNetwork: optionalEnv("BOT_NETWORK"),
  botVncMode: botVncMode === "network" ? "network" : "host",
  apiUrlForBots: env("API_URL_FOR_BOTS", "http://host.docker.internal:3000"),
  minioEndpointForBots: env("MINIO_ENDPOINT_FOR_BOTS", "host.docker.internal"),
};
