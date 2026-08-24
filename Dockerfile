# ---- Build stage: installs everything and compiles TypeScript ----
FROM node:24-slim AS builder
WORKDIR /app

# Prisma's engine needs OpenSSL to detect the right binary target; the
# slim base image doesn't include it by default.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ---- Runtime stage: only what's needed to run the compiled app ----
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

EXPOSE 3000

# Migrations and the (idempotent) seed run on every boot
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/main"]
