SHELL := /bin/sh

COMPOSE ?= $(shell if docker compose version >/dev/null 2>&1; then printf 'docker compose'; elif command -v docker-compose >/dev/null 2>&1; then printf 'docker-compose'; else printf 'docker compose'; fi)
ADMIN_EMAIL ?= admin@openminutes.dev
ADMIN_PASSWORD ?= admin12345

.PHONY: setup build up down logs ps restart db-push seed clean

setup:
	./scripts/setup.sh

build:
	$(COMPOSE) build api worker web bot

up:
	./scripts/check-prod-env.sh
	$(COMPOSE) up -d postgres redis minio minio-init
	$(COMPOSE) run --rm api pnpm db:push
	$(COMPOSE) run --rm api pnpm db:seed -- $(ADMIN_EMAIL) $(ADMIN_PASSWORD)
	$(COMPOSE) up -d api worker web

down:
	$(COMPOSE) down --remove-orphans

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

restart:
	$(COMPOSE) restart api worker web

db-push:
	./scripts/check-prod-env.sh
	$(COMPOSE) run --rm api pnpm db:push

seed:
	./scripts/check-prod-env.sh
	$(COMPOSE) run --rm api pnpm db:seed -- $(ADMIN_EMAIL) $(ADMIN_PASSWORD)

clean:
	$(COMPOSE) down -v --remove-orphans
