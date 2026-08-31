import { registerDecorator, ValidationOptions } from "class-validator";

// Cédula ecuatoriana — 10 dígitos, pero no cualquier combinación de 10
// dígitos es una cédula real: el Registro Civil arma el décimo dígito con
// un checksum módulo 10 sobre los primeros 9 (mismo algoritmo que usa el
// SRI para el campo cédula del RUC). Antes RentLockerDto solo chequeaba
// /^\d{10}$/ — aceptaba cualquier número de 10 dígitos escrito mal (a
// propósito o por error de tipeo), y eso terminaba firmado tal cual en el
// contrato del casillero sin que nadie lo notara hasta mirarlo a mano.
export function esCedulaEcuatorianaValida(cedula: string): boolean {
  if (!/^\d{10}$/.test(cedula)) return false;

  const provincia = Number(cedula.slice(0, 2));
  if (provincia < 1 || provincia > 24) return false;

  // Tercer dígito: 0-5 para personas naturales. 6 (entidad pública) y 9
  // (persona jurídica/privada) son formatos de RUC, no de cédula.
  const tercerDigito = Number(cedula[2]);
  if (tercerDigito > 5) return false;

  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let valor = Number(cedula[i]) * coeficientes[i];
    if (valor > 9) valor -= 9;
    suma += valor;
  }
  const digitoVerificador = suma % 10 === 0 ? 0 : 10 - (suma % 10);
  return digitoVerificador === Number(cedula[9]);
}

export const CEDULA_MESSAGE = "Esa cédula no es válida — revisa los dígitos";

export function IsCedulaEcuatoriana(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isCedulaEcuatoriana",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === "string" && esCedulaEcuatorianaValida(value);
        },
        defaultMessage(): string {
          return CEDULA_MESSAGE;
        },
      },
    });
  };
}
