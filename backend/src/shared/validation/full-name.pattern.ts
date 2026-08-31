// Compartido entre cualquier DTO que le pida al estudiante confirmar su
// nombre completo (RentLockerDto, SubscribeDto) — al menos dos palabras
// (nombre + al menos un apellido), sin exigir un conteo exacto: hay gente
// con un nombre y dos apellidos, otra con dos nombres y un apellido. Solo
// descarta lo que claramente NO es un nombre completo (un username suelto,
// un solo nombre de pila, o — el bug real que motivó esto — un correo
// electrónico colado como "nombre" desde el login por OTP).
//
// Cada "palabra" excluye < > { } a propósito (antes era \S+ sin más,
// aceptaba CUALQUIER caracter no-espacio) — este nombre termina
// interpolado directo en el HTML crudo del correo del contrato
// (lockerContractHtml en locker-contract.ts, un template string, sin
// escapar), así que es el campo de texto con el riesgo más alto de todo el
// backend si alguien mete un payload — más que cualquier campo que solo se
// renderiza en el frontend (Svelte ya escapa eso solo). Ver también
// shared/validation/no-payload-text.pattern.ts para el mismo criterio
// aplicado a campos de texto libre (emprendimientos).
export const FULL_NAME_PATTERN = /^[^\s<>{}]+(\s+[^\s<>{}]+)+$/s;
export const FULL_NAME_MESSAGE = "Escribe tu nombre completo (nombre y apellido) — sin los caracteres < > { }";
