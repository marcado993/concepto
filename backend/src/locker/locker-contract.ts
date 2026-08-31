// Genera el correo de "Contrato de Uso de Locker" que se manda al
// estudiante justo después de que PayPhone confirma el pago (ver
// confirmPayphonePayment en locker.service.ts). El texto legal reproduce
// docs/dominio/contrato_locker.docx — no se manda el .docx tal cual (así se
// evita depender de una librería de generación de documentos en el
// servidor, con toda su fragilidad, para algo que un correo bien
// formateado ya resuelve igual de bien); lo que importa es el contenido,
// no el formato del archivo.
//
// Hallazgo real al portar el texto: el .docx trae la fecha de fin de
// semestre escrita a mano ("18 de febrero del 2027"), pero el periodo REAL
// en la base de datos (2026-B) termina el 28 de febrero del 2027 — 10 días
// de diferencia. Se usa la fecha REAL del periodo acá, no la del .docx —
// mismo criterio que ya se aplicó en toda la app (ver
// PeriodService.getCurrentPeriod): un contrato no puede tener una fecha
// distinta a la que el sistema usa de verdad para decidir cuándo vence el
// alquiler.

// "luis andres" -> "Luis Andres" — una letra mayúscula por palabra, sin
// reglas especiales (de/la/del en minúscula, etc.) porque no se pidió y un
// nombre real puede empezar con esas mismas palabras (ej. "De la Torre").
export function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join(" ");
}

// periodEndsAt es una fecha DE CALENDARIO (guardada como medianoche UTC en
// Prisma, ver PeriodService), no un instante real — convertirla a
// America/Guayaquil (UTC-5) la corre un día atrás (medianoche UTC del 28 =
// 7pm del 27 en Guayaquil). Se formatea en UTC para que el día mostrado sea
// el mismo que el que decide PeriodService/el resto de la app.
export function formatCalendarDate(date: Date): string {
  return date.toLocaleDateString("es-EC", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export interface LockerContractData {
  fullName: string;
  cedula: string;
  uniqueCode: string;
  lockerCode: string;
  periodLabel: string;
  periodEndsAt: Date;
  amount: number;
  signedAt: Date;
}

export function lockerContractSubject(data: LockerContractData): string {
  return `Tu contrato de casillero ${data.lockerCode} — AEIS`;
}

export function lockerContractHtml(data: LockerContractData): string {
  const nombre = titleCase(data.fullName);
  const vigencia = formatCalendarDate(data.periodEndsAt);
  const firmadoEl = data.signedAt.toLocaleString("es-EC", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Guayaquil",
  });
  const monto = data.amount.toFixed(2);

  // Estilos inline a propósito — la mayoría de clientes de correo (Gmail,
  // Outlook) ignoran o despojan <style> en el <head>; inline es lo único
  // que se renderiza consistente en todos.
  return `
<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 640px; margin: 0 auto; color: #1a1a1a; line-height: 1.6;">
  <h1 style="font-size: 20px; text-align: center; margin-bottom: 4px;">CONTRATO DE USO DE LOCKER</h1>
  <p style="text-align: center; font-size: 13px; color: #444; margin-top: 0;">ASOCIACIÓN DE ESTUDIANTES DE INGENIERÍA DE SISTEMAS (AEIS)</p>

  <p>En la ciudad de Quito, a partir de la fecha de firma del presente documento, la Asociación de Estudiantes de Ingeniería de Sistemas (AEIS), en adelante <strong>"LA ASOCIACIÓN"</strong>, representada por su presidente, Sara Guayasamín, establece el siguiente Contrato de Uso de Locker con el/la estudiante identificado/a a continuación, en adelante <strong>"EL USUARIO"</strong>.</p>

  <table style="width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14px;">
    <tr><td style="padding: 4px 8px; color: #555; width: 40%;">Nombre</td><td style="padding: 4px 8px;"><strong>${nombre}</strong></td></tr>
    <tr style="background: #f7f7f7;"><td style="padding: 4px 8px; color: #555;">Cédula</td><td style="padding: 4px 8px;">${data.cedula}</td></tr>
    <tr><td style="padding: 4px 8px; color: #555;">Código único institucional</td><td style="padding: 4px 8px;">${data.uniqueCode}</td></tr>
    <tr style="background: #f7f7f7;"><td style="padding: 4px 8px; color: #555;">Casillero asignado</td><td style="padding: 4px 8px;"><strong>${data.lockerCode}</strong></td></tr>
    <tr><td style="padding: 4px 8px; color: #555;">Semestre</td><td style="padding: 4px 8px;">${data.periodLabel} (hasta el ${vigencia})</td></tr>
    <tr style="background: #f7f7f7;"><td style="padding: 4px 8px; color: #555;">Monto pagado</td><td style="padding: 4px 8px;">$${monto} — vía PayPhone</td></tr>
  </table>

  <h2 style="font-size: 15px; margin-top: 24px;">CLÁUSULAS</h2>

  <p><strong>PRIMERA: Objeto del Contrato.</strong> LA ASOCIACIÓN cede en uso un locker a EL USUARIO durante el periodo de un semestre, a cambio del pago correspondiente y bajo las condiciones establecidas en este contrato.</p>

  <p><strong>SEGUNDA: Pago y Vigencia.</strong> El costo por el uso del locker es de $6.50 (seis dólares con cincuenta centavos de dólar) por todo el semestre. El pago debe realizarse en un solo monto y, una vez confirmado, se asignará el locker de inmediato. Este contrato estará vigente hasta el ${vigencia}, según el calendario académico.</p>

  <p><strong>TERCERA: Asignación de Lockers.</strong> Los lockers se asignarán según disponibilidad y no podrán cambiarse salvo causa justificada aprobada por LA ASOCIACIÓN.</p>

  <p><strong>CUARTA: Seguridad y Responsabilidad.</strong> EL USUARIO deberá traer su propio candado para asegurar su locker. LA ASOCIACIÓN no se responsabiliza por la pérdida, robo o daño de objetos guardados en el locker. EL USUARIO no podrá guardar objetos inflamables, peligrosos o prohibidos.</p>

  <p><strong>QUINTA: Descuentos y Exoneraciones.</strong> Dependiendo del sistema de aportaciones, ciertos afiliados podrán recibir descuentos en el pago del locker o incluso un locker gratuito, conforme a las normas establecidas por LA ASOCIACIÓN. La aplicación de estos beneficios se verificará antes de la asignación del locker.</p>

  <p><strong>SEXTA: Devolución y Desocupación.</strong> EL USUARIO deberá vaciar el locker hasta el ${vigencia}, fecha correspondiente al final del semestre. De no hacerlo, LA ASOCIACIÓN podrá retirar el candado y las pertenencias a posteriori.</p>

  <p><strong>SÉPTIMA: Aceptación.</strong> Al completar el formulario de alquiler en AEIS-APP y aceptar los términos, EL USUARIO acepta todas las condiciones establecidas en este documento.</p>

  <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #ccc; font-size: 13px;">
    <p style="margin: 4px 0;">Firmado electrónicamente por:</p>
    <p style="margin: 4px 0; font-size: 15px;"><strong>${nombre.toUpperCase()}</strong></p>
    <p style="margin: 4px 0;">${nombre}</p>
    <p style="margin: 4px 0; color: #555;">Aceptación registrada en AEIS-APP el ${firmadoEl} (Ecuador/Guayaquil)</p>
  </div>

  <div style="margin-top: 20px; font-size: 13px;">
    <p style="margin: 4px 0;">Por LA ASOCIACIÓN:</p>
    <p style="margin: 4px 0; font-size: 15px;"><strong>SARA LIZBETH GUAYASAMÍN NACIMBA</strong></p>
    <p style="margin: 4px 0;">Sara Guayasamín</p>
    <p style="margin: 4px 0; color: #555;">Presidenta de la AEIS</p>
  </div>

  <p style="margin-top: 28px; font-size: 11px; color: #888;">Este correo es tu comprobante de contrato. Consérvalo — no necesitas responder nada.</p>
</div>
`.trim();
}
