import { Test } from "@nestjs/testing";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { LockerService, LockerUnavailableError } from "./locker.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { PeriodService } from "../shared/period/period.service";
import { SubscriptionBenefitsService } from "../subscription/subscription-benefits.service";

describe("LockerService.rent", () => {
  let service: LockerService;
  let prisma: any;
  let audit: { record: jest.Mock };
  let payphone: { confirm: jest.Mock; getPublicConfig: jest.Mock };
  let subscriptionBenefits: { getLockerDiscountPercent: jest.Mock; getLockerDiscountInfo: jest.Mock };

  const locker = { id: "locker-1", code: "A07", zone: "A", status: "AVAILABLE" };
  const params = {
    userId: "user-1",
    lockerCode: "A07",
    cedula: "1723456789",
    phone: "0991234567",
    acceptedTerms: true,
  };

  beforeEach(async () => {
    const tx = {
      payment: { create: jest.fn().mockResolvedValue({ id: "payment-1" }), update: jest.fn().mockResolvedValue({}) },
      lockerRental: { create: jest.fn().mockResolvedValue({ id: "rental-1" }) },
      locker: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      locker: { findUnique: jest.fn().mockResolvedValue(locker) },
      period: { findFirst: jest.fn().mockResolvedValue({ id: "period-1" }) },
      lockerRental: { findUnique: jest.fn() },
      user: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((cb: any) => cb(tx)),
      __tx: tx,
    };
    audit = { record: jest.fn().mockResolvedValue({ id: "log-1" }) };
    payphone = { confirm: jest.fn(), getPublicConfig: jest.fn() };
    subscriptionBenefits = {
      getLockerDiscountPercent: jest.fn().mockResolvedValue(0),
      getLockerDiscountInfo: jest.fn().mockResolvedValue({ discountPercent: 0, tierName: null }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LockerService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: PayphoneClient, useValue: payphone },
        { provide: PeriodService, useValue: { getCurrentPeriodId: jest.fn().mockResolvedValue("period-1") } },
        { provide: SubscriptionBenefitsService, useValue: subscriptionBenefits },
      ],
    }).compile();
    service = moduleRef.get(LockerService);
  });

  it("Dado un casillero inexistente, Cuando se intenta alquilar, Entonces lanza NotFoundException sin crear pago ni auditoría", async () => {
    prisma.locker.findUnique.mockResolvedValue(null);

    await expect(service.rent(params)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("Dado un casillero disponible, Cuando se alquila, Entonces el pago queda PENDING y el casillero RESERVED — la Cajita de Pagos real cobra en el navegador, no aquí (ver confirmPayphonePayment)", async () => {
    await service.rent(params);

    expect(payphone.confirm).not.toHaveBeenCalled();
    expect(prisma.__tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ method: "PAYPHONE", status: "PENDING" }) })
    );
    expect(prisma.__tx.locker.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "RESERVED" } })
    );
  });

  it("Dado dos estudiantes alquilando el mismo casillero a la vez (condición de carrera), Cuando la restricción única de la base de datos rechaza el segundo insert, Entonces el servicio traduce eso a LockerUnavailableError, no a un error genérico de base de datos", async () => {
    const dbError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.4.1",
    });
    prisma.__tx.lockerRental.create.mockRejectedValue(dbError);

    await expect(service.rent(params)).rejects.toBeInstanceOf(LockerUnavailableError);
  });

  it("Dado un alquiler exitoso, Cuando se completa, Entonces queda un registro de auditoría con actor, acción y monto — dentro de la MISMA transacción", async () => {
    await service.rent(params);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        action: "locker.rental.created",
        entityType: "LockerRental",
      }),
      prisma.__tx
    );
  });

  // Cruce de dominio: un aportante con beneficio "descuento_casillero"
  // paga menos por el casillero — pero LockerService nunca lee la tabla de
  // Subscription, solo confía en lo que le devuelve
  // SubscriptionBenefitsService (mockeado aquí, probado de verdad en
  // subscription-benefits.service.spec.ts).
  it("Dado un estudiante con 20% de descuento en casilleros (tier de Aportaciones), Cuando alquila, Entonces el precio ya viene descontado", async () => {
    subscriptionBenefits.getLockerDiscountPercent.mockResolvedValue(20);

    await service.rent(params);

    expect(prisma.__tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 5.2 }) }) // 6.50×0.8
    );
  });

  it("Dado un estudiante sin aportación (0% de descuento), Cuando alquila, Entonces paga el precio de lista completo", async () => {
    await service.rent(params);

    expect(prisma.__tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 6.5 }) })
    );
  });

  // Defensa en profundidad — el DTO ya rechaza esto con @IsIn([true]), pero
  // rent() no debe confiar solo en esa capa (ver comentario en el método).
  it("Dado acceptedTerms:false, Cuando se intenta alquilar, Entonces rechaza sin crear pago ni tocar el casillero", async () => {
    await expect(service.rent({ ...params, acceptedTerms: false })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // La "firma digital" del checkbox — QUIÉN/CUÁNDO/desde-dónde vienen de
  // fuentes que el cliente no controla (actorId del JWT, AuditLog.createdAt,
  // ipAddress de la request), no de campos del formulario. Acá solo se
  // prueba que termsVersion/termsAccepted quedan en el metadata auditado.
  it("Dado un alquiler aceptando términos, Cuando se completa, Entonces el audit log queda con termsAccepted y la versión del texto aceptado", async () => {
    await service.rent(params);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ termsAccepted: true, termsVersion: "2026-A-v1" }),
      }),
      prisma.__tx
    );
  });

  // Cédula/celular se piden una sola vez (ver comentario en
  // RentLockerModal.svelte) — el alquiler es el punto donde se guardan en
  // User, para que el siguiente semestre no haya que volver a pedirlos.
  it("Dado cédula y celular, Cuando alquila, Entonces los guarda en User para no volver a pedirlos", async () => {
    await service.rent(params);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { cedula: "1723456789", phone: "0991234567" },
    });
  });
});

describe("LockerService.getPricePreview", () => {
  let service: LockerService;
  let subscriptionBenefits: { getLockerDiscountPercent: jest.Mock; getLockerDiscountInfo: jest.Mock };

  beforeEach(async () => {
    subscriptionBenefits = {
      getLockerDiscountPercent: jest.fn(),
      getLockerDiscountInfo: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        LockerService,
        { provide: PrismaService, useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: PayphoneClient, useValue: {} },
        { provide: PeriodService, useValue: {} },
        { provide: SubscriptionBenefitsService, useValue: subscriptionBenefits },
      ],
    }).compile();
    service = moduleRef.get(LockerService);
  });

  // Esto es lo que reemplaza las preguntas "¿eres aportante?" / "¿qué plan
  // tienes?" del formulario en papel — el frontend llama a este preview
  // ANTES de mostrar el precio, y el descuento ya viene resuelto solo con
  // la sesión del estudiante, sin que declare nada.
  it("Dado un aportante Plan Platino (10% de descuento), Cuando pide el preview de precio, Entonces devuelve el nombre del tier y el precio ya descontado", async () => {
    subscriptionBenefits.getLockerDiscountInfo.mockResolvedValue({ discountPercent: 10, tierName: "Platino" });

    const preview = await service.getPricePreview("user-1");

    expect(preview).toEqual({
      basePrice: 6.5,
      discountPercent: 10,
      tierName: "Platino",
      price: { PAYPHONE: 5.85 }, // 6.5*0.9
    });
  });

  it("Dado un estudiante sin aportación, Cuando pide el preview de precio, Entonces tierName es null y el precio es de lista", async () => {
    subscriptionBenefits.getLockerDiscountInfo.mockResolvedValue({ discountPercent: 0, tierName: null });

    const preview = await service.getPricePreview("user-1");

    expect(preview).toEqual({
      basePrice: 6.5,
      discountPercent: 0,
      tierName: null,
      price: { PAYPHONE: 6.5 },
    });
  });
});

describe("LockerService.confirmPayphonePayment", () => {
  let service: LockerService;
  let prisma: any;
  let audit: { record: jest.Mock };
  let payphone: { confirm: jest.Mock; getPublicConfig: jest.Mock };

  const pendingRental = {
    id: "rental-1",
    userId: "user-1",
    lockerId: "locker-1",
    paymentId: "payment-1",
    payment: { id: "payment-1", method: "PAYPHONE", status: "PENDING", amount: 6.5 },
    locker: { id: "locker-1", code: "A07" },
  };

  beforeEach(async () => {
    const tx = {
      payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      locker: { update: jest.fn().mockResolvedValue({ id: "locker-1", status: "RENTED" }) },
    };
    prisma = {
      lockerRental: { findUnique: jest.fn().mockResolvedValue(pendingRental) },
      $transaction: jest.fn((cb: any) => cb(tx)),
      __tx: tx,
    };
    audit = { record: jest.fn().mockResolvedValue({ id: "log-1" }) };
    payphone = { confirm: jest.fn(), getPublicConfig: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LockerService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: PayphoneClient, useValue: payphone },
        { provide: PeriodService, useValue: { getCurrentPeriodId: jest.fn().mockResolvedValue("period-1") } },
        {
          provide: SubscriptionBenefitsService,
          useValue: { getLockerDiscountPercent: jest.fn().mockResolvedValue(0) },
        },
      ],
    }).compile();
    service = moduleRef.get(LockerService);
  });

  it("Dado un alquiler que no existe, Cuando se confirma el pago, Entonces lanza NotFoundException", async () => {
    prisma.lockerRental.findUnique.mockResolvedValue(null);

    await expect(service.confirmPayphonePayment("rental-x", 123, "user-1")).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("Dado un alquiler de otro estudiante, Cuando se confirma el pago, Entonces lanza ForbiddenException", async () => {
    await expect(service.confirmPayphonePayment("rental-1", 123, "user-otro")).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("Dado que PayPhone responde que la transacción NO fue aprobada, Cuando se confirma, Entonces rechaza sin tocar el pago ni el casillero, y audita el rechazo", async () => {
    payphone.confirm.mockResolvedValue({
      approved: false,
      transactionId: 999,
      clientTransactionId: "rental-1",
      amountCents: 650,
      raw: {},
    });

    await expect(service.confirmPayphonePayment("rental-1", 999, "user-1")).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locker.payphone.rejected", entityId: "rental-1" })
    );
  });

  it("Dado que PayPhone aprueba pero el monto confirmado no coincide con el esperado, Cuando se confirma, Entonces rechaza (nunca confía en el monto que 'dice' el cliente)", async () => {
    payphone.confirm.mockResolvedValue({
      approved: true,
      transactionId: 999,
      clientTransactionId: "rental-1",
      amountCents: 100, // el rental espera 650 ($6.50)
      raw: {},
    });

    await expect(service.confirmPayphonePayment("rental-1", 999, "user-1")).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // Hallazgo de auditoría de seguridad: un mismo pago real y aprobado de
  // PayPhone (mismo monto base) reutilizado para confirmar OTRO alquiler
  // distinto al que de verdad se pagó — sin este chequeo, solo aprobado+
  // monto no bastan, porque el precio de un casillero es fijo y el
  // atacante controla cuál rentalId manda a confirmar.
  it("Dado que PayPhone aprueba una transacción real pero para OTRO alquiler distinto (clientTransactionId no coincide), Cuando se confirma, Entonces rechaza sin tocar el pago ni el casillero", async () => {
    payphone.confirm.mockResolvedValue({
      approved: true,
      transactionId: 999,
      clientTransactionId: "rental-de-otro-alquiler",
      amountCents: 650,
      raw: {},
    });

    await expect(service.confirmPayphonePayment("rental-1", 999, "user-1")).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("Dado que PayPhone aprueba la transacción con el monto correcto, Cuando se confirma, Entonces el pago pasa a CONFIRMED y el casillero a RENTED dentro de la misma transacción", async () => {
    payphone.confirm.mockResolvedValue({
      approved: true,
      transactionId: 999,
      clientTransactionId: "rental-1",
      amountCents: 650,
      raw: {},
    });

    await service.confirmPayphonePayment("rental-1", 999, "user-1");

    expect(payphone.confirm).toHaveBeenCalledWith(999, "rental-1");
    expect(prisma.__tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "payment-1", status: "PENDING" },
        data: expect.objectContaining({ status: "CONFIRMED", providerRef: "999" }),
      })
    );
    expect(prisma.__tx.locker.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "RENTED" } })
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locker.payphone.confirmed", entityId: "rental-1" }),
      prisma.__tx
    );
  });

  // CONCURRENCIA — simula que otra petición (ej. el usuario recargando la
  // página de respuesta de PayPhone) ya confirmó este mismo pago entre el
  // findUnique() y el updateMany() de esta petición.
  it("Dado que otra petición ya confirmó el mismo pago justo antes (condición de carrera), Cuando updateMany no encuentra ninguna fila PENDING, Entonces lanza ConflictException y NUNCA toca el casillero", async () => {
    payphone.confirm.mockResolvedValue({
      approved: true,
      transactionId: 999,
      clientTransactionId: "rental-1",
      amountCents: 650,
      raw: {},
    });
    prisma.__tx.payment.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.confirmPayphonePayment("rental-1", 999, "user-1")).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(prisma.__tx.locker.update).not.toHaveBeenCalled();
  });
});

// Transferencia + comprobante por OCR se retiró como método de pago
// (PayPhone es el único desde acá en adelante) — este job se queda SOLO
// para drenar cualquier LockerRental RESERVED por transferencia que haya
// quedado de ANTES del retiro (ver comentario en locker.service.ts). No se
// pueden crear NUEVAS reservas por transferencia, así que este escenario
// solo aplica a datos legacy.
describe("LockerService.releaseExpiredTransferReservations (limpieza de datos legacy)", () => {
  let service: LockerService;
  let prisma: any;
  let audit: { record: jest.Mock };

  const expiredRental = {
    id: "rental-1",
    userId: "user-1",
    lockerId: "locker-1",
    paymentId: "payment-1",
    locker: { id: "locker-1", code: "A07" },
  };

  beforeEach(async () => {
    const tx = {
      payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      lockerRental: { delete: jest.fn().mockResolvedValue({}) },
      locker: { update: jest.fn().mockResolvedValue({ id: "locker-1", status: "AVAILABLE" }) },
    };
    prisma = {
      lockerRental: { findMany: jest.fn().mockResolvedValue([expiredRental]) },
      $transaction: jest.fn((cb: any) => cb(tx)),
      __tx: tx,
    };
    audit = { record: jest.fn().mockResolvedValue({ id: "log-1" }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LockerService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: PayphoneClient, useValue: { confirm: jest.fn(), getPublicConfig: jest.fn() } },
        { provide: PeriodService, useValue: { getCurrentPeriodId: jest.fn().mockResolvedValue("period-1") } },
        {
          provide: SubscriptionBenefitsService,
          useValue: { getLockerDiscountPercent: jest.fn().mockResolvedValue(0) },
        },
      ],
    }).compile();
    service = moduleRef.get(LockerService);
  });

  it("Dado un alquiler RESERVED por transferencia sin comprobante hace más de 24h (dato legacy), Cuando corre el job, Entonces marca el pago REJECTED, borra el LockerRental (libera @@unique[lockerId,periodId]), pone el casillero AVAILABLE y audita locker.rental.expired", async () => {
    const released = await service.releaseExpiredTransferReservations();

    expect(prisma.lockerRental.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ payment: { method: "TRANSFER", status: "PENDING" } }),
      })
    );
    expect(prisma.__tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "payment-1", status: "PENDING" },
        data: { status: "REJECTED" },
      })
    );
    expect(prisma.__tx.lockerRental.delete).toHaveBeenCalledWith({ where: { id: "rental-1" } });
    expect(prisma.__tx.locker.update).toHaveBeenCalledWith({
      where: { id: "locker-1" },
      data: { status: "AVAILABLE" },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        action: "locker.rental.expired",
        entityId: "rental-1",
        metadata: expect.objectContaining({ lockerCode: "A07", reason: "sin_comprobante_24h" }),
      }),
      prisma.__tx
    );
    expect(released).toBe(1);
  });

  it("Dado que no hay reservas vencidas, Cuando corre el job, Entonces no abre ninguna transacción y retorna 0", async () => {
    prisma.lockerRental.findMany.mockResolvedValue([]);

    const released = await service.releaseExpiredTransferReservations();

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(released).toBe(0);
  });

  // CONCURRENCIA — mismo patrón que confirmPayphonePayment(): el estudiante
  // confirma el pago justo en el instante en que el cron ya había leído
  // esta reserva legacy como "vencida" pero todavía no la liberó.
  it("Dado que se confirma el pago justo antes de que el job libere esa reserva (condición de carrera), Cuando updateMany no encuentra ninguna fila PENDING, Entonces NO borra el alquiler ni toca el casillero", async () => {
    prisma.__tx.payment.updateMany.mockResolvedValue({ count: 0 });

    const released = await service.releaseExpiredTransferReservations();

    expect(prisma.__tx.lockerRental.delete).not.toHaveBeenCalled();
    expect(prisma.__tx.locker.update).not.toHaveBeenCalled();
    expect(released).toBe(0);
  });
});

describe("LockerService.getMyRentedLocker", () => {
  let service: LockerService;
  let prisma: any;
  let period: { getCurrentPeriodId: jest.Mock };

  beforeEach(async () => {
    prisma = { lockerRental: { findFirst: jest.fn() } };
    period = { getCurrentPeriodId: jest.fn().mockResolvedValue("period-1") };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LockerService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: PayphoneClient, useValue: { confirm: jest.fn(), getPublicConfig: jest.fn() } },
        { provide: PeriodService, useValue: period },
        { provide: SubscriptionBenefitsService, useValue: { getLockerDiscountInfo: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(LockerService);
  });

  it("Dado un estudiante con un casillero confirmado este periodo, Cuando pide su casillero alquilado, Entonces devuelve el código y la zona — filtrado por su userId Y el periodo actual", async () => {
    prisma.lockerRental.findFirst.mockResolvedValue({
      id: "rental-1",
      userId: "user-1",
      locker: { code: "E08", zone: "E" },
    });

    const result = await service.getMyRentedLocker("user-1");

    expect(prisma.lockerRental.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", periodId: "period-1", payment: { status: "CONFIRMED" } },
      })
    );
    expect(result).toEqual({ lockerCode: "E08", zone: "E" });
  });

  it("Dado un estudiante sin ningún casillero confirmado, Cuando pide su casillero alquilado, Entonces devuelve null", async () => {
    prisma.lockerRental.findFirst.mockResolvedValue(null);

    const result = await service.getMyRentedLocker("user-1");

    expect(result).toBeNull();
  });
});
