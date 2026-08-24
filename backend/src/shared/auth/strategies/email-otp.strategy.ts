import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Response } from "express";
import { AuthStrategy } from "./auth-strategy.interface";
import { ExperienceApiError, LogtoExperienceClient } from "../logto-experience.client";
import { LogtoOidcClient } from "../logto-oidc.client";
import { PrismaService } from "../../prisma/prisma.service";
import { EmailDestinationLimiter } from "../../rate-limit/email-destination-limiter.service";
import { EmailPendingTokenService } from "../email-pending-token.service";
import { AuthService, isValidEmail } from "../auth.service";

// Login por correo institucional embebido — el estado de la interacción
// (sus cookies internas, el verificationId pendiente) tiene que sobrevivir
// entre el POST /auth/email/start y el POST /auth/email/verify de este
// mismo backend, mientras el estudiante nunca navega fuera de Login.svelte.
//
// Este estado viaja EXPLÍCITO en el cuerpo JSON (pendingToken), no en una
// cookie — mismo patrón que ya usa el access_token final (fragmento de URL
// → localStorage → header Authorization, nunca cookie). Se intentó primero
// con una cookie SameSite=None+Secure (aeis.app y api.aeis-app.online son
// dominios distintos) y en el papel debía funcionar, pero en producción real
// seguía fallando para usuarios reales: varios navegadores (Safari con ITP,
// Chrome con el apagado gradual de cookies de terceros) bloquean cookies
// entre sitios distintos SIN IMPORTAR el valor de SameSite — no hay
// combinación de atributos de cookie que lo arregle de forma confiable.
// Pasar el estado como dato explícito evita depender de una política de
// cookies que cada navegador decide distinto y sigue cambiando con el tiempo.
// Ver logto-experience.client.ts para el detalle de qué es cada campo.

// Estado en vuelo entre los dos endpoints del flujo de correo. Viaja
// firmado como JWT de corta vida (EmailPendingTokenService).
export interface EmailPending {
  email: string;
  codeVerifier: string;
  state: string;
  interactionEvent: "SignIn" | "Register";
  interactionCookie: string;
  verificationId: string;
}

@Injectable()
export class EmailOtpStrategy implements AuthStrategy {
  readonly name = "email-otp";
  private readonly logger = new Logger(EmailOtpStrategy.name);

  constructor(
    private readonly logto: LogtoOidcClient,
    private readonly logtoExperience: LogtoExperienceClient,
    private readonly prisma: PrismaService,
    private readonly emailDestinationLimiter: EmailDestinationLimiter,
    private readonly pendingTokens: EmailPendingTokenService,
    private readonly authService: AuthService,
    private readonly config: ConfigService
  ) {}

  // NUNCA reenviar ExperienceApiError.message tal cual al cliente — es el
  // mensaje crudo del conector de Logto, que a su vez puede traer el error
  // crudo del proveedor de correo por debajo (hallazgo real de producción:
  // Resend en modo sandbox devolvió su propio mensaje de error completo,
  // exponiendo qué proveedor se usa, que la cuenta no tiene dominio
  // verificado, Y el correo personal del desarrollador — a cualquier
  // visitante no autenticado, sin haber iniciado sesión siquiera). El
  // detalle real se audita acá, server-side; al cliente solo le llega un
  // mensaje genérico y seguro.
  private sanitizedEmailError(err: ExperienceApiError, context: string, safeMessage: string): BadRequestException {
    this.logger.error(`${context} — Logto Experience API rechazó la operación: [${err.code ?? "sin código"}] ${err.message}`);
    return new BadRequestException(safeMessage);
  }

  // Paso 1 de 2: arranca la interacción y dispara el correo con el código.
  async start(email: string | undefined, res: Response): Promise<void> {
    if (!isValidEmail(email)) {
      throw new BadRequestException("Escribe un correo válido");
    }
    // Límite por correo DESTINO, no por IP — ver EmailDestinationLimiter.
    // Sin dominio institucional exigido, cualquier correo es un blanco
    // válido para "email bombing" si solo se limitara por IP.
    if (!this.emailDestinationLimiter.tryConsume(email)) {
      throw new BadRequestException("Ya se mandaron varios códigos a este correo — espera unos minutos e intenta de nuevo");
    }

    const { codeVerifier, codeChallenge, state } = this.logto.generatePkce();
    const authUrl = this.logto.authorizationUrl({ codeChallenge, state });

    // Elegir el evento ANTES de mandar el código — esto es lo que arregla
    // el bug de los dos correos. Contrato real de Logto, comprobado contra
    // el tenant (agosto 2026):
    //   SignIn   → usuario existente: 204 · usuario nuevo: 404 user_not_exist
    //   Register → usuario nuevo: 201 · existente: 422 email_already_in_use
    // y cambiar el evento a mitad de la interacción DESTRUYE la
    // verificación ya aprobada (session.verification_session_not_found), o
    // sea que al fallar la corazonada hay que mandar un SEGUNDO código.
    // Como Logto no tiene un evento combinado, la única forma de acertar al
    // primer intento es saber de antemano si el correo ya existe: eso lo
    // responde nuestra propia tabla de usuarios (User.email, que se rellena
    // en cada login — ver provisionUser).
    //
    // Si el correo no está en nuestra base, se asume Register: el caso
    // masivo de aquí en adelante son estudiantes entrando por primera vez.
    // Un usuario que exista en Logto pero todavía no en nuestra base (o que
    // entró antes de que existiera esta columna) cae al fallback de
    // verify() y recibe dos correos ESA VEZ; a partir de la siguiente ya
    // queda registrado acá y le llega uno solo.
    const normalizedEmail = email.toLowerCase();
    const conocido = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    const interactionEvent: "SignIn" | "Register" = conocido ? "SignIn" : "Register";

    try {
      let cookie = await this.logtoExperience.startInteraction(authUrl);
      cookie = await this.logtoExperience.setInteractionEvent(cookie, interactionEvent);
      const { cookie: cookieWithCode, verificationId } = await this.logtoExperience.requestEmailCode(
        cookie,
        email,
        interactionEvent
      );

      const pending: EmailPending = {
        email,
        codeVerifier,
        state,
        interactionEvent,
        interactionCookie: cookieWithCode,
        verificationId,
      };
      // pendingToken explícito en el cuerpo, no una cookie — ver el
      // comentario grande de este módulo arriba.
      // Login.svelte lo guarda en memoria y lo reenvía tal cual en
      // /auth/email/verify.
      res.json({ pendingToken: this.pendingTokens.sign(pending) });
    } catch (err) {
      if (err instanceof ExperienceApiError) {
        throw this.sanitizedEmailError(
          err,
          `start(${email})`,
          "No se pudo enviar el código a tu correo — intenta de nuevo en unos minutos."
        );
      }
      throw err;
    }
  }

  // Paso 2 de 2: valida el código que el estudiante escribió en
  // Login.svelte. Si la corazonada de start() falló (correo no conocido en
  // nuestra base pero ya existía en Logto, o viceversa), reinicia la
  // interacción con el evento correcto y pide al frontend que muestre
  // "te mandamos un código nuevo" — Logto no permite seguir con la misma
  // verificación al cambiar de SignIn a Register a mitad de camino
  // (session.verification_session_not_found, comprobado contra el tenant real).
  async verify(code: string | undefined, pendingToken: string | undefined, res: Response): Promise<void> {
    const pending = this.pendingTokens.verify<EmailPending>(pendingToken);
    if (!pending || !code) {
      throw new BadRequestException("Sesión de verificación expirada o inválida — solicita un nuevo código");
    }

    let cookie: string;
    try {
      cookie = await this.logtoExperience.verifyEmailCode(
        pending.interactionCookie,
        pending.email,
        code,
        pending.verificationId
      );
    } catch (err) {
      if (err instanceof ExperienceApiError) {
        // "not_found" (el código venció o ya se usó) y "code_mismatch"
        // (el código está mal escrito) son casos DISTINTOS que Logto ya
        // distingue — antes ambos caían en el mismo "intenta de nuevo"
        // genérico. Bug real reportado en producción: con ese mensaje
        // vago, quien recibía "not_found" reintentaba con EL MISMO código
        // ya vencido (el único que tenía a mano) y volvía a fallar exacto
        // igual — dos errores idénticos seguidos en los logs. El mensaje
        // ahora dice qué pasó de verdad y apunta al único camino que sí
        // funciona: "‹ Usar otro correo" deja el correo ya escrito y
        // dispara un código nuevo con un solo toque en "Continuar".
        const safeMessage =
          err.code === "verification_code.not_found"
            ? "Ese código ya venció o ya se usó — toca «Usar otro correo» abajo y pide uno nuevo (el correo se queda escrito, no hay que repetirlo)."
            : "Código incorrecto — revisa los 6 dígitos e intenta de nuevo.";
        throw this.sanitizedEmailError(err, `verify.verifyEmailCode(${pending.email})`, safeMessage);
      }
      throw err;
    }

    const identification = await this.logtoExperience.submitIdentification(cookie, pending.verificationId);

    // La cookie con la que se continúa — cambia si hubo que reintentar con
    // el otro evento (ver abajo).
    let identifiedCookie = identification.cookie;

    // 204 = entró (usuario existente) · 201 = cuenta recién creada.
    const identificado = identification.status === 204 || identification.status === 201;

    if (!identificado) {
      // La corazonada de start() falló: creímos que el correo existía y
      // no existe (user_not_exist), o al revés (email_already_in_use). Pasa
      // solo cuando nuestra tabla está desincronizada con Logto — sobre
      // todo con cuentas creadas antes de que existiera User.email.
      //
      // Acá NO se puede reusar la verificación: cambiar el evento la
      // destruye (session.verification_session_not_found, comprobado contra
      // el tenant real). La única salida es reiniciar con el evento
      // correcto, lo que implica un segundo código. Por eso el arreglo de
      // verdad vive en start() (acertar a la primera) y esto es solo la
      // red de seguridad.
      const eventoCorrecto: "SignIn" | "Register" | null =
        identification.errorCode === "user.user_not_exist" && pending.interactionEvent === "SignIn"
          ? "Register"
          : identification.errorCode === "user.email_already_in_use" && pending.interactionEvent === "Register"
            ? "SignIn"
            : null;

      if (!eventoCorrecto) {
        this.logger.error(
          `verify(${pending.email}) — identificación falló sin camino de recuperación: ${identification.errorCode ?? identification.status}`
        );
        throw new BadRequestException("No se pudo verificar el código — intenta de nuevo");
      }

      this.logger.warn(
        `verify(${pending.email}) — el evento ${pending.interactionEvent} no aplicaba (${identification.errorCode}); se reinicia como ${eventoCorrecto} y se manda un código nuevo`
      );

      if (!this.emailDestinationLimiter.tryConsume(pending.email)) {
        throw new BadRequestException("Ya se mandaron varios códigos a este correo — espera unos minutos e intenta de nuevo");
      }

      const nuevaCookie = await this.logtoExperience.setInteractionEvent(identification.cookie, eventoCorrecto);
      let cookieWithCode: string;
      let verificationId: string;
      try {
        ({ cookie: cookieWithCode, verificationId } = await this.logtoExperience.requestEmailCode(
          nuevaCookie,
          pending.email,
          eventoCorrecto
        ));
      } catch (err) {
        if (err instanceof ExperienceApiError) {
          throw this.sanitizedEmailError(
            err,
            `verify.retry-${eventoCorrecto}(${pending.email})`,
            "No se pudo enviar el código a tu correo — intenta de nuevo en unos minutos."
          );
        }
        throw err;
      }
      const nextPending: EmailPending = {
        ...pending,
        interactionEvent: eventoCorrecto,
        interactionCookie: cookieWithCode,
        verificationId,
      };
      // El código anterior ya no sirve — Login.svelte debe reemplazar el
      // pendingToken guardado por este.
      res.status(202).json({
        needsNewCode: true,
        pendingToken: this.pendingTokens.sign(nextPending),
        message:
          eventoCorrecto === "Register"
            ? "Es tu primera vez con este correo — te mandamos un código nuevo para crear tu cuenta"
            : "Este correo ya tiene cuenta — te mandamos un código nuevo para entrar",
      });
      return;
    }

    const submitted = await this.logtoExperience.submitInteraction(identifiedCookie);
    const {
      code: authCode,
      state: authState,
      iss: authIss,
    } = await this.logtoExperience.completeAuthorization(submitted.cookie, submitted.redirectTo);

    const result = await this.authService.finishTokenExchange({
      code: authCode,
      state: authState,
      iss: authIss,
      expectedState: pending.state,
      codeVerifier: pending.codeVerifier,
    });

    if (!result.ok) {
      res.status(403).json({ error: result.reason });
      return;
    }
    res.json({ accessToken: result.accessToken });
  }
}
