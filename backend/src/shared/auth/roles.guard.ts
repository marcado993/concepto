import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";
import { ROLES_KEY } from "./roles.decorator";

// Jerarquía de roles confirmada por el sponsor
// (docs/dominio/02-necesidades-stakeholders.md §1): Director tiene TODO lo
// del Presidente, más auditoría técnica. No es un simple admin/no-admin de
// dos niveles — es política de negocio real, así que vive en código, no
// como comentario.
const ROLE_HIERARCHY: Record<Role, Role[]> = {
  [Role.ESTUDIANTE]: [Role.ESTUDIANTE],
  [Role.PRESIDENTE]: [Role.PRESIDENTE, Role.ESTUDIANTE],
  [Role.DIRECTOR]: [Role.DIRECTOR, Role.PRESIDENTE, Role.ESTUDIANTE],
};

export function roleSatisfies(userRole: Role, required: Role): boolean {
  return ROLE_HIERARCHY[userRole]?.includes(required) ?? false;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const userRole: Role | undefined = request.user?.role;
    if (!userRole) return false;

    return required.some((role) => roleSatisfies(userRole, role));
  }
}
