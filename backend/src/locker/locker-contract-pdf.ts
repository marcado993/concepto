import PDFDocument from "pdfkit";
import { titleCase, formatCalendarDate, type LockerContractData } from "./locker-contract";

// Versión en PDF del mismo contrato que ya se manda como HTML en el cuerpo
// del correo (ver lockerContractHtml en locker-contract.ts) — pedido real:
// un documento descargable/imprimible además del correo, no en vez de él.
// Reusa exactamente los mismos datos y el mismo texto legal (mismas 7
// cláusulas, mismas fechas calculadas con formatCalendarDate) para que
// nunca puedan divergir un contrato y el otro.
//
// pdfkit — JS puro, sin Chromium/binario externo — mismo criterio que ya
// se documentó arriba para el HTML: evitar una dependencia frágil de
// generación de documentos en el servidor. Genera en memoria (sin tocar
// disco) porque esto corre en el mismo proceso que ya maneja el pago real,
// no un job aparte.
export function lockerContractPdf(data: LockerContractData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

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

    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("CONTRATO DE USO DE LOCKER", { align: "center" });
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#444444")
      .text("ASOCIACIÓN DE ESTUDIANTES DE INGENIERÍA DE SISTEMAS (AEIS)", { align: "center" });
    doc.moveDown(1.2);

    doc
      .fillColor("#1a1a1a")
      .fontSize(10.5)
      .text(
        'En la ciudad de Quito, a partir de la fecha de firma del presente documento, la Asociación de Estudiantes de Ingeniería de Sistemas (AEIS), en adelante "LA ASOCIACIÓN", representada por su presidente, Sara Guayasamín, establece el siguiente Contrato de Uso de Locker con el/la estudiante identificado/a a continuación, en adelante "EL USUARIO".',
        { align: "justify" }
      );
    doc.moveDown(0.8);

    const rows: [string, string][] = [
      ["Nombre", nombre],
      ["Cédula", data.cedula],
      ["Código único institucional", data.uniqueCode],
      ["Casillero asignado", data.lockerCode],
      ["Semestre", `${data.periodLabel} (hasta el ${vigencia})`],
      ["Monto pagado", `$${monto} — vía PayPhone`],
    ];
    const labelX = doc.x;
    const valueX = labelX + 190;
    for (const [label, value] of rows) {
      const y = doc.y;
      doc.font("Helvetica").fillColor("#555555").fontSize(10).text(label, labelX, y, { width: 180 });
      doc.font("Helvetica-Bold").fillColor("#1a1a1a").fontSize(10).text(value, valueX, y, { width: 300 });
      doc.moveDown(0.4);
    }
    doc.moveDown(0.6);

    doc.font("Helvetica-Bold").fontSize(12).fillColor("#1a1a1a").text("CLÁUSULAS");
    doc.moveDown(0.3);

    const clausulas: [string, string][] = [
      [
        "PRIMERA: Objeto del Contrato.",
        "LA ASOCIACIÓN cede en uso un locker a EL USUARIO durante el periodo de un semestre, a cambio del pago correspondiente y bajo las condiciones establecidas en este contrato.",
      ],
      [
        "SEGUNDA: Pago y Vigencia.",
        `El costo por el uso del locker es de $6.50 (seis dólares con cincuenta centavos de dólar) por todo el semestre. El pago debe realizarse en un solo monto y, una vez confirmado, se asignará el locker de inmediato. Este contrato estará vigente hasta el ${vigencia}, según el calendario académico.`,
      ],
      [
        "TERCERA: Asignación de Lockers.",
        "Los lockers se asignarán según disponibilidad y no podrán cambiarse salvo causa justificada aprobada por LA ASOCIACIÓN.",
      ],
      [
        "CUARTA: Seguridad y Responsabilidad.",
        "EL USUARIO deberá traer su propio candado para asegurar su locker. LA ASOCIACIÓN no se responsabiliza por la pérdida, robo o daño de objetos guardados en el locker. EL USUARIO no podrá guardar objetos inflamables, peligrosos o prohibidos.",
      ],
      [
        "QUINTA: Descuentos y Exoneraciones.",
        "Dependiendo del sistema de aportaciones, ciertos afiliados podrán recibir descuentos en el pago del locker o incluso un locker gratuito, conforme a las normas establecidas por LA ASOCIACIÓN. La aplicación de estos beneficios se verificará antes de la asignación del locker.",
      ],
      [
        "SEXTA: Devolución y Desocupación.",
        `EL USUARIO deberá vaciar el locker hasta el ${vigencia}, fecha correspondiente al final del semestre. De no hacerlo, LA ASOCIACIÓN podrá retirar el candado y las pertenencias a posteriori.`,
      ],
      [
        "SÉPTIMA: Aceptación.",
        "Al completar el formulario de alquiler en AEIS-APP y aceptar los términos, EL USUARIO acepta todas las condiciones establecidas en este documento.",
      ],
    ];
    for (const [titulo, cuerpo] of clausulas) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#1a1a1a").text(titulo, { continued: true });
      doc.font("Helvetica").text(` ${cuerpo}`, { align: "justify" });
      doc.moveDown(0.5);
    }

    doc.moveDown(0.6);
    doc
      .moveTo(doc.x, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor("#cccccc")
      .stroke();
    doc.moveDown(0.5);

    doc.font("Helvetica").fontSize(10).fillColor("#1a1a1a").text("Firmado electrónicamente por:");
    doc.font("Helvetica-Bold").fontSize(11).text(nombre.toUpperCase());
    doc.font("Helvetica").fontSize(10).text(nombre);
    doc.fillColor("#555555").text(`Aceptación registrada en AEIS-APP el ${firmadoEl} (Ecuador/Guayaquil)`);
    doc.moveDown(0.8);

    doc.fillColor("#1a1a1a").text("Por LA ASOCIACIÓN:");
    doc.font("Helvetica-Bold").fontSize(11).text("SARA LIZBETH GUAYASAMÍN NACIMBA");
    doc.font("Helvetica").fontSize(10).text("Sara Guayasamín");
    doc.fillColor("#555555").text("Presidenta de la AEIS");

    doc.moveDown(1.2);
    doc
      .fontSize(8.5)
      .fillColor("#888888")
      .text("Este documento es tu comprobante de contrato. Consérvalo — no necesitas responder nada.");

    doc.end();
  });
}
