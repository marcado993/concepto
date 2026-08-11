import { Injectable, Logger } from "@nestjs/common";

// Cliente de PayPhone — hoy es un stub explícito, no una integración real.
//
// docs/dominio/01-analisis-negocio-mision.md §5 (Pago) confirma que se
// reutiliza/porta el `PayPhoneService` YA implementado y probado en
// aeis-app (Spring Boot) — este archivo es el punto de reemplazo cuando se
// porte esa lógica; la interfaz (`charge`) es estable para que
// LockerService/SubscriptionService no tengan que cambiar cuando eso pase.
//
// No se conecta a la API real de PayPhone sin credenciales de sandbox
// reales — inventar una integración "que compile" contra un endpoint que
// nadie configuró sería peor que dejarlo explícito.

export interface PayphoneChargeResult {
  providerRef: string;
  confirmed: boolean;
}

@Injectable()
export class PayphoneClient {
  private readonly logger = new Logger(PayphoneClient.name);

  async charge(amountUsd: number, userId: string): Promise<PayphoneChargeResult> {
    this.logger.warn(
      `PayphoneClient.charge() es un stub — portar PayPhoneService de aeis-app antes de producción. amount=${amountUsd} user=${userId}`
    );
    throw new Error(
      "PayphoneClient no está implementado todavía — ver docs/dominio/01-analisis-negocio-mision.md §5"
    );
  }
}
