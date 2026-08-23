import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

// Rate limiting global — en memoria (@nestjs/throttler sin storage
// externo), suficiente porque el backend corre como un solo proceso en un
// único Droplet (docs/dominio/04 §5-6: no hay balanceo entre instancias
// que necesite un storage compartido tipo Redis — agregar Redis solo para
// esto sería complejidad sin beneficio real a esta escala, justo lo que
// "simplicidad sin perder seguridad" pide evitar).
//
// Dos ventanas: una amplia para uso normal, una corta y estricta que sirve
// de "cortafuego" contra ráfagas (script/bot golpeando el endpoint). Los
// endpoints de dinero (locker/subscription) además tienen su propio límite
// más estricto vía @Throttle() en el controller — ver locker.controller.ts.
//
// Hallazgo real (prueba de carga contra producción, agosto 2026): estos
// dos límites por sí solos castigaban a gente real, no solo a atacantes.
// Abrir la app sin sesión dispara 5 GET en paralelo (/lockers,
// /security/indicators, /security/map-data, /ventures,
// /subscriptions/tiers) — con "short" en 5/seg, un SEGUNDO estudiante en
// la MISMA IP (típico en el WiFi del campus, donde cientos de estudiantes
// salen detrás de muy pocas IPs públicas por NAT) ya alcanzaba el techo.
// El límite no distinguía "un atacante" de "cien estudiantes reales el día
// que se habilitan los casilleros". Fix: los 5 GET públicos de solo
// lectura (sin costo real — SELECT indexado; confirmado que Postgres se
// queda en 0% de CPU incluso bajo la prueba de carga que agotó "short")
// sobreescriben short/medium a un techo mucho más alto directo en su
// propio controller (@Throttle({short:{...}, medium:{...}})) — mismo
// patrón que ya usaba locker.controller.ts para volver MÁS estricto un
// endpoint, aplicado acá al revés para volver MÁS laxos los de solo
// lectura. Todo lo que mueve dinero o crea sesión (rent, subscribe,
// confirmaciones de PayPhone, /auth/*) se queda EXACTAMENTE igual de
// estricto — ahí sí tiene sentido que una misma IP no pueda intentarlo
// muchas veces seguidas.
//
// IMPORTANTE al escribir un @Throttle() en cualquier controller: la clave
// del objeto que recibe DEBE ser uno de los nombres registrados aquí
// ("short" o "medium"), nunca "default" — @nestjs/throttler NO registra un
// throttler llamado "default" automáticamente. Un @Throttle({default:{...}})
// compila sin error y no lanza ninguna excepción en runtime, pero el guard
// real (ThrottlerGuard.canActivate) itera únicamente los throttlers
// nombrados arriba y busca el override por ESE nombre — con "default" el
// override es metadata que nunca se lee, y la ruta queda protegida SOLO
// por estos dos límites globales (hallazgo real, corregido en las rutas de
// dinero y en /auth/login y /auth/callback).
@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: "short", ttl: 1000, limit: 5 }, // ráfaga: máx 5 requests/segundo por IP
      { name: "medium", ttl: 60_000, limit: 100 }, // uso normal: máx 100 requests/minuto por IP
    ]),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
