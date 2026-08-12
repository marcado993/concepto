import { evaluate, describe as describeSnapshot, DEFAULT_THRESHOLDS } from "./resource-thresholds";

describe("evaluate (umbrales de CPU/memoria)", () => {
  it("Dado un CPU y memoria bajos, Cuando se evalúa, Entonces el nivel es ok (sin alertar)", () => {
    expect(evaluate({ cpuLoadRatio: 0.3, memoryUsedRatio: 0.4 })).toBe("ok");
  });

  it("Dado un CPU justo en el umbral de warning (0.75), Cuando se evalúa, Entonces alerta warning", () => {
    expect(evaluate({ cpuLoadRatio: 0.75, memoryUsedRatio: 0.1 })).toBe("warning");
  });

  it("Dado un CPU en el umbral crítico (0.9), Cuando se evalúa, Entonces alerta critical — \"el CPU ya va a morir\"", () => {
    expect(evaluate({ cpuLoadRatio: 0.9, memoryUsedRatio: 0.1 })).toBe("critical");
  });

  it("Dado un CPU bajo pero memoria en nivel crítico, Cuando se evalúa, Entonces también alerta critical (cualquiera de los dos dispara, no hace falta que ambos estén mal)", () => {
    expect(evaluate({ cpuLoadRatio: 0.1, memoryUsedRatio: 0.95 })).toBe("critical");
  });

  it("Dados umbrales personalizados, Cuando se evalúa, Entonces respeta esos umbrales en vez de los por defecto", () => {
    const laxos = { ...DEFAULT_THRESHOLDS, cpuWarning: 0.99, cpuCritical: 0.999 };
    expect(evaluate({ cpuLoadRatio: 0.8, memoryUsedRatio: 0.1 }, laxos)).toBe("ok");
  });
});

describe("describe (mensaje de alerta)", () => {
  it("Dado un snapshot crítico, Cuando se describe, Entonces el mensaje incluye el nivel en mayúsculas y los porcentajes redondeados", () => {
    const msg = describeSnapshot({ cpuLoadRatio: 0.913, memoryUsedRatio: 0.5 }, "critical");
    expect(msg).toContain("CRITICAL");
    expect(msg).toContain("91%");
    expect(msg).toContain("50%");
  });
});
