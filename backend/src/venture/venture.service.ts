import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { CreateVentureDto } from "./dto/create-venture.dto";

// Diseño confirmado (docs/dominio/01-analisis-negocio-mision.md §4):
// vitrina informativa + contacto WhatsApp, sin transacción in-app. El
// número de teléfono NUNCA se expone crudo en la respuesta pública — se
// arma el link wa.me aquí, el mismo patrón que aeis-app ya documentó.
export interface VenturePublic {
  id: string;
  name: string;
  description: string;
  category: string;
  photoUrl: string | null;
  whatsappLink: string;
}

@Injectable()
export class VentureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  // Directorio público — solo ventures APPROVED, y solo los campos que
  // tienen sentido mostrar a un desconocido (nunca ownerId ni el
  // whatsappNumber en crudo).
  async listApproved(): Promise<VenturePublic[]> {
    const ventures = await this.prisma.venture.findMany({
      where: { status: "APPROVED" },
      orderBy: { createdAt: "desc" },
    });
    return ventures.map(toPublic);
  }

  // Moderación por defecto (PENDING hasta que Presidente/Director
  // aprueben) — resuelve la pregunta abierta de
  // docs/dominio/02-necesidades-stakeholders.md §2.3 a favor de exigir
  // aprobación: un directorio público sin moderación es spam esperando a
  // pasar, y el propio hallazgo del déficit de caja (01 §2.1) ya mostró
  // qué pasa cuando AEIS-APP confía en que "nadie va a abusar".
  async create(ownerId: string, dto: CreateVentureDto, ipAddress?: string) {
    const venture = await this.prisma.venture.create({
      data: { ownerId, ...dto, status: "PENDING" },
    });
    await this.audit.record({
      actorId: ownerId,
      action: "venture.created",
      entityType: "Venture",
      entityId: venture.id,
      ipAddress,
      metadata: { name: dto.name, status: "PENDING" },
    });
    return venture;
  }

  async approve(ventureId: string, approverId: string, ipAddress?: string) {
    const venture = await this.prisma.venture.findUnique({ where: { id: ventureId } });
    if (!venture) throw new NotFoundException(`Emprendimiento ${ventureId} no existe`);
    if (venture.status === "APPROVED") return venture;

    const updated = await this.prisma.venture.update({
      where: { id: ventureId },
      data: { status: "APPROVED" },
    });
    await this.audit.record({
      actorId: approverId,
      action: "venture.approved",
      entityType: "Venture",
      entityId: ventureId,
      ipAddress,
      metadata: { ownerId: venture.ownerId },
    });
    return updated;
  }

  // Un estudiante solo puede ver el estado de SUS propios emprendimientos
  // (incluidos los PENDING) — no una vitrina pública de solicitudes ajenas
  // sin aprobar.
  async listOwnedBy(ownerId: string) {
    return this.prisma.venture.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" } });
  }

  async assertOwnerOrThrow(ventureId: string, userId: string) {
    const venture = await this.prisma.venture.findUnique({ where: { id: ventureId } });
    if (!venture) throw new NotFoundException(`Emprendimiento ${ventureId} no existe`);
    if (venture.ownerId !== userId) throw new ForbiddenException("No es tu emprendimiento");
    return venture;
  }
}

function toPublic(v: {
  id: string;
  name: string;
  description: string;
  category: string;
  photoUrl: string | null;
  whatsappNumber: string;
}): VenturePublic {
  const { id, name, description, category, photoUrl } = v;
  return { id, name, description, category, photoUrl, whatsappLink: whatsappLink(v.whatsappNumber) };
}

export function whatsappLink(whatsappNumber: string, message = "Hola, vi tu emprendimiento en AEIS-APP"): string {
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
}
