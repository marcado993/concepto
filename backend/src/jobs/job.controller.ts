import { Controller, Get, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../shared/auth/public.decorator";
import { JobService } from "./job.service";
import { QueryJobsDto } from "./dto/query-jobs.dto";

@Controller("jobs")
export class JobController {
  constructor(private readonly jobs: JobService) {}

  /**
   * Listado público de ofertas.
   *
   * Sin autenticación, igual que `/ventures` y `/security`: son datos
   * públicos de todas formas (vienen de bolsas abiertas) y exigir login
   * para ver pasantías sería poner una puerta justo delante de lo que la
   * asociación quiere que la gente use.
   *
   * Techo alto por el mismo motivo documentado en VentureController: la app
   * pide esto apenas abre, y varios estudiantes comparten la IP del WiFi
   * del campus, así que el límite global castigaba a usuarios reales.
   */
  @Throttle({ short: { limit: 50, ttl: 1000 }, medium: { limit: 3000, ttl: 60_000 } })
  @Public()
  @Get()
  list(@Query() query: QueryJobsDto) {
    return this.jobs.list(query);
  }

  /** Tags disponibles para armar los filtros de la UI. */
  @Throttle({ short: { limit: 20, ttl: 1000 }, medium: { limit: 1000, ttl: 60_000 } })
  @Public()
  @Get("tags")
  tags() {
    return this.jobs.topTags();
  }
}
