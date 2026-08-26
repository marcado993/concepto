import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { ExperienceApiError } from "../logto-experience.client";
import { SocialEmbeddedStrategy } from "./social-embedded.strategy";
import { LogtoOidcClient } from "../logto-oidc.client";
import { LogtoExperienceClient } from "../logto-experience.client";
import { AuthService } from "../auth.service";
import { PrismaService } from "../../prisma/prisma.service";

function mockResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as any;
}

describe("SocialEmbeddedStrategy", () => {
  let strategy: SocialEmbeddedStrategy;
  let logto: { generatePkce: jest.Mock; authorizationUrl: jest.Mock; exchangeCode: jest.Mock };
  let logtoExperience: {
    startInteraction: jest.Mock;
    setInteractionEvent: jest.Mock;
    submitIdentification: jest.Mock;
    submitInteraction: jest.Mock;
    completeAuthorization: jest.Mock;
    getSocialAuthorizationUri: jest.Mock;
    verifySocial: jest.Mock;
  };
  let prisma: { user: { upsert: jest.Mock; findUnique: jest.Mock } };

  beforeEach(async () => {
    logto = {
      generatePkce: jest.fn().mockReturnValue({ codeVerifier: "verifier-1", codeChallenge: "challenge-1", state: "state-1" }),
      authorizationUrl: jest.fn().mockReturnValue("https://logto.example/oidc/auth"),
      exchangeCode: jest.fn(),
    };
    logtoExperience = {
      startInteraction: jest.fn().mockResolvedValue("_interaction=cookie-1"),
      setInteractionEvent: jest.fn().mockResolvedValue("_interaction=cookie-2"),
      submitIdentification: jest.fn(),
      submitInteraction: jest.fn(),
      completeAuthorization: jest.fn(),
      getSocialAuthorizationUri: jest.fn(),
      verifySocial: jest.fn(),
    };
    prisma = {
      user: {
        upsert: jest.fn().mockResolvedValue({ id: "user-1" }),
        findUnique: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SocialEmbeddedStrategy,
        AuthService,
        { provide: LogtoOidcClient, useValue: logto },
        { provide: LogtoExperienceClient, useValue: logtoExperience },
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) =>
              ({
                FRONTEND_ORIGIN: "https://aeis-app.vercel.app",
                LOGTO_ISSUER: "https://tenant.logto.app/oidc",
                SOCIAL_REDIRECT_URI: "https://api.aeis-app.online/auth/social/callback",
              })[key],
            get: (key: string) =>
              ({
                LOGTO_GITHUB_CONNECTOR_ID: "gh-connector-1",
                LOGTO_GOOGLE_CONNECTOR_ID: "google-connector-1",
              })[key],
          },
        },
      ],
    }).compile();
    strategy = moduleRef.get(SocialEmbeddedStrategy);
  });

  // Helper para construir la cookie con el estado pendiente, ahora con el
  // campo interactionEvent requerido por el nuevo SocialPending.
  function socialCookieReq(overrides: Partial<Record<string, unknown>> = {}) {
    const pending = {
      connectorId: "gh-connector-1",
      redirectUri: "https://api.aeis-app.online/auth/social/callback",
      interactionCookie: "_interaction=pending",
      verificationId: "verif-social-1",
      interactionEvent: "Register",  // ahora siempre arranca como Register
      codeVerifier: "verifier-social-1",
      logtoState: "logto-state-1",
      oauthState: "oauth-state-1",
      ...overrides,
    };
    return { signedCookies: { aeis_social_pending: JSON.stringify(pending) } } as any;
  }

  it("Dado ?connector=github, Cuando se llama start(), Entonces arranca la interacción con Logto como Register, guarda una cookie firmada con el estado pendiente, y redirige DIRECTO a la URL real de GitHub (nunca a Logto)", async () => {
    const res = mockResponse();
    logtoExperience.getSocialAuthorizationUri.mockResolvedValue({
      cookie: "_interaction=with-social-uri",
      authorizationUri: "https://github.com/login/oauth/authorize?client_id=real-client-id&state=xyz",
      verificationId: "verif-social-1",
    });

    await strategy.start("github", res);

    expect(logtoExperience.startInteraction).toHaveBeenCalled();
    // Ahora arranca como Register, no como SignIn (bug fix: caso masivo = usuario nuevo)
    expect(logtoExperience.setInteractionEvent).toHaveBeenCalledWith("_interaction=cookie-1", "Register");
    expect(logtoExperience.getSocialAuthorizationUri).toHaveBeenCalledWith(
      "_interaction=cookie-2",
      "gh-connector-1",
      expect.any(String),
      "https://api.aeis-app.online/auth/social/callback"
    );
    expect(res.cookie).toHaveBeenCalledWith(
      "aeis_social_pending",
      expect.stringContaining("gh-connector-1"),
      expect.objectContaining({ httpOnly: true, signed: true, secure: true })
    );
    // La cookie debe incluir interactionEvent="Register"
    const cookiePayload = JSON.parse(res.cookie.mock.calls[0][1]);
    expect(cookiePayload.interactionEvent).toBe("Register");
    expect(res.redirect).toHaveBeenCalledWith(
      "https://github.com/login/oauth/authorize?client_id=real-client-id&state=xyz"
    );
  });

  it("Dado un connector desconocido o ausente, Cuando se llama start(), Entonces redirige con auth_error=connector_invalido sin tocar Logto", async () => {
    const res = mockResponse();

    await strategy.start("facebook", res);

    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/?auth_error=connector_invalido");
    expect(logtoExperience.startInteraction).not.toHaveBeenCalled();
  });

  it("Dado que Logto sigue con credenciales placeholder, Cuando se llama start(), Entonces redirige con auth_error=logto_not_configured en vez de un 500", async () => {
    const res = mockResponse();
    logto.authorizationUrl.mockImplementationOnce(() => {
      throw new Error("Logto no está configurado o no respondió al arrancar el backend — revisa LOGTO_ISSUER");
    });

    await strategy.start("github", res);

    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/?auth_error=logto_not_configured");
  });

  it("Dado que la Experience API rechaza el inicio del login social, Cuando se llama start(), Entonces redirige con auth_error=social_login_failed sin exponer el detalle interno", async () => {
    const res = mockResponse();
    logtoExperience.getSocialAuthorizationUri.mockRejectedValue(
      new ExperienceApiError(404, "entity.not_found", "The resource does not exist.")
    );

    await strategy.start("google", res);

    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/?auth_error=social_login_failed");
  });

  it("Dado un callback de GitHub válido (code+state coinciden con la cookie), Cuando se llama callback(), Entonces verifica, completa la interacción de Logto, y redirige al frontend con el access_token en el FRAGMENTO", async () => {
    const req = socialCookieReq();
    const res = mockResponse();
    logtoExperience.verifySocial.mockResolvedValue("_interaction=verified-social");
    logtoExperience.submitIdentification.mockResolvedValue({ status: 204, cookie: "_interaction=identified" });
    logtoExperience.submitInteraction.mockResolvedValue({
      cookie: "_interaction=submitted",
      redirectTo: "https://tenant.logto.app/callback",
    });
    logtoExperience.completeAuthorization.mockResolvedValue({ code: "auth-code-1", state: "logto-state-1", iss: undefined });
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-social-1",
      claims: () => ({ sub: "github|social1", email: "estudiante@gmail.com", name: "Estudiante" }),
    });

    await strategy.callback("gh-code-1", "oauth-state-1", undefined, req, res);

    expect(logtoExperience.verifySocial).toHaveBeenCalledWith(
      "_interaction=pending",
      "gh-connector-1",
      "verif-social-1",
      "gh-code-1",
      "https://api.aeis-app.online/auth/social/callback"
    );
    expect(res.clearCookie).toHaveBeenCalledWith("aeis_social_pending");
    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/#access_token=at-social-1");
  });

  it("Dado que falta la cookie de estado pendiente (expiró o nunca se puso), Cuando se llama callback(), Entonces redirige con auth_error=social_session_expired sin llamar a Logto", async () => {
    const req = { signedCookies: {} } as any;
    const res = mockResponse();

    await strategy.callback("gh-code-1", "oauth-state-1", undefined, req, res);

    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/?auth_error=social_session_expired");
    expect(logtoExperience.verifySocial).not.toHaveBeenCalled();
  });

  it("Dado que el `state` que vuelve NO coincide con el guardado en la cookie (posible CSRF), Cuando se llama callback(), Entonces rechaza con auth_error=social_login_cancelled sin llamar a verifySocial", async () => {
    const req = socialCookieReq();
    const res = mockResponse();

    await strategy.callback("gh-code-1", "state-distinto-al-guardado", undefined, req, res);

    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/?auth_error=social_login_cancelled");
    expect(logtoExperience.verifySocial).not.toHaveBeenCalled();
  });

  it("Dado que GitHub/Google devuelve ?error= (el estudiante canceló el consentimiento), Cuando se llama callback(), Entonces redirige con auth_error=social_login_cancelled sin llamar a Logto", async () => {
    const req = socialCookieReq();
    const res = mockResponse();

    await strategy.callback(undefined, "oauth-state-1", "access_denied", req, res);

    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/?auth_error=social_login_cancelled");
    expect(logtoExperience.verifySocial).not.toHaveBeenCalled();
  });

  it("Dado un usuario existente (arrancó como Register pero identity_already_exist), Cuando callback() recibe el error, Entonces reintenta como SignIn sin pedir código nuevo", async () => {
    const req = socialCookieReq({ interactionEvent: "Register" });
    const res = mockResponse();
    logtoExperience.verifySocial.mockResolvedValue("_interaction=verified-social");
    logtoExperience.submitIdentification
      .mockResolvedValueOnce({ status: 422, errorCode: "user.identity_already_exist", cookie: "_interaction=identified" })
      .mockResolvedValueOnce({ status: 204, cookie: "_interaction=signed-in" });
    logtoExperience.setInteractionEvent.mockResolvedValueOnce("_interaction=signin-event");
    logtoExperience.submitInteraction.mockResolvedValue({
      cookie: "_interaction=submitted",
      redirectTo: "https://tenant.logto.app/callback",
    });
    logtoExperience.completeAuthorization.mockResolvedValue({ code: "auth-code-2", state: "logto-state-1", iss: undefined });
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-existing",
      claims: () => ({ sub: "google|existing1", email: "existente@gmail.com", name: "Existente" }),
    });

    await strategy.callback("google-code-1", "oauth-state-1", undefined, req, res);

    expect(logtoExperience.setInteractionEvent).toHaveBeenCalledWith("_interaction=identified", "SignIn");
    expect(logtoExperience.submitIdentification).toHaveBeenCalledTimes(2);
    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/#access_token=at-existing");
  });

  it("Dado un usuario existente con el código REAL que manda Logto hoy (identity_already_in_use, no identity_already_exist), Cuando callback() recibe el error, Entonces igual reintenta como SignIn — bug real reportado en producción: este código faltaba y el login fallaba en silencio", async () => {
    const req = socialCookieReq({ interactionEvent: "Register" });
    const res = mockResponse();
    logtoExperience.verifySocial.mockResolvedValue("_interaction=verified-social");
    logtoExperience.submitIdentification
      .mockResolvedValueOnce({ status: 422, errorCode: "user.identity_already_in_use", cookie: "_interaction=identified" })
      .mockResolvedValueOnce({ status: 204, cookie: "_interaction=signed-in" });
    logtoExperience.setInteractionEvent.mockResolvedValueOnce("_interaction=signin-event");
    logtoExperience.submitInteraction.mockResolvedValue({
      cookie: "_interaction=submitted",
      redirectTo: "https://tenant.logto.app/callback",
    });
    logtoExperience.completeAuthorization.mockResolvedValue({ code: "auth-code-3", state: "logto-state-1", iss: undefined });
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-existing-2",
      claims: () => ({ sub: "github|existing2", email: "existente2@github.com", name: "Existente Dos" }),
    });

    await strategy.callback("github-code-1", "oauth-state-1", undefined, req, res);

    expect(logtoExperience.setInteractionEvent).toHaveBeenCalledWith("_interaction=identified", "SignIn");
    expect(logtoExperience.submitIdentification).toHaveBeenCalledTimes(2);
    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/#access_token=at-existing-2");
  });

  it("Dado un correo nuevo (primera vez con GitHub/Google), Cuando /auth/social/callback recibe user.user_not_exist, Entonces reintenta la MISMA verificación como registro — sin pedir un código nuevo, a diferencia del correo", async () => {
    const req = socialCookieReq({ interactionEvent: "SignIn" });
    const res = mockResponse();
    logtoExperience.verifySocial.mockResolvedValue("_interaction=verified-social");
    logtoExperience.submitIdentification
      .mockResolvedValueOnce({ status: 422, errorCode: "user.user_not_exist", cookie: "_interaction=identified" })
      .mockResolvedValueOnce({ status: 204, cookie: "_interaction=registered" });
    logtoExperience.setInteractionEvent.mockResolvedValueOnce("_interaction=register-event");
    logtoExperience.submitInteraction.mockResolvedValue({
      cookie: "_interaction=submitted",
      redirectTo: "https://tenant.logto.app/callback",
    });
    logtoExperience.completeAuthorization.mockResolvedValue({ code: "auth-code-2", state: "logto-state-1", iss: undefined });
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-social-2",
      claims: () => ({ sub: "google|social2", email: "nuevo@gmail.com", name: "Estudiante Nuevo" }),
    });

    await strategy.callback("google-code-1", "oauth-state-1", undefined, req, res);

    expect(logtoExperience.setInteractionEvent).toHaveBeenCalledWith("_interaction=identified", "Register");
    expect(logtoExperience.submitIdentification).toHaveBeenCalledTimes(2);
    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/#access_token=at-social-2");
  });

  it("Dado que la identificación sigue fallando incluso tras el reintento, Cuando se llama callback(), Entonces redirige con auth_error=social_login_failed en vez de colgarse o tirar un 500", async () => {
    const req = socialCookieReq();
    const res = mockResponse();
    logtoExperience.verifySocial.mockResolvedValue("_interaction=verified-social");
    logtoExperience.submitIdentification.mockResolvedValue({
      status: 422,
      errorCode: "user.identity_already_exist",
      cookie: "_interaction=identified",
    });
    logtoExperience.setInteractionEvent.mockResolvedValueOnce("_interaction=signin-event");

    await strategy.callback("gh-code-1", "oauth-state-1", undefined, req, res);

    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/?auth_error=social_login_failed");
    expect(logtoExperience.submitInteraction).not.toHaveBeenCalled();
  });

  it("Dado que la Experience API rechaza verifySocial (ej. código ya usado o vencido), Cuando se llama callback(), Entonces redirige con auth_error=social_login_failed sin exponer el detalle interno de Logto", async () => {
    const req = socialCookieReq();
    const res = mockResponse();
    logtoExperience.verifySocial.mockRejectedValue(
      new ExperienceApiError(400, "connector.general", "detalle interno del proveedor social")
    );

    await strategy.callback("gh-code-vencido", "oauth-state-1", undefined, req, res);

    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/?auth_error=social_login_failed");
  });
});
