import { Test } from "@nestjs/testing";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { VentureService, whatsappLink } from "./venture.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";

describe("whatsappLink", () => {
  it("Dado un número de WhatsApp, Cuando se arma el link, Entonces es un wa.me con el número y un mensaje precargado — nunca expone el número en otro formato", () => {
    const link = whatsappLink("593987654321");
    expect(link).toMatch(/^https:\/\/wa\.me\/593987654321\?text=/);
  });
});

describe("VentureService", () => {
  let service: VentureService;
  let prisma: any;
  let audit: { record: jest.Mock };

  const dto = {
    name: "Café del Politécnico",
    description: "Café de especialidad hecho por estudiantes de Sistemas.",
    category: "Alimentos",
    whatsappNumber: "593987654321",
  };

  beforeEach(async () => {
    prisma = {
      venture: {
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    audit = { record: jest.fn().mockResolvedValue({ id: "log-1" }) };

    const moduleRef = await Test.createTestingModule({
      providers: [VentureService, { provide: PrismaService, useValue: prisma }, { provide: AuditService, useValue: audit }],
    }).compile();
    service = moduleRef.get(VentureService);
  });

  describe("listApproved", () => {
    it("Dados emprendimientos aprobados, Cuando se lista el directorio público, Entonces cada resultado tiene whatsappLink pero NUNCA whatsappNumber ni ownerId crudos", async () => {
      prisma.venture.findMany.mockResolvedValue([
        { id: "v1", ownerId: "user-1", ...dto, photoUrl: null, status: "APPROVED", createdAt: new Date() },
      ]);

      const result = await service.listApproved();

      expect(prisma.venture.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: "APPROVED" } })
      );
      expect(result[0]).not.toHaveProperty("ownerId");
      expect(result[0]).not.toHaveProperty("whatsappNumber");
      expect(result[0].whatsappLink).toContain("593987654321");
    });
  });

  describe("create", () => {
    it("Dado un nuevo emprendimiento, Cuando un estudiante lo envía, Entonces queda en PENDING (no visible en el directorio) hasta que alguien lo apruebe", async () => {
      prisma.venture.create.mockResolvedValue({ id: "v1", ownerId: "user-1", ...dto, status: "PENDING" });

      await service.create("user-1", dto as any, "10.0.0.1");

      expect(prisma.venture.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "PENDING", ownerId: "user-1" }) })
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: "user-1", action: "venture.created" })
      );
    });
  });

  describe("approve", () => {
    it("Dado un emprendimiento PENDING, Cuando el Presidente/Director lo aprueba, Entonces pasa a APPROVED y queda auditado con quién aprobó", async () => {
      prisma.venture.findUnique.mockResolvedValue({ id: "v1", ownerId: "user-1", status: "PENDING" });
      prisma.venture.update.mockResolvedValue({ id: "v1", status: "APPROVED" });

      await service.approve("v1", "director-1", "10.0.0.2");

      expect(prisma.venture.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "v1" }, data: { status: "APPROVED" } })
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: "director-1", action: "venture.approved" })
      );
    });

    it("Dado un emprendimiento que ya estaba APPROVED, Cuando se intenta aprobar de nuevo, Entonces no re-audita (idempotente, no infla el log con aprobaciones repetidas)", async () => {
      prisma.venture.findUnique.mockResolvedValue({ id: "v1", ownerId: "user-1", status: "APPROVED" });

      await service.approve("v1", "director-1");

      expect(prisma.venture.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("Dado un id de emprendimiento inexistente, Cuando se intenta aprobar, Entonces lanza NotFoundException", async () => {
      prisma.venture.findUnique.mockResolvedValue(null);

      await expect(service.approve("no-existe", "director-1")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("assertOwnerOrThrow", () => {
    it("Dado un emprendimiento de OTRO estudiante, Cuando alguien más intenta operarlo, Entonces lanza ForbiddenException", async () => {
      prisma.venture.findUnique.mockResolvedValue({ id: "v1", ownerId: "user-1" });

      await expect(service.assertOwnerOrThrow("v1", "user-2")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("Dado el dueño real, Cuando verifica su propio emprendimiento, Entonces lo permite", async () => {
      prisma.venture.findUnique.mockResolvedValue({ id: "v1", ownerId: "user-1" });

      await expect(service.assertOwnerOrThrow("v1", "user-1")).resolves.toBeDefined();
    });
  });
});
