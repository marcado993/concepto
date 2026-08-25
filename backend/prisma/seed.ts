import { PrismaClient } from "@prisma/client";

// Seed de desarrollo/staging — NO usar los montos de tier en producción
// sin confirmarlos con el sponsor primero.
//
// docs/dominio/02-necesidades-stakeholders.md §2.2 deja los montos de
// Bronce/Platino/Pantera como pregunta abierta CRÍTICA. Los valores de
// abajo son placeholders derivados del único dato real disponible
// (docs/dominio/03-analisis-financiero-costos.md §3: históricamente hubo
// tiers a ~$7.99 y ~$19.99, y luego un plan único de $35) — sirven para
// poder probar el flujo end-to-end, no como precio final.

const prisma = new PrismaClient();

async function main() {
  const period = await prisma.period.upsert({
    where: { label: "2026-B" },
    update: {},
    create: {
      label: "2026-B",
      startsAt: new Date("2026-09-01"),
      endsAt: new Date("2027-02-28"),
    },
  });

  // Los 108 casilleros REALES — reemplaza el inventario de prueba anterior
  // (12 zonas ficticias A-L × 9, "A01".."L09") por el inventario físico
  // real que mandó el cliente (planilla casillero → código único del
  // dueño). Hallazgo real: los casilleros físicos NO tienen zona por
  // letra, solo un número — "los casilleros solo están por número, no por
  // a b c d" — así que el código es el número tal cual, sin ceros a la
  // izquierda ni prefijo. No se importan los códigos únicos de esa
  // planilla: son de estudiantes que probablemente nunca iniciaron sesión
  // en la app (no tienen User real), y crear un alquiler sin una cuenta
  // real violaría la FK NOT NULL de LockerRental.userId (ver
  // schema.prisma). zone queda en "General" para los 108 — no hay dato
  // real de zona/piso, y LockersSection.svelte ya usa ese campo para un
  // filtro por zona que sigue funcionando igual (con una sola zona).
  //
  // Excluidos de la planilla original por estar dañados/fuera de servicio:
  // 45 y 84 (110 números reales - 2 dañados = 108).
  const REAL_LOCKER_NUMBERS = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60,
    61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 85, 86, 87, 88, 89,
    90, 91, 92, 93, 94, 100, 101, 110, 120, 121, 130, 131, 140, 141, 150, 151, 160, 161, 171, 181, 191,
  ];
  for (const n of REAL_LOCKER_NUMBERS) {
    const code = String(n);
    await prisma.locker.upsert({
      where: { code },
      update: {},
      create: { code, zone: "General", status: "AVAILABLE" },
    });
  }

  const tiers: Array<{ name: string; amount: number; benefits: unknown }> = [
    {
      name: "Bronce",
      amount: 7.99, // PLACEHOLDER — confirmar con el sponsor
      benefits: [{ type: "descuento_casillero", percent: 0 }],
    },
    {
      name: "Platino",
      amount: 19.99, // PLACEHOLDER — confirmar con el sponsor
      benefits: [
        { type: "descuento_casillero", percent: 10 },
        { type: "descuento_billar", percent: 10 },
      ],
    },
    {
      name: "Pantera",
      amount: 35.0, // PLACEHOLDER — confirmar con el sponsor
      benefits: [
        { type: "descuento_casillero", percent: 20 },
        { type: "descuento_billar", percent: 20 },
        { type: "acceso_ps4", included: true },
      ],
    },
  ];

  for (const tier of tiers) {
    await prisma.subscriptionTier.upsert({
      where: { periodId_name: { periodId: period.id, name: tier.name } },
      update: {},
      create: { periodId: period.id, name: tier.name, amount: tier.amount, benefits: tier.benefits as any },
    });
  }

  // Emprendimientos MOCK — para poder ver el directorio con contenido real
  // en pantalla mientras el sponsor manda el diseño definitivo (pidió
  // explícitamente "emprendimientos mock, consumiendo imágenes falsas de
  // la API"). Van directo en APPROVED (no PENDING) porque son datos de
  // demostración, no solicitudes reales esperando moderación.
  //
  // Fotos: picsum.photos con seed fijo — API pública real de imágenes
  // falsas/de relleno (no assets locales inventados), determinista: el
  // mismo seed siempre devuelve la misma foto, así las capturas de
  // pantalla no cambian entre corridas del seed.
  //
  // Números de WhatsApp: 5939000000XX — NO son números reales, patrón
  // claramente ficticio (Ecuador no asigna móviles empezando en "900") a
  // propósito, para que nadie reciba un mensaje real por accidente si
  // alguien prueba el botón "Contactar por WhatsApp" contra este seed.
  const ventureOwner = await prisma.user.upsert({
    where: { logtoSub: "mock|venture-owner-seed" },
    update: {},
    create: {
      logtoSub: "mock|venture-owner-seed",
      uniqueCode: "MOCK-VENTURES-OWNER",
      fullName: "Cuenta demo — dueño de emprendimientos mock",
    },
  });

  const mockVentures: Array<{
    name: string;
    description: string;
    category: string;
    photoSeed: string;
    whatsappNumber: string;
  }> = [
    {
      name: "Café del Politécnico",
      description: "Café de especialidad tostado por estudiantes de Sistemas, venta por libra y por taza en el Bloque de Ingeniería.",
      category: "Alimentos",
      photoSeed: "cafe-politecnico",
      whatsappNumber: "593900000001",
    },
    {
      name: "PixelForge Devs",
      description: "Desarrollo de apps y sitios web por encargo para negocios pequeños — el mismo stack que usamos en AEIS-APP.",
      category: "Tecnología",
      photoSeed: "pixelforge-devs",
      whatsappNumber: "593900000002",
    },
    {
      name: "ImpresiónPN 3D",
      description: "Impresión 3D y prototipado rápido — piezas para proyectos de titulación, maquetas y repuestos.",
      category: "Manufactura",
      photoSeed: "impresion-pn-3d",
      whatsappNumber: "593900000003",
    },
    {
      name: "TutorApp Sistemas",
      description: "Tutorías entre pares de Estructuras de Datos, Bases de Datos y Redes — agenda tu sesión por WhatsApp.",
      category: "Educación",
      photoSeed: "tutorapp-sistemas",
      whatsappNumber: "593900000004",
    },
    {
      name: "Bordados Poli",
      description: "Ropa personalizada y bordados con el logo de la facultad — poleras, mochilas y gorras.",
      category: "Ropa y accesorios",
      photoSeed: "bordados-poli",
      whatsappNumber: "593900000005",
    },
  ];

  for (const v of mockVentures) {
    const existing = await prisma.venture.findFirst({ where: { name: v.name, ownerId: ventureOwner.id } });
    if (existing) continue;
    await prisma.venture.create({
      data: {
        ownerId: ventureOwner.id,
        name: v.name,
        description: v.description,
        category: v.category,
        photoUrl: `https://picsum.photos/seed/${v.photoSeed}/600/400`,
        whatsappNumber: v.whatsappNumber,
        status: "APPROVED",
      },
    });
  }

  console.log(
    `Seed listo — periodo ${period.label}, ${REAL_LOCKER_NUMBERS.length} casilleros, ${tiers.length} tiers (montos PLACEHOLDER), ${mockVentures.length} emprendimientos mock.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
