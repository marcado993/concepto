import { IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from "class-validator";

export class CreateVentureDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  description!: string;

  @IsString()
  @MaxLength(40)
  category!: string;

  @IsOptional()
  @IsUrl()
  photoUrl?: string;

  // Solo dígitos, con código de país — ej. 593987654321. La validación de
  // formato vive aquí; el número crudo nunca sale del backend hacia el
  // directorio público (ver venture.service.ts, whatsappLink()).
  @Matches(/^\d{8,15}$/, { message: "whatsappNumber debe ser solo dígitos, con código de país (ej. 593987654321)" })
  whatsappNumber!: string;
}
