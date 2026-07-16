FROM node:22-bookworm-slim

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json

RUN pnpm install --frozen-lockfile --filter @openminutes/api...

COPY apps/api ./apps/api

EXPOSE 3000
CMD ["pnpm", "--filter", "@openminutes/api", "start"]
