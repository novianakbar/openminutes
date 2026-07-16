import type { Locator, Page } from "playwright";
import {
  clickIfVisible,
  humanClick,
  humanType,
  randomDelay,
  sleep,
} from "./helpers.js";
import type { MeetingPlatform, JoinOptions } from "./types.js";

// Zoom jauh lebih ketat dari Meet/Teams: begitu mencurigai automation ia
// menampilkan captcha (reCAPTCHA/hCaptcha) alih-alih halaman join biasa. Kita
// TIDAK mencoba menyelesaikan captcha — kemunculannya = bot sudah terdeteksi,
// jadi gagal cepat dengan pesan jelas supaya fingerprint/IP bisa diperbaiki.
// Anti-deteksi dasar (webdriver, bahasa, plugins, AutomationControlled) ditangani
// di index.ts; di sini fokusnya perilaku manusiawi + web client.

// Tombol Leave di toolbar in-meeting menandakan kita SUDAH di dalam call.
const LEAVE_BUTTON =
  'button[aria-label="Leave"], button[aria-label*="Leave" i], .footer__leave-btn, #wc-footer button.leave-btn';

// Teks penolakan / kondisi gagal yang Zoom tampilkan — deteksi untuk gagal
// cepat alih-alih menggantung sampai joinTimeoutMs habis.
const BLOCKED_TEXT =
  /this meeting has been ended|meeting id is not valid|invalid meeting id|passcode wrong|incorrect (meeting )?passcode|wrong passcode|is not allowed to join|automated bots? (are|aren't|are not) allowed|you have been removed|removed by the host|host has (?:another|a different) meeting|meeting is locked|not started/i;

// Sinyal captcha — jika salah satu muncul, bot terdeteksi.
const CAPTCHA_TEXT = /verify you are human|are you a robot|complete the captcha|security check/i;
const CAPTCHA_FRAME =
  'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="captcha" i], div.g-recaptcha, div[class*="hcaptcha" i]';

interface ZoomTarget {
  launcherUrl: string;
  webClientUrl: string;
  pwd: string | null;
}

// Ambil meeting id dari berbagai bentuk URL Zoom (/j/{id}, /s/{id},
// /wc/{id}/join, /wc/join/{id}), lalu siapkan dua target:
// - launcherUrl: halaman normal yang manusia buka dari undangan.
// - webClientUrl: fallback langsung ke browser client bila link browser tidak
//   muncul dari launcher.
function toZoomTarget(raw: string): ZoomTarget | null {
  try {
    const u = new URL(raw);
    if (u.hostname !== "zoom.us" && !u.hostname.endsWith(".zoom.us")) return null;
    const id = u.pathname.match(/(\d{9,11})/)?.[1];
    if (!id) return null;
    const launcher = new URL(`https://${u.hostname}/j/${id}`);
    const webClient = new URL(`https://${u.hostname}/wc/${id}/join`);
    const pwd = u.searchParams.get("pwd");
    if (pwd) {
      launcher.searchParams.set("pwd", pwd);
      webClient.searchParams.set("pwd", pwd);
    }
    return {
      launcherUrl: launcher.toString(),
      webClientUrl: webClient.toString(),
      pwd,
    };
  } catch {
    return null;
  }
}

async function assertNoCaptcha(page: Page): Promise<void> {
  const frame = page.locator(CAPTCHA_FRAME).first();
  if (await frame.isVisible().catch(() => false)) {
    throw new Error(
      "Zoom presented a captcha — the bot was flagged as automation. " +
        "It cannot be solved automatically; improve the browser fingerprint or use a cleaner IP.",
    );
  }
  const text = page.getByText(CAPTCHA_TEXT).first();
  if (await text.isVisible().catch(() => false)) {
    throw new Error(
      "Zoom asked for human verification — the bot was flagged as automation. " +
        "It cannot be solved automatically; improve the browser fingerprint or use a cleaner IP.",
    );
  }
}

async function assertNotBlocked(page: Page): Promise<void> {
  await assertNoCaptcha(page);
  const blocked = page.getByText(BLOCKED_TEXT).first();
  if (await blocked.isVisible().catch(() => false)) {
    const reason = (await blocked.textContent().catch(() => null))?.trim();
    throw new Error(`Zoom rejected the join request: ${reason || "reason unavailable"}`);
  }
}

// Klik "Join from Your Browser" jika kita mendarat di halaman launcher
// (mis. karena transform URL gagal & kita buka link /j/ mentah). Best-effort:
// beberapa versi menyembunyikan link ini sampai "Launch Meeting" diklik dulu.
async function waitForWebClient(page: Page, timeoutMs = 5000): Promise<boolean> {
  if (page.url().includes("/wc/")) return true;
  await page.waitForURL(/\/wc\//, { timeout: timeoutMs }).catch(() => {});
  return page.url().includes("/wc/");
}

async function ensureWebClient(page: Page): Promise<boolean> {
  if (await waitForWebClient(page, 500)) return true;
  const clicked = await clickIfVisible(
    page
      .getByRole("link", { name: /join from your browser|gabung dari browser/i })
      .or(page.getByText(/join from your browser|gabung dari browser/i)),
    8000,
  );
  if (!clicked) return false;
  return waitForWebClient(page);
}

async function openZoomWebClient(page: Page, opts: JoinOptions): Promise<string | null> {
  const target = toZoomTarget(opts.meetingUrl);
  if (!target) {
    await page.goto(opts.meetingUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await ensureWebClient(page);
    return new URL(opts.meetingUrl, "https://zoom.us").searchParams.get("pwd");
  }

  // Ambil cookie/server-side context dari launcher TANPA membuka halamannya di
  // tab browser. Kalau /j/{id} dieksekusi sebagai page, Zoom dapat auto-launch
  // zoommtg:/ dan memunculkan dialog xdg-open yang memblokir automation.
  await page.request
    .get(target.launcherUrl, {
      headers: {
        "accept-language": "en-US,en;q=0.9",
      },
      maxRedirects: 0,
      timeout: 30_000,
    })
    .catch(() => {});

  await randomDelay(500);
  await page.goto(target.webClientUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
    referer: target.launcherUrl,
  });
  return target.pwd;
}

async function humanPause(page: Page, minMs: number, maxMs: number): Promise<void> {
  const duration = minMs + Math.floor(Math.random() * Math.max(1, maxMs - minMs));
  const deadline = Date.now() + duration;
  while (Date.now() < deadline) {
    await page.mouse
      .move(260 + Math.random() * 760, 160 + Math.random() * 420, {
        steps: 6 + Math.floor(Math.random() * 10),
      })
      .catch(() => {});
    await sleep(250 + Math.random() * 450);
  }
}

async function logMediaDevices(page: Page, stage: string): Promise<void> {
  const devices = await page
    .evaluate(async () => {
      const list = await navigator.mediaDevices.enumerateDevices();
      return list.map((device) => ({
        kind: device.kind,
        label: device.label,
        id: device.deviceId ? "set" : "empty",
      }));
    })
    .catch((err) => [{ kind: "error", label: String(err), id: "error" }]);
  console.log(`[zoom media] ${stage}: ${JSON.stringify(devices)}`);
}

// --- Kontrol mic/kamera ------------------------------------------------------
// Semua tombol audio/video Zoom adalah TOGGLE dan labelnya menyatakan AKSI
// berikutnya: "Mute"/"Stop Video" berarti device masih ON. Jangan pernah klik
// buta — baca label dulu, klik hanya saat ON, lalu verifikasi labelnya
// berbalik. (Bug lama: satu tombol fisik match beberapa locator sehingga
// ter-klik dua kali → device menyala kembali tepat sebelum join.)

interface Toggle {
  button: Locator;
  isOn: RegExp; // label saat device ON → klik untuk mematikan
  isOff: RegExp; // label saat device sudah OFF
  what: string;
}

async function toggleLabel(t: Toggle): Promise<string | null> {
  const btn = t.button;
  if (!(await btn.isVisible().catch(() => false))) return null;
  const aria = await btn.getAttribute("aria-label").catch(() => null);
  const text = aria ?? (await btn.textContent().catch(() => null));
  return text?.trim() ?? null;
}

async function turnOff(page: Page, t: Toggle): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const label = await toggleLabel(t);
    if (label === null || t.isOff.test(label)) return; // tak ada / sudah off
    if (!t.isOn.test(label)) return; // state tak dikenal — jangan diutak-atik
    await humanClick(page, t.button);
    await sleep(700);
  }
  console.warn(`Could not turn off ${t.what}: toggle label never flipped`);
}

function previewMic(page: Page): Toggle {
  return {
    button: page
      .locator("#preview-audio-control-button")
      .or(page.getByRole("button", { name: /^(mute|unmute)$/i }))
      .first(),
    isOn: /^mute/i,
    isOff: /^unmute/i,
    what: "preview microphone",
  };
}

function previewCamera(page: Page): Toggle {
  return {
    button: page
      .locator("#preview-video-control-button")
      .or(page.getByRole("button", { name: /^(stop|start) video$/i }))
      .first(),
    isOn: /^stop video/i,
    isOff: /^start video/i,
    what: "preview camera",
  };
}

// Toolbar in-meeting punya tombol berbeda dari preview. Label "join audio"
// berarti computer audio belum terhubung → mic tidak mengirim apa pun,
// jadi dihitung "off".
function meetingMic(page: Page): Toggle {
  return {
    button: page
      .locator("button.join-audio-container__btn")
      .or(page.getByRole("button", { name: /mute my (microphone|audio)/i }))
      .first(),
    isOn: /^mute my/i,
    isOff: /^unmute my|join audio/i,
    what: "meeting microphone",
  };
}

function meetingCamera(page: Page): Toggle {
  return {
    button: page
      .locator("button.send-video-container__btn")
      .or(page.getByRole("button", { name: /(stop|start) my video/i }))
      .first(),
    isOn: /^stop my video/i,
    isOff: /^start my video/i,
    what: "meeting camera",
  };
}

// Matikan mic/kamera di layar preview sebelum menekan Join.
async function muteInPreview(page: Page): Promise<void> {
  await turnOff(page, previewMic(page));
  await randomDelay(200);
  await turnOff(page, previewCamera(page));
}

// Pastikan mic/kamera mati di dalam call. Toolbar footer auto-hide, jadi
// gerakkan mouse dulu supaya tombolnya punya bounding box untuk diklik.
async function muteInMeeting(page: Page): Promise<void> {
  await page.mouse.move(640, 690).catch(() => {});
  await sleep(400);
  await turnOff(page, meetingMic(page));
  await turnOff(page, meetingCamera(page));
}

// Host bisa meminta bot unmute; selalu tolak supaya mic tak pernah aktif
// karena interaksi pihak lain.
async function dismissUnmuteRequest(page: Page): Promise<void> {
  const stay = page.getByRole("button", { name: /stay muted/i }).first();
  if (await stay.isVisible().catch(() => false)) {
    await stay.click().catch(() => {});
  }
}

// Bot wajib connect "computer audio" agar MENERIMA suara meeting — tanpanya
// rekaman kosong. Mic tetap aman: fake device diarahkan ke file hening (lihat
// index.ts) dan pemanggil langsung memastikan mute setelah terhubung.
async function ensureAudioJoined(page: Page): Promise<void> {
  const footerBtn = page.locator("button.join-audio-container__btn").first();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const label =
      (await footerBtn.getAttribute("aria-label").catch(() => null)) ?? "";
    if (/(un)?mute my/i.test(label)) return; // audio sudah terhubung

    // Dialog "Join Audio by Computer" — muncul otomatis atau setelah tombol
    // footer diklik.
    const dialogBtn = page
      .getByRole("button", { name: /join audio by computer|computer audio/i })
      .first();
    if (await dialogBtn.isVisible().catch(() => false)) {
      await humanClick(page, dialogBtn);
    } else if (/join audio/i.test(label)) {
      await page.mouse.move(640, 690).catch(() => {});
      await clickIfVisible(footerBtn, 2000);
    }
    await sleep(2000);
  }
  throw new Error(
    "Could not connect computer audio in the Zoom web client, so the recording " +
      "would be silent. (Some meetings — e.g. free-tier hosts — do not offer " +
      "computer audio in the browser client.)",
  );
}

export const zoom: MeetingPlatform = {
  async join(page: Page, opts: JoinOptions) {
    const pwd = await openZoomWebClient(page, opts);
    await humanPause(page, 1800, 4200);
    await logMediaDevices(page, "webclient-loaded");
    await assertNoCaptcha(page);

    // Cookie/consent banner best-effort.
    await clickIfVisible(page.getByRole("button", { name: /accept|setuju|got it/i }), 3000);
    await humanPause(page, 900, 2200);

    // Field nama web client. Passcode diisi otomatis lewat query pwd; kalau
    // Zoom tetap minta, isi dari pwd bila ada.
    const nameInput = page
      .locator("#input-for-name")
      .or(page.getByPlaceholder(/your name|nama anda/i))
      .or(page.locator('input[type="text"]'))
      .first();
    try {
      await nameInput.waitFor({ state: "visible", timeout: 45_000 });
    } catch (err) {
      await assertNotBlocked(page);
      throw err;
    }
    await assertNoCaptcha(page);
    await humanPause(page, 1200, 2600);

    // Interaksi manusiawi — gerak mouse + keystroke bertahap, hindari
    // fill()/click() instan yang jadi ciri automation.
    await humanType(page, nameInput, opts.botName);
    await humanPause(page, 900, 2200);

    const pwdField = page
      .locator("#input-for-pwd")
      .or(page.getByPlaceholder(/passcode|kata sandi/i))
      .first();
    if (await pwdField.isVisible().catch(() => false)) {
      if (pwd) {
        await humanType(page, pwdField, pwd);
        await randomDelay(300);
      }
    }

    await muteInPreview(page);
    await humanPause(page, 1200, 2800);

    const joinButton = page
      .locator("#joinBtn")
      .or(page.getByRole("button", { name: /^join$/i }))
      .or(page.getByRole("button", { name: /join meeting|gabung/i }))
      .first();
    await humanClick(page, joinButton);

    await assertNotBlocked(page);
    opts.onWaitingAdmission();

    // Menunggu di waiting room ("host will let you in soon"). Deteksi captcha /
    // penolakan supaya gagal cepat; kalau toolbar in-meeting (Leave) muncul,
    // berarti sudah masuk.
    const leaveButton = page.locator(LEAVE_BUTTON).first();
    const deadline = Date.now() + opts.joinTimeoutMs;
    while (Date.now() < deadline) {
      if (await leaveButton.isVisible().catch(() => false)) {
        // Sudah masuk: connect computer audio (wajib agar rekaman ada
        // suaranya), lalu pastikan mic/kamera mati di toolbar in-meeting.
        await ensureAudioJoined(page);
        await muteInMeeting(page);
        return;
      }
      await assertNotBlocked(page);
      await sleep(3000);
    }
    throw new Error(
      `Not admitted within ${Math.round(opts.joinTimeoutMs / 1000)}s. ` +
        "The host did not approve the join request.",
    );
  },

  async waitForEnd(page: Page): Promise<string> {
    const leaveButton = page.locator(LEAVE_BUTTON).first();
    while (true) {
      await sleep(5000);
      if (page.isClosed()) return "page_closed";
      const ended = await page
        .getByText(/this meeting has been ended|host has ended|meeting is over/i)
        .isVisible()
        .catch(() => false);
      if (ended) return "meeting_ended";
      const removed = await page
        .getByText(/you have been removed|removed by the host/i)
        .isVisible()
        .catch(() => false);
      if (removed) return "removed";
      const inCall = await leaveButton.isVisible().catch(() => false);
      if (!inCall) return "meeting_ended";
      // Penjagaan berkala: tolak permintaan unmute dari host & matikan lagi
      // mic/kamera bila state-nya berubah selama meeting.
      await dismissUnmuteRequest(page);
      await muteInMeeting(page);
    }
  },
};
