import {
  BadRequestException,
  Body,
  Controller,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { Public } from "../shared/auth/public.decorator";
import { Roles } from "../shared/auth/roles.decorator";
import { Role } from "@prisma/client";
import { LockerService } from "./locker.service";
import { RentLockerDto } from "./dto/rent-locker.dto";
import { ConfirmPayphoneDto } from "./dto/confirm-payphone.dto";

// El periodo activo se resuelve dentro de LockerService.getCurrentPeriodId()
// a partir de las fechas de Period — no viene del cliente. Es una
// resolución mínima (vigente o más próximo), no un PeriodService real
// todavía; ver el comentario en locker.service.ts si se extrae a futuro.

@Controller("lockers")
export class LockerController {
  constructor(private readonly lockerService: LockerService) {}

  // Público — mismo criterio que security/ y ventures/: ver disponibilidad
  // de casilleros no expone nada sensible, no hay motivo de negocio para
  // exigir login solo para mirar el mapa de casilleros.
  @Public()
  @Get()
  list() {
    return this.lockerService.list();
  }

  // Config pública del widget de PayPhone (token + storeId) — servida
  // desde el backend (no hardcodeada en el frontend) para poder rotarla
  // sin redeploy. Si PAYPHONE_TOKEN/PAYPHONE_STORE_ID no están
  // configurados, `configured:false` — el frontend deshabilita la opción
  // PayPhone en vez de renderizar un widget roto (mismo patrón que
  // auth_error=logto_not_configured).
  @Public()
  @Get("payphone/config")
  payphoneConfig() {
    return this.lockerService.getPayphoneConfig();
  }

  @Post("rent")
  @Roles(Role.ESTUDIANTE)
  // Límite propio, más estricto que el global (rate-limit.module.ts): un
  // mismo estudiante no necesita más de 3 intentos de alquiler en 10s — si
  // los ve, es un bug del cliente o un script, no una persona. Esto NO
  // limita a los 100 estudiantes DISTINTOS que puedan alquilar a la vez
  // (eso es carga legítima, resuelta por la restricción única de Prisma,
  // no por rate limiting) — limita a UN actor abusando, por IP.
  @Throttle({ default: { limit: 3, ttl: 10_000 } })
  rent(@Body() dto: RentLockerDto, @Req() req: Request & { user: { id: string } }) {
    return this.lockerService.rent({
      userId: req.user.id,
      lockerCode: dto.lockerCode,
      method: dto.method,
      ipAddress: req.ip,
    });
  }

  @Post("rentals/:rentalId/confirm-receipt")
  @Roles(Role.ESTUDIANTE)
  // Más laxo que "rent" (5 en vez de 3): una foto borrosa que hay que
  // volver a tomar y subir es un caso legítimo esperado, no un abuso.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor("receipt"))
  confirmReceipt(
    @Param("rentalId") rentalId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 8 * 1024 * 1024 }), // 8MB
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
        ],
      })
    )
    file: Express.Multer.File,
    @Req() req: Request & { user: { id: string } }
  ) {
    if (!file?.buffer) throw new BadRequestException("Falta el archivo del comprobante");
    return this.lockerService.confirmReceipt(rentalId, req.user.id, file.buffer, req.ip);
  }

  // clientTransactionId ES el id del LockerRental — nosotros lo elegimos
  // así al renderizar el widget (ver RentLockerModal.svelte), así que no
  // hace falta un :rentalId separado en la ruta.
  @Post("payphone/confirm")
  @Roles(Role.ESTUDIANTE)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  confirmPayphone(@Body() dto: ConfirmPayphoneDto, @Req() req: Request & { user: { id: string } }) {
    return this.lockerService.confirmPayphonePayment(dto.clientTransactionId, dto.id, req.user.id, req.ip);
  }
}
