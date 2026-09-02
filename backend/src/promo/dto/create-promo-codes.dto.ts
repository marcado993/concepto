import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";
import { NO_PAYLOAD_TEXT_MESSAGE, NO_PAYLOAD_TEXT_PATTERN } from "../../shared/validation/no-payload-text.pattern";
import { MAX_POR_LOTE } from "../promo-code.service";

export class CreatePromoCodesDto {
  /**
   * Cuántos códigos generar de una vez.
   *
   * El tope existe porque un cero de más ("100" en vez de "10") no debería
   * poder convertirse en mil casilleros regalados.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_POR_LOTE)
  cantidad!: number;

  /** 1..100. 100 = casillero gratis, es un valor válido y deliberado. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  discountPercent!: number;

  /**
   * A quién se le entrega, en texto libre.
   *
   * Pasa por NO_PAYLOAD_TEXT igual que el resto de campos libres de la app:
   * este texto se guarda y se vuelve a mostrar en el panel, así que es
   * exactamente la forma en que se cuela un payload en un campo que nadie
   * mira dos veces.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(NO_PAYLOAD_TEXT_PATTERN, { message: NO_PAYLOAD_TEXT_MESSAGE })
  note?: string;

  /** Fecha de vencimiento, opcional (ISO). Sin ella el código no caduca. */
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
