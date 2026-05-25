FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY pnpm-lock.yaml* ./
COPY libs/shared/package.json ./libs/shared/
COPY libs/database/package.json ./libs/database/
COPY apps/patient-service/package.json ./apps/patient-service/
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @mediflow/database exec prisma generate || true
RUN pnpm --filter @mediflow/shared run build
RUN pnpm --filter @mediflow/database run build
RUN pnpm --filter @mediflow/patient-service run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/patient-service/dist ./dist
COPY --from=builder /app/apps/patient-service/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs ./libs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s \
  CMD wget -qO- http://localhost:3000/health || exit 1
USER node
CMD ["node", "dist/main"]
