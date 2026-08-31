import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { DangerZoneService } from "./danger-zone.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { AlertService } from "../shared/monitoring/alert.service";
import { ConfirmWipeTestDataDto, ConfirmFreeLockersDto } from "./dto/confirm-danger-action.dto";

// PrismaClient CRUDO de logto se mockea a nivel de módulo — DangerZoneService
// instancia uno propio con `new PrismaClient(...)` (no el PrismaService de
// Nest, que apunta a aeis_app), mismo patrón que mail.service.spec.ts mockea
// "resend" a nivel de módulo.
const logtoQueryRaw = jest.fn();
const logtoExecuteRaw = jest.fn();
const logtoConnect = jest.fn().mockResolvedValue(undefined);
const logtoDisconnect = jest.fn().mockResolvedValue(undefined);
jest.mock("@prisma/client", () => {
  const actual = jest.requireActual("@prisma/client");
  return {
    ...actual,
    PrismaClient: jest.fn().mockImplementation(() => ({
      $connect: logtoConnect,
      $disconnect: logtoDisconnect,
      $queryRaw: (...args: unknown[]) => logtoQueryRaw(...args),
      $executeRaw: (...args: unknown[]) => logtoExecuteRaw(...args),
    })),
  };
});

function buildPrismaMock() {
  return {
    user: { count: jest.fn().mockResolvedValue(3), deleteMany: jest.fn() },
    payment: { count: jest.fn().mockResolvedValue(1), deleteMany: jest.fn() },
    lockerRental: { count: jest.fn().mockResolvedValue(1), deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    subscription: { count: jest.fn().mockResolvedValue(0), deleteMany: jest.fn() },
    venture: { count: jest.fn().mockResolvedValue(0), deleteMany: jest.fn() },
    auditLog: { count: jest.fn().mockResolvedValue(3), deleteMany: jest.fn() },
    locker: { count: jest.fn().mockResolvedValue(1), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

async function buildService(configValues: Record<string, string> = { LOGTO_DATABASE_URL: "postgresql://logto-test" }) {
  const prisma = buildPrismaMock();
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const config = { getOrThrow: (key: string) => configValues[key] };
  const alert = { send: jest.fn().mockResolvedValue(undefined) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      DangerZoneService,
      { provide: PrismaService, useValue: prisma },
      { provide: AuditService, useValue: audit },
      { provide: ConfigService, useValue: config },
      { provide: AlertService, useValue: alert },
    ],
  }).compile();

  return { service: moduleRef.get(DangerZoneService), prisma, audit, alert };
}

describe("DangerZoneService.previewWipe", () => {
  beforeEach(() => {
    logtoQueryRaw.mockReset();
    logtoExecuteRaw.mockReset();
  });

  it("Dado el estado real de aeis_app y logto, Cuando se pide el preview, Entonces junta ambos conteos", async () => {
    logtoQueryRaw.mockResolvedValue([{ count: BigInt(5) }]);
    const { service } = await buildService();

    const preview = await service.previewWipe();

    expect(preview.aeisApp).toEqual({
      users: 3,
      payments: 1,
      lockerRentals: 1,
      subscriptions: 0,
      ventures: 0,
      studentAuditLogs: 3,
      lockersNotAvailable: 1,
    });
    expect(preview.logtoDefaultTenantUsers).toBe(5);
    expect(preview.logtoError).toBeNull();
  });

  it("Dado que Logto no responde (LOGTO_DATABASE_URL mal o caído), Cuando se pide el preview, Entonces reporta el error SIN tumbar el resto del preview", async () => {
    logtoQueryRaw.mockRejectedValue(new Error("connection refused"));
    const { service } = await buildService();

    const preview = await service.previewWipe();

    expect(preview.logtoDefaultTenantUsers).toBeNull();
    expect(preview.logtoError).toContain("connection refused");
    expect(preview.aeisApp.users).toBe(3); // el resto del preview sigue funcionando
  });
});

describe("DangerZoneService.wipeTestData", () => {
  beforeEach(() => {
    logtoQueryRaw.mockReset();
    logtoExecuteRaw.mockReset();
  });

  it("Dada la confirmación, Cuando se ejecuta, Entonces borra aeis_app en una sola transacción y también el tenant default de Logto", async () => {
    logtoQueryRaw.mockResolvedValue([{ count: BigInt(3) }]);
    logtoExecuteRaw.mockResolvedValue(3);
    const { service, prisma, audit } = await buildService();

    const result = await service.wipeTestData({ adminActorId: "admin-1", ipAddress: "10.0.0.1" });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({});
    expect(prisma.lockerRental.deleteMany).toHaveBeenCalledWith({});
    expect(prisma.locker.updateMany).toHaveBeenCalledWith({
      where: { status: { not: "AVAILABLE" } },
      data: { status: "AVAILABLE" },
    });
    // Nunca toca periods/subscription_tiers/admin_accounts/app_settings —
    // ninguno de esos modelos se llama en absoluto en este service.
    expect(logtoExecuteRaw).toHaveBeenCalled();
    expect(result.logtoDeleted).toBe(3);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ adminActorId: "admin-1", action: "admin.danger_zone.wipe_test_data" })
    );
  });

  it("Dado que Logto falla al borrar (ej. cuenta de consola sin permisos de red), Cuando se ejecuta, Entonces aeis_app YA se borró y el error de Logto queda auditado, no silenciado", async () => {
    logtoQueryRaw.mockResolvedValue([{ count: BigInt(0) }]);
    logtoExecuteRaw.mockRejectedValue(new Error("no se pudo conectar a logto"));
    const { service, prisma, audit } = await buildService();

    const result = await service.wipeTestData({ adminActorId: "admin-1" });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1); // aeis_app no se revierte por un fallo de Logto
    expect(result.logtoDeleted).toBeNull();
    expect(result.logtoError).toContain("no se pudo conectar a logto");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ logtoError: expect.stringContaining("no se pudo conectar") }) })
    );
  });

  it("Cuando se ejecuta, Entonces manda una alerta CRITICAL en tiempo real ANTES de borrar — 'en caso de que pase algo' no puede depender de revisar el AuditLog después", async () => {
    logtoQueryRaw.mockResolvedValue([{ count: BigInt(0) }]);
    logtoExecuteRaw.mockResolvedValue(0);
    const { service, alert } = await buildService();

    await service.wipeTestData({ adminActorId: "admin-1", ipAddress: "10.0.0.1" });

    expect(alert.send).toHaveBeenCalledWith(expect.stringContaining("admin-1"), "critical");
    expect(alert.send).toHaveBeenCalledWith(expect.stringContaining("10.0.0.1"), "critical");
  });
});

describe("DangerZoneService.freeLockers", () => {
  it("Cuando se ejecuta, Entonces manda una alerta de tipo warning (menos grave que el wipe — no borra datos reales)", async () => {
    const { service, alert } = await buildService();

    await service.freeLockers({ adminActorId: "admin-1" });

    expect(alert.send).toHaveBeenCalledWith(expect.stringContaining("admin-1"), "warning");
  });

  it("Dados casilleros con alquiler real Y casilleros huérfanos, Cuando se liberan, Entonces SOLO toca los huérfanos", async () => {
    const { service, prisma } = await buildService();
    (prisma.lockerRental.findMany as jest.Mock).mockResolvedValue([{ lockerId: "locker-con-rental" }]);
    prisma.locker.count = jest.fn().mockResolvedValue(2);
    prisma.locker.updateMany = jest.fn().mockResolvedValue({ count: 2 });

    const result = await service.freeLockers({ adminActorId: "admin-1" });

    expect(prisma.locker.updateMany).toHaveBeenCalledWith({
      where: { status: { not: "AVAILABLE" }, id: { notIn: ["locker-con-rental"] } },
      data: { status: "AVAILABLE" },
    });
    expect(result.freed).toBe(2);
  });
});

describe("Confirmación literal en el body — no un POST vacío", () => {
  it.each([
    ["BORRAR DATOS DE PRUEBA", true],
    ["borrar datos de prueba", false],
    ["BORRAR DATOS DE PRUEBA ", false],
    ["", false],
  ])("ConfirmWipeTestDataDto(%j) válido=%s", async (confirm, expectedValid) => {
    const errors = await validate(plainToInstance(ConfirmWipeTestDataDto, { confirm }));
    expect(errors.length === 0).toBe(expectedValid);
  });

  it.each([
    ["LIBERAR CASILLEROS", true],
    ["liberar casilleros", false],
  ])("ConfirmFreeLockersDto(%j) válido=%s", async (confirm, expectedValid) => {
    const errors = await validate(plainToInstance(ConfirmFreeLockersDto, { confirm }));
    expect(errors.length === 0).toBe(expectedValid);
  });
});
