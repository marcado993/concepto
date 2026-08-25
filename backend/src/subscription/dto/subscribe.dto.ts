import { IsIn, Matches, MinLength } from "class-validator";
import { FULL_NAME_PATTERN, FULL_NAME_MESSAGE } from "../../shared/validation/full-name.pattern";

// Nombres de tier confirmados por el sponsor
// (docs/dominio/02-necesidades-stakeholders.md §2.2): Bronce, Platino,
// Pantera. Los MONTOS no — viven en SubscriptionTier (base de datos), no
// aquí, precisamente porque ya cambiaron una vez en el histórico real
// (docs/dominio/03-analisis-financiero-costos.md §3) y el modelo debe
// tolerar que vuelvan a cambiar sin tocar código.
export const SUBSCRIPTION_TIER_NAMES = ["Bronce", "Platino", "Pantera"] as const;
export type SubscriptionTierName = (typeof SUBSCRIPTION_TIER_NAMES)[number];

export class SubscribeDto {
  @IsIn(SUBSCRIPTION_TIER_NAMES)
  tierName!: SubscriptionTierName;

  // Mismo motivo/patrón que RentLockerDto.fullName — antes aportar nunca
  // pedía/confirmaba el nombre en absoluto, así que un estudiante que
  // SOLO aportara (nunca alquiló un casillero) se quedaba con el
  // placeholder interno para siempre (bug real: ese placeholder llegó a
  // ser literalmente su correo, ver auth.service.ts).
  @Matches(FULL_NAME_PATTERN, { message: FULL_NAME_MESSAGE })
  @MinLength(3)
  fullName!: string;
}
