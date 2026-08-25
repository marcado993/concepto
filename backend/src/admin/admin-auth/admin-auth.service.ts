import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../shared/prisma/prisma.service";

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
    private readonly jwt: JwtService
  ) {}

  async login(email: string, password: string): Promise<AdminLoginResult> {
    const account = await this.prisma.adminAccount.findUnique({ where: { email: email.toLowerCase().trim() } });

    const valid = await bcrypt.compare(password, account?.passwordHash ?? DUMMY_HASH);
    // Mismo mensaje genérico sin importar cuál de las dos cosas falló — un
    // mensaje distinto ("ese correo no existe") le confirma a quien intenta
    // entrar qué correos SÍ tienen cuenta admin (enumeración).
    if (!account || !valid) {
      throw new UnauthorizedException("Correo o contraseña incorrectos");
    }

    const accessToken = await this.jwt.signAsync(
      { sub: account.id, email: account.email, role: account.role },
      { expiresIn: "12h" }
    );
    return { accessToken };
  }
}
