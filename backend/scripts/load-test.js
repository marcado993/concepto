#!/usr/bin/env node
// Prueba de carga — "qué pasa si unas 100 entran al mismo tiempo".
//
// Requiere un servidor real corriendo (`npm run start:dev` o
// `start:prod`) contra una base de Postgres real con migraciones
// aplicadas — no se puede simular esto con mocks, porque lo que se está
// probando es precisamente la restricción @@unique de la base de datos
// bajo concurrencia real, no la lógica de negocio en aislamiento (eso ya
// lo cubren locker.service.spec.ts / subscription.service.spec.ts).
//
// Uso:
//   BASE_URL=http://localhost:3000 TOKEN=<jwt-de-prueba> node scripts/load-test.js
//
// Qué hace: dispara 100 requests CONCURRENTES a /lockers/rent para el
// MISMO casillero — el resultado esperado (y lo que hay que verificar a
// mano en la salida) es: exactamente 1 respuesta 201, 99 respuestas 409
// (LockerUnavailableError) o 429 (rate limit, según cuántas caigan dentro
// de la ventana de @Throttle del mismo IP/token de prueba) — NUNCA más de
// un 201, y NUNCA un 500 (eso indicaría que la restricción única no está
// protegiendo lo que se cree que protege).

const autocannon = require("autocannon");

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const TOKEN = process.env.TOKEN ?? "";
const LOCKER_CODE = process.env.LOCKER_CODE ?? "A01";
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 100);

async function main() {
  if (!TOKEN) {
    console.error("Falta TOKEN (un JWT válido de Logto/prueba) — ver comentario de este archivo.");
    process.exit(1);
  }

  console.log(
    `Disparando ${CONNECTIONS} requests concurrentes a ${BASE_URL}/lockers/rent (casillero ${LOCKER_CODE})...`
  );

  const result = await autocannon({
    url: `${BASE_URL}/lockers/rent`,
    connections: CONNECTIONS,
    amount: CONNECTIONS, // exactamente una request por conexión — no un stream sostenido
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ lockerCode: LOCKER_CODE, method: "TRANSFER" }),
  });

  console.log(autocannon.printResult(result));
  console.log("\nRevisar manualmente en los logs del servidor / base de datos:");
  console.log("  - Exactamente 1 LockerRental creado para este casillero+periodo.");
  console.log("  - 0 errores 500 (cualquier 500 aquí es un bug real, no ruido de carga).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
