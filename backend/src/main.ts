import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";

// Variables que, si faltan, deben tumbar el arranque en vez de fallar en
// silencio en el primer login real — hallazgo de la auditoría de seguridad
// (07-iso27001-sgsi-politica.md): sin esta validación, un despliegue sin
// COOKIE_SECRET simplemente rechaza todos los logins con un 400 confuso,
// en vez de un error de arranque claro.
const REQUIRED_ENV = ["COOKIE_SECRET", "LOGTO_ISSUER", "LOGTO_APP_ID", "LOGTO_AUDIENCE", "FRONTEND_ORIGIN", "ADMIN_JWT_SECRET"];

// Frontend (Vercel) y backend (VPS) desacoplados — CORS explícito en vez de
// "*", porque este backend maneja pagos y datos KYC/biométricos (ver
// docs/dominio/01-analisis-negocio-mision.md § Datos personales). El
// origen del frontend se configura por entorno, nunca hardcodeado.
async function bootstrap() {
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
      throw new Error(`Falta la variable de entorno ${key} — ver backend/.env.example`);
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Detrás de un reverse proxy (Nginx/Caddy en el VPS) req.ip refleja la IP
  // del proxy, no la del estudiante, rompiendo tanto el rate limiting por
  // IP como el `ipAddress` del AuditLog. Opt-in explícito (nunca por
  // defecto) porque confiar en X-Forwarded-For sin estar de verdad detrás
  // de un proxy conocido permite falsificar la IP de origen.
  if (process.env.TRUST_PROXY === "true") {
    app.set("trust proxy", 1);
  }

  // Cabeceras de seguridad (X-Frame-Options, X-Content-Type-Options,
  // etc.) — una sola línea, cubre una clase entera de hallazgos que de
  // otro modo habría que configurar a mano cabecera por cabecera.
  app.use(helmet());

  // Firma la cookie que guarda el code_verifier/state de PKCE entre
  // /auth/login y /auth/callback — sin esto, cualquiera podría fabricar
  // esa cookie y saltarse la protección de PKCE.
  app.use(cookieParser(process.env.COOKIE_SECRET));

  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN?.split(",") ?? false,
    credentials: true,
    // Sin maxAge, Chrome cachea el preflight OPTIONS solo 5s por defecto —
    // cualquier acción con body JSON o header Authorization (alquilar
    // casillero, aportar, /auth/me, precio con descuento...) dispara un
    // OPTIONS extra que paga la latencia real hasta el VPS en cada
    // ocasión. Invisible en local (RTT ~0), pero medido en producción real
    // (aeis.app en Vercel + API en el VPS) es un viaje de red completo
    // repetido innecesariamente en cada acción — 24h de caché del
    // preflight por sesión del navegador.
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`AEIS-APP backend escuchando en :${port}`, "Bootstrap");
}

bootstrap();
