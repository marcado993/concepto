import { Prisma } from "@prisma/client";
import { executeMoneyMutation } from "./money-mutation.helper";

// Fábrica de un error real de Prisma con code P2002 — no un objeto plano
// con esa forma, sino una instancia REAL de la clase que
// `err instanceof Prisma.PrismaClientKnownRequestError` de verdad
// reconoce. Un mock plano habría dejado pasar un bug real (el `instanceof`
// del helper nunca dispara) sin que ningún test lo notara.
function makeP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

function buildDeps() {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { payment: { create: jest.fn() } };
      return fn(tx);
    }),
  };
  return { prisma: prisma as any, audit: audit as any };
}

describe("executeMoneyMutation — camino feliz", () => {
  it("Dado que createEntity y el audit tienen éxito, Cuando se ejecuta, Entonces crea el Payment PENDING, la entidad, audita DENTRO de la misma tx y devuelve la entidad", async () => {
    const { prisma, audit } = buildDeps();
    let paymentCreateCall: unknown;
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        payment: {
          create: jest.fn((args: unknown) => {
            paymentCreateCall = args;
            return { id: "payment-1" };
          }),
        },
      };
      return fn(tx);
    });

    const result = await executeMoneyMutation(
      { prisma, audit },
      {
        userId: "user-1",
        amount: 6.5,
        method: "PAYPHONE",
        auditAction: "locker.rental.created",
        auditEntityType: "LockerRental",
        entityId: (e: { id: string }) => e.id,
        createEntity: async (_tx, paymentId) => ({ id: "rental-1", paymentId }),
        onConflict: () => {
          throw new Error("no debería llamarse");
        },
      }
    );

    expect(result).toEqual({ id: "rental-1", paymentId: "payment-1" });
    expect((paymentCreateCall as any).data).toEqual(
      expect.objectContaining({ userId: "user-1", amount: 6.5, method: "PAYPHONE", status: "PENDING", confirmedAt: null })
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "user-1", action: "locker.rental.created", entityId: "rental-1" }),
      expect.anything()
    );
  });

  it("Dado autoConfirm:true (ej. aportaciones — informativas, sin pasarela real), Cuando se ejecuta, Entonces el Payment se crea YA CONFIRMED con confirmedAt puesto, sin pasar por PENDING", async () => {
    const { prisma, audit } = buildDeps();
    let paymentCreateCall: unknown;
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        payment: {
          create: jest.fn((args: unknown) => {
            paymentCreateCall = args;
            return { id: "payment-1" };
          }),
        },
      };
      return fn(tx);
    });

    await executeMoneyMutation(
      { prisma, audit },
      {
        userId: "user-1",
        amount: 19.99,
        method: "INFORMATIVE",
        auditAction: "subscription.created",
        auditEntityType: "Subscription",
        entityId: () => "sub-1",
        autoConfirm: true,
        createEntity: async () => ({ id: "sub-1" }),
        onConflict: () => {
          throw new Error("no debería llamarse");
        },
      }
    );

    expect((paymentCreateCall as any).data).toEqual(
      expect.objectContaining({ status: "CONFIRMED", confirmedAt: expect.any(Date) })
    );
  });

  it("Dado autoConfirm ausente/false (default — ej. lockers, que SÍ pasan por PayPhone), Cuando se ejecuta, Entonces sigue creando el Payment como PENDING sin confirmedAt — el default NUNCA cambió por agregar la opción", async () => {
    const { prisma, audit } = buildDeps();
    let paymentCreateCall: unknown;
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        payment: {
          create: jest.fn((args: unknown) => {
            paymentCreateCall = args;
            return { id: "payment-1" };
          }),
        },
      };
      return fn(tx);
    });

    await executeMoneyMutation(
      { prisma, audit },
      {
        userId: "user-1",
        amount: 6.5,
        method: "PAYPHONE",
        auditAction: "locker.rental.created",
        auditEntityType: "LockerRental",
        entityId: () => "rental-1",
        createEntity: async () => ({ id: "rental-1" }),
        onConflict: () => {
          throw new Error("no debería llamarse");
        },
      }
    );

    expect((paymentCreateCall as any).data).toEqual(expect.objectContaining({ status: "PENDING", confirmedAt: null }));
  });

  it("Dado auditMetadata, Cuando se ejecuta, Entonces sus campos se fusionan CON method/amount, no los reemplazan", async () => {
    const { prisma, audit } = buildDeps();
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { payment: { create: jest.fn(() => ({ id: "payment-1" })) } };
      return fn(tx);
    });

    await executeMoneyMutation(
      { prisma, audit },
      {
        userId: "user-1",
        amount: 6.5,
        method: "PAYPHONE",
        auditAction: "locker.rental.created",
        auditEntityType: "LockerRental",
        entityId: () => "rental-1",
        auditMetadata: () => ({ lockerCode: "A07" }),
        createEntity: async () => ({}),
        onConflict: () => {
          throw new Error("no debería llamarse");
        },
      }
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { method: "PAYPHONE", amount: 6.5, lockerCode: "A07" } }),
      expect.anything()
    );
  });
});

describe("executeMoneyMutation — conflicto de unicidad (P2002)", () => {
  it("Dado que createEntity lanza P2002 (ej. @@unique[lockerId, periodId] bajo carrera real), Cuando se ejecuta, Entonces llama a onConflict() en vez de dejar pasar el error crudo de Postgres", async () => {
    const { prisma, audit } = buildDeps();
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { payment: { create: jest.fn(() => ({ id: "payment-1" })) } };
      return fn(tx);
    });

    class LockerUnavailableError extends Error {}
    await expect(
      executeMoneyMutation(
        { prisma, audit },
        {
          userId: "user-1",
          amount: 6.5,
          method: "PAYPHONE",
          auditAction: "locker.rental.created",
          auditEntityType: "LockerRental",
          entityId: () => "rental-1",
          createEntity: async () => {
            throw makeP2002();
          },
          onConflict: () => {
            throw new LockerUnavailableError("casillero ya tomado");
          },
        }
      )
    ).rejects.toBeInstanceOf(LockerUnavailableError);
  });

  it("Dado que onConflict() no lanza nada (bug de implementación del llamador), Cuando P2002 ocurre, Entonces el error P2002 original se re-lanza igual — nunca se traga en silencio", async () => {
    const { prisma, audit } = buildDeps();
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { payment: { create: jest.fn(() => ({ id: "payment-1" })) } };
      return fn(tx);
    });

    await expect(
      executeMoneyMutation(
        { prisma, audit },
        {
          userId: "user-1",
          amount: 6.5,
          method: "PAYPHONE",
          auditAction: "locker.rental.created",
          auditEntityType: "LockerRental",
          entityId: () => "rental-1",
          createEntity: async () => {
            throw makeP2002();
          },
          // onConflict con tipo `() => never` en el helper real, pero un
          // llamador mal escrito podría no lanzar — el helper no debe
          // devolver `undefined` silenciosamente en ese caso.
          onConflict: (() => {}) as unknown as () => never,
        }
      )
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("Dado un error de Prisma con OTRO código (ej. P2003, violación de FK), Cuando ocurre, Entonces NUNCA llama a onConflict — solo P2002 es 'conflicto de unicidad'", async () => {
    const { prisma, audit } = buildDeps();
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { payment: { create: jest.fn(() => ({ id: "payment-1" })) } };
      return fn(tx);
    });
    const onConflict = jest.fn(() => {
      throw new Error("no debería llamarse para P2003");
    });
    const p2003 = new Prisma.PrismaClientKnownRequestError("FK violation", { code: "P2003", clientVersion: "test" });

    await expect(
      executeMoneyMutation(
        { prisma, audit },
        {
          userId: "user-1",
          amount: 6.5,
          method: "PAYPHONE",
          auditAction: "locker.rental.created",
          auditEntityType: "LockerRental",
          entityId: () => "rental-1",
          createEntity: async () => {
            throw p2003;
          },
          onConflict,
        }
      )
    ).rejects.toBe(p2003);
    expect(onConflict).not.toHaveBeenCalled();
  });

  it("Dado un error que NO es de Prisma (ej. un bug de JS dentro de createEntity), Cuando ocurre, Entonces se re-lanza tal cual — nunca se confunde con un conflicto de unicidad", async () => {
    const { prisma, audit } = buildDeps();
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { payment: { create: jest.fn(() => ({ id: "payment-1" })) } };
      return fn(tx);
    });
    const onConflict = jest.fn(() => {
      throw new Error("no debería llamarse");
    });
    const boom = new TypeError("cannot read property of undefined");

    await expect(
      executeMoneyMutation(
        { prisma, audit },
        {
          userId: "user-1",
          amount: 6.5,
          method: "PAYPHONE",
          auditAction: "locker.rental.created",
          auditEntityType: "LockerRental",
          entityId: () => "rental-1",
          createEntity: async () => {
            throw boom;
          },
          onConflict,
        }
      )
    ).rejects.toBe(boom);
    expect(onConflict).not.toHaveBeenCalled();
  });

  it("Dado que el audit.record() DENTRO de la transacción falla, Cuando se ejecuta, Entonces el Payment/entidad ya creados en esa misma tx NUNCA quedan a medias (todo o nada, garantía de $transaction)", async () => {
    const audit = { record: jest.fn().mockRejectedValue(new Error("audit_logs insert falló")) };
    let paymentWasCreated = false;
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          payment: {
            create: jest.fn(() => {
              paymentWasCreated = true;
              return { id: "payment-1" };
            }),
          },
        };
        // Simula la semántica real de Prisma: si algo dentro del callback
        // de $transaction lanza, TODO se revierte — no hay Payment real
        // persistido, aunque el mock de arriba haya "corrido" en memoria.
        try {
          return await fn(tx);
        } catch (err) {
          paymentWasCreated = false; // refleja el rollback real de Postgres
          throw err;
        }
      }),
    };

    await expect(
      executeMoneyMutation(
        { prisma: prisma as any, audit: audit as any },
        {
          userId: "user-1",
          amount: 6.5,
          method: "PAYPHONE",
          auditAction: "locker.rental.created",
          auditEntityType: "LockerRental",
          entityId: () => "rental-1",
          createEntity: async () => ({ id: "rental-1" }),
          onConflict: () => {
            throw new Error("no debería llamarse — esto no es P2002");
          },
        }
      )
    ).rejects.toThrow("audit_logs insert falló");
    expect(paymentWasCreated).toBe(false);
  });
});
