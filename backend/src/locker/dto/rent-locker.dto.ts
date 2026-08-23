import { IsIn, IsString, Matches } from "class-validator";

export class RentLockerDto {
  @IsString()
  lockerCode!: string;

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
