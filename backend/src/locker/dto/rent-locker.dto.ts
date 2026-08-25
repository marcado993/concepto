import { IsIn, IsString, Length, Matches } from "class-validator";

export class RentLockerDto {
  @IsString()
  lockerCode!: string;

  // Código único institucional — dato personal REAL usado para localizar
  // físicamente al dueño de un casillero (no un identificador interno
  // nuestro). Hasta ahora User.uniqueCode nacía como placeholder
  // ("PENDIENTE-<uuid>") en el primer login y nunca se completaba con un
  // dato real — decisión consciente de diseño (ver docs/dominio/
  // 06-iso27701-privacidad.md §3: "completar el código único institucional
  // es un paso posterior y consciente, no implícito en el login social").
  // El alquiler es justo ese paso: es obligatorio, no un placeholder más.
  // Sin un formato EPN oficial confirmado, solo se valida longitud
  // razonable — no se inventa un patrón más estricto que podría rechazar
  // códigos reales válidos.
  @IsString()
  @Length(3, 20, { message: "El código único debe tener entre 3 y 20 caracteres" })
  uniqueCode!: string;

  // Cédula ecuatoriana — 10 dígitos, sin guiones ni espacios (el frontend
  // los limpia antes de mandar). Se guarda en User (ver locker.service.ts)
  // para no volver a pedirla el siguiente semestre.
  @Matches(/^\d{10}$/, { message: "La cédula debe tener 10 dígitos" })
  cedula!: string;

  // Celular ecuatoriano — 10 dígitos empezando en 0 (ej. 0991234567).
  @Matches(/^0\d{9}$/, { message: "El celular debe tener 10 dígitos (ej. 0991234567)" })
  phone!: string;

  // "Firma digital" del checkbox de términos — @IsIn([true]) rechaza la
  // petición entera si viene false/ausente, así que no hace falta un
  // chequeo aparte en el service. El resto de la firma (QUIÉN, CUÁNDO,
  // desde QUÉ IP) no se le pide al cliente — el backend la toma de fuentes
  // que no puede falsificar: actorId del JWT, createdAt del propio
  // AuditLog (reloj del servidor), e ipAddress de la request real (ver
  // locker.service.ts).
  @IsIn([true], { message: "Debes aceptar los términos y condiciones" })
  acceptedTerms!: boolean;
}
