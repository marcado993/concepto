import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";

// Vence en el mismo plazo que ya usaba la cookie que reemplaza (10 min —
// el código de Logto vence a los 10 minutos, no tiene sentido que el
// estado que lo acompaña dure más que el propio código).
const TTL_MS = 10 * 60 * 1000;

interface Envelope<T> {
  payload: T;
  exp: number;
}

/**
 * Firma/verifica un blob de estado que viaja EXPLÍCITO con el cliente
 * (cuerpo JSON), no en una cookie — usado por el login de correo
 * (auth.controller.ts) para el estado pendiente entre /auth/email/start y
 * /auth/email/verify.
 *
 * Por qué no una cookie: el frontend (aeis.app) y el backend
 * (api.aeis-app.online) son dominios distintos. Se intentó primero con una
 * cookie SameSite=None + Secure y en el papel debía funcionar, pero en
 * producción real seguía fallando: varios navegadores (Safari con ITP,
 * Chrome apagando cookies de terceros) bloquean cookies entre sitios
 * distintos sin importar el valor de SameSite. Mismo patrón que ya usa el
 * access_token final (fragmento de URL → localStorage → header
 * Authorization, nunca cookie) — acá se aplica lo mismo al estado
 * intermedio.
 *
 * El cliente puede LEER este blob (a diferencia de una cookie httpOnly),
 * pero no puede alterarlo sin invalidar la firma HMAC. En la práctica
 * Logto igual rechazaría cualquier interactionCookie ajena del lado del
 * proveedor, así que esto es defensa en profundidad barata, no la única
 * barrera real.
 *
 * Extraído a su propio provider (en vez de vivir como métodos privados de
 * AuthController) para que la firma/verificación se pueda probar sola, sin
 * levantar todo el controlador — y para que AuthController no siga
 * creciendo con lógica de criptografía mezclada con manejo de HTTP.
 */
@Injectable()
export class EmailPendingTokenService {
  constructor(private readonly config: ConfigService) {}

  sign<T>(payload: T): string {
    const secret = this.config.getOrThrow<string>("COOKIE_SECRET");
    const envelope: Envelope<T> = { payload, exp: Date.now() + TTL_MS };
    const json = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
    const sig = createHmac("sha256", secret).update(json).digest("base64url");
    return `${json}.${sig}`;
  }

  verify<T>(token: string | undefined): T | null {
    if (!token) return null;
    const [json, sig] = token.split(".");
    if (!json || !sig) return null;

    const secret = this.config.getOrThrow<string>("COOKIE_SECRET");
    const expected = createHmac("sha256", secret).update(json).digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expected);
    // timingSafeEqual lanza si los buffers tienen distinto largo — por eso
    // el chequeo de largo va ANTES, como su propio corto-circuito seguro
    // (comparar longitudes no filtra nada sensible sobre el contenido).
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

    let envelope: Envelope<T>;
    try {
      envelope = JSON.parse(Buffer.from(json, "base64url").toString("utf8")) as Envelope<T>;
    } catch {
      return null;
    }
    if (typeof envelope.exp !== "number" || Date.now() > envelope.exp) return null;
    return envelope.payload;
  }
}
