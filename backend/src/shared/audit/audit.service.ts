import { Injectable } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

// Servicio de auditoría — no es opcional ni "nice to have".
//
// Es la respuesta directa al hallazgo de negocio de
// docs/dominio/01-analisis-negocio-mision.md §2.1: 277 registros del
// proceso de alquiler, solo 91 casilleros efectivamente concretados, y un
// déficit de caja que la directiva no puede explicar porque el proceso
// manual no dejaba rastro. `record()` recibe un `actorId` NOT NULL a
// propósito (docs/dominio/05-metodologia-devsecops-pipeline.md §3.1): no
// existe un evento de auditoría sin un usuario responsable identificado.
//
// `record()` acepta un cliente Prisma opcional (`tx`) para poder llamarse
// DENTRO de la misma transacción que crea el pago/alquiler/aportación — si
// la transacción falla, el registro de auditoría también se revierte, así
// nunca queda un alquiler sin su rastro (o viceversa).

// Dos tipos de actor autenticado desde que existe el panel de
// administración (AdminAccount, login propio correo+contraseña — ver
// admin-auth.service.ts), separado a propósito de User/Logto. El tipo
// unión obliga a pasar EXACTAMENTE uno de los dos en cada llamado — nunca
// ninguno (mismo principio de "ningún dato desacoplado" que ya regía
// actorId como NOT NULL), nunca los dos a la vez.
type AuditActor = { actorId: string; adminActorId?: never } | { actorId?: never; adminActorId: string };

export type AuditEntry = AuditActor & {
  action: string;
  entityType: string;
  entityId: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
};

type PrismaTx = Prisma.TransactionClient | PrismaClient;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx: PrismaTx = this.prisma) {
    return tx.auditLog.create({
      data: {
        actorId: entry.actorId,
        adminActorId: entry.adminActorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        ipAddress: entry.ipAddress,
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
