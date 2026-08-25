import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class ListAuditLogsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 30;

  // Filtro parcial contra AuditLog.action (ej. "locker" trae
  // locker.rental.created, locker.payphone.confirmed, etc.) — no un enum
  // cerrado, porque las acciones nuevas se agregan libremente en cada
  // dominio (ver audit.service.ts) sin tener que tocar este DTO cada vez.
  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  actorId?: string;
}
