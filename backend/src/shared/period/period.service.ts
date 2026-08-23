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
    return (await this.getCurrentPeriod()).id;
  }

  // El periodo COMPLETO, no solo su id — la UI necesita nombrarlo de
  // verdad. Hallazgo real de auditoría: el modal de alquiler tenía el
  // semestre escrito a mano ("Acepto usar el casillero hasta fin del
  // semestre 2026-A") mientras el periodo activo en producción ya era
  // 2026-B, o sea que el estudiante aceptaba un texto que nombraba un
  // semestre equivocado — y esa aceptación se guarda firmada en AuditLog
  // como prueba. Un texto legal con la fecha mal no lo arregla una
  // corrección de copy: tiene que salir del mismo dato que usa el backend
  // para asignar el alquiler, o vuelve a desincronizarse el otro semestre.
  async getCurrentPeriod(): Promise<{ id: string; label: string; startsAt: Date; endsAt: Date }> {
    const period = await this.prisma.period.findFirst({
      where: { endsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
    });
    if (!period) throw new NotFoundException("No hay un periodo activo configurado");
    return period;
  }
}
