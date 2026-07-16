import type { Page } from "playwright";
import {
  clickIfVisible,
  humanClick,
  humanType,
  randomDelay,
  sleep,
} from "./helpers.js";
import type { MeetingPlatform, JoinOptions } from "./types.js";

// Selector berbasis teks EN + ID — Google sering mengubah DOM Meet,
// jadi semuanya best-effort dengan fallback.
const LEAVE_BUTTON = /leave call|keluar dari panggilan/i;

// Kalau Meet me-redirect keluar dari meet.google.com (mis. ke halaman
// marketing workspace.google.com), biasanya UA browser dianggap tak didukung.
function assertStillOnMeet(page: Page): void {
  const url = page.url();
  if (/^https:\/\/meet\.google\.com\//.test(url)) return;
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();
  throw new Error(
    `Redirected away from Google Meet to ${host}. The browser may not be supported. ` +
      "Check the browser user agent.",
  );
}

async function assertNotBlocked(page: Page): Promise<void> {
  assertStillOnMeet(page);
  const blocked = page.getByText(
    /you can't join|can't join this|check your meeting code|tidak dapat bergabung|periksa kode rapat/i,
  );
  if (await blocked.first().isVisible().catch(() => false)) {
    throw new Error(
      `Google Meet rejected the join request: ${(await blocked.first().textContent()) ?? "reason unavailable"}`,
    );
  }
}

// Mematikan mic/kamera: tombol "Turn off ..." hanya muncul saat perangkat
// menyala, jadi mengkliknya = state jadi mati. No-op kalau sudah mati.
async function turnOffMedia(page: Page, name: RegExp): Promise<void> {
  const btn = page.getByRole("button", { name }).first();
  if (await btn.isVisible().catch(() => false)) {
    await humanClick(page, btn);
    await randomDelay(200);
  }
}

export const googleMeet: MeetingPlatform = {
  async join(page: Page, opts: JoinOptions) {
    await page.goto(opts.meetingUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await clickIfVisible(page.getByRole("button", { name: /got it|mengerti/i }));

    const nameInput = page
      .getByPlaceholder(/your name|nama anda/i)
      .or(page.locator('input[type="text"]'))
      .first();
    try {
      await nameInput.waitFor({ state: "visible", timeout: 30_000 });
    } catch (err) {
      await assertNotBlocked(page);
      throw err;
    }
    assertStillOnMeet(page);

    // Isi nama & klik dengan gerak mouse manusiawi. Meet menolak submit
    // "Ask to join" bila kursor teleport (ciri automation) — lihat helpers.
    await humanType(page, nameInput, opts.botName);
    await randomDelay(400);

    // Bot hanya pendengar: matikan mic & kamera di layar pra-gabung.
    // Tombol "Turn off ..." hanya ada saat perangkat sedang menyala.
    await turnOffMedia(page, /turn off microphone|matikan mikrofon/i);
    await turnOffMedia(page, /turn off camera|matikan kamera/i);
    await randomDelay(300);

    const joinButton = page
      .getByRole("button", {
        name: /ask to join|join now|minta bergabung|gabung sekarang/i,
      })
      .first();
    await humanClick(page, joinButton);

    await assertNotBlocked(page);
    opts.onWaitingAdmission();

    // Menunggu host meng-admit. Selama menunggu, Meet bisa memunculkan layar
    // penolakan ("You can't join this video call") jika host tak kunjung
    // meng-admit atau tak ada host aktif — deteksi itu dan gagal cepat alih-alih
    // menggantung sampai joinTimeoutMs habis.
    const leaveButton = page.getByRole("button", { name: LEAVE_BUTTON });
    const deadline = Date.now() + opts.joinTimeoutMs;
    while (Date.now() < deadline) {
      if (await leaveButton.isVisible().catch(() => false)) {
        // Jaring pengaman: pastikan mic & kamera tetap mati di dalam call.
        await turnOffMedia(page, /turn off microphone|matikan mikrofon/i);
        await turnOffMedia(page, /turn off camera|matikan kamera/i);
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
    const leaveButton = page.getByRole("button", { name: LEAVE_BUTTON });
    while (true) {
      await sleep(5000);
      if (page.isClosed()) return "page_closed";
      const removed = await page
        .getByText(/you've been removed|anda telah dikeluarkan/i)
        .isVisible()
        .catch(() => false);
      if (removed) return "removed";
      const inCall = await leaveButton.isVisible().catch(() => false);
      if (!inCall) return "meeting_ended";
    }
  },
};
