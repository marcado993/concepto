import { Role } from "@prisma/client";
import { roleSatisfies } from "./roles.guard";

describe("roleSatisfies (jerarquía de roles)", () => {
  it("Dado un Director, Cuando el endpoint exige Presidente, Entonces lo permite (Director ⊇ Presidente)", () => {
    expect(roleSatisfies(Role.DIRECTOR, Role.PRESIDENTE)).toBe(true);
  });

  it("Dado un Director, Cuando el endpoint exige Estudiante, Entonces lo permite", () => {
    expect(roleSatisfies(Role.DIRECTOR, Role.ESTUDIANTE)).toBe(true);
  });

  it("Dado un Presidente, Cuando el endpoint exige Director (auditoría de seguridad), Entonces lo RECHAZA — no hereda hacia arriba", () => {
    expect(roleSatisfies(Role.PRESIDENTE, Role.DIRECTOR)).toBe(false);
  });

  it("Dado un Estudiante, Cuando el endpoint exige Presidente, Entonces lo rechaza", () => {
    expect(roleSatisfies(Role.ESTUDIANTE, Role.PRESIDENTE)).toBe(false);
  });

  it("Dado un Estudiante, Cuando el endpoint exige Estudiante, Entonces lo permite", () => {
    expect(roleSatisfies(Role.ESTUDIANTE, Role.ESTUDIANTE)).toBe(true);
  });
});
