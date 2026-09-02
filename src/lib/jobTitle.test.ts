import { describe, it, expect } from "vitest";
import { tituloLegible } from "./jobTitle";

describe("tituloLegible", () => {
  // Titulos REALES tal como llegan de Multitrabajos, Indeed y la Bolsa EPN.
  // El texto en mayusculas elimina la silueta de la palabra, que es de lo
  // que mas entorpece la lectura a alguien con dislexia.
  it.each([
    ["PASANTE BUSINESS INTELLIGENCE", "Pasante Business Intelligence"],
    ["DESARROLLADOR JUNIOR PARA QUITO", "Desarrollador Junior para Quito"],
    ["PASANTE DE SGI", "Pasante de SGI"],
    ["DESARROLLADOR .NET + ANGULAR", "Desarrollador .NET + Angular"],
  ])("Dado el titulo gritado '%s', Cuando se muestra, Entonces se lee sin gritar", (entrada, esperado) => {
    expect(tituloLegible(entrada)).toBe(esperado);
  });

  // Reescribir algo bien escrito es tan malo como dejar el grito: se pierde
  // la capitalizacion que la empresa eligio a proposito.
  it.each([
    ["Pasante de Ciberseguridad"],
    ["Senior Backend Developer (Remote)"],
    ["Desarrollador Full Stack"],
    ["Analista de Datos Junior"],
  ])("Dado el titulo ya bien escrito '%s', Cuando se muestra, Entonces NO se toca", (entrada) => {
    expect(tituloLegible(entrada)).toBe(entrada);
  });

  // Sin la lista de siglas, "PASANTE TI" terminaba como "Pasante Ti", que
  // se lee PEOR que el original: una sigla en minuscula deja de parecer
  // una sigla.
  it.each([
    ["PASANTE TI", "Pasante TI"],
    ["ANALISTA SQL SENIOR", "Analista SQL Senior"],
    ["PRACTICANTE DE RRHH Y TI", "Practicante de RRHH y TI"],
    ["SOPORTE IT - QA", "Soporte IT - QA"],
    ["PASANTE DE SGI", "Pasante de SGI"],
    ["ANALISTA SST", "Analista SST"],
  ])("Dado '%s' con siglas, Cuando se muestra, Entonces las siglas siguen en mayuscula", (entrada, esperado) => {
    expect(tituloLegible(entrada)).toBe(esperado);
  });

  // Las palabras de union en minuscula son lo que separa
  // "Pasante De Sistemas De La Empresa" (que se lee a tropezones) de
  // "Pasante de Sistemas de la Empresa".
  it("Dado un titulo con conectores, Cuando se muestra, Entonces van en minuscula salvo al inicio", () => {
    expect(tituloLegible("PASANTE DE SISTEMAS DE LA EMPRESA")).toBe("Pasante de Sistemas de la Empresa");
  });

  it("Dado un conector AL INICIO, Cuando se muestra, Entonces si va con mayuscula", () => {
    expect(tituloLegible("DE PRACTICAS EN SISTEMAS")).toBe("De Practicas en Sistemas");
  });

  // Menos de 4 letras no alcanza para juzgar: "QA" es una sigla legitima,
  // no un grito.
  it.each([["QA"], ["TI"], ["BI"]])("Dada la sigla suelta '%s', Cuando se muestra, Entonces no se toca", (entrada) => {
    expect(tituloLegible(entrada)).toBe(entrada);
  });

  it("Dado un titulo con parentesis, Cuando se capitaliza, Entonces respeta la puntuacion inicial", () => {
    expect(tituloLegible("(EVENTUAL) PASANTE INFRAESTRUCTURA")).toBe("(Eventual) Pasante Infraestructura");
  });

  it("Dadas tildes en mayuscula, Cuando se muestra, Entonces se conservan", () => {
    expect(tituloLegible("PASANTÍA DE INGENIERÍA")).toBe("Pasantía de Ingeniería");
  });

  it.each([[""], ["   "]])("Dado un titulo vacio %p, Cuando se muestra, Entonces no revienta", (entrada) => {
    expect(tituloLegible(entrada)).toBe("");
  });

  it("Dados espacios repetidos, Cuando se muestra, Entonces los colapsa", () => {
    expect(tituloLegible("PASANTE    DE   SISTEMAS")).toBe("Pasante de Sistemas");
  });
});
