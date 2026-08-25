import { IsArray, IsNumber, IsOptional, Min } from "class-validator";

// benefits se deja como array SIN una clase anidada a propósito — con
// whitelist:true global (ver main.ts), validar contra una clase que solo
// declarara "type" habría BORRADO en silencio el resto de cada beneficio
// (percent/value/included/...) al transformarlo. La forma real es
// deliberadamente libre (ver schema.prisma: SubscriptionTier.benefits Json,
// y subscription-benefits.service.ts, que interpreta y acota los valores) —
// acá solo se valida que sea un array; AdminService.updateSubscriptionTier
// revisa a mano que cada elemento sea un objeto con "type" antes de guardar.
export class UpdateSubscriptionTierDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01, { message: "El monto debe ser mayor a 0" })
  amount?: number;

  @IsOptional()
  @IsArray({ message: "benefits debe ser un array" })
  benefits?: unknown[];
}
