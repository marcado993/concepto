import { Injectable, OnModuleDestroy } from "@nestjs/common";

// Límite POR CORREO DESTINO — el @Throttle() de los endpoints de
// auth.controller.ts es por IP, y un atacante distribuido lo esquiva
// fácil rotando IPs (proxies, funciones cloud, VPN). Este límite es
// independiente de eso: sin importar desde cuántas IPs distintas vengan
// las peticiones, EL MISMO correo destino no puede recibir más de
// MAX_PER_WINDOW códigos en WINDOW_MS.
//
// Relevante desde que se quitó la restricción de dominio @epn.edu.ec
// (decisión de DGIP, ver auth.controller.ts) — ahora cualquier correo
// puede pedirse un código, así que hace falta frenar dos abusos reales:
// "email bombing" contra un tercero que nunca pidió nada, y agotar la
// cuota de envío (Mailgun) mandando a muchos destinos sin control.
//
// En memoria, un solo proceso — mismo criterio que RateLimitModule (ver
// ese archivo): agregar Redis solo para esto sería complejidad sin
// beneficio real a esta escala (un Droplet, una asociación estudiantil).
const WINDOW_MS = 15 * 60 * 1000; // 15 minutos
const MAX_PER_WINDOW = 3; // un estudiante real rara vez necesita más de 1-2 códigos por sesión
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // limpieza periódica para no crecer sin límite en memoria

@Injectable()
export class EmailDestinationLimiter implements OnModuleDestroy {
  private readonly attempts = new Map<string, number[]>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor() {
    // unref() — este timer no debe mantener vivo el proceso él solo (ej.
    // durante tests, que crean/destruyen el módulo muchas veces).
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS).unref();
  }

  onModuleDestroy() {
    clearInterval(this.sweepTimer);
  }

  // true = permitido (y ya quedó registrado este intento). false =
  // bloqueado — el llamador NO debe mandar el correo.
  tryConsume(email: string): boolean {
    const key = email.trim().toLowerCase();
    const now = Date.now();
    const recent = (this.attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAX_PER_WINDOW) {
      this.attempts.set(key, recent);
      return false;
    }
    recent.push(now);
    this.attempts.set(key, recent);
    return true;
  }

  // Sin esto, un atacante que rota el CORREO destino (no solo la IP) deja
  // entradas vacías/vencidas acumulándose en el Map para siempre — barato
  // por entrada, pero sin límite de cuántas puede generar.
  private sweep() {
    const now = Date.now();
    for (const [key, timestamps] of this.attempts) {
      const recent = timestamps.filter((t) => now - t < WINDOW_MS);
      if (recent.length === 0) this.attempts.delete(key);
      else this.attempts.set(key, recent);
    }
  }
}
