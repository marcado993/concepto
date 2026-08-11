# AEIS-APP backend — build multi-stage para una imagen liviana en el
# Droplet de $27.60/mes (2 vCPU/2 GB, ver docs/dominio/04 §5-6). A partir de
# aquí, el job "trivy-scan" de .github/workflows/devsecops.yml puede pasar
# de escanear filesystem a escanear esta imagen sin cambiar de política.
#
# CMD apunta a "dist/src/main.js", no "dist/main.js": tsconfig.json no fija
# "rootDir", asi que tsc infiere la raiz comun de todo lo que compila (src/
# + prisma/seed.ts) y anida el output bajo dist/src/... — confirmado
# inspeccionando la imagen real (docs/dominio/10-despliegue-vps-vercel.md).

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
CMD ["node", "dist/src/main.js"]
