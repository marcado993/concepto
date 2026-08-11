import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    const startedAt = Date.now();
    let database: "ok" | "down" = "ok";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "down";
    }
    return {
      status: database === "ok" ? "ok" : "degraded",
      database,
      uptimeSeconds: Math.round(process.uptime()),
      checkedInMs: Date.now() - startedAt,
    };
  }
}
