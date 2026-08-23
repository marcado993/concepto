import { Body, Controller, Get, Post, Req } from "@nestjs/common";
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

  // Precio real (con descuento de aportante ya resuelto) para el paso de
  // identidad de RentLockerModal.svelte — requiere sesión porque el
  // descuento depende de QUIÉN pregunta, no es un dato público como la
  // lista de casilleros.
  @Get("my-price")
  @Roles(Role.ESTUDIANTE)
  myPrice(@Req() req: Request & { user: { id: string } }) {
    return this.lockerService.getPricePreview(req.user.id);
  }

  // "¿Ya tengo un casillero confirmado este periodo?" — pedido real: en
  // vez de que el estudiante busque el suyo entre hasta 108, la grilla lo
  // distingue y lo deja tocar para ver el estado directamente.
  @Get("mine/rented")
  @Roles(Role.ESTUDIANTE)
  myRentedLocker(@Req() req: Request & { user: { id: string } }) {
    return this.lockerService.getMyRentedLocker(req.user.id);
  }

  @Post("rent")
  @Roles(Role.ESTUDIANTE)
  // Límite propio, más estricto que el global (rate-limit.module.ts): un
  // mismo estudiante no necesita más de 3 intentos de alquiler en 10s — si
  // los ve, es un bug del cliente o un script, no una persona. Esto NO
  // limita a los 100 estudiantes DISTINTOS que puedan alquilar a la vez
  // (eso es carga legítima, resuelta por la restricción única de Prisma,
  // no por rate limiting) — limita a UN actor abusando, por IP.
  //
  // La clave del objeto DEBE ser el nombre de un throttler ya registrado
  // en ThrottlerModule.forRoot() ("short"/"medium", ver rate-limit.module.ts)
  // — "default" no existe ahí, así que un @Throttle({default:{...}}) es
  // metadata que el guard real nunca lee (lo confirma su código fuente:
  // itera this.throttlers, que son los NOMBRES configurados, y busca el
  // override por ESE nombre). Con "default" este límite nunca se aplicaba
  // — la ruta solo quedaba cubierta por los límites globales (5/s, 100/min).
  @Throttle({ short: { limit: 3, ttl: 10_000 } })
  rent(@Body() dto: RentLockerDto, @Req() req: Request & { user: { id: string } }) {
    return this.lockerService.rent({
      userId: req.user.id,
      lockerCode: dto.lockerCode,
      cedula: dto.cedula,
      phone: dto.phone,
      acceptedTerms: dto.acceptedTerms,
      ipAddress: req.ip,
    });
  }

  // clientTransactionId ES el id del LockerRental — nosotros lo elegimos
  // así al renderizar el widget (ver RentLockerModal.svelte), así que no
  // hace falta un :rentalId separado en la ruta.
  @Post("payphone/confirm")
  @Roles(Role.ESTUDIANTE)
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  confirmPayphone(@Body() dto: ConfirmPayphoneDto, @Req() req: Request & { user: { id: string } }) {
    return this.lockerService.confirmPayphonePayment(dto.clientTransactionId, dto.id, req.user.id, req.ip);
  }
}
