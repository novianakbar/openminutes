#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() {
  printf '[setup] %s\n' "$*"
}

warn() {
  printf '[setup] WARNING: %s\n' "$*" >&2
}

die() {
  printf '[setup] ERROR: %s\n' "$*" >&2
  exit 1
}

has() {
  command -v "$1" >/dev/null 2>&1
}

sudo_cmd() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

random_secret() {
  openssl rand -base64 "${1:-36}" | tr -d '\n' | tr '/+' '_-' | tr -d '='
}

detect_os() {
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "macos"
    return
  fi

  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}" in
      ubuntu|debian) echo "ubuntu" ;;
      fedora) echo "fedora" ;;
      *) die "Unsupported Linux distro: ${ID:-unknown}. Supported: Ubuntu/Debian, Fedora, macOS." ;;
    esac
    return
  fi

  die "Unsupported OS. Supported: Ubuntu/Debian, Fedora, macOS."
}

install_ubuntu() {
  log "Installing host dependencies with apt."
  sudo_cmd apt-get update
  sudo_cmd apt-get install -y ca-certificates curl gnupg git make openssl

  if ! has docker; then
    sudo_cmd install -m 0755 -d /etc/apt/keyrings
    if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
      # shellcheck disable=SC1091
      . /etc/os-release
      docker_repo_os="${ID:-ubuntu}"
      curl -fsSL "https://download.docker.com/linux/${docker_repo_os}/gpg" \
        | sudo_cmd gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      sudo_cmd chmod a+r /etc/apt/keyrings/docker.gpg
    fi
    # shellcheck disable=SC1091
    . /etc/os-release
    docker_repo_os="${ID:-ubuntu}"
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${docker_repo_os} ${VERSION_CODENAME} stable" \
      | sudo_cmd tee /etc/apt/sources.list.d/docker.list >/dev/null
    sudo_cmd apt-get update
    sudo_cmd apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    sudo_cmd apt-get install -y docker-compose-plugin || true
  fi

  if ! has node; then
    sudo_cmd apt-get install -y nodejs npm
  fi
}

install_fedora() {
  log "Installing host dependencies with dnf."
  sudo_cmd dnf install -y git make curl openssl nodejs npm

  if ! has docker; then
    if ! sudo_cmd dnf install -y moby-engine; then
      sudo_cmd dnf install -y docker
    fi
  fi

  if ! docker compose version >/dev/null 2>&1; then
    sudo_cmd dnf install -y docker-compose-plugin || true
  fi

  if ! docker compose version >/dev/null 2>&1; then
    sudo_cmd dnf install -y docker-compose || true
  fi
}

install_macos() {
  if ! has brew; then
    log "Installing Homebrew."
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [ -x /opt/homebrew/bin/brew ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [ -x /usr/local/bin/brew ]; then
      eval "$(/usr/local/bin/brew shellenv)"
    fi
  fi

  log "Installing host dependencies with Homebrew."
  brew install git make curl openssl node pnpm

  if ! has docker && [ ! -d /Applications/Docker.app ]; then
    brew install --cask docker
  fi
}

ensure_pnpm() {
  if has corepack; then
    corepack enable || true
    corepack prepare pnpm@10.28.1 --activate || true
  fi

  if ! has pnpm; then
    if has npm; then
      npm install -g pnpm@10.28.1
    else
      die "Node/npm is installed incorrectly; npm was not found."
    fi
  fi
}

ensure_docker_running() {
  if docker info >/dev/null 2>&1; then
    return
  fi

  case "$1" in
    ubuntu|fedora)
      log "Starting Docker service."
      sudo_cmd systemctl enable --now docker || true
      ;;
    macos)
      if [ -d /Applications/Docker.app ]; then
        log "Opening Docker Desktop. Waiting for Docker daemon."
        open -a Docker || true
      fi
      ;;
  esac

  for _ in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done

  if [ "$1" = "macos" ]; then
    die "Docker daemon is not running. Open Docker Desktop, wait until it is ready, then rerun make setup."
  fi

  if ! groups "$USER" | grep -q '\bdocker\b'; then
    warn "Adding $USER to the docker group. Log out and back in if Docker commands still require sudo."
    sudo_cmd usermod -aG docker "$USER" || true
  fi

  die "Docker daemon is not reachable yet. Start Docker or refresh your shell session, then rerun make setup."
}

ensure_docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    return
  fi

  if has docker-compose; then
    return
  fi

  die "Docker Compose is not available. Install a package that provides 'docker compose' or 'docker-compose', then rerun make setup."
}

create_env() {
  if [ -f .env ]; then
    log ".env already exists; leaving it unchanged."
    if grep -Eq '^(DATABASE_URL=.*localhost|REDIS_URL=.*localhost|MINIO_ENDPOINT=localhost|BOT_IMAGE=openminutes-bot:dev|BOT_VNC_MODE=host)' .env; then
      warn ".env looks like a local development file. For production Docker, compare it with .env.production.example and set Docker service hosts such as postgres, redis, minio, BOT_IMAGE=openminutes-bot:prod, and BOT_VNC_MODE=network."
    fi
    return
  fi

  log "Creating production .env with generated secrets."
  postgres_password="$(random_secret 24)"
  minio_password="$(random_secret 24)"
  auth_secret="$(random_secret 48)"
  internal_token="$(random_secret 36)"

  cat > .env <<EOF
APP_PORT=8080
PORT=3000
POSTGRES_PORT=5432
REDIS_PORT=6379
MINIO_HOST_PORT=9000
MINIO_CONSOLE_PORT=9001

POSTGRES_USER=openminutes
POSTGRES_PASSWORD=${postgres_password}
POSTGRES_DB=openminutes
DATABASE_URL=postgres://openminutes:${postgres_password}@postgres:5432/openminutes

REDIS_URL=redis://redis:6379

MINIO_ROOT_USER=minio
MINIO_ROOT_PASSWORD=${minio_password}
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_ACCESS_KEY=minio
MINIO_SECRET_KEY=${minio_password}
MINIO_BUCKET=recordings

BETTER_AUTH_SECRET=${auth_secret}
BETTER_AUTH_URL=http://localhost:8080
WEB_ORIGIN=http://localhost:8080
INTERNAL_TOKEN=${internal_token}

BOT_IMAGE=openminutes-bot:prod
BOT_NETWORK=openminutes-net
BOT_VNC_MODE=network
API_URL_FOR_BOTS=http://api:3000
MINIO_ENDPOINT_FOR_BOTS=minio

DEEPGRAM_API_KEY=
DEEPGRAM_LANGUAGE=id

BROWSER_STEALTH=off
CHROMIUM_FAKE_MEDIA=true
FAKE_MEDIA_DIR=/app/assets
JOIN_TIMEOUT_SEC=300
MAX_DURATION_MIN=180
TZ=Asia/Jakarta
EOF
}

main() {
  os="$(detect_os)"
  case "$os" in
    ubuntu) install_ubuntu ;;
    fedora) install_fedora ;;
    macos) install_macos ;;
  esac

  ensure_pnpm
  ensure_docker_running "$os"
  ensure_docker_compose
  create_env

  log "Setup complete. Next: make build && make up"
}

main "$@"
