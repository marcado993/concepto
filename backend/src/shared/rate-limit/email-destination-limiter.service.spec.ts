import { EmailDestinationLimiter } from "./email-destination-limiter.service";

// El @Throttle() de auth.controller.ts limita por IP; esto limita por
// correo DESTINO, que es lo único que frena un ataque distribuido (muchas
// IPs, un solo blanco) y el agotamiento de la cuota de envío de Mailgun.
describe("EmailDestinationLimiter", () => {
  let limiter: EmailDestinationLimiter;

  beforeEach(() => {
    limiter = new EmailDestinationLimiter();
  });

  afterEach(() => {
    limiter.onModuleDestroy();
  });

  it("Dado un correo que nunca pidió código, Cuando pide los primeros 3, Entonces los tres pasan (un estudiante real reintenta alguna vez)", () => {
    expect(limiter.tryConsume("estudiante@epn.edu.ec")).toBe(true);
    expect(limiter.tryConsume("estudiante@epn.edu.ec")).toBe(true);
    expect(limiter.tryConsume("estudiante@epn.edu.ec")).toBe(true);
  });

  it("Dado un correo que ya pidió 3 códigos en la ventana, Cuando pide el cuarto, Entonces se bloquea — esto es lo que evita el email bombing a un tercero", () => {
    limiter.tryConsume("victima@gmail.com");
    limiter.tryConsume("victima@gmail.com");
    limiter.tryConsume("victima@gmail.com");

    expect(limiter.tryConsume("victima@gmail.com")).toBe(false);
    expect(limiter.tryConsume("victima@gmail.com")).toBe(false);
  });

  it("Dado que un correo llegó a su límite, Cuando OTRO correo distinto pide un código, Entonces no se ve afectado — el límite es por destino, no global", () => {
    limiter.tryConsume("uno@epn.edu.ec");
    limiter.tryConsume("uno@epn.edu.ec");
    limiter.tryConsume("uno@epn.edu.ec");
    expect(limiter.tryConsume("uno@epn.edu.ec")).toBe(false);

    expect(limiter.tryConsume("otro@epn.edu.ec")).toBe(true);
  });

  it("Dado el MISMO correo escrito con distinta capitalización o espacios, Cuando pide códigos, Entonces cuenta como el mismo destino (si no, cambiar una mayúscula esquivaría el límite entero)", () => {
    limiter.tryConsume("Estudiante@EPN.edu.ec");
    limiter.tryConsume("  estudiante@epn.edu.ec  ");
    limiter.tryConsume("ESTUDIANTE@EPN.EDU.EC");

    expect(limiter.tryConsume("estudiante@epn.edu.ec")).toBe(false);
  });

  it("Dado que pasó la ventana de tiempo, Cuando el correo pide otro código, Entonces vuelve a estar permitido (es un límite temporal, no un bloqueo permanente)", () => {
    jest.useFakeTimers();
    try {
      limiter.tryConsume("estudiante@epn.edu.ec");
      limiter.tryConsume("estudiante@epn.edu.ec");
      limiter.tryConsume("estudiante@epn.edu.ec");
      expect(limiter.tryConsume("estudiante@epn.edu.ec")).toBe(false);

      jest.advanceTimersByTime(15 * 60 * 1000 + 1000);

      expect(limiter.tryConsume("estudiante@epn.edu.ec")).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
