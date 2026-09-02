import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { AlertService } from "../shared/monitoring/alert.service";
import { AdminActionContext } from "./admin.service";

// "Zona de riesgo" — el botón del panel que reemplaza los scripts .ps1
// manuales (wipe-all-to-zero.ps1, free-stuck-lockers.ps1) para no tener
// que pedir esto por chat cada vez. MISMO alcance que esos scripts, sin
// excepción — ver el comentario grande de wipe-all-to-zero.ps1 para el
// porqué exacto de cada tabla incluida/excluida.
//
// NUNCA toca (a propósito, verificado tabla por tabla):
//   - periods, subscription_tiers, admin_accounts, app_settings (config
//     real, no datos de prueba)
//   - audit_logs de acciones de ADMIN (adminActorId) — solo estudiante
//   - logto tenant "admin" (la cuenta de consola) — SOLO tenant "default"
//     (hallazgo real de este mismo proyecto: un DELETE FROM users sin
//     filtrar por tenant se llevó por delante el acceso a la consola de
//     Logto una vez — ver create-logto-admin.ps1 / grant-logto-admin-
//     permissions.ps1 para la recuperación que hizo falta). Además del
//     WHERE, el borrado corre en una transacción que cuenta el tenant
//     "admin" antes y después y REVIERTE todo si el número cambió — ver
//     wipeLogtoDefaultTenant().
@Injectable()
export class DangerZoneService {
  private readonly logger = new Logger(DangerZoneService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly alert: AlertService
  ) {}

  // Solo lectura — counts reales para que el admin vea QUÉ va a borrar
  // antes de escribir la frase de confirmación, no un botón a ciegas.
  async previewWipe() {
    const [users, payments, lockerRentals, subscriptions, ventures, studentAuditLogs, lockersNotAvailable] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.payment.count(),
        this.prisma.lockerRental.count(),
        this.prisma.subscription.count(),
        this.prisma.venture.count(),
        this.prisma.auditLog.count({ where: { actorId: { not: null } } }),
        this.prisma.locker.count({ where: { status: { not: "AVAILABLE" } } }),
      ]);

    let logtoDefaultUsers: number | null = null;
    let logtoError: string | null = null;
    try {
      logtoDefaultUsers = await this.countLogtoDefaultTenantUsers();
    } catch (err) {
      logtoError = (err as Error).message;
      this.logger.warn(`previewWipe() — no se pudo contar usuarios de Logto (tenant default): ${logtoError}`);
    }

    return {
      aeisApp: { users, payments, lockerRentals, subscriptions, ventures, studentAuditLogs, lockersNotAvailable },
      logtoDefaultTenantUsers: logtoDefaultUsers,
      logtoError,
    };
  }

  async wipeTestData(ctx: AdminActionContext) {
    // Fire-and-forget, ANTES de borrar — es la acción más destructiva de
    // todo el panel: si una cuenta de admin se compromete, este es
    // literalmente el escenario "en caso de que pase algo" que la alerta
    // en tiempo real existe para cubrir. No await: una alerta lenta/caída
    // nunca debe frenar ni la acción real ni el AuditLog de abajo.
    void this.alert.send(
      `Zona de riesgo: BORRAR DATOS DE PRUEBA disparado por admin ${ctx.adminActorId}${ctx.ipAddress ? ` desde ${ctx.ipAddress}` : ""}`,
      "critical"
    );
    const before = await this.previewWipe();

    // Mismo orden que wipe-all-to-zero.ps1 — hijos antes que padres, para
    // no chocar con las FK reales del schema (ver locker_rentals ->
    // lockers/users/periods/payments, subscriptions -> users/tiers/
    // periods/payments, payments -> users).
    await this.prisma.$transaction([
      this.prisma.locker.updateMany({ where: { status: { not: "AVAILABLE" } }, data: { status: "AVAILABLE" } }),
      this.prisma.auditLog.deleteMany({ where: { actorId: { not: null } } }),
      this.prisma.venture.deleteMany({}),
      this.prisma.lockerRental.deleteMany({}),
      this.prisma.subscription.deleteMany({}),
      this.prisma.payment.deleteMany({}),
      this.prisma.user.deleteMany({}),
    ]);

    let logtoDeleted: number | null = null;
    let logtoError: string | null = null;
    try {
      logtoDeleted = await this.wipeLogtoDefaultTenant();
    } catch (err) {
      logtoError = (err as Error).message;
      this.logger.error(`wipeTestData() — aeis_app SÍ se borró, pero Logto (tenant default) falló: ${logtoError}`);
    }

    // Se audita DESPUÉS de borrar users — adminActorId nunca depende de la
    // tabla users (es un AdminAccount, tabla aparte, ver audit.service.ts),
    // así que este registro sobrevive intacto al wipe que acaba de correr.
    await this.audit.record({
      adminActorId: ctx.adminActorId,
      action: "admin.danger_zone.wipe_test_data",
      entityType: "System",
      entityId: "wipe",
      ipAddress: ctx.ipAddress,
      metadata: { before, logtoDeleted, logtoError },
    });

    return { wiped: before.aeisApp, logtoDeleted, logtoError };
  }

  async freeLockers(ctx: AdminActionContext) {
    // "warning", no "critical" — a diferencia de wipeTestData(), esto no
    // borra ningún dato real (solo huérfanos), pero sigue siendo una
    // mutación en bloque digna de quedar visible en tiempo real.
    void this.alert.send(
      `Zona de riesgo: LIBERAR CASILLEROS disparado por admin ${ctx.adminActorId}${ctx.ipAddress ? ` desde ${ctx.ipAddress}` : ""}`,
      "warning"
    );
    // Solo libera lo que de verdad no tiene un alquiler real detrás — un
    // Locker con status != AVAILABLE pero SIN fila en locker_rentals es
    // basura huérfana (reset parcial anterior, bug, lo que sea). Uno con
    // un alquiler real activo NO se toca: liberarlo a ciegas dejaría
    // status=AVAILABLE con un LockerRental real todavía apuntándole,
    // exactamente la inconsistencia que este botón existe para evitar.
    const rentedLockerIds = (await this.prisma.lockerRental.findMany({ select: { lockerId: true } })).map(
      (r) => r.lockerId
    );

    const before = await this.prisma.locker.count({
      where: { status: { not: "AVAILABLE" }, id: { notIn: rentedLockerIds } },
    });

    const result = await this.prisma.locker.updateMany({
      where: { status: { not: "AVAILABLE" }, id: { notIn: rentedLockerIds } },
      data: { status: "AVAILABLE" },
    });

    await this.audit.record({
      adminActorId: ctx.adminActorId,
      action: "admin.danger_zone.free_lockers",
      entityType: "Locker",
      entityId: "bulk",
      ipAddress: ctx.ipAddress,
      metadata: { freed: result.count, expectedCount: before },
    });

    return { freed: result.count };
  }

  // Conexión CRUDA aparte a la base de Logto — nunca vía el PrismaService
  // normal (ese apunta a aeis_app, un esquema completamente distinto).
  // Mismo servidor Postgres, mismo usuario/password que aeis_app (ver
  // docker-compose.prod.yml — un solo contenedor aeis-postgres sirve
  // ambas bases), solo cambia el nombre de la base en la URL — por eso
  // LOGTO_DATABASE_URL es su propia variable de entorno, no una derivada
  // a ciegas de DATABASE_URL.
  private async withLogtoClient<T>(fn: (client: PrismaClient) => Promise<T>): Promise<T> {
    const url = this.config.getOrThrow<string>("LOGTO_DATABASE_URL");
    const client = new PrismaClient({ datasources: { db: { url } } });
    try {
      await client.$connect();
      return await fn(client);
    } finally {
      await client.$disconnect();
    }
  }

  private countLogtoDefaultTenantUsers(): Promise<number> {
    return this.withLogtoClient(async (client) => {
      const rows = await client.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM users WHERE tenant_id = 'default'`;
      return Number(rows[0]?.count ?? 0);
    });
  }

  /**
   * Borra los usuarios de Logto del tenant 'default' (estudiantes).
   *
   * SOLO tenant 'default'. El `WHERE` es lo que protege la cuenta de la
   * consola (tenant 'admin'). Las 15 FK que cuelgan de logto.users tienen
   * ON DELETE CASCADE confirmado (verificado a mano contra pg_constraint),
   * así que este DELETE arrastra limpio sesiones/identidades/tokens sin
   * dejar huérfanos.
   *
   * Todo corre dentro de una TRANSACCIÓN con una verificación posterior, y
   * esa es la parte importante: en este mismo proyecto un
   * `DELETE FROM users` sin filtrar por tenant ya se llevó por delante la
   * cuenta de la consola de Logto, y hubo que recrearla a mano con hash
   * Argon2i y volver a asignarle los permisos (ver create-logto-admin.ps1
   * y grant-logto-admin-permissions.ps1). Un `WHERE` correcto evita que
   * eso vuelva a pasar hoy; contar el tenant 'admin' antes y después, y
   * ABORTAR la transacción si el número cambió, evita que vuelva a pasar
   * si alguien edita esta consulta mañana.
   *
   * Con esto, el peor caso deja de ser "el admin desaparece y nadie se
   * entera hasta que intenta entrar" y pasa a ser "la operación se
   * revierte entera y salta una alerta crítica".
   */
  private wipeLogtoDefaultTenant(): Promise<number> {
    return this.withLogtoClient((client) =>
      client.$transaction(async (tx) => {
        const adminsBefore = await this.countLogtoTenantUsers(tx, "admin");

        const deleted = await tx.$executeRaw`DELETE FROM users WHERE tenant_id = 'default'`;

        const adminsAfter = await this.countLogtoTenantUsers(tx, "admin");
        if (adminsAfter !== adminsBefore) {
          void this.alert.send(
            `ABORTADO: el wipe de Logto iba a borrar cuentas del tenant 'admin' (${adminsBefore} -> ${adminsAfter}). ` +
              `La transaccion se revirtio, no se borro nada. Revisar DangerZoneService antes de reintentar.`,
            "critical"
          );
          // Lanzar DENTRO de la transacción es lo que la revierte: el
          // DELETE de arriba se deshace y la cuenta de consola sobrevive.
          throw new Error(
            `Wipe de Logto abortado: el tenant 'admin' paso de ${adminsBefore} a ${adminsAfter} cuentas. Nada se borro.`
          );
        }

        return deleted;
      })
    );
  }

  // `tx` en vez del cliente completo para poder contar DENTRO de la
  // transacción — contar fuera leería un snapshot distinto y la
  // comprobación no probaría nada.
  private async countLogtoTenantUsers(
    tx: Pick<PrismaClient, "$queryRaw">,
    tenantId: string
  ): Promise<number> {
    const rows = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM users WHERE tenant_id = ${tenantId}`;
    return Number(rows[0]?.count ?? 0);
  }
}
