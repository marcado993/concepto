# AEIS-APP backend — build multi-stage para una imagen liviana en el
# Droplet de $27.60/mes (2 vCPU/2 GB, ver docs/dominio/04 §5-6). A partir de
# aquí, el job "trivy-scan" de .github/workflows/devsecops.yml puede pasar
# de escanear filesystem a escanear esta imagen sin cambiar de política.
#
# CMD apunta a "dist/src/main.js", no "dist/main.js": tsconfig.json no fija
# "rootDir", asi que tsc infiere la raiz comun de todo lo que compila (src/
# + prisma/seed.ts) y anida el output bajo dist/src/... — confirmado
# inspeccionando la imagen real (docs/dominio/10-despliegue-vps-vercel.md).

# Parches del SISTEMA OPERATIVO de la imagen base, en CADA build.
#
# El problema real que esto resuelve: node:22-alpine se reconstruye río
# arriba cada tanto, pero entre una versión y otra Alpine publica parches
# de seguridad que la imagen base todavía no incluye. Como acá se
# despliega por commit y a veces pasa un mes entre uno y otro, esas CVEs
# se ACUMULAN y el gate de Trivy termina bloqueando un deploy que no tiene
# nada que ver con el cambio que se quería subir. Pasó exactamente así con
# CVE-2026-14456 (openssl/libcrypto3 3.5.7-r0 → 3.5.8-r0, DoS por
# crecimiento de memoria sin límite en el servidor QUIC): parche
# disponible río arriba, imagen base sin él, deploy bloqueado.
#
# `apk upgrade` en cada build hace que el commit de hoy salga siempre con
# los parches de hoy, sin tener que esperar a que se actualice la imagen
# base ni ir agregando excepciones a .trivyignore por algo que SÍ tiene
# arreglo. El costo es que la build deja de ser reproducible byte a byte —
# aceptado a conciencia: acá vale más no arrastrar un CVE con parche
# disponible que poder reproducir una imagen vieja idéntica.
#
# Va en AMBOS stages: el builder porque compila, y el runtime porque es la
# imagen que de verdad se escanea y se despliega.
FROM node:26-alpine AS builder
RUN apk --no-cache upgrade
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:26-alpine AS runtime
# Ver la nota del stage builder: parches del SO en cada build. Esta es la
# imagen que escanea Trivy en el pipeline y la que corre en el VPS.
RUN apk --no-cache upgrade
WORKDIR /app
ENV NODE_ENV=production
# El npm que trae node:22-alpine por defecto carga sus propias dependencias
# vendored (tar, brace-expansion, sigstore...) con CVEs conocidos — no son
# dependencias de AEIS-APP, pero Trivy las escanea igual porque quedan en
# la imagen final. Se necesita `npx` en runtime (prisma migrate deploy se
# corre dentro del contenedor ya desplegado), así que no se puede quitar
# npm — se actualiza a la última versión en vez, que ya trae esos CVEs
# resueltos.
RUN npm install -g npm@latest
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate
COPY --from=builder /app/dist ./dist

# Nunca root en producción — reduce el impacto de un RCE.
RUN addgroup -S aeis && adduser -S aeis -G aeis
USER aeis

EXPOSE 3000
CMD ["node", "dist/src/main.js"]
