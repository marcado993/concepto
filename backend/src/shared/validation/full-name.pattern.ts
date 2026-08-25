// Compartido entre cualquier DTO que le pida al estudiante confirmar su
// nombre completo (RentLockerDto, SubscribeDto) — al menos dos palabras
// (nombre + al menos un apellido), sin exigir un conteo exacto: hay gente
// con un nombre y dos apellidos, otra con dos nombres y un apellido. Solo
// descarta lo que claramente NO es un nombre completo (un username suelto,
// un solo nombre de pila, o — el bug real que motivó esto — un correo
// electrónico colado como "nombre" desde el login por OTP).
export const FULL_NAME_PATTERN = /^\S+(\s+\S+)+$/;
export const FULL_NAME_MESSAGE = "Escribe tu nombre completo (nombre y apellido)";
