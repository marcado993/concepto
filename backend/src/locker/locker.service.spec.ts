import { Test } from "@nestjs/testing";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { LockerService, LockerUnavailableError } from "./locker.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { OcrService } from "../shared/ocr/ocr.service";
import { PeriodService } from "../shared/period/period.service";
import { SubscriptionBenefitsService } from "../subscription/subscription-benefits.service";

describe("LockerService.rent", () => {
  let service: LockerService;
  let prisma: any;
  let audit: { record: jest.Mock };
  let payphone: { confirm: jest.Mock; getPublicConfig: jest.Mock };
  let ocr: { extractText: jest.Mock };
  let subscriptionBenefits: { getLockerDiscountPercent: jest.Mock; getLockerDiscountInfo: jest.Mock };

  const locker = { id: "locker-1", code: "A07", zone: "A", status: "AVAILABLE" };
  const params = {
    userId: "user-1",
    lockerCode: "A07",
    method: "TRANSFER" as const,
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
    ocr = { extractText: jest.fn().mockResolvedValue("") };
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
        { provide: OcrService, useValue: ocr },
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

  it("Dado un pago por transferencia, Cuando se alquila, Entonces el pago queda PENDING y el casillero RESERVED (no RENTED hasta que el OCR confirme)", async () => {
    await service.rent(params);

    expect(prisma.__tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING" }) })
    );
    expect(prisma.__tx.locker.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "RESERVED" } })
    );
  });

  it("Dado un pago por PayPhone, Cuando se alquila, Entonces el pago queda PENDING y el casillero RESERVED — la Cajita de Pagos real cobra en el navegador, no aquí (ver confirmPayphonePayment)", async () => {
    await service.rent({ ...params, method: "PAYPHONE" });

    expect(payphone.confirm).not.toHaveBeenCalled();
    expect(prisma.__tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING" }) })
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
  it("Dado un estudiante con 20% de descuento en casilleros (tier de Aportaciones), Cuando alquila por transferencia, Entonces el precio ya viene descontado", async () => {
    subscriptionBenefits.getLockerDiscountPercent.mockResolvedValue(20);

    await service.rent(params);

    expect(prisma.__tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 5.2 }) }) // 6.50 × 0.8
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
        { provide: OcrService, useValue: {} },
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
  it("Dado un aportante Plan Platino (10% de descuento), Cuando pide el preview de precio, Entonces devuelve el nombre del tier y el precio ya descontado en los dos métodos", async () => {
    subscriptionBenefits.getLockerDiscountInfo.mockResolvedValue({ discountPercent: 10, tierName: "Platino" });

    const preview = await service.getPricePreview("user-1");

    expect(preview).toEqual({
      basePrice: 6.5,
      discountPercent: 10,
      tierName: "Platino",
      price: { TRANSFER: 5.85, PAYPHONE: 6.25 }, // 6.5*0.9=5.85; +0.40 de recargo PayPhone
    });
  });

  it("Dado un estudiante sin aportación, Cuando pide el preview de precio, Entonces tierName es null y el precio es de lista", async () => {
    subscriptionBenefits.getLockerDiscountInfo.mockResolvedValue({ discountPercent: 0, tierName: null });

    const preview = await service.getPricePreview("user-1");

    expect(preview).toEqual({
      basePrice: 6.5,
      discountPercent: 0,
      tierName: null,
      price: { TRANSFER: 6.5, PAYPHONE: 6.9 },
    });
  });
});

describe("LockerService.confirmReceipt", () => {
  let service: LockerService;
  let prisma: any;
  let audit: { record: jest.Mock };
  let ocr: { extractText: jest.Mock };

  const pendingRental = {
    id: "rental-1",
    userId: "user-1",
    lockerId: "locker-1",
    paymentId: "payment-1",
    payment: { id: "payment-1", method: "TRANSFER", status: "PENDING", amount: 6.5 },
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
    ocr = { extractText: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LockerService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: PayphoneClient, useValue: { confirm: jest.fn(), getPublicConfig: jest.fn() } },
        { provide: OcrService, useValue: ocr },
        { provide: PeriodService, useValue: { getCurrentPeriodId: jest.fn().mockResolvedValue("period-1") } },
        {
          provide: SubscriptionBenefitsService,
          useValue: { getLockerDiscountPercent: jest.fn().mockResolvedValue(0) },
        },
      ],
    }).compile();
    service = moduleRef.get(LockerService);
  });

  it("Dado un alquiler que no existe, Cuando se confirma el comprobante, Entonces lanza NotFoundException", async () => {
    prisma.lockerRental.findUnique.mockResolvedValue(null);

    await expect(service.confirmReceipt("rental-x", "user-1", Buffer.from(""))).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("Dado un alquiler de otro estudiante, Cuando se confirma el comprobante, Entonces lanza ForbiddenException", async () => {
    await expect(service.confirmReceipt("rental-1", "user-otro", Buffer.from(""))).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("Dado que el OCR no encuentra el monto esperado en la imagen, Cuando se confirma, Entonces rechaza sin tocar el pago ni el casillero, y audita el rechazo", async () => {
    ocr.extractText.mockResolvedValue("comprobante ilegible");

    await expect(service.confirmReceipt("rental-1", "user-1", Buffer.from("img"))).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locker.receipt.rejected", entityId: "rental-1" })
    );
  });

  it("Dado que el OCR encuentra el monto esperado, Cuando se confirma, Entonces el pago pasa a CONFIRMED y el casillero a RENTED dentro de la misma transacción", async () => {
    ocr.extractText.mockResolvedValue("Transferencia exitosa por $6.50");

    await service.confirmReceipt("rental-1", "user-1", Buffer.from("img"));

    expect(prisma.__tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "payment-1", status: "PENDING" },
        data: expect.objectContaining({ status: "CONFIRMED" }),
      })
    );
    expect(prisma.__tx.locker.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "RENTED" } })
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locker.receipt.confirmed", entityId: "rental-1" }),
      prisma.__tx
    );
  });

  it("Dado un alquiler ya confirmado, Cuando se intenta confirmar de nuevo, Entonces lanza BadRequestException", async () => {
    prisma.lockerRental.findUnique.mockResolvedValue({
      ...pendingRental,
      payment: { ...pendingRental.payment, status: "CONFIRMED" },
    });

    await expect(service.confirmReceipt("rental-1", "user-1", Buffer.from("img"))).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  // CONCURRENCIA — el chequeo `payment.status !== "PENDING"` de arriba lee
  // ANTES de la transacción, así que dos peticiones para el MISMO
  // comprobante (doble click, reintento de red) pueden pasar ambas ese
  // chequeo antes de que cualquiera escriba. Este test simula justo esa
  // ventana: el mock representa "otra petición ya ganó la carrera y puso
  // status=CONFIRMED entre el findUnique() de esta petición y su propio
  // updateMany()" — el WHERE status:"PENDING" de la transacción real
  // (no simulable con un mock de Prisma, que no tiene estado) es lo que
  // hace esto imposible en producción; aquí se prueba que el servicio SÍ
  // reacciona correctamente cuando ese WHERE no encuentra fila que tocar.
  it("Dado que otra petición ya confirmó el mismo comprobante justo antes de esta transacción (condición de carrera), Cuando updateMany no encuentra ninguna fila PENDING que tocar, Entonces lanza ConflictException y NUNCA toca el casillero", async () => {
    ocr.extractText.mockResolvedValue("Transferencia exitosa por $6.50");
    prisma.__tx.payment.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.confirmReceipt("rental-1", "user-1", Buffer.from("img"))).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(prisma.__tx.locker.update).not.toHaveBeenCalled();
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
    payment: { id: "payment-1", method: "PAYPHONE", status: "PENDING", amount: 6.9 },
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
        { provide: OcrService, useValue: { extractText: jest.fn() } },
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
      amountCents: 690,
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
      amountCents: 100, // el rental espera 690 ($6.90)
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
      amountCents: 690,
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

  // CONCURRENCIA — mismo patrón que confirmReceipt(): simula que otra
  // petición (ej. el usuario recargando la página de respuesta de
  // PayPhone) ya confirmó este mismo pago entre el findUnique() y el
  // updateMany() de esta petición.
  it("Dado que otra petición ya confirmó el mismo pago justo antes (condición de carrera), Cuando updateMany no encuentra ninguna fila PENDING, Entonces lanza ConflictException y NUNCA toca el casillero", async () => {
    payphone.confirm.mockResolvedValue({
      approved: true,
      transactionId: 999,
      clientTransactionId: "rental-1",
      amountCents: 690,
      raw: {},
    });
    prisma.__tx.payment.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.confirmPayphonePayment("rental-1", 999, "user-1")).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(prisma.__tx.locker.update).not.toHaveBeenCalled();
  });
});

describe("LockerService.releaseExpiredTransferReservations", () => {
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
        { provide: OcrService, useValue: { extractText: jest.fn() } },
        { provide: PeriodService, useValue: { getCurrentPeriodId: jest.fn().mockResolvedValue("period-1") } },
        {
          provide: SubscriptionBenefitsService,
          useValue: { getLockerDiscountPercent: jest.fn().mockResolvedValue(0) },
        },
      ],
    }).compile();
    service = moduleRef.get(LockerService);
  });

  it("Dado un alquiler RESERVED por transferencia sin comprobante hace más de 24h, Cuando corre el job, Entonces marca el pago REJECTED, borra el LockerRental (libera @@unique[lockerId,periodId]), pone el casillero AVAILABLE y audita locker.rental.expired", async () => {
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

  // CONCURRENCIA — mismo patrón que confirmReceipt()/confirmPayphonePayment():
  // el estudiante sube el comprobante justo en el instante en que el cron
  // ya había leído esta reserva como "vencida" pero todavía no la liberó.
  it("Dado que el estudiante confirma el pago justo antes de que el job libere esa reserva (condición de carrera), Cuando updateMany no encuentra ninguna fila PENDING, Entonces NO borra el alquiler ni toca el casillero", async () => {
    prisma.__tx.payment.updateMany.mockResolvedValue({ count: 0 });

    const released = await service.releaseExpiredTransferReservations();

    expect(prisma.__tx.lockerRental.delete).not.toHaveBeenCalled();
    expect(prisma.__tx.locker.update).not.toHaveBeenCalled();
    expect(released).toBe(0);
  });
});
