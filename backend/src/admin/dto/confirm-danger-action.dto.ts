import { Equals, IsString } from "class-validator";

// "Zona de riesgo" del panel — borra datos reales, sin deshacer posible
// desde la app (solo con un pg_dump manual). Un simple POST sin cuerpo es
// demasiado fácil de disparar por accidente (un doble-click, un script de
// pruebas, un curl copiado mal) — exigir que el admin escriba la frase
// exacta en el body es la misma defensa que usan GitHub/Vercel para borrar
// un repo: el "confirmar" tiene que costar algo más que un solo click.
export class ConfirmWipeTestDataDto {
  @IsString()
  @Equals("BORRAR DATOS DE PRUEBA")
  confirm!: string;
}

export class ConfirmFreeLockersDto {
  @IsString()
  @Equals("LIBERAR CASILLEROS")
  confirm!: string;
}
