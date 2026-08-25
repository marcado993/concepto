import { IsIn, IsString, Matches, MinLength } from "class-validator";

// Al menos dos palabras (nombre + al menos un apellido) — sin exigir un
// conteo exacto: hay gente con un nombre y dos apellidos, otra con dos
// nombres y un apellido. Solo descarta lo que claramente NO es un nombre
// completo (un username suelto, un solo nombre de pila).
const FULL_NAME_PATTERN = /^\S+(\s+\S+)+$/;

// Formato real del código único institucional de la EPN (confirmado con
// datos reales del cliente, no inventado): 9 dígitos, sin letras ni
// guiones — AAAAP NNNN.
//   AAAA = año (empieza en "2", ej. 2017..2022 en los datos reales vistos)
//   P    = periodo, 1 o 2 (semestre A/B)
//   NNNN = secuencial de 4 dígitos, sin patrón — puede ser cualquiera
// Ejemplos reales: 202120100, 201710909, 202221129.
export const UNIQUE_CODE_PATTERN = /^2\d{3}[12]\d{4}$/;

export class RentLockerDto {
  @IsString()
  lockerCode!: string;

  // Nombre completo — pedido real: el que trae Logto/GitHub/Google puede
  // venir incompleto, en minúscula, o ser un username en vez del nombre
  // real (y a veces la app solo tenía la primera carga de OAuth, nunca
  // actualizada). El alquiler es el momento de pedirlo/confirmarlo de
  // verdad, igual que cédula/celular/código único — este texto es
  // literalmente el que va a salir firmado en el contrato (ver
  // locker-contract.ts), así que tiene que ser el correcto ANTES de
  // pagar, no algo que se corrija después.
  @Matches(FULL_NAME_PATTERN, { message: "Escribe tu nombre completo (nombre y apellido)" })
  @MinLength(3)
  fullName!: string;

  // Código único institucional — dato personal REAL usado para localizar
  // físicamente al dueño de un casillero (no un identificador interno
  // nuestro). Hasta ahora User.uniqueCode nacía como placeholder
  // ("PENDIENTE-<uuid>") en el primer login y nunca se completaba con un
  // dato real — decisión consciente de diseño (ver docs/dominio/
  // 06-iso27701-privacidad.md §3: "completar el código único institucional
  // es un paso posterior y consciente, no implícito en el login social").
  // El alquiler es justo ese paso: es obligatorio, no un placeholder más.
  @Matches(UNIQUE_CODE_PATTERN, {
    message: "El código único debe tener el formato real de la EPN: año + periodo (1 o 2) + secuencial, ej. 202120100",
  })
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
