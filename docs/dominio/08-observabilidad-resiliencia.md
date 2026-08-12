# 08 · Observabilidad, Rate Limiting y Resiliencia bajo Carga

Responde directamente a lo que pidió el sponsor: *"rate limiting de la api, pruebas de
estrés al servidor, qué pasa si unos 100 entran al mismo tiempo, métricas, y que me llegue
al correo/celular si el CPU se está muriendo"*. Cuatro piezas, todas ya implementadas en
`backend/`, ninguna añade un proceso/servicio nuevo que correr aparte de la propia API —
condición dura dada la escala real del proyecto (Droplet de $27.60/mes, 2 vCPU/2 GB
compartidos con NestJS + Postgres, ver `04-alternativas-tecnologicas-y-costos.md` §5-6).

## 1. Rate limiting

`shared/rate-limit/rate-limit.module.ts` — `@nestjs/throttler`, en memoria (sin Redis: un
solo proceso, un solo Droplet, no hay nada que sincronizar entre instancias). Dos capas:

- **Global:** 5 req/s y 100 req/min por IP — cortafuego contra ráfagas/bots.
- **Por endpoint de dinero:** `@Throttle({ limit: 3, ttl: 10_000 })` en
  `locker.controller.ts` y `subscription.controller.ts` — 3 intentos por 10s es más que
  suficiente para un estudiante real; más que eso es un script o un bug del cliente.

**Importante — el rate limiting NO es lo que protege contra 100 estudiantes distintos
alquilando a la vez.** Eso es carga legítima (cada uno tiene su propia IP/sesión) y se
resuelve con la restricción `@@unique([lockerId, periodId])` de Prisma (ver
`05-metodologia-devsecops-pipeline.md` §7 y el escenario BDD de "condición de carrera").
Rate limiting resuelve abuso de UN actor; la restricción única resuelve corrección bajo
concurrencia de MUCHOS actores. Son dos problemas distintos — mezclarlos sería el tipo de
"solución simple pero equivocada" que el principio de simplicidad de esta iteración
justamente busca evitar.

## 2. Métricas — `GET /metrics`

`shared/metrics/` — `prom-client`, formato Prometheus estándar. Un único `Registry`
(`MetricsService`), poblado automáticamente con las métricas por defecto de Node (CPU del
proceso, heap, event loop lag — exactamente lo que hace falta para responder "¿el CPU se
está muriendo?") más `http_request_duration_seconds` / `http_requests_total` /
`http_rate_limited_total`, capturadas una sola vez vía `MetricsInterceptor` global (DRY: no
hay que instrumentar cada controller a mano).

**Pendiente antes de producción:** `MetricsController` está `@Public()` a nivel de
autenticación de la app, pero el endpoint **debe quedar detrás del firewall del Droplet**
(solo accesible desde el propio servidor o desde quien scrapee las métricas) — exponerlo
abierto a internet filtra volumen de tráfico y topología, información útil para un
atacante. Es una regla de firewall (`ufw`/`iptables` en el Droplet), no algo que el código
de NestJS pueda resolver por sí solo.

## 3. Health check — `GET /health`

`shared/health/` — liveness simple: responde `ok`/`degraded` según si `SELECT 1` contra
Postgres responde. Sirve para cualquier monitor externo (UptimeRobot, un script de cron en
el propio Droplet, o el balanceador si algún día lo hay) sin depender de parsear métricas
Prometheus para saber "¿está vivo el backend?".

## 4. Alertas de CPU/memoria — "que me llegue al correo o celular"

`shared/monitoring/` — sin un proceso de Prometheus + Alertmanager aparte (eso exige
512MB-2GB adicionales según la propia Tabla 4.4 de `04-alternativas-tecnologicas-y-costos.md`,
que no caben junto a NestJS + Postgres en un Droplet de 2GB). En su lugar:

- `ResourceMonitorService` — un cron (`@nestjs/schedule`, cada minuto) que lee
  `os.loadavg()`/`os.freemem()` del propio proceso Node y evalúa contra umbrales
  (`resource-thresholds.ts`, con **75%/90%** para CPU y **80%/92%** para memoria como
  warning/critical, ambos configurables).
- `AlertService` — un POST genérico a una o más URLs (`ALERT_WEBHOOK_URLS`). Recomendado en
  `.env.example`: un topic privado de **ntfy.sh** (push directo al celular, gratis, sin
  registro) — "al correo" se resuelve con cualquier automatización que reenvíe ese mismo
  POST (ntfy también soporta reenvío, o un webhook de Discord/Slack con notificaciones por
  correo configuradas del lado de esos servicios).
- **Cooldown, no spam:** se alerta una vez al cruzar el umbral, no en cada corrida del cron
  mientras se mantenga alto — y se avisa también cuando se **recupera**, para no dejar la
  duda de si el problema sigue activo. Verificado con test (`resource-monitor.service.spec.ts`,
  caso "alerta UNA sola vez... cooldown").

**Ruta de escalamiento cuando el proyecto crezca más allá del piloto actual** (Fase 3/4 de
la hoja de ruta en `04-alternativas-tecnologicas-y-costos.md` §6): recién ahí se justifica
Prometheus + Grafana + Alertmanager como proceso aparte — el propio `Propuesta.pdf`
documenta que el repositorio de referencia (`adv-web-apps-aeis-app`) ya usa exactamente ese
stack para su arquitectura de microservicios. Migrar de este monitor liviano a esa pila no
requiere cambiar código de negocio: `GET /metrics` ya habla Prometheus, un Prometheus
externo puede empezar a scrapearlo el día que exista sin tocar `MetricsService`.

## 5. Pruebas de carga — "qué pasa si unos 100 entran al mismo tiempo"

`backend/scripts/load-test.js` — `autocannon` (ya en devDependencies), dispara 100
conexiones concurrentes contra `POST /lockers/rent` para el **mismo casillero**, que es el
escenario que de verdad importa probar (no "puede el servidor responder rápido" en
abstracto, sino "sigue siendo correcto — exactamente 1 alquiler, nunca 2 — bajo presión
real"). Resultado esperado documentado en el propio script: 1 respuesta 201, el resto
409/429, cero 500.

**No se pudo ejecutar todavía** — requiere un servidor real corriendo contra una base
Postgres con migraciones aplicadas (`npm run prisma:migrate`), que sigue como pendiente de
`05-metodologia-devsecops-pipeline.md` §7 ("Pendiente inmediato", punto 2). El script queda
listo y documentado, no simulado con datos falsos — se ejecuta y se reporta el resultado
real en cuanto exista esa infraestructura, no antes.

## 6. Nota de seguridad transversal sobre `npm audit`

`npm audit` en `backend/` reporta 3 vulnerabilidades moderadas, las tres en la cadena
`autocannon → hyperid → uuid` — **una devDependency usada solo para el script de carga de
§5, nunca parte del código que corre en producción**. No se aplica `npm audit fix --force`
(degradaría `autocannon` a una versión anterior) porque el riesgo real es cero: ese código
nunca se despliega. Se deja documentado en vez de "arreglado" silenciosamente, porque
ocultar un audit limpio cuando no lo está sería peor que explicar por qué no importa.
