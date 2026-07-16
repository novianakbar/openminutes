# Design Doc — Live View Browser Bot di Dashboard (noVNC + API reverse-proxy)

Status: **Diimplementasi** (fase 1–5; hardening §7 belum). Lihat §13 untuk catatan implementasi.
Penulis: —
Terkait: `apps/bot`, `apps/api`, `apps/web`

---

## 1. Latar belakang & tujuan

Bot meeting berjalan `headless: false` di dalam **Xvfb display `:99`** di kontainer Docker
(lihat `apps/bot/entrypoint.sh`). Artinya sudah ada browser sungguhan yang dirender ke
layar virtual — kita cukup "menyiarkannya" ke dashboard.

Kegunaan utama: **debugging join** (terutama Teams yang sering terindikasi bot / nyangkut di
prejoin). Dengan live view + kemampuan ambil-alih (takeover), operator bisa melihat persis
kondisi layar bot dan mengintervensi manual (klik tombol aneh, lolos dari halaman "unsupported
browser", dsb) — jauh lebih cepat daripada menebak dari log.

### Goals
- Menonton layar bot **secara live** dari dashboard web (`apps/web`).
- Opsional **ambil alih** mouse/keyboard bot (takeover) untuk pemilik meeting.
- **Tanpa mem-publish port bot ke publik** — semua trafik lewat API sebagai reverse-proxy.
- Lintas platform: dev di macOS (Docker Desktop) & prod di Linux.

### Non-goals
- Merekam video sesi (audio-only recording yang sudah ada tidak berubah).
- Multi-tenant sharing / link publik. View hanya untuk pemilik meeting.
- Mengubah pipeline audio/transkrip.

---

## 2. Kenapa VNC + reverse-proxy

- Xvfb sudah ada → tambah `x11vnc` yang meng-export display `:99` sebagai server RFB. Nyaris nol
  perubahan pada logika bot.
- **noVNC** (RFB client di browser) berbicara RFB **di atas WebSocket**. Handshake & enkode
  frame terjadi **end-to-end antara browser dan x11vnc** — API di tengah hanya menyalurkan byte
  mentah (transparent pipe). Ini membuat proxy sangat sederhana dan tidak perlu paham protokol RFB.
- API sebagai reverse-proxy: bot **tidak** mem-publish port ke jaringan publik; hanya API (yang
  sudah memegang dockerode & auth pengguna) yang boleh menjangkau x11vnc.

Alternatif yang ditolak: screenshot polling (tersendat, bukan live) dan CDP screencast (view-only,
tidak bisa takeover, dan tetap perlu jalur WS yang sama). VNC memberi live + takeover sekaligus.

---

## 3. Arsitektur

```
┌────────────┐  wss (RFB over WS)      ┌──────────────┐   TCP RFB    ┌───────────────────────┐
│  Browser   │  ?token=<view-token>    │   API        │  raw byte    │  Kontainer bot        │
│  (noVNC)   │ ──────────────────────► │  (Fastify)   │ ───────────► │  x11vnc → Xvfb :99    │
│  canvas    │ ◄────────────────────── │  WS↔TCP pipe │ ◄─────────── │  (Chromium headful)   │
└────────────┘   frame RFB             └──────┬───────┘              └───────────────────────┘
                                              │ dockerode inspect (cari alamat x11vnc)
                                              ▼
                                        Docker Engine
```

Peran API = **websockify** yang ditanam di dalam server yang sudah ada: terima WebSocket dari
browser, buka koneksi TCP ke x11vnc milik kontainer bot, lalu salurkan byte dua arah.

---

## 4. Cara API menjangkau x11vnc (poin arsitektur paling penting)

Kontainer bot bersifat **ephemeral, `AutoRemove`, tanpa port publik** (`apps/api/src/services/botManager.ts`).
Ada dua mode deployment; helper `resolveVncTarget(containerId)` menyembunyikan perbedaannya:

- **Mode A — API di host (kondisi sekarang, dev macOS/Linux).**
  Di macOS Docker Desktop, IP kontainer **tidak** routable dari host, jadi kita **publish port
  x11vnc ke loopback host dengan port ephemeral**: `PortBindings 5900/tcp → 127.0.0.1:0` (Docker
  memilih port kosong). Saat proxy dipanggil, API `docker inspect` kontainer → baca
  `NetworkSettings.Ports["5900/tcp"][0].HostPort` → `net.connect(hostPort, "127.0.0.1")`.
  Port hanya terikat ke `127.0.0.1`, jadi tidak terekspos ke luar host.

- **Mode B — API di kontainer, jaringan sama (opsi prod).**
  Sambungkan API & bot ke satu user-defined network; API `net.connect(5900, "openminutes-bot-<id>")`
  via DNS Docker. Tidak perlu publish port sama sekali.

Keputusan: **implementasi awal pakai Mode A** (cocok dengan setup sekarang). `resolveVncTarget`
dibuat agar Mode B tinggal menambah cabang, tanpa mengubah pemanggil.

> Alamat x11vnc **diturunkan saat request** dari `containerId` yang sudah tersimpan di
> `meetings.containerId` — **tidak perlu kolom DB baru** untuk host/port.

---

## 5. Perubahan per komponen

### 5.1 Bot — `apps/bot/Dockerfile`
Tambah `x11vnc` ke daftar apt:
```dockerfile
RUN apt-get update \
    && apt-get install -y --no-install-recommends pulseaudio ffmpeg xvfb x11vnc \
    && rm -rf /var/lib/apt/lists/*
```

### 5.2 Bot — `apps/bot/entrypoint.sh`
Jalankan x11vnc setelah Xvfb siap, sebelum `node`:
```bash
Xvfb :99 -screen 0 1280x720x24 &

# Export display :99 sebagai server RFB untuk live view di dashboard.
# -forever: tetap hidup setelah viewer disconnect; -shared: banyak viewer;
# listen 0.0.0.0:5900 di dalam kontainer (dibatasi ke loopback host lewat PortBindings).
x11vnc -display :99 -rfbport 5900 -forever -shared -nopw -quiet -bg -noxdamage

pulseaudio -D --exit-idle-time=-1
...
```
Catatan `-nopw`: aman **karena** batas keamanan sebenarnya ada di layer API (token + kepemilikan)
dan port host hanya terikat `127.0.0.1`. Lihat §7 untuk opsi password (hardening).

### 5.3 Bot — `apps/bot/src/platforms/*` (takeover)
Tidak ada perubahan wajib. x11vnc mengirim input ke display `:99` yang sama, jadi klik manual dari
noVNC otomatis diterima Chromium. (Catatan: gerakan mouse manual saat takeover justru
memperkuat sinyal "manusia" untuk anti-bot detection.)

### 5.4 API — `apps/api/src/services/botManager.ts`
Publish port x11vnc ke loopback host saat spawn:
```ts
HostConfig: {
  AutoRemove: true,
  ShmSize: 2 * 1024 * 1024 * 1024,
  ExtraHosts: ["host.docker.internal:host-gateway"],
  PortBindings: { "5900/tcp": [{ HostIp: "127.0.0.1", HostPort: "" }] }, // ephemeral
},
ExposedPorts: { "5900/tcp": {} },
```
Tambah helper resolusi target:
```ts
// Kembalikan { host, port } TCP menuju x11vnc kontainer, atau null jika kontainer sudah tiada.
export async function resolveVncTarget(
  containerId: string,
): Promise<{ host: string; port: number } | null> {
  try {
    const info = await docker.getContainer(containerId).inspect();
    if (!info.State.Running) return null;
    const binding = info.NetworkSettings.Ports?.["5900/tcp"]?.[0]; // Mode A
    if (!binding) return null;
    return { host: "127.0.0.1", port: Number(binding.HostPort) };
  } catch (err) {
    if (isContainerGone(err)) return null;
    throw err;
  }
}
```

### 5.5 API — auth token untuk WebSocket
Browser tidak bisa mengirim header `x-api-key` saat membuka WebSocket, dan menaruh API key di URL
berisiko (bocor di log). Solusi: **view-token berumur pendek**.

Endpoint REST (sudah terautentikasi lewat `x-api-key` + cek kepemilikan di `botRoutes`):
```
POST /api/meetings/:id/view-token
→ 200 { token: string, expiresInSec: 60 }
```
`token = base64url(payload) + "." + HMAC_SHA256(payload, config.internalToken)` dengan
`payload = { meetingId, userId, exp }`. Verifikasi di handler WS. (Reuse `internalToken` sebagai
secret HMAC; boleh diganti secret khusus nanti.)

### 5.6 API — endpoint WebSocket proxy
Registrasi plugin `@fastify/websocket`, lalu:
```
GET /api/meetings/:id/vnc?token=<view-token>   (WebSocket upgrade)
```
Alur handler:
1. Verifikasi `token` (HMAC + belum kedaluwarsa + `meetingId` cocok).
2. Ambil meeting; pastikan `meeting.userId === token.userId` dan status masih **live**
   (`joining | waiting_admission | recording`) serta `containerId` ada.
3. `target = await resolveVncTarget(meeting.containerId)`; kalau `null` → tutup WS
   (kode 1011, alasan `bot_not_running`).
4. `const tcp = net.connect(target.port, target.host)` lalu **pipe dua arah**:
   - `ws.on("message", (buf) => tcp.write(buf))`  (browser → bot)
   - `tcp.on("data", (buf) => ws.send(buf))`      (bot → browser)
   - tutup salah satu sisi ⇒ tutup sisi lain; catat & telan error socket.
   WebSocket harus mode **binary**.

Kerangka:
```ts
app.get("/meetings/:id/vnc", { websocket: true }, async (conn, req) => {
  const ws = conn.socket;
  const claim = verifyViewToken((req.query as any).token);       // §5.5
  if (!claim) return ws.close(1008, "invalid_token");

  const meeting = await loadOwnedLiveMeeting(claim.meetingId, claim.userId);
  if (!meeting) return ws.close(1008, "not_found_or_ended");

  const target = await resolveVncTarget(meeting.containerId!);
  if (!target) return ws.close(1011, "bot_not_running");

  const tcp = net.connect(target.port, target.host);
  tcp.on("data", (d) => ws.readyState === ws.OPEN && ws.send(d));
  ws.on("message", (d: Buffer) => tcp.write(d));
  const shutdown = () => { tcp.destroy(); if (ws.readyState === ws.OPEN) ws.close(); };
  tcp.on("close", shutdown); tcp.on("error", shutdown);
  ws.on("close", shutdown); ws.on("error", shutdown);
});
```
> Endpoint ini didaftarkan di grup `/api`. Karena auth WS pakai view-token (bukan `preHandler`
> `x-api-key`), pastikan `preHandler` `botRoutes` di-skip untuk rute ini (mis. daftarkan di plugin
> terpisah, atau kecualikan path saat `req.ws`).

### 5.7 Web — `apps/web`
- Tambah dependency `@novnc/novnc` (di-bundle Vite, murni ESM). **Tidak** mengubah port dev
  (tetap 5173).
- Komponen `<BotLiveView meetingId status />`:
  1. Tampil hanya saat `status` live (`joining|waiting_admission|recording`).
  2. `POST /api/meetings/:id/view-token` → dapat `token`.
  3. Bentuk URL: `wss://<api-host>/api/meetings/:id/vnc?token=<token>`.
  4. `new RFB(canvasContainerEl, url, { ... })`; set `viewOnly` = `true` default, dengan toggle
     **"Ambil alih"** untuk mengaktifkan input (kirim mouse/keyboard).
  5. Tangani event `disconnect` RFB → tampilkan status "Bot tidak aktif / sesi berakhir" dan
     tombol reconnect.
- Tempatkan di halaman detail meeting (yang sudah memanggil `GET /api/meetings/:id`).

---

## 6. Data flow (happy path)
1. User buka detail meeting yang statusnya `waiting_admission`.
2. `BotLiveView` minta `view-token` (REST, `x-api-key`) → dapat token 60 dtk.
3. noVNC buka `wss://…/vnc?token=…`.
4. API verifikasi token & kepemilikan → `resolveVncTarget` → `net.connect` ke x11vnc.
5. Frame RFB mengalir bot → API → browser; canvas menampilkan layar bot.
6. User klik "Ambil alih", klik tombol join yang nyangkut → input mengalir browser → API → bot.
7. Meeting selesai / bot exit → kontainer `AutoRemove` → `resolveVncTarget` null di reconnect
   berikutnya → viewer tampilkan "sesi berakhir".

---

## 7. Keamanan
- **Isolasi jaringan**: port x11vnc hanya di-bind `127.0.0.1` pada host (Mode A). Tidak ada
  paparan ke publik.
- **Otorisasi**: WS hanya bisa dibuka dengan view-token bertanda tangan HMAC, berumur pendek,
  terikat ke `meetingId` + `userId`. Cek kepemilikan diulang di sisi server saat upgrade.
- **Batas status**: view hanya untuk meeting yang sedang live milik user.
- **Residual risk**: di dalam jaringan Docker, x11vnc mendengarkan `0.0.0.0:5900` (perlu agar port
  publishing jalan), sehingga kontainer lain di network yang sama bisa menjangkaunya.
  **Hardening (opsional, fase 2):** set password RFB per-sesi —
  `x11vnc -rfbauth /run/vncpass` dari env `VNC_PASSWORD` acak; karena RFB auth bersifat
  **end-to-end**, password diteruskan ke browser lewat response `view-token`
  (`{ token, vncCredential }`) dan diberikan ke noVNC sebagai `credentials`. API tetap pipe byte
  mentah tanpa tahu password.
- **Takeover**: hanya pemilik meeting. Pertimbangkan audit-log saat mode input diaktifkan.

---

## 8. Edge cases
- **Kontainer sudah exit** (`AutoRemove`): `inspect` → 404, `resolveVncTarget` null → WS ditutup
  rapi, UI tampilkan "bot tidak aktif".
- **Token kedaluwarsa** saat sesi panjang: noVNC minta token baru & reconnect otomatis.
- **Banyak viewer**: `x11vnc -shared` mengizinkan >1 koneksi; tiap viewer = pipe TCP sendiri.
- **Bot di-stop via API** saat ditonton: TCP putus → `shutdown()` menutup WS.
- **Race saat join** (bot baru mulai, x11vnc belum listen): `net.connect` gagal → UI retry singkat.
- **Ukuran layar**: Xvfb fix 1280x720; noVNC auto-scale ke kontainer canvas (`scaleViewport`).

---

## 9. Konfigurasi
- Bot: tidak ada env baru untuk versi `-nopw`. Untuk hardening: `VNC_PASSWORD` (di-generate API,
  dikirim via `Env` saat spawn).
- API: reuse `config.internalToken` sebagai secret HMAC view-token (boleh dipisah jadi
  `VIEW_TOKEN_SECRET` nanti). Tambah dependency `@fastify/websocket`.
- Web: tambah `@novnc/novnc`. Base URL API menyesuaikan konfigurasi `apps/web/src/lib/api.ts`
  (skema `ws/wss` diturunkan dari origin API).

---

## 10. Rencana implementasi (bertahap)
1. **Bot**: Dockerfile (`x11vnc`) + entrypoint (jalankan x11vnc). Rebuild image.
2. **API infra**: `PortBindings`/`ExposedPorts` + `resolveVncTarget` di `botManager.ts`.
3. **API auth**: mint & verify view-token.
4. **API proxy**: registrasi `@fastify/websocket` + route `/vnc` (pipe WS↔TCP).
5. **Web**: dependency noVNC + komponen `BotLiveView` + toggle takeover.
6. **Hardening (opsional)**: password RFB per-sesi.

Estimasi kasar: langkah 1–5 ~1 hari kerja; langkah 6 setengah hari.

---

## 11. Rencana verifikasi (dijalankan nanti, bukan sekarang)
- Spawn bot ke satu meeting uji; pastikan `docker inspect` menunjukkan `5900/tcp` ter-bind ke
  `127.0.0.1:<port>`.
- Buka dashboard → live view tampil, layar bot terlihat bergerak (prejoin Meet/Teams).
- Aktifkan takeover → klik di canvas menggerakkan kursor bot.
- Stop bot → viewer menutup rapi.
- Uji token: URL WS tanpa token / token kedaluwarsa ditolak (close 1008).

---

## 12. Pertanyaan terbuka
- Perlukah takeover sekarang, atau view-only dulu untuk fase 1? → **Diputuskan:** view-only
  default, takeover di belakang toggle "Ambil alih".
- Secret view-token: reuse `internalToken` atau env terpisah sejak awal? → **Diputuskan:** reuse
  `internalToken` dulu.
- Mode B (API dalam kontainer) untuk prod — kapan ditargetkan? Menentukan apakah `PortBindings`
  perlu dipertahankan atau cukup DNS network. (Masih terbuka.)

---

## 13. Catatan implementasi (deviasi kecil dari rancangan)
- **URL WS same-origin, bukan `wss://<api-host>`**: web dev memakai proxy Vite `/api` → :3000,
  jadi `BotLiveView` membentuk `ws(s)://${location.host}/api/meetings/:id/vnc?token=…` dan proxy
  Vite diberi `ws: true`. Berlaku juga untuk prod di belakang reverse-proxy same-origin.
- **`@fastify/websocket` v11** (Fastify 5): signature handler `(socket, req)` — bukan
  `conn.socket` seperti sketsa §5.6. Route WS didaftarkan sebagai plugin terpisah
  (`services/vncProxy.ts`) tanpa preHandler auth milik `botRoutes`.
- **Auth REST via session cookie**: web memanggil `POST /view-token` dengan cookie session
  (preHandler `botRoutes` menerima session maupun `x-api-key`).
- **noVNC 1.7**: entry `import RFB from "@novnc/novnc"`; tidak ada types resmi → deklarasi lokal
  di `apps/web/src/types/novnc.d.ts`.
- **entrypoint.sh**: x11vnc dibungkus retry-loop menunggu Xvfb siap; kalau tetap gagal, bot
  jalan terus tanpa live view (VNC bukan jalur kritis).
- **Halaman live terpisah + connect eksplisit** (revisi UX): live view TIDAK auto-connect di
  detail meeting. Detail hanya menampilkan kartu dengan tombol "Buka Live View" → route
  `/meetings/:id/live` (tab baru, `apps/web/src/pages/MeetingLivePage.tsx`). Koneksi dimulai
  lewat tombol "Sambungkan" (state machine idle→connecting→connected→ended), ada tombol
  "Putuskan", dan sesi ditutup rapi saat bot berhenti. Penyebab revisi: auto-connect ganda
  (StrictMode me-mount efek 2×, dua `connect()` async lolos guard sebelum `await` → dua canvas
  tertumpuk); guard kini pakai nomor sesi (`genRef`) yang dinaikkan sinkron + `replaceChildren()`
  sebelum attach.
- Verifikasi yang sudah dijalankan: smoke test kontainer (x11vnc listen, greeting `RFB 003.008`
  terbaca dari host via port ephemeral 127.0.0.1) dan curl API (view-token tanpa auth → 401;
  WS dengan token invalid → close 1008 `invalid_token`). Uji end-to-end di dashboard oleh user.
