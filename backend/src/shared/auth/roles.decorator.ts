import { SetMetadata } from "@nestjs/common";
import { Role } from "@prisma/client";

export const ROLES_KEY = "roles";

// Uso: @Roles(Role.PRESIDENTE) — el guard resuelve la jerarquía
// (Director hereda todo lo de Presidente, ver docs/dominio/02 §1), así que
// un endpoint marcado @Roles(Role.PRESIDENTE) también lo puede llamar un
// Director. Nunca al revés.
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
