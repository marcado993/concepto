import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

// Habla con la Experience API de Logto (la misma API que usa la pantalla
// hospedada de Logto por dentro) en vez de redirigir el navegador ahí —
// así el estudiante nunca sale de Login.svelte para el login por correo
// institucional (a diferencia de GitHub, que sí necesita salir a
// github.com — eso es inherente a cualquier OAuth social, no algo que
// podamos evitar). Este backend actúa de "navegador" contra Logto: guarda
// las cookies de la interacción él mismo y nunca las expone al cliente.
//
// Contrato verificado a mano contra el tenant real (curl, agosto 2026) —
// no está documentado con este nivel de detalle en docs.logto.io, así que
// cualquier cambio acá debería re-verificarse contra un tenant real antes
// de asumir que "debería funcionar".
export class ExperienceApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "ExperienceApiError";
  }
}

interface CallResult {
  status: number;
  cookie: string;
  json: unknown;
}

@Injectable()
export class LogtoExperienceClient {
  private readonly logger = new Logger(LogtoExperienceClient.name);

  constructor(private readonly config: ConfigService) {}

  private get authOrigin(): string {
    // LOGTO_ISSUER = "https://auth.aeis-app.online/oidc" — la Experience
    // API vive en el mismo host, sin el sufijo /oidc.
    return this.config.getOrThrow<string>("LOGTO_ISSUER").replace(/\/oidc\/?$/, "");
  }

  // Cookie jar manual — Node no trae uno para fetch(). Solo nos interesa
  // el par nombre=valor de cada Set-Cookie, nunca sus atributos
  // (HttpOnly/Secure/Path/Domain): como este backend es el único
  // "navegador" que las usa, replayarlas todas en cada request contra el
  // mismo host basta, sin implementar las reglas reales de un navegador.
  private mergeCookies(existing: string, setCookieHeaders: string[]): string {
    const jar = new Map<string, string>();
    for (const part of existing.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      const k = part.slice(0, eq).trim();
      if (k) jar.set(k, part.slice(eq + 1).trim());
    }
    for (const setCookie of setCookieHeaders) {
      const pair = setCookie.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const k = pair.slice(0, eq).trim();
      if (k) jar.set(k, pair.slice(eq + 1).trim());
    }
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private async call(cookie: string, path: string, method: string, body?: unknown): Promise<CallResult> {
    const res = await fetch(`${this.authOrigin}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const setCookies = res.headers.getSetCookie();
    const newCookie = setCookies.length ? this.mergeCookies(cookie, setCookies) : cookie;
    let json: unknown = undefined;
    const len = res.headers.get("content-length");
    if (len !== "0" && res.status !== 204) {
      json = await res.json().catch(() => undefined);
    }
    return { status: res.status, cookie: newCookie, json };
  }

  // Primer salto: el GET normal a /oidc/auth (misma URL que construye
  // LogtoOidcClient.authorizationUrl() para el flujo de GitHub) — esto es
  // lo que crea la interacción en Logto y nos da las cookies
  // _interaction/_interaction.sig que todo lo demás necesita.
  async startInteraction(authorizationUrl: string): Promise<string> {
    const res = await fetch(authorizationUrl, { redirect: "manual" });
    if (res.status !== 303 && res.status !== 302) {
      throw new Error(`Logto no inició la interacción como se esperaba (status ${res.status})`);
    }
    return this.mergeCookies("", res.headers.getSetCookie());
  }

  async setInteractionEvent(cookie: string, interactionEvent: "SignIn" | "Register"): Promise<string> {
    const r = await this.call(cookie, "/api/experience", "PUT", { interactionEvent });
    if (r.status !== 204) throw new Error(`No se pudo fijar el tipo de interacción (status ${r.status})`);
    return r.cookie;
  }

  async requestEmailCode(
    cookie: string,
    email: string,
    interactionEvent: "SignIn" | "Register"
  ): Promise<{ cookie: string; verificationId: string }> {
    const r = await this.call(cookie, "/api/experience/verification/verification-code", "POST", {
      identifier: { type: "email", value: email },
      interactionEvent,
    });
    if (r.status !== 200) {
      const body = r.json as { code?: string; message?: string } | undefined;
      throw new ExperienceApiError(r.status, body?.code, body?.message ?? "No se pudo enviar el código");
    }
    const { verificationId } = r.json as { verificationId: string };
    return { cookie: r.cookie, verificationId };
  }

  async verifyEmailCode(cookie: string, email: string, code: string, verificationId: string): Promise<string> {
    const r = await this.call(cookie, "/api/experience/verification/verification-code/verify", "POST", {
      identifier: { type: "email", value: email },
      code,
      verificationId,
    });
    if (r.status !== 200) {
      const body = r.json as { code?: string; message?: string } | undefined;
      throw new ExperienceApiError(r.status, body?.code, body?.message ?? "Código incorrecto o vencido");
    }
    return r.cookie;
  }

  // 204 = identificado con éxito (usuario existente para SignIn, o recién
  // registrado para Register). 404 user.user_not_exist = este correo no
  // tiene cuenta todavía — el llamador debe reintentar el flujo completo
  // con interactionEvent="Register" (Logto invalida la verificación al
  // cambiar de evento a mitad de la interacción, así que no hay forma de
  // "seguir" con la misma verificación — hay que volver a mandar código).
  async submitIdentification(cookie: string, verificationId: string): Promise<{ cookie: string; status: number; errorCode?: string }> {
    const r = await this.call(cookie, "/api/experience/identification", "POST", { verificationId });
    if (r.status === 204) return { cookie: r.cookie, status: r.status };
    const body = r.json as { code?: string } | undefined;
    return { cookie: r.cookie, status: r.status, errorCode: body?.code };
  }

  async submitInteraction(cookie: string): Promise<{ cookie: string; redirectTo: string }> {
    const r = await this.call(cookie, "/api/experience/submit", "POST");
    if (r.status !== 200) throw new Error(`No se pudo completar la interacción (status ${r.status})`);
    const { redirectTo } = r.json as { redirectTo: string };
    return { cookie: r.cookie, redirectTo };
  }

  // Sigue la cadena de redirecciones tras /submit — puede pasar por
  // /consent (primera vez que este usuario autoriza la app; hay que
  // aceptarlo con un POST) antes de llegar al callback real de este
  // backend con ?code=&state=, que es lo único que exchangeCode() (el
  // mismo método que ya usa el flujo de GitHub) necesita para terminar.
  async completeAuthorization(cookie: string, redirectTo: string): Promise<{ code: string; state: string; iss?: string }> {
    let currentCookie = cookie;
    let url = redirectTo;
    const redirectUri = this.config.getOrThrow<string>("LOGTO_REDIRECT_URI");

    for (let hop = 0; hop < 6; hop++) {
      if (url.startsWith(redirectUri)) {
        const parsed = new URL(url);
        const code = parsed.searchParams.get("code");
        const state = parsed.searchParams.get("state");
        const iss = parsed.searchParams.get("iss") ?? undefined;
        if (!code || !state) throw new Error("Logto no devolvió code/state en el callback");
        return { code, state, iss };
      }

      if (url.includes("/consent")) {
        const res = await fetch(`${this.authOrigin}/consent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: currentCookie },
          body: "{}",
          redirect: "manual",
        });
        const setCookies = res.headers.getSetCookie();
        if (setCookies.length) currentCookie = this.mergeCookies(currentCookie, setCookies);
        const location = res.headers.get("location");
        if (!location) throw new Error("Logto no devolvió redirect tras el consentimiento");
        url = location.startsWith("http") ? location : `${this.authOrigin}${location}`;
        continue;
      }

      const res = await fetch(url, { redirect: "manual", headers: { Cookie: currentCookie } });
      const setCookies = res.headers.getSetCookie();
      if (setCookies.length) currentCookie = this.mergeCookies(currentCookie, setCookies);
      const location = res.headers.get("location");
      if (!location) throw new Error(`Logto no devolvió redirect (status ${res.status}) completando el login`);
      url = location.startsWith("http") ? location : `${this.authOrigin}${location}`;
    }
    throw new Error("Demasiadas redirecciones completando el login por correo");
  }
}
