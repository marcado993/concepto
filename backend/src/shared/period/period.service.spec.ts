import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { PeriodService } from "./period.service";
import { PrismaService } from "../prisma/prisma.service";

describe("PeriodService.getCurrentPeriodId", () => {
  let service: PeriodService;
  let prisma: { period: { findFirst: jest.Mock } };

  beforeEach(async () => {
    prisma = { period: { findFirst: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [PeriodService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(PeriodService);
  });

  it("Dado un periodo vigente o próximo, Cuando se resuelve, Entonces retorna su id y ordena por fecha de inicio ascendente", async () => {
    prisma.period.findFirst.mockResolvedValue({ id: "period-1" });

    await expect(service.getCurrentPeriodId()).resolves.toBe("period-1");
    expect(prisma.period.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { startsAt: "asc" } })
    );
  });

  it("Dado que no hay ningún periodo configurado, Cuando se resuelve, Entonces lanza NotFoundException en vez de devolver un id inventado", async () => {
    prisma.period.findFirst.mockResolvedValue(null);

    await expect(service.getCurrentPeriodId()).rejects.toBeInstanceOf(NotFoundException);
  });
});
