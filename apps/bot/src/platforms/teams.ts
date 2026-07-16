import type { Locator, Page } from "playwright";
import {
  clickIfVisible,
  humanClick,
  humanType,
  randomDelay,
  sleep,
} from "./helpers.js";
import type { MeetingPlatform, JoinOptions } from "./types.js";

// Dukungan Teams masih eksperimental: join anonim via web client.
// Hanya berfungsi jika tenant mengizinkan anonymous/guest join.
const HANGUP = '#hangup-button, button[data-tid="call-hangup"]';

// Pesan yang Teams tampilkan saat join ditolak / tak didukung. Sama seperti
// Meet, kita deteksi ini untuk gagal cepat dengan pesan jelas alih-alih
// menggantung sampai joinTimeoutMs habis (mis. saat terindikasi bot/unsupported).
const BLOCKED_TEXT =
  /couldn't (join|connect)|can't join|unable to join|something went wrong|not supported|browser (isn't|is not) supported|tidak dapat (bergabung|terhubung)|terjadi kesalahan/i;

async function assertNotBlocked(page: Page): Promise<void> {
  const blocked = page.getByText(BLOCKED_TEXT).first();
  if (await blocked.isVisible().catch(() => false)) {
    const reason = (await blocked.textContent().catch(() => null))?.trim();
    throw new Error(`Teams rejected the join request: ${reason || "reason unavailable"}`);
  }
}

type MediaKind = "mic" | "camera";

// Teams punya beragam varian selector antara pre-join vs in-call, dan atributnya
// juga tidak konsisten (kadang aria-checked, kadang aria-pressed, kadang cuma
// tercermin di aria-label "Mute"/"Unmute"). Kita coba semua kandidat dan pakai
// tombol pertama yang terlihat.
const MIC_SELECTORS = [
  '[data-tid="toggle-mute"]',
  '[data-tid="microphone-button"]',
  '#microphone-button',
  '[role="switch"][aria-label*="microphone" i]',
  '[role="switch"][aria-label*="mikrofon" i]',
  '[role="switch"][aria-label*="mic" i]',
  '[role="switch"][aria-label*="mute" i]',
  'button[aria-label*="microphone" i]',
  'button[aria-label*="mikrofon" i]',
  'button[aria-label*="mute" i]',
];
const CAM_SELECTORS = [
  '[data-tid="toggle-video"]',
  '[data-tid="video-btn"]',
  '#video-button',
  '[role="switch"][aria-label*="camera" i]',
  '[role="switch"][aria-label*="kamera" i]',
  '[role="switch"][aria-label*="video" i]',
  'button[aria-label*="camera" i]',
  'button[aria-label*="kamera" i]',
];

// Cari elemen pertama yang ADA di DOM — tidak pakai isVisible() karena Fluent UI
// menyembunyikan <input role="switch"> secara visual (opacity 0) sementara UI
// switch-nya digambar oleh div indicator. Elemen tetap fungsional lewat click().
async function findFirst(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0) return loc;
  }
  return null;
}

// Baca apakah perangkat sedang MENYALA. True = on, false = off, null = tak yakin.
// Urutan sumber kebenaran:
//   1. input.checked (Fluent Switch pakai <input type="checkbox" role="switch">
//      dan native property; aria-checked TIDAK di-set).
//   2. aria-checked / aria-pressed (untuk button-based toggle di layar lain).
//   3. title / aria-label: "Mute mic" atau "Turn camera off" = sedang on,
//      "Unmute" / "Turn camera on" = sudah off.
async function readOnState(loc: Locator): Promise<boolean | null> {
  const checked = await loc
    .evaluate((el) =>
      el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")
        ? el.checked
        : null,
    )
    .catch(() => null);
  if (typeof checked === "boolean") return checked;
  const ariaChecked = await loc.getAttribute("aria-checked").catch(() => null);
  if (ariaChecked === "true") return true;
  if (ariaChecked === "false") return false;
  const pressed = await loc.getAttribute("aria-pressed").catch(() => null);
  if (pressed === "true") return true;
  if (pressed === "false") return false;
  const title = ((await loc.getAttribute("title").catch(() => null)) ?? "").toLowerCase();
  const label = ((await loc.getAttribute("aria-label").catch(() => null)) ?? "").toLowerCase();
  const text = `${title} ${label}`;
  if (!text.trim()) return null;
  if (/unmute|nyalakan mikrofon|turn camera on|nyalakan kamera/.test(text)) return false;
  if (/\bmute\b|bisukan|turn camera off|matikan kamera/.test(text)) return true;
  return null;
}

// DIVERIFIKASI langsung terhadap halaman light-meetings (probe 2026-07-10):
// - Toggle prejoin = <input type="checkbox" role="switch" data-tid="toggle-mute"
//   / "toggle-video">, VISIBLE (~56x20), TANPA aria-checked. State hanya di
//   property input.checked (+ cermin di data-cid="toggle-*-true/false").
// - Satu klik (fisik maupun el.click()) berhasil mematikan, TAPI React
//   me-re-render async: input.checked masih terbaca nilai lama sampai ~1 detik
//   setelah klik. Karena itu verifikasi HARUS polling, bukan cek instan —
//   cek instan membuat kita mengira klik gagal lalu klik lagi = toggle balik ON.
async function pollUntilOff(loc: Locator, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await readOnState(loc)) === false) return true;
    await sleep(250);
  }
  return false;
}

// Satu percobaan klik + verifikasi polling. Return state akhir (true = masih on).
async function clickToggleOff(page: Page, loc: Locator, tag: string): Promise<boolean> {
  const tid = (await loc.getAttribute("data-tid").catch(() => null)) ?? "?";
  const box = await loc.boundingBox().catch(() => null);
  let via: string;
  if (box && box.width > 2 && box.height > 2) {
    via = "humanClick";
    await humanClick(page, loc);
  } else {
    // Elemen ada tapi tak punya area klik (varian DOM lain) — native click
    // pada input checkbox tetap men-toggle dan men-trigger onChange React.
    via = "el.click";
    await loc.evaluate((el) => (el as HTMLElement).click()).catch(() => {});
  }
  const off = await pollUntilOff(loc, 2500);
  console.log(`[teams mute] ${tag} tid=${tid} via=${via} off=${off}`);
  return !off;
}

// Matikan mic/kamera dengan verifikasi. Bot cuma pendengar — jangan pernah
// menyalakan. Klik hanya jika terbaca sedang on, lalu cek ulang; kalau masih on,
// retry beberapa kali. Kalau state tak terbaca sama sekali, biarkan (jangan asal
// klik supaya tidak malah ter-toggle jadi on).
async function turnOffMedia(page: Page, kind: MediaKind): Promise<void> {
  const selectors = kind === "mic" ? MIC_SELECTORS : CAM_SELECTORS;
  for (let attempt = 0; attempt < 3; attempt++) {
    const btn = await findFirst(page, selectors);
    if (!btn) {
      if (attempt === 0) console.log(`[teams mute] ${kind}: no matching element`);
      return;
    }
    const state = await readOnState(btn);
    if (state === false) return;
    if (state === null && attempt > 0) return;
    const stillOn = await clickToggleOff(page, btn, kind);
    if (!stillOn) return;
    await randomDelay(300);
  }
}

// Fallback pass: kalau suatu saat Teams mengganti data-tid, sweep semua
// [role="switch"] yang masih on. Di layar pra-gabung/lobby, switch yang ada
// hanya mic & kamera (probe: cuma 2 elemen role=switch), jadi aman menekan
// semuanya. Jangan pakai sweep ini di dalam call (bisa kena toggle lain).
async function turnOffAllOnSwitches(page: Page): Promise<void> {
  for (let pass = 0; pass < 3; pass++) {
    const switches = await page.locator('[role="switch"]').all();
    let clickedAny = false;
    for (const sw of switches) {
      if ((await readOnState(sw)) !== true) continue;
      await clickToggleOff(page, sw, "sweep");
      clickedAny = true;
    }
    if (!clickedAny) return;
  }
}

// Setelah turnOffMedia, pastikan mic & kamera BENAR-BENAR mati sebelum join.
// Kalau salah satu masih terbaca on, lempar error — lebih baik gagal join
// daripada masuk meeting dengan mic/kamera hidup dan membuat noise. State
// "tak terbaca" (null) dibiarkan lolos supaya varian DOM Teams yang belum
// dikenali tidak memblokir semua join.
async function assertMediaOff(page: Page): Promise<void> {
  const stillOn: string[] = [];
  for (const [kind, selectors] of [
    ["microphone", MIC_SELECTORS],
    ["camera", CAM_SELECTORS],
  ] as const) {
    const btn = await findFirst(page, selectors);
    if (!btn) continue;
    if ((await readOnState(btn)) === true) stillOn.push(kind);
  }
  // Jaring pengaman terakhir: iterasi semua [role="switch"] dan baca state
  // via readOnState (mendeteksi input.checked juga, bukan cuma aria-checked).
  const switches = await page.locator('[role="switch"]').all();
  for (const sw of switches) {
    if ((await readOnState(sw)) === true) {
      stillOn.push("unknown-toggle");
      break;
    }
  }
  if (stillOn.length > 0) {
    throw new Error(
      `Refusing to join Teams meeting with ${stillOn.join(" & ")} still on. ` +
        "Pre-join toggle did not respond to the mute click.",
    );
  }
}

export const teams: MeetingPlatform = {
  async join(page: Page, opts: JoinOptions) {
    await page.goto(opts.meetingUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    // Teams kadang menawarkan buka app desktop / lanjut di browser. Pakai
    // browser web client. Klik best-effort (tidak selalu muncul).
    await clickIfVisible(
      page.getByRole("button", {
        name: /continue on this browser|lanjutkan di browser ini/i,
      }),
      10_000,
    );

    const nameInput = page
      .locator('input[data-tid="prejoin-display-name-input"]')
      .or(page.getByPlaceholder(/type your name|ketik nama/i))
      .first();
    try {
      await nameInput.waitFor({ state: "visible", timeout: 60_000 });
    } catch (err) {
      await assertNotBlocked(page);
      throw err;
    }

    // Isi nama & interaksi dengan gerak mouse + keystroke manusiawi — hindari
    // fill()/click() instan yang jadi ciri automation dan memicu deteksi bot.
    await humanType(page, nameInput, opts.botName);
    await randomDelay(400);

    // Bot hanya pendengar: matikan mic & kamera sebelum bergabung (cek #1).
    // Dua pass: (a) selektor spesifik untuk toggle yang kita kenali,
    // (b) sweep semua [role="switch"] yang masih on — layar pra-gabung
    // Teams (termasuk light-meetings anonymous) hanya expose mic & kamera
    // sebagai switch, jadi aman. Verifikasi terakhir gagalkan join kalau
    // masih ada yang on.
    await turnOffMedia(page, "mic");
    await turnOffMedia(page, "camera");
    await turnOffAllOnSwitches(page);
    await randomDelay(300);
    await assertMediaOff(page);

    // Pilih tombol Join utama saja — JANGAN tombol "Join without audio".
    // Teams kadang menampilkan opsi itu sebagai bypass kalau device audio
    // dianggap bermasalah; kita tidak butuh, karena mic sudah dipastikan mati
    // di atas dan bot tetap butuh audio (untuk mendengarkan/merekam).
    const joinButton = page
      .locator('button[data-tid="prejoin-join-button"]')
      .or(
        page
          .getByRole("button", { name: /join now|gabung sekarang/i })
          .filter({ hasNotText: /without audio|tanpa audio/i }),
      )
      .first();
    await humanClick(page, joinButton);

    await assertNotBlocked(page);
    opts.onWaitingAdmission();

    // Menunggu di lobby sampai host meng-admit. Selama menunggu, Teams bisa
    // memunculkan layar penolakan — deteksi itu dan gagal cepat alih-alih
    // menggantung sampai joinTimeoutMs habis.
    const hangup = page.locator(HANGUP).first();
    const deadline = Date.now() + opts.joinTimeoutMs;
    while (Date.now() < deadline) {
      if (await hangup.isVisible().catch(() => false)) {
        // Cek #2: pastikan mic & kamera benar-benar mati setelah masuk call.
        // Tunggu sebentar supaya toolbar in-call selesai dirender sebelum
        // membaca state, lalu jalankan turnOffMedia (retry internal kalau
        // state masih on). Sweep [role="switch"] TIDAK dipakai di sini —
        // di dalam call bisa ada switch lain yang tidak boleh disentuh.
        await sleep(1500);
        await turnOffMedia(page, "mic");
        await turnOffMedia(page, "camera");
        return;
      }
      // Masih di lobby — DOM lobby (terutama light-meetings anonymous flow)
      // masih menampilkan toggle mic/kamera. Terus matikan supaya begitu
      // di-admit, bot masuk dengan perangkat sudah mati.
      await turnOffMedia(page, "mic");
      await turnOffMedia(page, "camera");
      await turnOffAllOnSwitches(page);
      await assertNotBlocked(page);
      await sleep(3000);
    }
    throw new Error(
      `Not admitted within ${Math.round(opts.joinTimeoutMs / 1000)}s. ` +
        "The host did not approve the join request.",
    );
  },

  async waitForEnd(page: Page): Promise<string> {
    const hangup: Locator = page.locator(HANGUP).first();
    while (true) {
      await sleep(5000);
      if (page.isClosed()) return "page_closed";
      const inCall = await hangup.isVisible().catch(() => false);
      if (!inCall) return "meeting_ended";
    }
  },
};
