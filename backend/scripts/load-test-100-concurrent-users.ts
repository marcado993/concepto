// Prueba de carga real: 100 estudiantes DISTINTOS alquilando 100 casilleros
// DISTINTOS al mismo tiempo (no la carrera por el MISMO casillero — eso ya
// lo cubre scripts/load-test.js). Esto es "carga legítima" según
// docs/dominio/12-concurrencia-y-testing.md §1 ("Lo que NO es un caso de
// concurrencia aquí") — lo que se mide es cuánto tarda el pool de
// conexiones de Postgres en atender 100 escrituras concurrentes según
// cuántas conexiones reales tenga disponibles, no si hay una condición de
// carrera (no la hay: cada request toca una fila distinta).
//
// Corre LOCAL contra el Postgres de docker-compose.yml — nunca contra
// producción (100 alquileres reales ocuparían casilleros de estudiantes
// reales y mandarían 100 correos de contrato reales). El resultado es
// igual de válido para la VPS real (2 OCPU) porque lo que se está midiendo
// es el límite de conexiones de Prisma, que es un cálculo (2*cpu+1), no
// una propiedad física de la máquina donde corre este script.
//
// Uso:
//   POOL_SIZE=5  npx ts-node scripts/load-test-100-concurrent-users.ts
//   POOL_SIZE=20 npx ts-node scripts/load-test-100-concurrent-users.ts
//   N_USERS=1700 POOL_SIZE=5 npx ts-node scripts/load-test-100-concurrent-users.ts
//
// N_USERS > 108 (los casilleros reales que hay) es a propósito el escenario
// del día real de apertura: más demanda que oferta. Los códigos de casillero
// se REPITEN (módulo 108) — cada uno recibe varios intentos simultáneos, así
// que esto YA deja de ser "carga legítima sin condición de carrera" y pasa a
// probar el Caso 1 de docs/dominio/12-concurrencia-y-testing.md a escala
// real: la restricción @@unique([lockerId, periodId]) tiene que seguir
// garantizando EXACTAMENTE un 201 por casillero, sin importar cuántos
// estudiantes distintos compitan por él a la vez.
//
// Requiere: docker compose up -d postgres, migraciones aplicadas, seed
// corrido (108 casilleros reales + periodo 2026-B) — ver prisma/seed.ts.

import { randomUUID } from "crypto";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { CanActivate, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import http from "http";

const POOL_SIZE = Number(process.env.POOL_SIZE ?? 5);
const CONCURRENT_USERS = Number(process.env.N_USERS ?? 100);

// DATABASE_URL con connection_limit explícito ANTES de importar AppModule
// (PrismaClient lee la variable de entorno al construirse) — así se puede
// comparar el mismo código contra distintos tamaños de pool sin tocar
// backend/.env real.
const baseUrl = process.env.DATABASE_URL ?? "postgresql://aeis:postgres@localhost:5433/aeis_app?schema=public";
const withPoolSize = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}connection_limit=${POOL_SIZE}&pool_timeout=30`;
process.env.DATABASE_URL = withPoolSize;

// Import diferido a PROPÓSITO — tiene que pasar DESPUÉS de fijar
// DATABASE_URL de arriba, si no PrismaService ya habría leído el valor
// original al cargar el módulo.
async function loadDeps() {
  const { AppModule } = await import("../src/app.module");
  const { JwtAuthGuard } = await import("../src/shared/auth/jwt-auth.guard");
  const { IS_PUBLIC_KEY } = await import("../src/shared/auth/public.decorator");
  const { PrismaService } = await import("../src/shared/prisma/prisma.service");
  const { PayphoneClient } = await import("../src/shared/payment/payphone.client");
  return { AppModule, JwtAuthGuard, IS_PUBLIC_KEY, PrismaService, PayphoneClient };
}

// Mismo TestAuthGuard que test/lockers.e2e-spec.ts — un header de prueba
// arma req.user sin necesitar un JWT real de Logto. Acá cada una de las
// 100 requests trae un userId DISTINTO (100 estudiantes reales, no el
// mismo actor repetido).
function buildTestAuthGuard(reflector: Reflector, IS_PUBLIC_KEY: string) {
  return class TestAuthGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
      if (isPublic) return true;
      const req = context.switchToHttp().getRequest();
      const header: string | undefined = req.headers.authorization;
      const match = header?.match(/^TestUser (.+):(ESTUDIANTE|PRESIDENTE|DIRECTOR)$/);
      if (!match) throw new UnauthorizedException();
      req.user = { id: match[1], role: match[2] };
      return true;
    }
  };
}

// Cédula ecuatoriana real (pasa el checksum) por cada "estudiante" —
// generada variando el secuencial final de una base válida y reajustando
// el dígito verificador, para no repetir la misma cédula 100 veces (el
// backend no lo prohíbe, pero no sería realista).
function cedulaValida(seq: number): string {
  const base = `17${String(seq % 100).padStart(2, "0")}00000`.slice(0, 9);
  const coef = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let v = Number(base[i]) * coef[i];
    if (v > 9) v -= 9;
    suma += v;
  }
  const verificador = suma % 10 === 0 ? 0 : 10 - (suma % 10);
  return base + verificador;
}

async function main() {
  const { AppModule, JwtAuthGuard, IS_PUBLIC_KEY, PrismaService, PayphoneClient } = await loadDeps();
  const reflector = new Reflector();
  const TestAuthGuard = buildTestAuthGuard(reflector, IS_PUBLIC_KEY);

  console.log(`\n=== POOL_SIZE=${POOL_SIZE} — arrancando la app NestJS completa ===`);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(JwtAuthGuard)
    .useFactory({ factory: (r: Reflector) => new TestAuthGuard(), inject: [Reflector] })
    .overrideProvider(PayphoneClient)
    .useValue({
      getPublicConfig: () => ({ configured: true, token: "load-test-token", storeId: "load-test-store" }),
      confirm: async (transactionId: number, clientTransactionId: string) => ({
        approved: true,
        transactionId,
        clientTransactionId,
        amountCents: 650,
        raw: {},
      }),
    })
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  // Mismo "trust proxy" que main.ts hace en bootstrap() — este script NO
  // pasa por main.ts (arranca el módulo directo, como el harness e2e), así
  // que sin esto Express ignora x-forwarded-for y ve las 100 requests como
  // UNA sola IP (127.0.0.1), disparando el rate limiter por IP de
  // locker.controller.ts antes de llegar a medir nada del pool de Postgres.
  app.set("trust proxy", 1);
  await app.init();
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === "object" && address ? address.port : 0;
  const prisma = moduleRef.get(PrismaService);

  // Casilleros reales sembrados (prisma/seed.ts) — sin prefijo de prueba,
  // son los códigos reales de la app. Con N_USERS > cantidad real de
  // casilleros, se cicla (índice % lockers.length) — a propósito, ver
  // comentario de arriba.
  const lockers = await prisma.locker.findMany({ where: { status: "AVAILABLE" }, orderBy: { code: "asc" } });
  if (lockers.length === 0) {
    console.error(`No hay casilleros AVAILABLE — corre "npx prisma db seed" primero.`);
    await app.close();
    process.exit(1);
  }
  const period = await prisma.period.findFirst({ where: { label: "2026-B" } });
  if (!period) {
    console.error('No existe el periodo "2026-B" — corre "npx prisma db seed" primero.');
    await app.close();
    process.exit(1);
  }

  // Usuarios REALES en la tabla (no simulados en memoria) — uniqueCode es
  // @unique en User, así que cada uno necesita el suyo, igual que exige
  // validRentBody() en lockers.e2e-spec.ts. createMany en un solo viaje
  // (no CONCURRENT_USERS awaits secuenciales) — a 1700 usuarios, crearlos
  // uno por uno tardaría minutos y ese tiempo no es lo que se está
  // midiendo. Los ids se generan acá mismo (randomUUID) porque createMany
  // no devuelve las filas creadas.
  const createdUserIds: string[] = Array.from({ length: CONCURRENT_USERS }, () => randomUUID());
  const runTag = Date.now();
  await prisma.user.createMany({
    data: createdUserIds.map((id, i) => ({
      id,
      logtoSub: `load-test|${runTag}-${i}`,
      uniqueCode: `LOADTEST-${runTag}-${i}`,
      fullName: `Estudiante Carga ${i}`,
    })),
  });

  // Un cliente HTTP real por request (no supertest in-process) — mide
  // latencia real de socket TCP, igual que vería un navegador real.
  function rent(i: number): Promise<{ status: number; ms: number; netErrorCode?: string; body?: string }> {
    const body = JSON.stringify({
      lockerCode: lockers[i % lockers.length].code,
      fullName: `Estudiante Carga ${i}`,
      uniqueCode: `LT-UC-${runTag}-${i}`,
      cedula: cedulaValida(i),
      phone: `09${String(90000000 + i).padStart(8, "0")}`,
      acceptedTerms: true,
    });
    const start = Date.now();
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/lockers/rent",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            authorization: `TestUser ${createdUserIds[i]}:ESTUDIANTE`,
            // IP distinta por "estudiante" — sin esto, las 100 requests
            // comparten la misma conexión local y el rate limiter por IP
            // de locker.controller.ts (3 intentos/10s, ver
            // rate-limit.module.ts) las bloquearía a casi todas — que NO
            // es lo que se está midiendo acá (eso ya se probó en
            // producción en agosto 2026, ver el comentario de ese
            // archivo). requiere TRUST_PROXY=true en backend/.env local.
            "x-forwarded-for": `10.${Math.floor(i / 256)}.${i % 256}.${(i % 250) + 1}`,
          },
        },
        (res) => {
          let chunks = "";
          res.on("data", (c) => {
            if (chunks.length < 500) chunks += c;
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              ms: Date.now() - start,
              body: (res.statusCode ?? 0) >= 500 ? chunks : undefined,
            })
          );
        }
      );
      req.on("error", (err: NodeJS.ErrnoException) =>
        resolve({ status: -1, ms: Date.now() - start, netErrorCode: err.code ?? err.message })
      );
      req.setTimeout(30_000, () => req.destroy(new Error("client timeout")));
      req.write(body);
      req.end();
    });
  }

  const expectedOk = Math.min(CONCURRENT_USERS, lockers.length);
  console.log(
    `Disparando ${CONCURRENT_USERS} POST /lockers/rent concurrentes contra ${lockers.length} casilleros reales${
      CONCURRENT_USERS > lockers.length ? ` (ciclados — más demanda que oferta, día real de apertura)` : ""
    }...`
  );
  const wallStart = Date.now();
  const results = await Promise.all(Array.from({ length: CONCURRENT_USERS }, (_, i) => rent(i)));
  const wallMs = Date.now() - wallStart;

  const ok = results.filter((r) => r.status === 201).length;
  const conflict = results.filter((r) => r.status === 409).length;
  const throttled = results.filter((r) => r.status === 429).length;
  const netFails = results.filter((r) => r.status === -1);
  const realServerErrors = results.filter((r) => r.status >= 500);
  const errors = netFails.length + realServerErrors.length;
  const other = results.length - ok - conflict - throttled - errors;

  if (netFails.length > 0) {
    const byCode = new Map<string, number>();
    for (const r of netFails) byCode.set(r.netErrorCode ?? "?", (byCode.get(r.netErrorCode ?? "?") ?? 0) + 1);
    console.log(`\nDesglose de fallas de RED (mi propio cliente, no necesariamente el servidor): ${[...byCode].map(([code, n]) => `${code}=${n}`).join(", ")}`);
  }
  if (realServerErrors.length > 0) {
    console.log(`\nDesglose de 5xx REALES del servidor (primeros 3): ${realServerErrors.slice(0, 3).map((r) => `${r.status}: ${r.body}`).join(" | ")}`);
  }
  const timings = results.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = timings[Math.floor(timings.length * 0.5)];
  const p95 = timings[Math.floor(timings.length * 0.95)];
  const p99 = timings[Math.floor(timings.length * 0.99)];
  const max = timings[timings.length - 1];

  console.log(`\n--- Resultado POOL_SIZE=${POOL_SIZE} · N_USERS=${CONCURRENT_USERS} · casilleros reales=${lockers.length} ---`);
  console.log(`201 Created (esperado EXACTO: ${expectedOk}): ${ok}${ok !== expectedOk ? "  <- MAL: no coincide con el número real de casilleros — posible fuga de la restricción @@unique" : ""}`);
  console.log(`409 Conflict (casillero ya tomado): ${conflict}`);
  console.log(`429 Too Many Requests:            ${throttled}`);
  console.log(`5xx / errores de red:             ${errors}  <- CUALQUIER valor >0 acá es un bug real`);
  console.log(`Otro status:                      ${other}`);
  console.log(`Tiempo total (wall clock):         ${wallMs} ms`);
  console.log(`Latencia p50 / p95 / p99 / max:    ${p50} / ${p95} / ${p99} / ${max} ms`);

  // Limpieza — deja la base lista para la siguiente corrida con otro
  // POOL_SIZE sin arrastrar basura de esta.
  const rentalRows = await prisma.lockerRental.findMany({ where: { userId: { in: createdUserIds } }, select: { id: true, paymentId: true, lockerId: true } });
  await prisma.lockerRental.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: rentalRows.map((r) => r.paymentId) } } });
  await prisma.locker.updateMany({ where: { id: { in: rentalRows.map((r) => r.lockerId) } }, data: { status: "AVAILABLE" } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
