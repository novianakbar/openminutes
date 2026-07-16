FROM node:22-bookworm-slim

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker/package.json ./apps/worker/package.json

RUN pnpm install --frozen-lockfile --filter @openminutes/worker...

COPY apps/worker ./apps/worker

CMD ["pnpm", "--filter", "@openminutes/worker", "start"]
