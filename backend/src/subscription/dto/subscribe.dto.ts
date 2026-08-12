import { IsIn, IsString } from "class-validator";
import { PaymentMethod } from "../../locker/rental-calculator";

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

  @IsIn(["TRANSFER", "PAYPHONE"] satisfies PaymentMethod[])
  method!: PaymentMethod;
}
