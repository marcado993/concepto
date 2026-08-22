import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { LogtoOidcClient } from "./logto-oidc.client";
import { PrismaService } from "../prisma/prisma.service";

// Restricción de dominio institucional — RETIRADA a propósito (decisión
// real de DGIP, 2026-08-19): atar la cuenta al correo @epn.edu.ec hacía
// que un estudiante quedara sin poder loguearse en cuanto la EPN le daba
// de baja esa cuenta al graduarse, y una cuenta institucional inactiva
// reutilizada más adelante era un vector de ataque real. Ya no hay
// ninguna verificación de que quien se registra sea efectivamente
// estudiante de Sistemas — decisión consciente, aceptada así por ahora:
// alquilar un casillero de todos modos exige pagar (PayPhone o
// transferencia) y tener acceso físico al campus para usarlo, lo que ya
// filtra bastante el abuso sin necesitar una verificación de dominio.
export function isValidEmail(email: string | undefined): email is string {
  return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Lógica de dominio del login — intercambio de código OIDC y provisión de
 * usuario. Extraído de AuthController (mismo patrón que LockerService
 * para /locker: controlador delgado que maneja HTTP, servicio que hace el
 * trabajo real) — antes vivía como métodos privados del controlador,
 * mezclando manejo de peticiones/respuestas con lógica de negocio que no
 * depende de Express en absoluto.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly logto: LogtoOidcClient,
    private readonly prisma: PrismaService
  ) {}

  // Compartido entre /auth/callback (GitHub, redirige) y /auth/email/verify
  // (correo institucional embebido, responde JSON) — el intercambio de
  // código + validación de dominio + aprovisionamiento es EXACTAMENTE el
  // mismo trabajo sin importar qué conector produjo el `code`; solo cambia
  // cómo cada endpoint le informa el resultado al frontend.
  async finishTokenExchange(params: {
    code: string;
    state: string;
    iss?: string;
    expectedState: string;
    codeVerifier: string;
  }): Promise<{ ok: true; accessToken: string } | { ok: false; reason: "correo_no_disponible" }> {
    const tokenSet = await this.logto.exchangeCode(params);
    const claims = tokenSet.claims();
    const email = claims.email as string | undefined;

    // Ya no se exige dominio @epn.edu.ec (ver comentario de isValidEmail
    // más arriba) — este chequeo ahora solo cubre el caso real que queda:
    // GitHub sin correo público/verificado en el perfil, donde Logto
    // nunca nos entrega el claim `email` en absoluto. Se rechaza ANTES de
    // tocar la base de datos — nunca se crea un User "a medias" para una
    // identidad sin correo que después haya que limpiar a mano.
    if (!isValidEmail(email)) {
      return { ok: false, reason: "correo_no_disponible" };
    }

    await this.provisionUser(claims.sub, email, claims.name as string | undefined);
    if (!tokenSet.access_token) throw new Error("Logto no devolvió access_token");
    return { ok: true, accessToken: tokenSet.access_token };
  }

  // Provisiona el User en el primer login — mismo principio que aeis-app
  // documentó para OAuth social: el login identifica "quién eres en
  // internet", NO "eres estudiante de la EPN". Se crea con rol ESTUDIANTE
  // y SIN código único todavía; completar el código único/verificación
  // institucional es un flujo aparte (pendiente — ver
  // docs/dominio/02-necesidades-stakeholders.md).
  private async provisionUser(logtoSub: string, email?: string, name?: string) {
    return this.prisma.user.upsert({
      where: { logtoSub },
      update: {},
      create: {
        logtoSub,
        // randomUUID(), no un slice de logtoSub — un slice truncado puede
        // colisionar entre dos `sub` distintos y romper la restricción
        // @unique de uniqueCode con un 500 no controlado (hallazgo de la
        // auditoría de seguridad, 07-iso27001-sgsi-politica.md).
        uniqueCode: `PENDIENTE-${randomUUID()}`,
        fullName: name ?? email ?? "Estudiante pendiente de completar registro",
      },
    });
  }
}
