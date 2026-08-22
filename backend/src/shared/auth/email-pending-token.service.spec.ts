import { ConfigService } from "@nestjs/config";
import { EmailPendingTokenService } from "./email-pending-token.service";

function makeService(secret = "test-secret") {
  const config = { getOrThrow: () => secret } as unknown as ConfigService;
  return new EmailPendingTokenService(config);
}

describe("EmailPendingTokenService", () => {
  it("Dado un payload cualquiera, Cuando se firma y luego se verifica, Entonces devuelve el mismo payload intacto", () => {
    const service = makeService();
    const payload = { email: "estudiante@epn.edu.ec", verificationId: "verif-1" };

    const token = service.sign(payload);
    const result = service.verify<typeof payload>(token);

    expect(result).toEqual(payload);
  });

  it("Dado un token sin firma o con formato inválido, Cuando se verifica, Entonces rechaza en vez de lanzar", () => {
    const service = makeService();
    expect(service.verify("solo-una-parte-sin-punto")).toBeNull();
    expect(service.verify("")).toBeNull();
    expect(service.verify(undefined)).toBeNull();
  });

  it("Dado un token firmado con OTRO secreto, Cuando se verifica, Entonces lo rechaza — nunca confía en la firma de otra clave", () => {
    const firmadoConOtraClave = makeService("clave-distinta").sign({ x: 1 });
    const service = makeService("test-secret");
    expect(service.verify(firmadoConOtraClave)).toBeNull();
  });

  it("Dado un token válido cuyo payload fue alterado a mano (misma firma, JSON distinto), Cuando se verifica, Entonces lo rechaza", () => {
    const service = makeService();
    const token = service.sign({ email: "victima@epn.edu.ec" });
    const [, sig] = token.split(".");
    const payloadFalso = Buffer.from(JSON.stringify({ payload: { email: "atacante@epn.edu.ec" }, exp: Date.now() + 999_999 })).toString(
      "base64url"
    );
    expect(service.verify(`${payloadFalso}.${sig}`)).toBeNull();
  });

  it("Dado un token cuya firma tiene distinto LARGO que la esperada, Cuando se verifica, Entonces rechaza sin lanzar (timingSafeEqual exige mismo largo)", () => {
    const service = makeService();
    const token = service.sign({ x: 1 });
    const [json] = token.split(".");
    expect(() => service.verify(`${json}.firma-corta`)).not.toThrow();
    expect(service.verify(`${json}.firma-corta`)).toBeNull();
  });

  it("Dado un token cuyo plazo de 10 minutos ya venció, Cuando se verifica, Entonces lo rechaza aunque la firma sea válida", () => {
    const service = makeService();
    const yaVencido = { payload: { x: 1 }, exp: Date.now() - 1000 };
    const json = Buffer.from(JSON.stringify(yaVencido)).toString("base64url");
    // Firma real con el mismo secreto — solo el "exp" está manipulado a
    // propósito para simular el paso del tiempo sin depender de temporizadores.
    const crypto = jest.requireActual("node:crypto") as typeof import("node:crypto");
    const sig = crypto.createHmac("sha256", "test-secret").update(json).digest("base64url");
    expect(service.verify(`${json}.${sig}`)).toBeNull();
  });
});
