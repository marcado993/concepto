import { Test } from "@nestjs/testing";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { LockerService, LockerUnavailableError } from "./locker.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { PeriodService } from "../shared/period/period.service";
import { SubscriptionBenefitsService } from "../subscription/subscription-benefits.service";
import { MailService } from "../shared/mail/mail.service";

// El periodo activo real, no solo su id: el texto de términos que el
// estudiante firma y la etiqueta con que se archiva esa aceptación salen
// de acá (ver PeriodService.getCurrentPeriod — antes el semestre estaba
// escrito a mano en el modal y nombraba uno que ya no era el vigente).
const TEST_PERIOD = {
  id: "period-1",
  label: "2026-B",
  startsAt: new Date("2026-09-01T00:00:00Z"),
  endsAt: new Date("2027-02-28T00:00:00Z"),
  lockerBasePrice: 6.5,
};

function makePeriodMock() {
  return {
    getCurrentPeriodId: jest.fn().mockResolvedValue(TEST_PERIOD.id),
    getCurrentPeriod: jest.fn().mockResolvedValue(TEST_PERIOD),
  };
}

describe("LockerService.rent", () => {
  let service: LockerService;
  let prisma: any;
  let audit: { record: jest.Mock };
  let payphone: { confirm: jest.Mock; getPublicConfig: jest.Mock };
  let subscriptionBenefits: { getLockerDiscountPercent: jest.Mock; getLockerDiscountInfo: jest.Mock };
  let period: ReturnType<typeof makePeriodMock>;

  const locker = { id: "locker-1", code: "A07", zone: "A", status: "AVAILABLE" };
  const params = {
    userId: "user-1",
    lockerCode: "A07",
    fullName: "Luis Andres Guerrero",
    uniqueCode: "AEIS-2026-001",
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
      // findFirst → null por defecto = el estudiante NO tiene ninguna
      // reserva activa (el caso normal). El guard "un casillero por
      // estudiante" lo usa; un test específico más abajo lo hace devolver
      // una reserva activa para probar el rechazo.
      lockerRental: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
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
    period = makePeriodMock();

    const moduleRef = await Test.createTestingModule({
      providers: [
        LockerService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: PayphoneClient, useValue: payphone },
        { provide: PeriodService, useValue: period },
        { provide: SubscriptionBenefitsService, useValue: subscriptionBenefits },
        { provide: MailService, useValue: { send: jest.fn().mockResolvedValue(undefined) } },
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

  // Hallazgo de pentesting (lógica de negocio, invisible a los escáneres):
  // sin este guard un mismo estudiante podía reservar casillero tras
  // casillero (el @@unique es por [lockerId, periodId], no por usuario) y,
  // como una reserva PayPhone sin pagar no la liberaba ningún cron, acaparar
  // los 108 y negárselos a los ~1700 restantes sin pagar nada.
  it("Dado un estudiante que YA tiene una reserva activa este semestre, Cuando intenta alquilar OTRO casillero, Entonces se rechaza con ConflictException — nunca crea un segundo alquiler", async () => {
    prisma.lockerRental.findFirst.mockResolvedValue({
      id: "rental-previo",
      locker: { code: "A03" },
      payment: { status: "PENDING" },
    });

    await expect(service.rent(params)).rejects.toBeInstanceOf(ConflictException);
    // Ni siquiera llega a tocar la mutación de dinero.
    expect(prisma.__tx.payment.create).not.toHaveBeenCalled();
    expect(prisma.__tx.lockerRental.create).not.toHaveBeenCalled();
  });

  it("Dado un estudiante con una reserva PENDING del MISMO casillero (salió del widget de PayPhone sin pagar), Cuando lo intenta de nuevo, Entonces retoma esa reserva en vez de bloquear ni crear una nueva", async () => {
    prisma.lockerRental.findFirst.mockResolvedValue({
      id: "rental-previo",
      locker: { code: params.lockerCode },
      payment: { status: "PENDING" },
    });

    const result = await service.rent(params);

    expect(result).toEqual(
      expect.objectContaining({ id: "rental-previo", locker: { code: params.lockerCode }, payment: { status: "PENDING" } })
    );
    // No crea un Payment/LockerRental nuevo — retoma el que ya existía.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.__tx.payment.create).not.toHaveBeenCalled();
    expect(prisma.__tx.lockerRental.create).not.toHaveBeenCalled();
  });

  it("Dado un estudiante con una reserva ya CONFIRMED del mismo casillero, Cuando lo intenta de nuevo, Entonces igual rechaza — retomar es solo para pagos PENDING, no para repetir uno ya pagado", async () => {
    prisma.lockerRental.findFirst.mockResolvedValue({
      id: "rental-previo",
      locker: { code: params.lockerCode },
      payment: { status: "CONFIRMED" },
    });

    await expect(service.rent(params)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.__tx.lockerRental.create).not.toHaveBeenCalled();
  });

  it("Dado un estudiante cuya reserva anterior venció (pago REJECTED, no cuenta como activa), Cuando alquila de nuevo, Entonces sí puede — el guard solo bloquea reservas PENDING/CONFIRMED", async () => {
    // findFirst filtra por status IN (PENDING, CONFIRMED); una REJECTED no
    // la devuelve, así que el mock default (null) representa este caso.
    prisma.lockerRental.findFirst.mockResolvedValue(null);

    await expect(service.rent(params)).resolves.toBeDefined();
    expect(prisma.__tx.lockerRental.create).toHaveBeenCalled();
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
        metadata: expect.objectContaining({ termsAccepted: true, termsVersion: "2026-B-v1" }),
      }),
      prisma.__tx
    );
  });

  // Hallazgo real de auditoría: termsVersion era la constante escrita a
  // mano "2026-A-v1" mientras el periodo activo en producción ya era
  // 2026-B — o sea que cada aceptación se archivaba con la etiqueta del
  // semestre equivocado, y el modal le mostraba al estudiante ese mismo
  // semestre incorrecto. Este test fija que la etiqueta SIGA al periodo
  // real: si vuelve a quedar fija, falla acá y no seis meses después en
  // un AuditLog que ya no se puede corregir.
  it("Dado que cambia el periodo activo, Cuando se alquila, Entonces la versión de términos archivada sigue al periodo real — nunca una constante fija", async () => {
    period.getCurrentPeriod.mockResolvedValue({ ...TEST_PERIOD, label: "2027-A" });

    await service.rent(params);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ termsVersion: "2027-A-v1" }),
      }),
      prisma.__tx
    );
  });

  // Nombre/cédula/celular/código único se piden una sola vez (ver
  // comentario en RentLockerModal.svelte) — el alquiler es el punto donde
  // se guardan en User, para que el siguiente semestre no haya que volver
  // a pedirlos.
  it("Dado nombre, cédula, celular y código único, Cuando alquila, Entonces los guarda en User para no volver a pedirlos", async () => {
    await service.rent(params);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { fullName: "Luis Andres Guerrero", cedula: "1723456789", phone: "0991234567", uniqueCode: "AEIS-2026-001" },
    });
  });

  it("Dado un código único que ya usa OTRO estudiante, Cuando alquila, Entonces rechaza con BadRequestException (mensaje claro, no un 500 crudo)", async () => {
    const dbError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.4.1",
    });
    prisma.user.update.mockRejectedValue(dbError);

    await expect(service.rent(params)).rejects.toBeInstanceOf(BadRequestException);
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
        { provide: PeriodService, useValue: makePeriodMock() },
        { provide: SubscriptionBenefitsService, useValue: subscriptionBenefits },
        { provide: MailService, useValue: { send: jest.fn().mockResolvedValue(undefined) } },
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
      period: { label: "2026-B", endsAt: TEST_PERIOD.endsAt.toISOString() },
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
      period: { label: "2026-B", endsAt: TEST_PERIOD.endsAt.toISOString() },
    });
  });
});

describe("LockerService.confirmPayphonePayment", () => {
  let service: LockerService;
  let prisma: any;
  let audit: { record: jest.Mock };
  let payphone: { confirm: jest.Mock; getPublicConfig: jest.Mock };
  let mail: { send: jest.Mock };

  const pendingRental = {
    id: "rental-1",
    userId: "user-1",
    lockerId: "locker-1",
    periodId: "period-1",
    paymentId: "payment-1",
    payment: { id: "payment-1", method: "PAYPHONE", status: "PENDING", amount: 6.5 },
    locker: { id: "locker-1", code: "A07" },
  };

  const contractUser = {
    id: "user-1",
    fullName: "luis andres guerrero",
    cedula: "1723456789",
    uniqueCode: "AEIS-2026-001",
    email: "luis@epn.edu.ec",
  };

  beforeEach(async () => {
    const tx = {
      payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      locker: { update: jest.fn().mockResolvedValue({ id: "locker-1", status: "RENTED" }) },
    };
    prisma = {
      lockerRental: { findUnique: jest.fn().mockResolvedValue(pendingRental) },
      user: { findUnique: jest.fn().mockResolvedValue(contractUser) },
      locker: { findUnique: jest.fn().mockResolvedValue({ id: "locker-1", code: "A07" }) },
      period: { findUnique: jest.fn().mockResolvedValue(TEST_PERIOD) },
      $transaction: jest.fn((cb: any) => cb(tx)),
      __tx: tx,
    };
    audit = { record: jest.fn().mockResolvedValue({ id: "log-1" }) };
    payphone = { confirm: jest.fn(), getPublicConfig: jest.fn() };
    mail = { send: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LockerService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: PayphoneClient, useValue: payphone },
        { provide: PeriodService, useValue: makePeriodMock() },
        {
          provide: SubscriptionBenefitsService,
          useValue: { getLockerDiscountPercent: jest.fn().mockResolvedValue(0) },
        },
        { provide: MailService, useValue: mail },
      ],
    }).compile();
    service = moduleRef.get(LockerService);
  });

  function approvePayphone() {
    payphone.confirm.mockResolvedValue({
      approved: true,
      transactionId: 999,
      clientTransactionId: "rental-1",
      amountCents: 650,
      raw: {},
    });
  }

  // Hallazgo de pentesting anterior en esta misma auditoría: el contrato es
  // justo el mecanismo que el cliente pidió para tener el nombre del
  // estudiante EN MAYÚSCULA INICIAL, sin importar cómo lo haya escrito
  // Logto/GitHub/Google (a veces todo en minúscula).
  it("Dado un pago aprobado, Cuando se confirma, Entonces manda el contrato por correo con el nombre en Title Case y los datos reales del alquiler", async () => {
    approvePayphone();

    await service.confirmPayphonePayment("rental-1", 999, "user-1");

    expect(mail.send).toHaveBeenCalledTimes(1);
    const call = mail.send.mock.calls[0][0];
    expect(call.to).toBe("luis@epn.edu.ec");
    expect(call.cc).toBe("aeis.fis.epn@gmail.com"); // AEIS también queda con copia de cada contrato
    expect(call.subject).toContain("A07");
    expect(call.html).toContain("Luis Andres Guerrero"); // title case, no "luis andres guerrero"
    expect(call.html).toContain("1723456789");
    expect(call.html).toContain("AEIS-2026-001");
    expect(call.html).toContain("A07");
  });

  it("Dado un pago aprobado, Cuando se confirma, Entonces adjunta el contrato como PDF real (no solo el HTML del cuerpo)", async () => {
    approvePayphone();

    await service.confirmPayphonePayment("rental-1", 999, "user-1");

    const call = mail.send.mock.calls[0][0];
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments[0].filename).toBe("contrato-casillero-A07.pdf");
    expect(Buffer.isBuffer(call.attachments[0].content)).toBe(true);
    expect(call.attachments[0].content.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("Dado un pago aprobado, Cuando se manda el contrato con éxito, Entonces audita locker.contract.sent", async () => {
    approvePayphone();

    await service.confirmPayphonePayment("rental-1", 999, "user-1");

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locker.contract.sent", entityId: "rental-1" })
    );
  });

  // El correo NUNCA debe poder tumbar un pago que YA se confirmó de verdad
  // contra PayPhone — mismo principio que AlertService: una notificación
  // que falla se audita y se loguea, no revierte la transacción de dinero.
  it("Dado que Resend rechaza el envío, Cuando se confirma el pago, Entonces el alquiler queda CONFIRMED/RENTED igual, sin lanzar, y audita locker.contract.send_failed", async () => {
    approvePayphone();
    mail.send.mockRejectedValue(new Error("dominio no verificado"));

    const result = await service.confirmPayphonePayment("rental-1", 999, "user-1");

    expect(result.locker.status).toBe("RENTED");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locker.contract.send_failed", entityId: "rental-1" })
    );
  });

  it("Dado un usuario sin correo guardado (caso legacy), Cuando se confirma el pago, Entonces NO intenta mandar nada y el alquiler queda confirmado igual", async () => {
    approvePayphone();
    prisma.user.findUnique.mockResolvedValue({ ...contractUser, email: null });

    const result = await service.confirmPayphonePayment("rental-1", 999, "user-1");

    expect(mail.send).not.toHaveBeenCalled();
    expect(result.locker.status).toBe("RENTED");
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
        { provide: PeriodService, useValue: makePeriodMock() },
        {
          provide: SubscriptionBenefitsService,
          useValue: { getLockerDiscountPercent: jest.fn().mockResolvedValue(0) },
        },
        { provide: MailService, useValue: { send: jest.fn().mockResolvedValue(undefined) } },
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

// Hallazgo de pentesting: el cron legacy solo liberaba reservas TRANSFER,
// pero desde el retiro de la transferencia TODAS las reservas nuevas son
// PAYPHONE — y ninguna tarea las liberaba, así que una reserva sin pagar
// quedaba retenida para siempre. Este cron nuevo cierra ese hueco: es la
// otra mitad del guard "un casillero por estudiante" en rent().
describe("LockerService.releaseExpiredPayphoneReservations", () => {
  let service: LockerService;
  let prisma: any;
  let audit: { record: jest.Mock };

  const expiredRental = {
    id: "rental-pp",
    userId: "user-9",
    lockerId: "locker-9",
    paymentId: "payment-9",
    locker: { id: "locker-9", code: "C05" },
  };

  beforeEach(async () => {
    const tx = {
      payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      lockerRental: { delete: jest.fn().mockResolvedValue({}) },
      locker: { update: jest.fn().mockResolvedValue({ id: "locker-9", status: "AVAILABLE" }) },
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
        { provide: PeriodService, useValue: makePeriodMock() },
        { provide: SubscriptionBenefitsService, useValue: { getLockerDiscountPercent: jest.fn().mockResolvedValue(0) } },
        { provide: MailService, useValue: { send: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = moduleRef.get(LockerService);
  });

  it("Dado un RESERVED de PayPhone que quedó PENDING más allá de la ventana de gracia, Cuando corre el job, Entonces lo libera (pago REJECTED, alquiler borrado, casillero AVAILABLE) y audita con reason pago_no_completado", async () => {
    const released = await service.releaseExpiredPayphoneReservations();

    expect(prisma.lockerRental.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ payment: { method: "PAYPHONE", status: "PENDING" } }),
      })
    );
    expect(prisma.__tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "payment-9", status: "PENDING" }, data: { status: "REJECTED" } })
    );
    expect(prisma.__tx.lockerRental.delete).toHaveBeenCalledWith({ where: { id: "rental-pp" } });
    expect(prisma.__tx.locker.update).toHaveBeenCalledWith({ where: { id: "locker-9" }, data: { status: "AVAILABLE" } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "locker.rental.expired",
        metadata: expect.objectContaining({ lockerCode: "C05", reason: "pago_no_completado" }),
      }),
      prisma.__tx
    );
    expect(released).toBe(1);
  });

  it("Dado que el estudiante confirma el pago justo antes de que el job lo libere (carrera), Cuando updateMany no encuentra fila PENDING, Entonces NO borra el alquiler ni toca el casillero", async () => {
    prisma.__tx.payment.updateMany.mockResolvedValue({ count: 0 });

    const released = await service.releaseExpiredPayphoneReservations();

    expect(prisma.__tx.lockerRental.delete).not.toHaveBeenCalled();
    expect(prisma.__tx.locker.update).not.toHaveBeenCalled();
    expect(released).toBe(0);
  });
});

describe("LockerService.list", () => {
  let service: LockerService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { locker: { findMany: jest.fn() } };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LockerService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: PayphoneClient, useValue: { confirm: jest.fn(), getPublicConfig: jest.fn() } },
        { provide: PeriodService, useValue: makePeriodMock() },
        { provide: SubscriptionBenefitsService, useValue: { getLockerDiscountInfo: jest.fn() } },
        { provide: MailService, useValue: { send: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = moduleRef.get(LockerService);
  });

  // Hallazgo real: los casilleros reales se identifican SOLO por número
  // (ver prisma/seed.ts, "los casilleros solo están por número, no por a b
  // c d"), sin cero a la izquierda — un orden alfabético de `code` pone
  // "100" antes que "2" (compara texto, no número). La grilla debe verse
  // en el orden real 1, 2, ..., 100, 101, ...
  it("Dado casilleros con códigos numéricos de distinto largo, Cuando se listan, Entonces el orden es NUMÉRICO (2 antes que 100), no alfabético", async () => {
    prisma.locker.findMany.mockResolvedValue([
      { id: "l-100", code: "100", zone: "General", status: "AVAILABLE" },
      { id: "l-2", code: "2", zone: "General", status: "AVAILABLE" },
      { id: "l-11", code: "11", zone: "General", status: "AVAILABLE" },
      { id: "l-1", code: "1", zone: "General", status: "AVAILABLE" },
    ]);

    const result = await service.list();

    expect(result.map((l) => l.code)).toEqual(["1", "2", "11", "100"]);
  });

  it("Dado casilleros en zonas distintas, Cuando se listan, Entonces agrupa primero por zona (alfabético) y dentro de cada zona por número", async () => {
    prisma.locker.findMany.mockResolvedValue([
      { id: "l-b2", code: "2", zone: "B", status: "AVAILABLE" },
      { id: "l-a10", code: "10", zone: "A", status: "AVAILABLE" },
      { id: "l-a2", code: "2", zone: "A", status: "AVAILABLE" },
    ]);

    const result = await service.list();

    expect(result.map((l) => `${l.zone}${l.code}`)).toEqual(["A2", "A10", "B2"]);
  });
});

describe("LockerService.getMyRentedLocker", () => {
  let service: LockerService;
  let prisma: any;
  let period: ReturnType<typeof makePeriodMock>;

  beforeEach(async () => {
    prisma = { lockerRental: { findFirst: jest.fn() } };
    period = makePeriodMock();

    const moduleRef = await Test.createTestingModule({
      providers: [
        LockerService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: PayphoneClient, useValue: { confirm: jest.fn(), getPublicConfig: jest.fn() } },
        { provide: PeriodService, useValue: period },
        { provide: SubscriptionBenefitsService, useValue: { getLockerDiscountInfo: jest.fn() } },
        { provide: MailService, useValue: { send: jest.fn().mockResolvedValue(undefined) } },
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
