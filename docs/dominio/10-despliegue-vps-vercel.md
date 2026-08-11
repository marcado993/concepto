# 10 · Despliegue: Backend en VPS (Docker) + Frontend en Vercel

Responde a *"ya subirlo al server y este a vercel"*. Backend y frontend se despliegan
**desacoplados** (`04-alternativas-tecnologicas-y-costos.md` §1, ya decidido desde el
inicio): el backend vive en una instancia propia vía Docker, el frontend en Vercel.
Ninguno de los dos necesita saber cómo está desplegado el otro — solo se hablan por
HTTPS + CORS.

**Proveedor real: Oracle Cloud (OCI), no DigitalOcean.** El plan original de
`04-alternativas-tecnologicas-y-costos.md` §5 presupuestaba un Droplet de DigitalOcean
(~USD 27.60/mes). En la práctica se aprovisionó una instancia **Always Free** de OCI
(`VM.Standard.A1.Flex`, 2 OCPU / 12 GB RAM, **USD 0.00/mes** — dentro del pool gratuito de
hasta 4 OCPU/24GB de Ampere que ofrece Oracle de forma indefinida, no solo en período de
prueba). El `Dockerfile`/`docker-compose.prod.yml` no dependen del proveedor, así que esto
no cambia nada del resto de esta guía salvo el sistema operativo real usado: **Oracle
Linux 9** (no Ubuntu — la instancia se creó con esa imagen), lo que cambia el gestor de
paquetes (`dnf` en vez de `apt`), el firewall local (`firewalld` en vez de `ufw`) y el
usuario SSH por defecto (`opc` en vez de `ubuntu`).

**Nada de este documento se ejecutó todavía más allá de crear la instancia** — el resto
(clonar repo, levantar Docker, DNS, TLS) queda pendiente de que el sponsor lo haga. Esto es
la guía lista para seguir paso a paso.

## 1. Backend — Instancia OCI + Docker

**1.1 Instancia ya creada** (Oracle Cloud, Always Free): Oracle Linux 9, shape
`VM.Standard.A1.Flex` 2 OCPU/12GB, con IP pública asignada. Presupuesto de budget alert
configurado en Billing → Cost Management → Budgets (USD 1, 1% actual spend) como red de
seguridad tras pasar la cuenta a Pay As You Go.

**Importante — dos capas de firewall en OCI, no una:** además de `firewalld` dentro de la
instancia (§1.5), el **Security List** de la subred de OCI bloquea todo el tráfico
entrante salvo el puerto 22 (SSH) por defecto — se debe abrir manualmente 80/443 ahí
también (Networking → Virtual Cloud Networks → tu VCN → Security Lists → Add Ingress
Rules, Source `0.0.0.0/0`, puertos TCP 80 y 443), o Caddy nunca va a recibir tráfico.

**1.2 DNS:** apuntar un subdominio (p. ej. `api.aeis-app.<dominio>`) a la IP pública de la
instancia con un registro `A`. Sustituir ese dominio en `Caddyfile` (raíz del repo) antes
de desplegar — Caddy no emite el certificado TLS hasta que el DNS resuelva correctamente.

**1.3 Instalar Docker** (Oracle Linux 9 no lo trae preinstalado, a diferencia de las
imágenes "Docker on Ubuntu" de DigitalOcean):

```bash
sudo dnf install -y dnf-utils
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker opc   # evita tener que anteponer sudo a cada `docker`
# cerrar sesión SSH y volver a entrar para que el grupo nuevo tome efecto
```

**1.4 Clonar el repo y configurar secretos** (en la instancia, no en el repo):

```bash
git clone <url-del-repo> aeis-app && cd aeis-app
cp backend/.env.example backend/.env
nano backend/.env   # rellenar LOGTO_*, COOKIE_SECRET real, ALERT_WEBHOOK_URLS, etc.
```

Dos cosas que **cambian respecto al `.env.example`** al pasar a producción real:

- `FRONTEND_ORIGIN` → la URL real de Vercel (`https://aeis-app.vercel.app` o el dominio
  final), nunca `*` — el backend maneja pagos y datos de KYC.
- `TRUST_PROXY=true` — **obligatorio** en el VPS. Caddy queda delante del backend como
  reverse proxy; si esto queda en `false`, el rate limiting por IP y el `ipAddress` del
  `AuditLog` (`05-metodologia-devsecops-pipeline.md` §7) registran la IP interna de Caddy
  para todo el mundo, no la IP real de cada usuario — inutiliza ambos controles.

Luego, la contraseña de Postgres (compartida entre `docker-compose.prod.yml` y
`DATABASE_URL` dentro de `backend/.env` — ver el comentario en el propio compose):

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
# copiar ese mismo valor a la parte de la contraseña en DATABASE_URL dentro de backend/.env
```

**1.5 Levantar:**

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
docker compose -f docker-compose.prod.yml exec backend npx prisma db seed   # opcional, datos mock
```

`migrate deploy` (no `migrate dev`) porque en producción nunca se generan migraciones
nuevas al vuelo — solo se aplican las que ya vinieron commiteadas desde el desarrollo
local (`backend/prisma/migrations/`, creado en este mismo cambio — ver §4 más abajo).

**1.6 Firewall local** (`firewalld`, ya viene activo por defecto en las imágenes Oracle
Linux de OCI — a diferencia de Ubuntu, donde `ufw` hay que activarlo a mano):

```bash
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload
```

El puerto 22 (SSH) ya está permitido por defecto en `firewalld` — no hace falta abrirlo.
Nada más queda abierto — ni `3000` (backend) ni `5432` (Postgres) se exponen al exterior;
`docker-compose.prod.yml` ya los deja sin `ports:` publicados. Esta es la **segunda** capa
de firewall (la primera es el Security List de OCI, §1.1) — ambas deben tener 80/443
abiertos, o Caddy no recibe tráfico (hallazgo de `09-auditoria-pentest.md` §2).

**1.7 Verificar:**

```bash
curl https://api.aeis-app.<dominio>/health
# → {"status":"ok","database":"ok",...}
```

**Pendiente ya documentado, no resuelto aquí:** `GET /metrics` (Prometheus) sigue
`@Public()` a nivel de auth de NestJS — debe quedar bloqueado por el firewall salvo desde
`localhost`/la propia red de la instancia (`08-observabilidad-resiliencia.md` §2). Con el
compose de producción ya no publica `3000` al exterior, así que en la práctica queda
cubierto — pero si en algún momento Caddy expone `/metrics` con un `reverse_proxy` propio,
hay que añadir una restricción de IP explícita en el `Caddyfile` en ese momento.

## 2. Frontend — Vercel

`vercel.json` (raíz del repo) ya existe con las cabeceras de cache correctas — no requiere
cambios para el primer deploy.

**2.1 Conectar el repo** en el dashboard de Vercel (Import Project → seleccionar este
repo). Framework preset: Vite (auto-detectado por el `vite.config.ts` existente).

**2.2 Variable de entorno** (Project Settings → Environment Variables, en Vercel — no en
un archivo del repo):

```
VITE_API_BASE_URL = https://api.aeis-app.<dominio>
```

Mismo nombre que usa `.env.example` (raíz) en local, apuntando ahora a la instancia OCI en
vez de `localhost:3000`.

**2.3 Deploy.** Vercel construye y publica automáticamente en cada push a `main` una vez
conectado — no requiere configuración adicional de CI para el frontend.

**2.4 Cerrar el círculo:** una vez Vercel asigna la URL final (o el dominio custom), volver
a la instancia y actualizar `FRONTEND_ORIGIN` en `backend/.env` con esa URL exacta, luego:

```bash
docker compose -f docker-compose.prod.yml up -d --build backend
```

## 3. Qué NO se automatizó en este cambio (decisión pendiente del sponsor)

- **Despliegue continuo del backend** (GitHub Actions → SSH a la instancia → `docker
  compose up -d --build` en cada push a `main`): factible y coherente con el pipeline ya
  existente en `.github/workflows/devsecops.yml`, pero modificar el pipeline de CI/CD es
  una acción que se confirma explícitamente antes de tocarla — no se añadió sin pedirlo.
- **Backups de Postgres** fuera del volumen Docker: OCI no cobra por backups de boot
  volume en el tier Always Free del modo que sí lo hacía el presupuesto original de
  DigitalOcean (`04-alternativas-tecnologicas-y-costos.md` §5) — conviene programar un
  `pg_dump` periódico manual (cron dentro de la instancia) ya que no hay backup automático
  de proveedor cubriendo esto sin costo; no implementado aún.
- **Alerta de presupuesto ya configurada** (Billing → Cost Management → Budgets, USD 1,
  umbral 1% de gasto actual) — cubre el riesgo de que, al pasar la cuenta a Pay As You Go,
  algún recurso fuera de los límites de Always Free genere cargo sin aviso.

## 4. Por qué ahora sí hay `backend/prisma/migrations/`

Hasta este cambio el desarrollo local usaba `prisma db push` (aplica el schema directo,
sin historial) porque no había necesidad de reproducir el esquema en un segundo entorno.
Para que `docker-compose.prod.yml` pueda correr `prisma migrate deploy` en la instancia —
que **requiere** una carpeta de migraciones versionada, a diferencia de `db push` — se
generó la primera migración (`20260811021700_init`) desde `docker-compose.yml` (desarrollo).
A partir de ahora, cualquier cambio a `backend/prisma/schema.prisma` debe generarse con
`npx prisma migrate dev --name <algo>` (no `db push`) para que seguir teniendo una
migración aplicable en producción.
