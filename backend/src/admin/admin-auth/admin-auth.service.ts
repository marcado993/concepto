import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../shared/prisma/prisma.service";

export interface AdminLoginResult {
  accessToken: string;
}

// Hash señuelo (bcrypt de un texto fijo cualquiera, precalculado) — cuando
// el correo no existe, se compara igual contra ESTE hash en vez de saltar
// directo al 401. Sin esto, "correo no existe" responde más rápido que
// "correo existe pero contraseña mala" (bcrypt.compare es la parte lenta),
// y ese tiempo de respuesta ya es suficiente para que alguien enumere qué
// correos SÍ tienen cuenta de administración — mismo principio que ya se
// aplicó en el flujo de correo/OTP (nunca confirmar existencia por un
// canal lateral).
const DUMMY_HASH = "$2b$10$uDiNKi3.UTZfwt7AorZFtO4JwLOsQQSya0ME8NK9LfELwWR/WcI9u";

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
