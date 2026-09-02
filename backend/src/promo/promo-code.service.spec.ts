import { Test } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PromoCodeService, normalizar, MAX_POR_LOTE } from "./promo-code.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";

function buildPrisma() {
  return {
    promoCode: {
      create: jest.fn().mockImplementation(({ data }: any) => ({
        id: "p1",
        note: null,
        expiresAt: null,
        createdAt: new Date("2026-09-02T00:00:00Z"),
        redeemedAt: null,
        ...data,
      })),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
  };
}

async function buildService(prisma = buildPrisma()) {
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const moduleRef = await Test.createTestingModule({
    providers: [
      PromoCodeService,
      { provide: PrismaService, useValue: prisma },
      { provide: AuditService, useValue: audit },
    ],
  }).compile();
  return { service: moduleRef.get(PromoCodeService), prisma, audit };
}

describe("PromoCodeService.generarCodigo", () => {
  it("Dado un codigo generado, Cuando se inspecciona, Entonces tiene el formato AEIS-XXXX-XXXX", async () => {
    const { service } = await buildService();

    expect(service.generarCodigo()).toMatch(/^AEIS-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  // Estos codigos se dictan por WhatsApp y se copian a mano de un correo.
  // 0/O y 1/I/L son indistinguibles en casi cualquier tipografia, y un
  // codigo que no se puede leer sin equivocarse genera "no me funciona"
  // que en realidad son erratas.
  it("Dados muchos codigos, Cuando se inspeccionan, Entonces NUNCA contienen caracteres ambiguos (0 O 1 I L)", async () => {
    const { service } = await buildService();

    for (let i = 0; i < 300; i += 1) {
      expect(service.generarCodigo().slice(5)).not.toMatch(/[01OIL]/);
    }
  });

  // Un codigo del 100% es un casillero gratis: si el generador fuera
  // predecible, conociendo unos pocos emitidos se podrian adivinar los
  // siguientes. Este test no prueba la calidad criptografica (para eso
  // esta randomInt), pero si detecta el error obvio de un generador que
  // repite.
  it("Dados 500 codigos, Cuando se generan, Entonces no se repite ninguno", async () => {
    const { service } = await buildService();
    const vistos = new Set<string>();

    for (let i = 0; i < 500; i += 1) vistos.add(service.generarCodigo());

    expect(vistos.size).toBe(500);
  });
});

describe("PromoCodeService.crearLote", () => {
  it("Dada una cantidad, Cuando se crea el lote, Entonces devuelve esa cantidad de codigos", async () => {
    const { service } = await buildService();

    const codigos = await service.crearLote({ cantidad: 5, discountPercent: 50, adminActorId: "admin-1" });

    expect(codigos).toHaveLength(5);
    expect(codigos[0].discountPercent).toBe(50);
  });

  // Se audita el LOTE y no cada codigo: lo que hay que poder reconstruir
  // despues es "quien autorizo regalar N casilleros y cuando".
  it("Cuando se crea un lote, Entonces queda UNA entrada de auditoria con quien, cuanto y que codigos", async () => {
    const { service, audit } = await buildService();

    await service.crearLote({ cantidad: 3, discountPercent: 100, adminActorId: "admin-1", ipAddress: "10.0.0.1" });

    expect(audit.record).toHaveBeenCalledTimes(1);
    const arg = audit.record.mock.calls[0][0];
    expect(arg.adminActorId).toBe("admin-1");
    expect(arg.action).toBe("admin.promo_code.batch_created");
    expect(arg.metadata.codigos).toHaveLength(3);
    expect(arg.metadata.discountPercent).toBe(100);
  });

  // Un cero de mas no puede convertirse en 10 000 casilleros regalados.
  it.each([[0], [-1], [MAX_POR_LOTE + 1], [10_000]])(
    "Dada la cantidad invalida %p, Cuando se crea el lote, Entonces se rechaza",
    async (cantidad) => {
      const { service, prisma } = await buildService();

      await expect(
        service.crearLote({ cantidad, discountPercent: 50, adminActorId: "admin-1" })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.promoCode.create).not.toHaveBeenCalled();
    }
  );

  it.each([[0], [101], [-10], [50.5]])(
    "Dado el descuento invalido %p, Cuando se crea el lote, Entonces se rechaza",
    async (discountPercent) => {
      const { service } = await buildService();

      await expect(
        service.crearLote({ cantidad: 1, discountPercent, adminActorId: "admin-1" })
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  );

  it("Dado el 100% (casillero gratis), Cuando se crea, Entonces se acepta — es un caso valido y deliberado", async () => {
    const { service } = await buildService();

    await expect(
      service.crearLote({ cantidad: 1, discountPercent: 100, adminActorId: "admin-1" })
    ).resolves.toHaveLength(1);
  });

  // Una colision en 31^8 es improbabilisima, pero el modo de falla seria un
  // 500 opaco justo cuando la directiva esta generando codigos para
  // repartir.
  it("Dada una colision de codigo, Cuando se crea, Entonces reintenta con otro en vez de fallar", async () => {
    const prisma = buildPrisma();
    const p2002 = new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "t" });
    prisma.promoCode.create
      .mockRejectedValueOnce(p2002)
      .mockImplementationOnce(({ data }: any) => ({
        id: "p1",
        note: null,
        expiresAt: null,
        createdAt: new Date(),
        redeemedAt: null,
        ...data,
      }));
    const { service } = await buildService(prisma);

    await expect(
      service.crearLote({ cantidad: 1, discountPercent: 20, adminActorId: "admin-1" })
    ).resolves.toHaveLength(1);
    expect(prisma.promoCode.create).toHaveBeenCalledTimes(2);
  });

  it("Dado un error que NO es colision, Cuando se crea, Entonces se propaga tal cual", async () => {
    const prisma = buildPrisma();
    const boom = new Error("conexion perdida");
    prisma.promoCode.create.mockRejectedValue(boom);
    const { service } = await buildService(prisma);

    await expect(service.crearLote({ cantidad: 1, discountPercent: 20, adminActorId: "admin-1" })).rejects.toBe(boom);
  });
});

describe("PromoCodeService.verificar", () => {
  it("Dado un codigo valido, Cuando se verifica, Entonces devuelve su descuento", async () => {
    const prisma = buildPrisma();
    prisma.promoCode.findUnique.mockResolvedValue({ discountPercent: 50, redeemedAt: null, expiresAt: null });
    const { service } = await buildService(prisma);

    await expect(service.verificar("AEIS-ABCD-2345")).resolves.toEqual({ valido: true, discountPercent: 50 });
  });

  // Devuelve un motivo legible en vez de lanzar: aca "no sirve" es una
  // respuesta esperada del formulario, no un error del sistema.
  it.each([
    [null, "no existe"],
    [{ discountPercent: 50, redeemedAt: new Date(), expiresAt: null }, "ya fue usado"],
    [{ discountPercent: 50, redeemedAt: null, expiresAt: new Date("2020-01-01") }, "ya venci"],
  ])("Dado un codigo no utilizable, Cuando se verifica, Entonces explica por que (%#)", async (fila, esperado) => {
    const prisma = buildPrisma();
    prisma.promoCode.findUnique.mockResolvedValue(fila);
    const { service } = await buildService(prisma);

    const r = await service.verificar("AEIS-ABCD-2345");

    expect(r.valido).toBe(false);
    expect(r.discountPercent).toBe(0);
    expect(r.motivo).toContain(esperado);
  });
});

describe("PromoCodeService.canjear", () => {
  function buildTx(overrides: Record<string, unknown> = {}) {
    return {
      promoCode: {
        findUnique: jest.fn().mockResolvedValue({ discountPercent: 50, expiresAt: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        ...overrides,
      },
    } as any;
  }

  it("Dado un codigo valido, Cuando se canjea, Entonces devuelve su descuento y lo marca usado", async () => {
    const { service } = await buildService();
    const tx = buildTx();

    await expect(
      service.canjear(tx, { code: "AEIS-ABCD-2345", userId: "u1", rentalId: "r1" })
    ).resolves.toBe(50);
    const args = tx.promoCode.updateMany.mock.calls[0][0];
    expect(args.data).toEqual(
      expect.objectContaining({ redeemedByUserId: "u1", redeemedRentalId: "r1", redeemedAt: expect.any(Date) })
    );
  });

  // LA pieza clave: sin `redeemedAt: null` en el WHERE, dos alquileres
  // simultaneos con el mismo codigo pasan ambos la comprobacion previa y lo
  // usan los dos. Con el, Postgres decide y solo uno ve count===1.
  it("Cuando se canjea, Entonces el UPDATE exige redeemedAt=null — es lo que impide el doble uso bajo carrera", async () => {
    const { service } = await buildService();
    const tx = buildTx();

    await service.canjear(tx, { code: "AEIS-ABCD-2345", userId: "u1", rentalId: "r1" });

    expect(tx.promoCode.updateMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ redeemedAt: null })
    );
  });

  it("Dado que OTRA transaccion gano la carrera (count=0), Cuando se canjea, Entonces falla con 'ya fue usado'", async () => {
    const { service } = await buildService();
    const tx = buildTx({ updateMany: jest.fn().mockResolvedValue({ count: 0 }) });

    await expect(service.canjear(tx, { code: "AEIS-ABCD-2345", userId: "u1", rentalId: "r1" })).rejects.toThrow(
      /ya fue usado/i
    );
  });

  it("Dado un codigo inexistente, Cuando se canjea, Entonces falla sin tocar la tabla", async () => {
    const { service } = await buildService();
    const tx = buildTx({ findUnique: jest.fn().mockResolvedValue(null) });

    await expect(service.canjear(tx, { code: "AEIS-XXXX-XXXX", userId: "u1", rentalId: "r1" })).rejects.toThrow(
      /no existe/i
    );
    expect(tx.promoCode.updateMany).not.toHaveBeenCalled();
  });

  it("Dado un codigo vencido, Cuando se canjea, Entonces falla sin marcarlo usado", async () => {
    const { service } = await buildService();
    const tx = buildTx({
      findUnique: jest.fn().mockResolvedValue({ discountPercent: 50, expiresAt: new Date("2020-01-01") }),
    });

    await expect(service.canjear(tx, { code: "AEIS-ABCD-2345", userId: "u1", rentalId: "r1" })).rejects.toThrow(
      /venci/i
    );
    expect(tx.promoCode.updateMany).not.toHaveBeenCalled();
  });
});

describe("normalizar", () => {
  // Los codigos se dictan y se copian a mano: llegan en minusculas, con
  // espacios del portapapeles o sin los guiones. Nada de eso deberia ser un
  // "codigo invalido".
  it.each([
    ["AEIS-ABCD-2345"],
    ["aeis-abcd-2345"],
    ["AEISABCD2345"],
    ["  AEIS ABCD 2345  "],
    ["aeis abcd2345"],
    ["AEIS_ABCD_2345"],
  ])("Dado %p escrito por el estudiante, Cuando se normaliza, Entonces da el mismo codigo canonico", (entrada) => {
    expect(normalizar(entrada)).toBe("AEIS-ABCD-2345");
  });

  it("Dada una cadena vacia, Cuando se normaliza, Entonces no revienta", () => {
    expect(normalizar("")).toBe("AEIS");
  });
});
