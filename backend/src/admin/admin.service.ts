import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PeriodService } from "../shared/period/period.service";
import { UiVariantService } from "../shared/settings/ui-variant.service";
import { ListUsersQueryDto } from "./dto/list-users.dto";
import { ListAuditLogsQueryDto } from "./dto/list-audit-logs.dto";
import { UpdateSubscriptionTierDto } from "./dto/update-subscription-tier.dto";
import { UpdateLockerPricingDto } from "./dto/update-locker-pricing.dto";
import { UpdateUiVariantDto } from "./dto/update-ui-variant.dto";

export interface AdminActionContext {
  // El actor de toda acción hecha desde el panel es SIEMPRE un
  // AdminAccount (login propio, ver admin-auth.service.ts), nunca un User
  // — el panel es una identidad completamente aparte.
  adminActorId: string;
  ipAddress?: string;
}

// Dashboard de PRESIDENTE/DIRECTOR (ver RolesGuard) — precios de
// aportaciones/casillero, directorio de estudiantes registrados, y el
// registro de auditoría real (AuditLog) para investigar cualquier
// inconveniente. No expone nada que ya no sea visible a un admin por
// diseño (logtoSub nunca sale ni de acá).
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly period: PeriodService,
    private readonly uiVariant: UiVariantService
  ) {}

  // Rueda (ArcMenu, "A") vs. lista accesible (AccessibleCategoryNav, "B")
  // — ver src/lib/abTest.ts en el frontend. El experimento real ya se
  // cerró a favor de B, pero antes el valor quedaba hardcodeado en el
  // frontend: cambiarlo necesitaba un redeploy. Ahora es un feature flag
  // real, editable desde acá sin tocar código.
  async getUiVariant() {
    return { variant: await this.uiVariant.get() };
  }

  async updateUiVariant(dto: UpdateUiVariantDto, ctx: AdminActionContext) {
    await this.uiVariant.set(dto.variant);
    await this.audit.record({
      adminActorId: ctx.adminActorId,
      action: "admin.ui_variant.updated",
      entityType: "AppSetting",
      entityId: "ui_variant",
      ipAddress: ctx.ipAddress,
      metadata: { variant: dto.variant },
    });
    return { variant: dto.variant };
  }

  async listUsers(query: ListUsersQueryDto) {
    const where = query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: "insensitive" as const } },
            { email: { contains: query.search, mode: "insensitive" as const } },
            { uniqueCode: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          email: true,
          uniqueCode: true,
          role: true,
          cedula: true,
          phone: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { total, page: query.page, pageSize: query.pageSize, users };
  }

  // Tiers del periodo ACTIVO únicamente — editar el monto/beneficios de un
  // periodo ya cerrado reescribiría en silencio lo que un aportante de un
  // semestre pasado de verdad pagó (ese dato histórico tiene que quedar
  // fijo, es lo que ya prueba AuditLog).
  async listSubscriptionTiers() {
    const period = await this.period.getCurrentPeriod();
    const tiers = await this.prisma.subscriptionTier.findMany({
      where: { periodId: period.id },
      select: { id: true, name: true, amount: true, benefits: true },
      orderBy: { amount: "asc" },
    });
    return { periodLabel: period.label, tiers };
  }

  async updateSubscriptionTier(tierId: string, dto: UpdateSubscriptionTierDto, ctx: AdminActionContext) {
    if (dto.amount === undefined && dto.benefits === undefined) {
      throw new BadRequestException("Nada que actualizar — manda amount y/o benefits");
    }
    if (dto.benefits !== undefined) {
      assertValidBenefits(dto.benefits);
    }

    const period = await this.period.getCurrentPeriod();
    const tier = await this.prisma.subscriptionTier.findUnique({ where: { id: tierId } });
    if (!tier || tier.periodId !== period.id) {
      throw new NotFoundException("Ese tier no existe en el periodo activo");
    }

    const before = { amount: Number(tier.amount), benefits: tier.benefits };
    const updated = await this.prisma.subscriptionTier.update({
      where: { id: tierId },
      data: {
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.benefits !== undefined ? { benefits: dto.benefits as object } : {}),
      },
    });

    await this.audit.record({
      adminActorId: ctx.adminActorId,
      action: "admin.subscription_tier.updated",
      entityType: "SubscriptionTier",
      entityId: tierId,
      ipAddress: ctx.ipAddress,
      metadata: { tierName: tier.name, before, after: { amount: Number(updated.amount), benefits: updated.benefits } },
    });

    return { id: updated.id, name: updated.name, amount: Number(updated.amount), benefits: updated.benefits };
  }

  async getLockerPricing() {
    const period = await this.period.getCurrentPeriod();
    return { periodLabel: period.label, basePrice: Number(period.lockerBasePrice) };
  }

  async updateLockerPricing(dto: UpdateLockerPricingDto, ctx: AdminActionContext) {
    const period = await this.period.getCurrentPeriod();
    const before = Number(period.lockerBasePrice);

    const updated = await this.prisma.period.update({
      where: { id: period.id },
      data: { lockerBasePrice: dto.basePrice },
    });

    await this.audit.record({
      adminActorId: ctx.adminActorId,
      action: "admin.locker_pricing.updated",
      entityType: "Period",
      entityId: period.id,
      ipAddress: ctx.ipAddress,
      metadata: { periodLabel: period.label, before, after: dto.basePrice },
    });

    return { periodLabel: period.label, basePrice: Number(updated.lockerBasePrice) };
  }

  async listAuditLogs(query: ListAuditLogsQueryDto) {
    const where = {
      ...(query.action ? { action: { contains: query.action, mode: "insensitive" as const } } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
    };

    const [total, logs] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        // El actor puede ser un User (Logto) o un AdminAccount (panel) —
        // nunca los dos — ver el comentario grande sobre AuditLog en
        // schema.prisma. Se piden ambas relaciones y se usa la que venga.
        include: { actor: { select: { fullName: true } }, adminActor: { select: { email: true } } },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId,
        actorId: l.actorId ?? l.adminActorId,
        actorName: l.actor?.fullName ?? (l.adminActor ? `${l.adminActor.email} (admin)` : "—"),
        ipAddress: l.ipAddress,
        metadata: l.metadata,
        createdAt: l.createdAt,
      })),
    };
  }
}

// Nunca confiar ciegamente en el JSON que manda el cliente para un campo
// deliberadamente libre (mismo criterio que SubscriptionBenefitsService al
// LEER benefits) — acá al escribirlo, lo mínimo exigible es "un array de
// objetos, cada uno con un type identificable", no un array de strings
// sueltos ni de números.
function assertValidBenefits(benefits: unknown[]): void {
  for (const b of benefits) {
    if (typeof b !== "object" || b === null || Array.isArray(b) || typeof (b as { type?: unknown }).type !== "string") {
      throw new BadRequestException('Cada beneficio debe ser un objeto con al menos { "type": "..." }');
    }
  }
}
