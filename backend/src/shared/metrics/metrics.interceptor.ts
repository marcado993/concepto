import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { tap } from "rxjs";
import { MetricsService } from "./metrics.service";

// Interceptor global (registrado una vez en app.module.ts) en vez de medir
// tiempo a mano en cada controller — es exactamente el tipo de
// duplicación que el principio DRY de esta iteración pide evitar.
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const route = req.route?.path ?? req.url;
    const stop = this.metrics.httpRequestDuration.startTimer({ method: req.method, route });

    return next.handle().pipe(
      tap({
        next: () => this.finish(stop, req.method, route, res.statusCode),
        error: () => this.finish(stop, req.method, route, res.statusCode || 500),
      })
    );
  }

  private finish(stop: (labels?: Record<string, string | number>) => number, method: string, route: string, statusCode: number) {
    stop({ status_code: statusCode });
    this.metrics.httpRequestsTotal.inc({ method, route, status_code: statusCode });
    if (statusCode === 429) this.metrics.rateLimitedTotal.inc();
  }
}
