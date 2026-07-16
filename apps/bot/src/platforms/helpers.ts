import type { Locator, Page } from "playwright";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const randomDelay = (base: number) =>
  sleep(base + Math.floor(Math.random() * base));

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Google Meet menolak submit "Ask to join" jika kursor "teleport" ke tombol
// (ciri automation). Gerakkan kursor bertahap ke target dengan sedikit jitter,
// meniru lintasan tangan manusia, sebelum menekan.
async function moveMouseTo(page: Page, box: Box): Promise<void> {
  const tx = box.x + box.width / 2;
  const ty = box.y + box.height / 2;
  const steps = 18;
  let cx = 640;
  let cy = 360;
  for (let i = 1; i <= steps; i++) {
    const remaining = steps - i + 1;
    cx += (tx - cx) / remaining + (Math.random() - 0.5) * 6;
    cy += (ty - cy) / remaining + (Math.random() - 0.5) * 6;
    await page.mouse.move(cx, cy);
    await sleep(15 + Math.random() * 25);
  }
  await page.mouse.move(tx, ty);
}

// Klik seperti manusia: gerak organik ke elemen lalu tekan-lepas fisik.
export async function humanClick(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) {
    await locator.click({ timeout: 10_000 });
    return;
  }
  await moveMouseTo(page, box);
  await sleep(150 + Math.random() * 200);
  await page.mouse.down();
  await sleep(50 + Math.random() * 50);
  await page.mouse.up();
}

// Ketik dengan gerak kursor ke field lebih dulu + jeda antar karakter.
export async function humanType(
  page: Page,
  locator: Locator,
  text: string,
): Promise<void> {
  const box = await locator.boundingBox();
  if (box) {
    await moveMouseTo(page, box);
    await page.mouse.down();
    await sleep(60);
    await page.mouse.up();
  } else {
    await locator.click();
  }
  await sleep(250);
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(80 + Math.random() * 120);
  }
}

export async function clickIfVisible(
  locator: Locator,
  timeoutMs = 3000,
): Promise<boolean> {
  try {
    await locator.first().click({ timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}
