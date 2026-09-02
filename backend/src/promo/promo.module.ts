import { Module } from "@nestjs/common";
import { PromoCodeService } from "./promo-code.service";
import { AuditModule } from "../shared/audit/audit.module";

// Códigos promocionales de casillero. Reemplazan al descuento automático
// por tier de aportación (ver el comentario del modelo PromoCode en
// schema.prisma para el porqué de alcance).
//
// Exporta el servicio entero — lo consumen dos módulos con necesidades
// distintas: AdminModule para generarlos y listarlos, y LockerModule para
// verificarlos y canjearlos al alquilar.
@Module({
  imports: [AuditModule],
  providers: [PromoCodeService],
  exports: [PromoCodeService],
})
export class PromoModule {}
