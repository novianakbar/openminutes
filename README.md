# OpenMinutes

Sistem bot meeting: kirim link Google Meet / Microsoft Teams, sistem men-spawn
kontainer Docker berisi bot (Chromium + Playwright) yang join sebagai peserta,
merekam audio meeting, lalu mentranskripsinya.

Multi-user: admin membuat akun, tiap user login dan hanya melihat meeting
miliknya sendiri.

## Arsitektur

```
apps/web (Vite + React) ──┐
klien lain (curl/dsb) ────┴─HTTP──▶ apps/api (Fastify + better-auth)
                  ├─ spawn kontainer via Docker API ──▶ apps/bot (Playwright + PulseAudio + FFmpeg)
                  │                                        ├─ join meeting, rekam audio
                  │                                        ├─ upload rekaman ke MinIO
                  │                                        └─ callback status ke /internal/*
                  └─ enqueue job (BullMQ/Redis) ──▶ apps/worker ── STT provider ──▶ PostgreSQL
```

| Paket | Peran |
|---|---|
| `apps/web` | Dashboard web (Vite + React + Tailwind) — login, meeting, transkrip, halaman admin |
| `apps/api` | REST API, auth session + API key (better-auth), bot manager (dockerode) |
| `apps/bot` | Bot meeting — dibangun jadi image `openminutes-bot:dev`, satu kontainer per meeting |
| `apps/worker` | Konsumer antrian transkripsi — provider pluggable (Deepgram / OpenAI-compatible) |
| `packages/shared` | Schema Drizzle + tipe bersama |

## Menjalankan (production Docker)

Alur production full Docker:

```bash
make setup
make build
make up
```

`make setup` mengecek/menginstall dependency host untuk Ubuntu/Debian, Fedora,
atau macOS: `git`, `make`, `curl`, `openssl`, Docker + Compose plugin,
Node/Corepack/pnpm. Jika `.env` belum ada, script membuat `.env` production
dengan secret/password acak dan default yang cocok untuk jaringan Docker.
File `.env` yang sudah ada tidak akan ditimpa.

Setelah `make up`, dashboard tersedia di:

```text
http://localhost:8080
```

Target Make yang tersedia:

```bash
make setup      # siapkan host + buat .env production bila belum ada
make build      # build image api, worker, web, dan bot
make up         # start infra, push schema, seed admin, start app
make down       # stop stack
make logs       # tail logs semua service
make ps         # lihat status service
make restart    # restart api/worker/web
make db-push    # push schema database
make seed       # seed admin idempotent
make clean      # stop stack dan hapus volume
```

Default admin seed:

```text
admin@openminutes.dev / admin12345
```

Bisa dioverride saat seed/up:

```bash
make seed ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='password-ku'
make up ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='password-ku'
```

Env production penting:

- `ENV_FILE` — path env file yang dipakai service `api` dan `worker`;
  default `.env`. Biasanya tidak perlu diubah.
- `APP_PORT` — port HTTP host untuk web, default `8080`.
- `POSTGRES_PORT`, `REDIS_PORT`, `MINIO_HOST_PORT`, `MINIO_CONSOLE_PORT` —
  port infra yang dibind ke `127.0.0.1` untuk operasional/debug lokal.
- `BETTER_AUTH_URL` dan `WEB_ORIGIN` — isi dengan URL publik deployment
  bila dijalankan di balik reverse proxy/domain.
- `BOT_IMAGE=openminutes-bot:prod`, `BOT_NETWORK=openminutes-net`,
  `BOT_VNC_MODE=network` — membuat API dan bot dinamis berada di network Docker
  yang sama sehingga live view tidak perlu publish port bot.
- `DEEPGRAM_API_KEY` opsional sebagai fallback; konfigurasi utama provider
  transkripsi tetap bisa diatur dari UI admin.

Production awal diekspos sebagai HTTP lokal/configurable. Untuk HTTPS/domain,
taruh reverse proxy eksternal (mis. Nginx, Caddy, Cloudflare Tunnel) di depan
port `APP_PORT`.

## Menjalankan (dev lokal)

```bash
pnpm install
pnpm infra:up          # Postgres, Redis, MinIO (+ bucket "recordings")
pnpm db:push           # terapkan schema
pnpm db:seed           # buat admin (default: admin@openminutes.dev / admin12345)
pnpm bot:build         # build image bot (sekali, atau tiap kali kode bot berubah)
pnpm dev:api           # terminal 1
pnpm dev:worker        # terminal 2
pnpm dev:web           # terminal 3 — dashboard di http://localhost:5173
```

Login di dashboard dengan kredensial hasil `db:seed` (bisa dioverride:
`pnpm db:seed -- email password`). Dev server web mem-proxy `/api` ke
`http://localhost:3000`.

## Auth & multi-user

- **Web**: login email + password (session cookie). Registrasi publik dimatikan —
  akun dibuat admin lewat halaman **Users**.
- **Admin**: role `admin` membuka halaman Users (create/ban/role/hapus user) dan
  Transcription (konfigurasi provider STT).
- **Programmatic**: tiap user bisa membuat API key di halaman **Settings**,
  dipakai sebagai header `x-api-key` — endpoint yang sama menerima session
  cookie maupun API key.
- Isolasi resource: semua endpoint meeting difilter berdasarkan user pemilik.

## Transcription

Provider diatur admin dari halaman **Transcription** (tersimpan di DB, berlaku
untuk job berikutnya tanpa restart worker). Bahasa transkripsi dipilih user saat
join meeting dan disimpan per meeting:

- **Deepgram** — dengan speaker diarization.
- **OpenAI-compatible** — `POST {baseUrl}/audio/transcriptions`
  (`verbose_json`); dipakai untuk OpenAI, Groq, atau whisper self-hosted
  (mis. speaches / faster-whisper-server). Tanpa diarization.

Mode **Real-time** mengirim audio bot ke API saat meeting berjalan. Deepgram
memakai streaming WebSocket dengan partial transcript; OpenAI-compatible memakai
micro-batch ke endpoint transkripsi yang sama agar tetap kompatibel dengan
OpenAI/Groq/server Whisper lokal. Jika realtime gagal, rekaman tetap diupload dan
diproses lewat alur after-meeting.

Tanpa konfigurasi, rekaman tetap tersimpan tapi transkripsi dilewati
(status `transcription_skipped`). Env `DEEPGRAM_API_KEY` jadi fallback bila
settings belum diisi.

## Pemakaian via API

```bash
# Buat API key dulu di dashboard (Settings), lalu:

# Suruh bot join meeting
curl -X POST http://localhost:3000/api/bots \
  -H "x-api-key: <API_KEY>" -H "content-type: application/json" \
  -d '{"meetingUrl": "https://meet.google.com/xxx-yyyy-zzz", "botName": "OpenMinutes Bot"}'

# Cek status + transkrip
curl http://localhost:3000/api/meetings/<meetingId> -H "x-api-key: <API_KEY>"

# Suruh bot keluar dari meeting
curl -X DELETE http://localhost:3000/api/bots/<meetingId> -H "x-api-key: <API_KEY>"
```

Alur status meeting: `pending → joining → waiting_admission → recording →
uploading → processing_transcript → completed` (atau `failed` /
`transcription_skipped`).

Catatan penting:
- Bot Google Meet biasanya harus di-approve host dari waiting room ("ask to join").
- Dukungan Teams eksperimental — hanya bekerja jika tenant mengizinkan anonymous join.
- Selector UI Meet/Teams bisa berubah sewaktu-waktu; kalau bot gagal join, cek
  `docker logs` kontainer `openminutes-bot-<meetingId>`.

## Belum dikerjakan (roadmap)

- Login Google/GitHub (tinggal aktifkan `socialProviders` di
  `apps/api/src/auth.ts` + tombol di halaman login).
- Speaker mapping dari DOM meeting (siapa berbicara).
- Migrasi bot manager ke Kubernetes Jobs (interface sudah dipisah di
  `apps/api/src/services/botManager.ts`).
# openminutes
