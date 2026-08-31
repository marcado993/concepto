import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { AlertService } from "../../shared/monitoring/alert.service";

export interface AdminLoginResult {
  accessToken: string;
}

// Hash señuelo — cuando el correo no existe, se compara igual contra ESTE
// hash en vez de saltar directo al 401. Sin esto, "correo no existe"
// responde más rápido que "correo existe pero contraseña mala"
// (bcrypt.compare es la parte lenta), y ese tiempo de respuesta ya es
// suficiente para que alguien enumere qué correos SÍ tienen cuenta de
// administración — mismo principio que ya se aplicó en el flujo de
// correo/OTP (nunca confirmar existencia por un canal lateral).
//
// Generado en tiempo de ejecución (no un string bcrypt literal en el
// código) a propósito — un hash hardcodeado, aunque sea de un texto
// inventado y no de una contraseña real, tiene la MISMA forma que un
// secreto real filtrado y dispara escáneres de secretos (hallazgo real:
// generic.secrets.security.detected-bcrypt-hash bloqueó el pipeline de
// CI). El costo de calcularlo (bcrypt real, ~50-100ms) se paga UNA sola
// vez al levantar el proceso, no en cada login.
const DUMMY_HASH = bcrypt.hashSync("nunca-es-una-cuenta-real", 10);

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly alert: AlertService
  ) {}

  // ipAddress es SOLO para la alerta de abajo — nunca cambia si el login
  // en sí se acepta o se rechaza (eso sigue dependiendo únicamente de
  // email/password). "en caso de que pase algo": un intento fallido contra
  // este endpoint es justo la señal temprana de un ataque de fuerza bruta
  // contra el panel — el @Throttle del controller ya limita CUÁNTOS
  // intentos caben, esto avisa en tiempo real de que están pasando, sin
  // esperar a que alguien mire el AuditLog después.
  async login(email: string, password: string, ipAddress?: string): Promise<AdminLoginResult> {
    const account = await this.prisma.adminAccount.findUnique({ where: { email: email.toLowerCase().trim() } });

    const valid = await bcrypt.compare(password, account?.passwordHash ?? DUMMY_HASH);
    // Mismo mensaje genérico sin importar cuál de las dos cosas falló — un
    // mensaje distinto ("ese correo no existe") le confirma a quien intenta
    // entrar qué correos SÍ tienen cuenta admin (enumeración).
    if (!account || !valid) {
      // No await — una alerta que tarda o falla en mandarse nunca debe
      // retrasar ni tumbar la respuesta 401 real (mismo principio que el
      // correo del contrato en locker.service.ts).
      void this.alert.send(
        `Login fallido en el panel de administración — correo intentado: ${email}${ipAddress ? `, IP: ${ipAddress}` : ""}`,
        "warning"
      );
      throw new UnauthorizedException("Correo o contraseña incorrectos");
    }

    const accessToken = await this.jwt.signAsync(
      { sub: account.id, email: account.email, role: account.role },
      { expiresIn: "12h" }
    );
    return { accessToken };
  }
}
