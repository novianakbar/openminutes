import Docker from "dockerode";
import type { Platform, TranscriptionMode } from "@openminutes/shared";
import { config } from "../config";

const docker = new Docker();
const optionalBotEnv = [
  "BROWSER_STEALTH",
  "CHROMIUM_FAKE_MEDIA",
  "FAKE_MEDIA_DIR",
  "JOIN_TIMEOUT_SEC",
  "MAX_DURATION_MIN",
  "SCREENSHOT_INTERVAL_SEC",
  "SCREENSHOT_MAX_COUNT",
  "SCREENSHOT_MIN_HASH_DISTANCE",
  "TZ",
]
  .map((key) => {
    const value = process.env[key]?.trim();
    return value ? `${key}=${value}` : null;
  })
  .filter((value): value is string => value !== null);

export interface SpawnBotOptions {
  meetingId: string;
  meetingUrl: string;
  platform: Platform;
  mode: TranscriptionMode;
  botName: string;
  captureScreenshots: boolean;
  captureVideo: boolean;
}

export async function spawnBot(opts: SpawnBotOptions): Promise<string> {
  const hostConfig = {
    AutoRemove: true,
    ShmSize: 2 * 1024 * 1024 * 1024,
    ExtraHosts: ["host.docker.internal:host-gateway"],
    ...(config.botNetwork ? { NetworkMode: config.botNetwork } : {}),
    ...(config.botVncMode === "host"
      ? {
          // x11vnc (live view) di-publish ke loopback host dengan port ephemeral —
          // hanya API di host yang bisa menjangkaunya (docs/live-view-design.md §4).
          PortBindings: { "5900/tcp": [{ HostIp: "127.0.0.1", HostPort: "" }] },
        }
      : {}),
  };

  const container = await docker.createContainer({
    Image: config.botImage,
    name: `openminutes-bot-${opts.meetingId}`,
    Env: [
      `MEETING_ID=${opts.meetingId}`,
      `MEETING_URL=${opts.meetingUrl}`,
      `PLATFORM=${opts.platform}`,
      `MODE=${opts.mode}`,
      `BOT_NAME=${opts.botName}`,
      `CAPTURE_SCREENSHOTS=${opts.captureScreenshots ? "1" : "0"}`,
      `CAPTURE_VIDEO=${opts.captureVideo ? "1" : "0"}`,
      `API_URL=${config.apiUrlForBots}`,
      `INTERNAL_TOKEN=${config.internalToken}`,
      `MINIO_ENDPOINT=${config.minioEndpointForBots}`,
      `MINIO_PORT=${config.minio.port}`,
      `MINIO_ACCESS_KEY=${config.minio.accessKey}`,
      `MINIO_SECRET_KEY=${config.minio.secretKey}`,
      `MINIO_BUCKET=${config.minio.bucket}`,
      ...optionalBotEnv,
    ],
    HostConfig: hostConfig,
    ExposedPorts: { "5900/tcp": {} },
  });
  await container.start();
  return container.id;
}

export async function stopBot(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  // Bot menangani SIGTERM: berhenti merekam, upload, lapor, lalu exit.
  // kill (bukan stop) agar request tidak memblokir menunggu kontainer exit;
  // callback status dari bot yang meng-update DB.
  await container.kill({ signal: "SIGTERM" });
  // Jaring pengaman: kalau bot macet dan tidak exit sendiri, paksa matikan.
  // Kontainer AutoRemove — kalau sudah exit, kill kedua ini gagal 404 dan diabaikan.
  setTimeout(() => {
    container.kill({ signal: "SIGKILL" }).catch(() => {});
  }, 120_000).unref();
}

// Alamat TCP menuju x11vnc kontainer bot untuk proxy live view, atau null
// jika kontainer sudah tiada/berhenti.
export async function resolveVncTarget(
  containerId: string,
): Promise<{ host: string; port: number } | null> {
  try {
    const info = await docker.getContainer(containerId).inspect();
    if (!info.State.Running) return null;

    if (config.botVncMode === "network") {
      return { host: info.Name.replace(/^\//, ""), port: 5900 };
    }

    // Mode A (API di host): baca HostPort hasil binding ephemeral di 127.0.0.1
    // lihat docs/live-view-design.md §4.
    const binding = info.NetworkSettings.Ports?.["5900/tcp"]?.[0];
    if (!binding?.HostPort) return null;
    return { host: "127.0.0.1", port: Number(binding.HostPort) };
  } catch (err) {
    if (isContainerGone(err)) return null;
    throw err;
  }
}

// dockerode melempar error ber-statusCode; 404 = kontainer sudah tidak ada,
// 409 = kontainer ada tapi tidak running.
export function isContainerGone(err: unknown): boolean {
  const status = (err as { statusCode?: number })?.statusCode;
  return status === 404 || status === 409;
}
