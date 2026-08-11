# AEIS-APP backend — build multi-stage para una imagen liviana en el
# Droplet de $27.60/mes (2 vCPU/2 GB, ver docs/dominio/04 §5-6). A partir de
# aquí, el job "trivy-scan" de .github/workflows/devsecops.yml puede pasar
# de escanear filesystem a escanear esta imagen sin cambiar de política.

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate
COPY --from=builder /app/dist ./dist

# Nunca root en producción — reduce el impacto de un RCE.
RUN addgroup -S aeis && adduser -S aeis -G aeis
USER aeis

EXPOSE 3000
CMD ["node", "dist/main.js"]
