import { Body, Controller, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { Roles } from "../shared/auth/roles.decorator";
import { Role } from "@prisma/client";
import { LockerService } from "./locker.service";
import { RentLockerDto } from "./dto/rent-locker.dto";

// El periodo activo (periodId) debería resolverse server-side a partir del
// calendario académico, no venir del cliente — se deja como TODO explícito
// para el módulo `period` (no implementado todavía) en vez de simularlo
// con un valor hardcodeado que parecería real.

@Controller("lockers")
export class LockerController {
  constructor(private readonly lockerService: LockerService) {}

  @Post("rent")
  @Roles(Role.ESTUDIANTE)
  // Límite propio, más estricto que el global (rate-limit.module.ts): un
  // mismo estudiante no necesita más de 3 intentos de alquiler en 10s — si
  // los ve, es un bug del cliente o un script, no una persona. Esto NO
  // limita a los 100 estudiantes DISTINTOS que puedan alquilar a la vez
  // (eso es carga legítima, resuelta por la restricción única de Prisma,
  // no por rate limiting) — limita a UN actor abusando, por IP.
  @Throttle({ default: { limit: 3, ttl: 10_000 } })
  rent(@Body() dto: RentLockerDto, @Req() req: Request & { user: { id: string } }) {
    return this.lockerService.rent({
      userId: req.user.id,
      lockerCode: dto.lockerCode,
      method: dto.method,
      ipAddress: req.ip,
      // TODO: resolver desde PeriodService.getCurrent() cuando ese módulo exista.
      periodId: "TODO-period-not-yet-implemented",
    });
  }
}
