import { IsNumber, Max, Min } from "class-validator";

// Rango real de negocio (docs/dominio/03-analisis-financiero-costos.md §4 /
// §8.7): el sponsor puede fijar el precio del casillero entre $5.50 y
// $9.00 según la utilidad objetivo — no es un límite técnico inventado,
// es la política de precios ya documentada. Un valor fuera de ese rango
// se rechaza acá en vez de dejar que la directiva se equivoque de un cero.
export class UpdateLockerPricingDto {
  @IsNumber()
  @Min(5.5, { message: "El precio del casillero no puede ser menor a $5.50" })
  @Max(9, { message: "El precio del casillero no puede ser mayor a $9.00" })
  basePrice!: number;
}
