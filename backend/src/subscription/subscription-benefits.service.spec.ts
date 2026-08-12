import { Test } from "@nestjs/testing";
import { SubscriptionBenefitsService } from "./subscription-benefits.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { PeriodService } from "../shared/period/period.service";

describe("SubscriptionBenefitsService.getLockerDiscountPercent", () => {
  let service: SubscriptionBenefitsService;
  let prisma: { subscription: { findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = { subscription: { findUnique: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SubscriptionBenefitsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PeriodService, useValue: { getCurrentPeriodId: jest.fn().mockResolvedValue("period-1") } },
      ],
    }).compile();
    service = moduleRef.get(SubscriptionBenefitsService);
  });

  it("Dado un estudiante sin aportación este periodo, Cuando se consulta el descuento, Entonces retorna 0 (nunca lanza)", async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);

    await expect(service.getLockerDiscountPercent("user-1")).resolves.toBe(0);
  });

  it("Dado una aportación PENDING (todavía sin pagar), Cuando se consulta el descuento, Entonces retorna 0 — un beneficio real requiere pago CONFIRMADO", async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      tier: { benefits: [{ type: "descuento_casillero", percent: 20 }] },
      payment: { status: "PENDING" },
    });

    await expect(service.getLockerDiscountPercent("user-1")).resolves.toBe(0);
  });

  it("Dado un tier CONFIRMADO sin beneficio de casilleros, Cuando se consulta, Entonces retorna 0", async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      tier: { benefits: [{ type: "descuento_billar", percent: 10 }] },
      payment: { status: "CONFIRMED" },
    });

    await expect(service.getLockerDiscountPercent("user-1")).resolves.toBe(0);
  });

  it("Dado un tier CONFIRMADO con descuento_casillero, Cuando se consulta, Entonces retorna el porcentaje exacto del tier", async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      tier: { benefits: [{ type: "descuento_casillero", percent: 20 }] },
      payment: { status: "CONFIRMED" },
    });

    await expect(service.getLockerDiscountPercent("user-1")).resolves.toBe(20);
  });

  it("Dado un valor de benefits fuera de rango (dato corrupto/malicioso), Cuando se consulta, Entonces lo recorta a [0,100] en vez de propagarlo tal cual", async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      tier: { benefits: [{ type: "descuento_casillero", percent: 500 }] },
      payment: { status: "CONFIRMED" },
    });

    await expect(service.getLockerDiscountPercent("user-1")).resolves.toBe(100);
  });
});
