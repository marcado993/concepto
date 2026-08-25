import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { JwtAuthGuard } from "../src/shared/auth/jwt-auth.guard";
import { IS_PUBLIC_KEY } from "../src/shared/auth/public.decorator";
import { PrismaService } from "../src/shared/prisma/prisma.service";
import { PayphoneClient } from "../src/shared/payment/payphone.client";

// Guard de prueba — calca el comportamiento real de JwtAuthGuard
// (respeta @Public(), lanza UnauthorizedException con 401 real en vez de
// dejar que Nest devuelva el 403 genérico de "guard retornó false") pero
// sin necesitar un JWT real firmado por Logto.
class TestAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const match = header?.match(/^TestUser (.+):(ESTUDIANTE|PRESIDENTE|DIRECTOR)$/);
    if (!match) throw new UnauthorizedException();
    req.user = { id: match[1], role: match[2] };
    return true;
  }
}

// E2E de caja negra — arranca la app NestJS COMPLETA (todos los módulos,
// guards reales, restricciones de Prisma reales) contra una base de datos
// Postgres real (la misma de docker-compose.yml, expuesta en
// 127.0.0.1:5433 — ver backend/.env). No se mockea Prisma en ningún lado
// de este archivo: si algo pasa aquí, pasaría igual en producción.
//
// Dos cosas SÍ se sustituyen, y ambas a propósito:
//   1. JwtAuthGuard — no hay forma de generar un JWT real firmado por
//      Logto sin credenciales reales de un tenant (ver docs/dominio/
//      10-despliegue-vps-vercel.md). Se reemplaza por un guard mínimo que
//      lee un header de prueba y arma req.user — así se puede simular a
//      DOS estudiantes distintos peleando por el mismo casillero, que es
//      justo el escenario de concurrencia que se quiere probar.
//   2. PayphoneClient — no hay forma de completar el widget real de
//      PayPhone (client-side, requiere un navegador de verdad) ni de
//      pegarle a su API real de Confirm desde un test. Se sustituye por
//      un cliente falso que siempre aprueba con el monto/clientTransactionId
//      exactos que se le pidan — lo que se está probando acá es la
//      transacción de Prisma bajo carrera (updateMany + WHERE
//      status:"PENDING"), no la integración real con PayPhone (esa se
//      verifica a mano contra el tenant real, ver payphone.client.ts).
function testAuthHeader(userId: string, role: "ESTUDIANTE" | "PRESIDENTE" | "DIRECTOR" = "ESTUDIANTE") {
  return `TestUser ${userId}:${role}`;
}

// Precio esperado para un estudiante sin descuento de aportante: $6.50
// (precio único, sin recargo — ver rental-calculator.ts).
const EXPECTED_LOCKER_AMOUNT_CENTS = 650;

// Cuerpo válido de POST /lockers/rent — cedula/phone/acceptedTerms/uniqueCode
// son todos obligatorios en RentLockerDto (ver rent-locker.dto.ts), así que
// cualquier request de prueba que solo mande lockerCode se rechazaría con
// 400 antes de llegar a la lógica que este archivo quiere probar.
// uniqueCode es @unique en User (ver schema.prisma) — dos estudiantes
// distintos nunca pueden compartir el mismo valor, así que cada llamador
// pasa el suyo (importa sobre todo en el test de concurrencia, donde
// userA y userB alquilan a la vez: reusar el mismo literal ahí causaría un
// choque real de unicidad y ya no probaría la carrera del casillero).
function validRentBody(lockerCode: string, uniqueCode = "209900001") {
  return { lockerCode, cedula: "1723456789", phone: "0991234567", uniqueCode, acceptedTerms: true };
}

describe("Lockers (e2e) — caja negra contra Postgres real", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let periodId: string | undefined;
  let userAId: string | undefined;
  let userBId: string | undefined;
  // Sufijo único por corrida — si una corrida anterior falló a mitad de
  // beforeAll (Jest reporta timeout pero la promesa sigue viva en segundo
  // plano y puede terminar de crear datos igual), un código fijo chocaría
  // con la basura huérfana de esa corrida anterior en el siguiente intento.
  const LOCKER_CODE = `E2E-TEST-${Date.now()}`;
  let lockerId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JwtAuthGuard)
      .useFactory({ factory: (reflector: Reflector) => new TestAuthGuard(reflector), inject: [Reflector] })
      .overrideProvider(PayphoneClient)
      .useValue({
        getPublicConfig: () => ({ configured: true, token: "e2e-fake-token", storeId: "e2e-fake-store" }),
        confirm: async (transactionId: number, clientTransactionId: string) => ({
          approved: true,
          transactionId,
          clientTransactionId,
          amountCents: EXPECTED_LOCKER_AMOUNT_CENTS,
          raw: {},
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    // Datos mínimos autocontenidos — no depende de `prisma db seed` haber
    // corrido antes. Código de casillero con prefijo "E2E-TEST-" para que
    // nunca choque con los 108 casilleros reales (zona de una sola letra).
    const period = await prisma.period.create({
      data: { label: `e2e-${Date.now()}`, startsAt: new Date(), endsAt: new Date(Date.now() + 86_400_000) },
    });
    periodId = period.id;

    const [userA, userB] = await Promise.all([
      prisma.user.create({ data: { logtoSub: `e2e|${Date.now()}-a`, uniqueCode: `E2E-A-${Date.now()}`, fullName: "Estudiante E2E A" } }),
      prisma.user.create({ data: { logtoSub: `e2e|${Date.now()}-b`, uniqueCode: `E2E-B-${Date.now()}`, fullName: "Estudiante E2E B" } }),
    ]);
    userAId = userA.id;
    userBId = userB.id;

    const locker = await prisma.locker.create({ data: { code: LOCKER_CODE, zone: "E2E", status: "AVAILABLE" } });
    lockerId = locker.id;
  }, 30_000); // arrancar la app NestJS completa (todos los módulos) tarda más que el timeout default de Jest (5s)

  afterAll(async () => {
    // Defensivo: si beforeAll falló a mitad de camino, algunos ids pueden
    // seguir undefined — no queremos que la limpieza misma reviente y
    // esconda el error real de beforeAll.
    if (lockerId) {
      const rentals = await prisma.lockerRental.findMany({ where: { lockerId }, select: { id: true, paymentId: true } });
      await prisma.lockerRental.deleteMany({ where: { lockerId } });
      await prisma.payment.deleteMany({ where: { id: { in: rentals.map((r) => r.paymentId) } } });
      await prisma.locker.delete({ where: { id: lockerId } });
    }
    if (userAId || userBId) {
      const actorIds = [userAId, userBId].filter((id): id is string => !!id);
      await prisma.auditLog.deleteMany({ where: { actorId: { in: actorIds } } });
      await prisma.user.deleteMany({ where: { id: { in: actorIds } } });
    }
    if (periodId) {
      await prisma.period.delete({ where: { id: periodId } });
    }
    await app.close();
  });

  it("Dado el directorio público de casilleros, Cuando se pide sin autenticación, Entonces responde 200 e incluye el casillero de prueba", async () => {
    const res = await request(app.getHttpServer()).get("/lockers");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: LOCKER_CODE, status: "AVAILABLE" })])
    );
  });

  it("Dado un intento de alquiler sin header de autenticación, Cuando se llama POST /lockers/rent, Entonces responde 401 (JwtAuthGuard real de la app, no el mock, rechaza sin req.user)", async () => {
    const res = await request(app.getHttpServer()).post("/lockers/rent").send(validRentBody(LOCKER_CODE));

    expect(res.status).toBe(401);
  });

  it("Dado un casillero disponible, Cuando un estudiante lo alquila, Entonces responde 201, el casillero queda RESERVED en la base de datos real, y hay un AuditLog", async () => {
    const res = await request(app.getHttpServer())
      .post("/lockers/rent")
      .set("Authorization", testAuthHeader(userAId!))
      .send(validRentBody(LOCKER_CODE));

    expect(res.status).toBe(201);

    const locker = await prisma.locker.findUniqueOrThrow({ where: { id: lockerId } });
    expect(locker.status).toBe("RESERVED");

    const auditEntry = await prisma.auditLog.findFirst({
      where: { actorId: userAId, action: "locker.rental.created" },
    });
    expect(auditEntry).not.toBeNull();

    // Limpiar este alquiler puntual para que el siguiente test (la carrera)
    // vuelva a encontrar el casillero AVAILABLE.
    const rental = await prisma.lockerRental.findFirstOrThrow({ where: { lockerId } });
    await prisma.lockerRental.delete({ where: { id: rental.id } });
    await prisma.payment.delete({ where: { id: rental.paymentId } });
    await prisma.locker.update({ where: { id: lockerId }, data: { status: "AVAILABLE" } });
  });

  // ---------------------------------------------------------------
  // CONCURRENCIA REAL — dos estudiantes DISTINTOS disparan la petición de
  // alquiler para el MISMO casillero al mismo tiempo (Promise.all, no en
  // secuencia). Contra la base de datos real, protegida por
  // @@unique([lockerId, periodId]) en schema.prisma. Esto es exactamente
  // el escenario BDD "condición de carrera" que ya tenía un test unitario
  // con mocks (locker.service.spec.ts) — este es la versión de caja negra
  // que prueba que la restricción real de Postgres, no solo la lógica de
  // traducción de errores, funciona bajo concurrencia real.
  // ---------------------------------------------------------------
  it("Dado dos estudiantes alquilando el MISMO casillero al mismo tiempo (peticiones HTTP concurrentes reales), Cuando ambas llegan a la vez, Entonces exactamente una gana (201) y la otra pierde (409), nunca las dos ganan", async () => {
    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post("/lockers/rent")
        .set("Authorization", testAuthHeader(userAId!))
        .send(validRentBody(LOCKER_CODE, "209900002")),
      request(app.getHttpServer())
        .post("/lockers/rent")
        .set("Authorization", testAuthHeader(userBId!))
        .send(validRentBody(LOCKER_CODE, "209900003")),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    // Solo debe existir UN LockerRental para este casillero, no dos.
    const rentals = await prisma.lockerRental.findMany({ where: { lockerId } });
    expect(rentals).toHaveLength(1);

    // Limpiar el alquiler ganador para que el siguiente test vuelva a
    // encontrar el casillero AVAILABLE (mismo motivo que el test anterior).
    await prisma.lockerRental.delete({ where: { id: rentals[0].id } });
    await prisma.payment.delete({ where: { id: rentals[0].paymentId } });
    await prisma.locker.update({ where: { id: lockerId }, data: { status: "AVAILABLE" } });
  });

  // ---------------------------------------------------------------
  // CONCURRENCIA REAL #2 — confirmación de pago PayPhone duplicada. Simula
  // el navegador recargando la página de respuesta de PayPhone (o un doble
  // callback real): la MISMA petición de confirmación llega dos veces a la
  // vez para el mismo alquiler PENDING. Prueba el mismo patrón atómico que
  // el test de arriba (updateMany + WHERE status:"PENDING" real de
  // Postgres, no un mock) — como máximo una gana.
  // ---------------------------------------------------------------
  it("Dado un mismo pago de PayPhone confirmado dos veces a la vez (recarga de página / doble callback), Cuando ambas peticiones llegan juntas, Entonces exactamente una confirma (201) y la otra recibe 409, y el casillero termina RENTED una sola vez", async () => {
    const rentRes = await request(app.getHttpServer())
      .post("/lockers/rent")
      .set("Authorization", testAuthHeader(userAId!))
      .send(validRentBody(LOCKER_CODE, "209900004"));
    const rentalId = rentRes.body.id;

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post("/lockers/payphone/confirm")
        .set("Authorization", testAuthHeader(userAId!))
        .send({ id: 555, clientTransactionId: rentalId }),
      request(app.getHttpServer())
        .post("/lockers/payphone/confirm")
        .set("Authorization", testAuthHeader(userAId!))
        .send({ id: 555, clientTransactionId: rentalId }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const locker = await prisma.locker.findUniqueOrThrow({ where: { id: lockerId } });
    expect(locker.status).toBe("RENTED");
  });
});
