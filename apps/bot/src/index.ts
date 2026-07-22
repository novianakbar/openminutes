import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { chromium as vanillaChromium, type BrowserContext } from "playwright";
import { chromium as stealthChromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import {
  reportRecording,
  reportScreenshot,
  reportStatus,
  reportVideo,
  reportVideoFailure,
} from "./api.js";
import { startRecording, type Recorder } from "./audio.js";
import { startLiveTranscriptionStream, type LiveTranscriptionStream } from "./liveTranscription.js";
import {
  startScreenshotCapture,
  type ScreenshotCapture,
} from "./screenshots.js";
import { startVideoRecording, type VideoRecorder } from "./video.js";
import { uploadRecording, uploadScreenshot, uploadVideo } from "./upload.js";
import { googleMeet } from "./platforms/googleMeet.js";
import { teams } from "./platforms/teams.js";
import { zoom } from "./platforms/zoom.js";
import { sleep } from "./platforms/helpers.js";
import type { MeetingPlatform } from "./platforms/types.js";

// Full stealth tidak aman dipakai sebagai default: user-agent-override bawaan
// plugin ini memalsukan Linux menjadi Windows/Win32 dan menulis ulang client
// hints. Teams bisa mencoba membuka app desktop lewat msteams:/xdg-open,
// sementara Meet/Zoom dapat melihat fingerprint yang tidak konsisten.
// Default produksi memakai Chromium vanilla + patch ringan di bawah; full
// stealth tetap tersedia lewat BROWSER_STEALTH untuk eksperimen per platform.
stealthChromium.use(StealthPlugin());

const PLATFORMS: Record<string, MeetingPlatform> = {
  google_meet: googleMeet,
  teams,
  zoom,
};

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`Environment variable ${key} is required`);
    process.exit(1);
  }
  return value;
}

function positiveNumberEnv(key: string, fallback: number): number {
  const value = Number(process.env[key] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function booleanEnv(key: string, fallback: boolean): boolean {
  const value = process.env[key]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

const cfg = {
  meetingId: required("MEETING_ID"),
  meetingUrl: required("MEETING_URL"),
  platform: required("PLATFORM"),
  mode: process.env.MODE ?? "post_meeting",
  botName: process.env.BOT_NAME ?? "OpenMinutes Assistant",
  captureScreenshots: booleanEnv("CAPTURE_SCREENSHOTS", true),
  captureVideo: booleanEnv("CAPTURE_VIDEO", false),
  joinTimeoutMs: positiveNumberEnv("JOIN_TIMEOUT_SEC", 300) * 1000,
  maxDurationMs: positiveNumberEnv("MAX_DURATION_MIN", 180) * 60_000,
  screenshotIntervalMs: positiveNumberEnv("SCREENSHOT_INTERVAL_SEC", 10) * 1000,
  screenshotMaxCount: Math.floor(positiveNumberEnv("SCREENSHOT_MAX_COUNT", 50)),
  screenshotMinHashDistance: positiveNumberEnv("SCREENSHOT_MIN_HASH_DISTANCE", 24),
};

function shouldUseStealth(platform: string): boolean {
  const override = process.env.BROWSER_STEALTH?.trim().toLowerCase();
  if (override) {
    if (["1", "true", "yes", "all"].includes(override)) return true;
    if (["0", "false", "no", "none", "off"].includes(override)) return false;
    return override
      .split(",")
      .map((item) => item.trim())
      .includes(platform);
  }
  return false;
}

function shouldUseChromiumFakeMedia(platform: string): boolean {
  const override = process.env.CHROMIUM_FAKE_MEDIA?.trim().toLowerCase();
  if (override) {
    if (["1", "true", "yes", "all"].includes(override)) return true;
    if (["0", "false", "no", "none", "off"].includes(override)) return false;
    return override
      .split(",")
      .map((item) => item.trim())
      .includes(platform);
  }
  return true;
}

async function addLightFingerprintPatch(
  context: BrowserContext,
  platform: string,
): Promise<void> {
  // Meet/Teams sudah terbukti stabil dengan patch minimal ini. Jangan tambah
  // spoof lain secara global: Meet sensitif terhadap fingerprint yang terlalu
  // dimanipulasi dan bisa langsung menolak join.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
      configurable: true,
    });
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
      configurable: true,
    });
  });
}

function mediaPermissionOrigins(platform: string, meetingUrl: string): string[] {
  const origins = new Set<string>();
  try {
    origins.add(new URL(meetingUrl).origin);
  } catch {
    // Ignore invalid URL here; validation/reporting happens elsewhere.
  }

  if (platform === "google_meet") origins.add("https://meet.google.com");
  if (platform === "teams") {
    origins.add("https://teams.microsoft.com");
    origins.add("https://teams.live.com");
  }
  if (platform === "zoom") {
    origins.add("https://zoom.us");
    for (const prefix of ["us02web", "us04web", "us05web"]) {
      origins.add(`https://${prefix}.zoom.us`);
    }
  }
  return [...origins];
}

async function grantMediaPermissions(
  context: BrowserContext,
  platform: string,
  meetingUrl: string,
): Promise<void> {
  for (const origin of mediaPermissionOrigins(platform, meetingUrl)) {
    await context
      .grantPermissions(["microphone", "camera"], { origin })
      .catch(() => {});
  }
}

const RECORDING_PATH = "/tmp/recording.ogg";
const VIDEO_RECORDING_PATH = "/tmp/recording.mp4";
const PROFILE_DIR = "/tmp/profile";

// Media palsu "aman": fake device bawaan Chromium menghasilkan nada beep
// (audio) & pola hijau bergerak (video) — kalau mute sampai gagal, itulah yang
// diterima peserta. File hening & frame hitam (dibuat saat build image, lihat
// Dockerfile) memastikan kebocoran apa pun tetap senyap. Saat dev lokal file
// boleh tidak ada — flag dilewati dan fake device default yang dipakai.
const fakeMediaDir = process.env.FAKE_MEDIA_DIR ?? "/app/assets";
const silenceWav = `${fakeMediaDir}/silence.wav`;
const blackY4m = `${fakeMediaDir}/black.y4m`;

let sigterm: () => void = () => {};
const sigtermPromise = new Promise<string>((resolve) => {
  sigterm = () => resolve("stopped_by_api");
});
process.on("SIGTERM", () => sigterm());

async function blockExternalAppProtocols(profileDir: string): Promise<void> {
  // Chrome menyimpan preferensi external protocol per profile. Ini menjadi
  // belt-and-suspenders untuk Zoom/Teams: kalau sebuah page mencoba membuka
  // zoommtg:/ atau msteams:/, profile tidak menampilkan dialog xdg-open yang
  // bisa memblokir Playwright.
  const prefsPath = `${profileDir}/Default/Preferences`;
  const prefs: Record<string, unknown> = await readFile(prefsPath, "utf8")
    .then((raw) => JSON.parse(raw) as Record<string, unknown>)
    .catch(() => ({} as Record<string, unknown>));
  const protocolHandler =
    prefs.protocol_handler && typeof prefs.protocol_handler === "object"
      ? (prefs.protocol_handler as Record<string, unknown>)
      : {};
  const excludedSchemes =
    protocolHandler.excluded_schemes &&
    typeof protocolHandler.excluded_schemes === "object"
      ? (protocolHandler.excluded_schemes as Record<string, unknown>)
      : {};
  for (const scheme of ["zoommtg", "zoomus", "zoomphonecall", "msteams"]) {
    excludedSchemes[scheme] = true;
  }
  protocolHandler.excluded_schemes = excludedSchemes;
  prefs.protocol_handler = protocolHandler;
  await mkdir(`${profileDir}/Default`, { recursive: true });
  await writeFile(prefsPath, JSON.stringify(prefs));
}

async function main() {
  const platform = PLATFORMS[cfg.platform];
  if (!platform) {
    throw new Error(
      `Unsupported bot platform "${cfg.platform}". Supported platforms: ${Object.keys(
        PLATFORMS,
      ).join(", ")}.`,
    );
  }
  console.log(
    `Starting bot for platform=${cfg.platform} browser=chromium url=${cfg.meetingUrl}`,
  );
  const useStealth = shouldUseStealth(cfg.platform);
  const browser = useStealth ? stealthChromium : vanillaChromium;
  const useChromiumFakeMedia = shouldUseChromiumFakeMedia(cfg.platform);

  await reportStatus(cfg.meetingId, "joining");
  await blockExternalAppProtocols(PROFILE_DIR);

  const context = await browser.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 720 },
    screen: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    locale: "en-US",
    timezoneId: process.env.TZ ?? "Asia/Jakarta",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
    // Meet me-redirect Chromium Linux ke halaman marketing kalau UA-nya
    // dianggap browser tak didukung — samarkan sebagai Chrome desktop asli.
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    permissions: ["microphone", "camera"],
    args: [
      "--no-sandbox",
      "--autoplay-policy=no-user-gesture-required",
      ...(useChromiumFakeMedia ? ["--use-fake-device-for-media-stream"] : []),
      ...(useChromiumFakeMedia && existsSync(silenceWav)
        ? [`--use-file-for-fake-audio-capture=${silenceWav}`]
        : []),
      ...(useChromiumFakeMedia && existsSync(blackY4m)
        ? [`--use-file-for-fake-video-capture=${blackY4m}`]
        : []),
      ...(useChromiumFakeMedia ? ["--use-fake-ui-for-media-stream"] : []),
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,720",
    ],
  });

  await addLightFingerprintPatch(context, cfg.platform);
  await grantMediaPermissions(context, cfg.platform, cfg.meetingUrl);

  const page = await context.newPage();

  // SIGTERM harus efektif juga selama fase join (joining/waiting_admission) —
  // tanpa race ini, "stop" dari API baru bereaksi setelah bot di-admit host.
  const joinPromise = platform
    .join(page, {
      meetingUrl: cfg.meetingUrl,
      botName: cfg.botName,
      joinTimeoutMs: cfg.joinTimeoutMs,
      onWaitingAdmission: () => {
        void reportStatus(cfg.meetingId, "waiting_admission");
      },
    })
    .then(() => "joined" as const);
  // Cegah unhandled rejection bila join gagal setelah SIGTERM menang race.
  joinPromise.catch(() => {});

  const joinResult = await Promise.race([joinPromise, sigtermPromise]);
  if (joinResult !== "joined") {
    console.log("Stopped before recording started");
    await reportStatus(
      cfg.meetingId,
      "failed",
      "The session was stopped before joining the meeting. No recording was created.",
    );
    await context.close().catch(() => {});
    return;
  }

  await reportStatus(cfg.meetingId, "recording");
  const recorder = startRecording(RECORDING_PATH);
  const videoRecorder = cfg.captureVideo
    ? startVideoRecording(VIDEO_RECORDING_PATH)
    : null;
  const screenshots = cfg.captureScreenshots
    ? startScreenshotCapture(page, {
        startedAt: recorder.startedAt,
        intervalMs: cfg.screenshotIntervalMs,
        maxScreenshots: cfg.screenshotMaxCount,
        minHashDistance: cfg.screenshotMinHashDistance,
        onCapture: async (capture, index) => {
          const objectKey = await uploadScreenshot(
            cfg.meetingId,
            index,
            capture.buffer,
          );
          await reportScreenshot(cfg.meetingId, {
            objectKey,
            capturedAtMs: capture.capturedAtMs,
            width: capture.width,
            height: capture.height,
            hash: capture.hash,
          });
        },
      })
    : null;
  const liveTranscription =
    cfg.mode === "realtime"
      ? startLiveTranscriptionStream(cfg.meetingId)
      : null;

  const endReason = await Promise.race([
    platform.waitForEnd(page),
    sleep(cfg.maxDurationMs).then(() => "max_duration"),
    sigtermPromise,
  ]);
  console.log(`Meeting ended: ${endReason}`);

  await finish(recorder, liveTranscription, screenshots, videoRecorder);
  await context.close().catch(() => {});
}

async function finish(
  recorder: Recorder,
  liveTranscription: LiveTranscriptionStream | null,
  screenshots: ScreenshotCapture | null,
  videoRecorder: VideoRecorder | null,
) {
  const durationSec = Math.round((Date.now() - recorder.startedAt) / 1000);
  await screenshots?.stop().catch((err) => {
    console.error("screenshot capture finalize gagal:", err);
  });
  await liveTranscription?.stop().catch((err) => {
    console.error("live transcription finalize gagal:", err);
  });

  let videoStopError: unknown = null;
  await Promise.all([
    recorder.stop(),
    videoRecorder?.stop().catch((err) => {
      videoStopError = err;
      console.error("video recording finalize gagal:", err);
    }),
  ]);

  const fileSize = await stat(RECORDING_PATH)
    .then((s) => s.size)
    .catch(() => 0);
  if (fileSize === 0) {
    throw new Error(
      "The recording file is empty or missing. Audio capture did not produce usable output " +
        "(check PulseAudio/MeetSink in the container logs).",
    );
  }
  await reportStatus(cfg.meetingId, "uploading");
  const objectKey = await uploadRecording(cfg.meetingId, RECORDING_PATH);
  await reportRecording(cfg.meetingId, objectKey, durationSec);
  console.log(`Recording ${objectKey} (${durationSec}s) uploaded`);

  if (!videoRecorder) return;

  if (videoStopError) {
    await reportVideoFailure(
      cfg.meetingId,
      videoStopError instanceof Error ? videoStopError.message : String(videoStopError),
    );
    return;
  }

  const videoSizeBytes = await stat(VIDEO_RECORDING_PATH)
    .then((s) => s.size)
    .catch(() => 0);
  if (videoSizeBytes === 0) {
    await reportVideoFailure(
      cfg.meetingId,
      "Video recording file is empty or missing.",
    );
    return;
  }

  try {
    const videoObjectKey = await uploadVideo(cfg.meetingId, VIDEO_RECORDING_PATH);
    await reportVideo(cfg.meetingId, videoObjectKey, videoSizeBytes);
    console.log(`Video ${videoObjectKey} (${videoSizeBytes} bytes) uploaded`);
  } catch (err) {
    console.error("video upload gagal:", err);
    await reportVideoFailure(
      cfg.meetingId,
      err instanceof Error ? err.message : String(err),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await reportStatus(
      cfg.meetingId,
      "failed",
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
