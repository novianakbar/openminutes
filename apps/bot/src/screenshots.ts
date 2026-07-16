import type { Page } from "playwright";
import { PNG } from "pngjs";

const HASH_SIZE = 16;

export interface ScreenshotCaptureResult {
  buffer: Buffer;
  capturedAtMs: number;
  width: number;
  height: number;
  hash: string;
}

export interface ScreenshotCapture {
  stop: () => Promise<void>;
}

export interface ScreenshotCaptureOptions {
  startedAt: number;
  intervalMs: number;
  maxScreenshots: number;
  minHashDistance: number;
  onCapture: (result: ScreenshotCaptureResult, index: number) => Promise<void>;
}

function luminanceAt(png: PNG, x: number, y: number): number {
  const idx = (png.width * y + x) << 2;
  const alpha = png.data[idx + 3] / 255;
  const r = png.data[idx] * alpha + 255 * (1 - alpha);
  const g = png.data[idx + 1] * alpha + 255 * (1 - alpha);
  const b = png.data[idx + 2] * alpha + 255 * (1 - alpha);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function visualHash(buffer: Buffer): {
  hash: string;
  width: number;
  height: number;
} {
  const png = PNG.sync.read(buffer);
  const crop = {
    x: Math.floor(png.width * 0.1),
    y: Math.floor(png.height * 0.08),
    width: Math.max(HASH_SIZE, Math.floor(png.width * 0.8)),
    height: Math.max(HASH_SIZE, Math.floor(png.height * 0.72)),
  };
  const values: number[] = [];

  for (let gy = 0; gy < HASH_SIZE; gy++) {
    for (let gx = 0; gx < HASH_SIZE; gx++) {
      const startX = crop.x + Math.floor((gx * crop.width) / HASH_SIZE);
      const endX = crop.x + Math.floor(((gx + 1) * crop.width) / HASH_SIZE);
      const startY = crop.y + Math.floor((gy * crop.height) / HASH_SIZE);
      const endY = crop.y + Math.floor(((gy + 1) * crop.height) / HASH_SIZE);
      let sum = 0;
      let count = 0;

      for (let y = startY; y < Math.min(endY, png.height); y++) {
        for (let x = startX; x < Math.min(endX, png.width); x++) {
          sum += luminanceAt(png, x, y);
          count++;
        }
      }
      values.push(count > 0 ? sum / count : 0);
    }
  }

  let hash = "";
  for (const value of values) {
    hash += Math.max(0, Math.min(15, Math.round(value / 17))).toString(16);
  }
  return { hash, width: png.width, height: png.height };
}

export function hashDistance(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let distance = Math.abs(a.length - b.length);
  for (let i = 0; i < length; i++) {
    const av = Number.parseInt(a[i], 16);
    const bv = Number.parseInt(b[i], 16);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) {
      distance += 1;
      continue;
    }
    if (Math.abs(av - bv) >= 3) distance++;
  }
  return distance;
}

function shouldSaveScreenshot(
  lastSavedHash: string | null,
  nextHash: string,
  minHashDistance: number,
): boolean {
  if (!lastSavedHash) return true;
  return hashDistance(lastSavedHash, nextHash) >= minHashDistance;
}

function sleepUntil(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

export function startScreenshotCapture(
  page: Page,
  opts: ScreenshotCaptureOptions,
): ScreenshotCapture {
  const abort = new AbortController();
  let savedCount = 0;
  let lastSavedHash: string | null = null;

  const loop = (async () => {
    await sleepUntil(2000, abort.signal);
    while (!abort.signal.aborted && savedCount < opts.maxScreenshots) {
      try {
        const buffer = await page.screenshot({
          type: "png",
          fullPage: false,
          animations: "disabled",
        });
        const { hash, width, height } = visualHash(buffer);
        if (shouldSaveScreenshot(lastSavedHash, hash, opts.minHashDistance)) {
          const result = {
            buffer,
            capturedAtMs: Date.now() - opts.startedAt,
            width,
            height,
            hash,
          };
          await opts.onCapture(result, savedCount + 1);
          savedCount++;
          lastSavedHash = hash;
          console.log(
            `[screenshots] saved ${savedCount}/${opts.maxScreenshots} at ${result.capturedAtMs}ms`,
          );
        }
      } catch (err) {
        console.warn("[screenshots] capture failed:", err);
      }
      await sleepUntil(opts.intervalMs, abort.signal);
    }
  })();

  return {
    stop: async () => {
      abort.abort();
      await loop.catch(() => {});
    },
  };
}
