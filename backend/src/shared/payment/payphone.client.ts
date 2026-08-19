import { Injectable, Logger } from "@nestjs/common";

// Cliente de PayPhone — integración real contra la "Cajita de Pagos"
// (https://payphonetodoesposible.com), NO el antiguo stub.
//
// El flujo real de la Cajita de Pagos es client-side, no un cobro que el
// backend pueda disparar de un solo golpe:
//   1. El navegador renderiza el widget de PayPhone (token+storeId
//      públicos, ver getPublicConfig()) con un clientTransactionId que
//      nosotros elegimos — usamos el id del LockerRental que ya quedó
//      PENDING/RESERVED en la base de datos (mismo patrón que TRANSFER).
//   2. El estudiante paga en el widget/página de PayPhone.
//   3. PayPhone redirige la página completa (todo el dominio, configurado
//      en Payphone Developer, no por request) con ?id=&clientTransactionId=
//      en la URL — el frontend (App.svelte) captura esos parámetros y llama
//      a POST /lockers/payphone/confirm.
//   4. Recién ahí el backend llama a esta API (Confirm) para verificar que
//      la transacción fue realmente aprobada antes de marcar el pago como
//      CONFIRMED — nunca se confía en el simple hecho de que el navegador
//      volvió con esos parámetros, alguien podría fabricarlos a mano.
//
// PAYPHONE_TOKEN se usa en dos lugares (por diseño de PayPhone, no una
// elección nuestra): lo recibe el navegador para renderizar el widget, Y
// autentica esta llamada server-to-server — no es un secreto en el sentido
// clásico, es más parecido a una publishable key.

export interface PayphonePublicConfig {
  configured: boolean;
  token: string;
  storeId: string;
}

export interface PayphoneConfirmResult {
  approved: boolean;
  transactionId: number;
  clientTransactionId: string;
  amountCents: number;
  raw: unknown;
}

const CONFIRM_URL = "https://paymentbox.payphonetodoesposible.com/api/confirm";

@Injectable()
export class PayphoneClient {
  private readonly logger = new Logger(PayphoneClient.name);

  getPublicConfig(): PayphonePublicConfig {
    const token = process.env.PAYPHONE_TOKEN ?? "";
    const storeId = process.env.PAYPHONE_STORE_ID ?? "";
    return { configured: Boolean(token && storeId), token, storeId };
  }

  // Confirma el estado real de una transacción ante PayPhone — ver
  // "Consultar respuesta de la transacción" en la documentación oficial.
  // clientTransactionId es el id del LockerRental que nosotros generamos
  // (ver locker.service.ts confirmPayphonePayment); transactionId es el
  // `id` numérico que PayPhone asigna y devuelve en el redirect.
  async confirm(transactionId: number, clientTransactionId: string): Promise<PayphoneConfirmResult> {
    const token = process.env.PAYPHONE_TOKEN;
    if (!token) {
      throw new Error("PAYPHONE_TOKEN no está configurado — no se puede confirmar el pago");
    }

    let res: Response;
    try {
      res = await fetch(CONFIRM_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: transactionId, clientTxId: clientTransactionId }),
      });
    } catch (err) {
      this.logger.error(`PayPhone Confirm API no respondió: ${(err as Error).message}`);
      throw new Error("No se pudo contactar a PayPhone para confirmar el pago");
    }

    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !body || body.errorCode !== undefined) {
      this.logger.warn(`PayPhone Confirm rechazado: ${JSON.stringify(body)}`);
      throw new Error((body?.message as string) ?? "PayPhone rechazó la confirmación de la transacción");
    }

    return {
      // Sin fallback a `clientTransactionId` (el valor que NOSOTROS
      // mandamos) — el llamador compara este campo contra el rentalId/
      // subscriptionId que dice estar confirmando, precisamente para
      // detectar que UN pago real aprobado se reutilice para confirmar
      // OTRO alquiler/aportación distinto (hallazgo de auditoría de
      // seguridad). Si PayPhone no devuelve este campo, `String(undefined)`
      // nunca calza con un id real — falla cerrado, no abierto.
      approved: body.transactionStatus === "Approved" && body.statusCode === 3,
      transactionId: Number(body.transactionId),
      clientTransactionId: String(body.clientTransactionId),
      amountCents: Number(body.amount),
      raw: body,
    };
  }
}
