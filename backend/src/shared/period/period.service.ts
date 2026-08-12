import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

// Resolución mínima del periodo activo — antes vivía duplicada, palabra
// por palabra, en LockerService y en el TODO de SubscriptionController
// ("TODO-period-not-yet-implemented", un literal que habría reventado con
// una violación de FK real en el primer aporte). Un solo lugar ahora.
//
// "Vigente o próximo" (no solo "vigente") a propósito: el alquiler/aporte
// para el semestre 2026-B debe poder abrirse antes de que arranque el 1 de
// septiembre, no solo durante sus fechas exactas.
@Injectable()
export class PeriodService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentPeriodId(): Promise<string> {
    const period = await this.prisma.period.findFirst({
      where: { endsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
    });
    if (!period) throw new NotFoundException("No hay un periodo activo configurado");
    return period.id;
  }
}
