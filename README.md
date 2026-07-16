# OpenMinutes

OpenMinutes is a self-hosted meeting bot for recording and transcribing online
meetings. Give it a Google Meet or Microsoft Teams link, and it will start a
browser-based bot, join the meeting, record the audio, upload the recording, and
process the transcript.

The app is built for multi-user teams: admins create accounts, users only see
their own meetings, and API keys are available for automation.

## Features

- Meeting bot for Google Meet and Microsoft Teams.
- Audio recording with containerized Chromium, Playwright, PulseAudio, and FFmpeg.
- Post-meeting and real-time transcription flows.
- Pluggable transcription providers:
  - Deepgram, including diarization support.
  - OpenAI-compatible transcription endpoints.
- Web dashboard for meetings, transcripts, users, and transcription settings.
- Multi-user auth with admin-managed users and per-user API keys.
- Live bot view through noVNC for debugging or manual takeover.
- Production Docker stack with Postgres, Redis, MinIO, API, worker, web, and bot image.

## Architecture

```text
apps/web (Vite + React) ──┐
API clients ──────────────┴─HTTP──▶ apps/api (Fastify + better-auth)
                    ├─ Docker API ──▶ apps/bot (Playwright + PulseAudio + FFmpeg)
                    │                    ├─ joins meeting
                    │                    ├─ records audio
                    │                    ├─ uploads recording to MinIO
                    │                    └─ calls back to /internal/*
                    └─ BullMQ/Redis ──▶ apps/worker ── STT provider ──▶ PostgreSQL
```

| Package | Purpose |
|---|---|
| `apps/web` | Dashboard UI for login, meetings, transcripts, admin users, and transcription settings |
| `apps/api` | REST API, auth/session/API key handling, Docker bot manager, and live-view proxy |
| `apps/bot` | Meeting bot image, one ephemeral container per meeting |
| `apps/worker` | Transcription queue worker |
| `packages/shared` | Shared schema, types, and transcript helpers |

## Production Quickstart

Requirements:

- Ubuntu/Debian, Fedora, or macOS.
- Docker with Docker Compose.
- `make`.

For a new server or laptop:

```bash
make setup
make build
make up
```

`make setup` installs/checks host dependencies and creates a production `.env`
with generated secrets when `.env` does not exist. It will not overwrite an
existing `.env`.

Open the dashboard:

```text
http://localhost:8080
```

Default seeded admin:

```text
admin@openminutes.dev / admin12345
```

Override the seeded admin when starting or reseeding:

```bash
make up ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='change-this-password'
make seed ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='change-this-password'
```

If you previously started OpenMinutes with different database credentials, the
old Postgres volume may not match the new `.env`. For a fresh local install,
reset volumes with:

```bash
make clean
make up
```

## Make Targets

```bash
make setup      # install/check host dependencies and create .env if missing
make build      # build api, worker, web, and bot images
make up         # start infra, push schema, seed admin, then start app services
make down       # stop the stack
make logs       # follow service logs
make ps         # show service status
make restart    # restart api, worker, and web
make db-push    # push database schema
make seed       # seed admin user idempotently
make clean      # stop stack and remove volumes
```

## Configuration

Production settings live in `.env`. Use `.env.production.example` as the shape of
the expected config.

Important values:

- `APP_PORT` — host HTTP port for the web app, default `8080`.
- `BETTER_AUTH_URL` — public browser URL used by auth, for example
  `https://example.com` or `http://<vm-ip>:<forwarded-port>`.
- `WEB_ORIGIN` — allowed browser origin. Comma-separated values are supported,
  for example `http://localhost:8080,http://<vm-ip>:<forwarded-port>`.
- `POSTGRES_PORT`, `REDIS_PORT`, `MINIO_HOST_PORT`, `MINIO_CONSOLE_PORT` —
  local loopback ports for operations/debugging.
- `BOT_IMAGE=openminutes-bot:prod`.
- `BOT_NETWORK=openminutes-net`.
- `BOT_VNC_MODE=network`.
- `API_URL_FOR_BOTS=http://api:3000`.
- `MINIO_ENDPOINT_FOR_BOTS=minio`.
- `DEEPGRAM_API_KEY` — optional fallback transcription key. The preferred
  provider configuration can be managed from the admin UI.

The production stack exposes HTTP only. Put Nginx, Caddy, Cloudflare Tunnel, or
another reverse proxy in front of `APP_PORT` for TLS and domains.

## Development

Install dependencies:

```bash
pnpm install
```

Start local infrastructure:

```bash
pnpm infra:up
pnpm db:push
pnpm db:seed
pnpm bot:build
```

Start app processes in separate terminals:

```bash
pnpm dev:api
pnpm dev:worker
pnpm dev:web
```

The development dashboard runs at:

```text
http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:3000`.

## Transcription

Transcription provider settings are managed from the admin dashboard and stored
in the database. Changes apply to future jobs without restarting the worker.

Supported providers:

- **Deepgram** — supports speaker diarization.
- **OpenAI-compatible** — sends `POST {baseUrl}/audio/transcriptions` using
  `verbose_json`; works with OpenAI, Groq, and compatible Whisper servers.

If no provider is configured, recordings are still stored but transcription is
skipped with status `transcription_skipped`.

## API Usage

Create an API key from the dashboard Settings page, then call the API with
`x-api-key`.

Create a bot:

```bash
curl -X POST http://localhost:8080/api/bots \
  -H "x-api-key: <API_KEY>" \
  -H "content-type: application/json" \
  -d '{"meetingUrl": "https://meet.google.com/xxx-yyyy-zzz", "botName": "OpenMinutes Bot"}'
```

Fetch meeting status and transcript:

```bash
curl http://localhost:8080/api/meetings/<meetingId> \
  -H "x-api-key: <API_KEY>"
```

Stop a bot:

```bash
curl -X DELETE http://localhost:8080/api/bots/<meetingId> \
  -H "x-api-key: <API_KEY>"
```

Common meeting statuses:

```text
pending -> joining -> waiting_admission -> recording -> uploading
-> processing_transcript -> completed
```

Failure or non-transcription states include `failed` and
`transcription_skipped`.

## Operational Notes

- Google Meet bots usually need host approval from the waiting room.
- Microsoft Teams support depends on the tenant allowing anonymous guests.
- Meeting UI selectors can change. If a bot cannot join, inspect the bot logs:

```bash
docker logs openminutes-bot-<meetingId>
```

- Production bot containers are spawned dynamically by the API through the
  Docker socket. The API container therefore mounts `/var/run/docker.sock`.

## Contributing

Issues and pull requests are welcome. For changes that touch bot behavior,
deployment, auth, or transcription flow, please include a short test note in the
PR describing what was verified.
