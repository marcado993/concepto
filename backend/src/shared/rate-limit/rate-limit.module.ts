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
