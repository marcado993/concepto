import { IsInt, IsString } from "class-validator";

// Parámetros que PayPhone devuelve en el redirect tras completar el pago
// en la Cajita de Pagos (?id=&clientTransactionId=) — ver
// payphone.client.ts y RentLockerModal.svelte.
export class ConfirmPayphoneDto {
  @IsInt()
  id!: number;

  @IsString()
  clientTransactionId!: string;
}
