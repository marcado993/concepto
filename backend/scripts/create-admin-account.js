// Crea (o resetea la contraseña de) una cuenta del panel de administración
// — completamente aparte de User/Logto, ver src/admin/admin-auth/. Se
// corre a mano, dentro del contenedor del backend (para tener
// DATABASE_URL real), nunca desde la app.
//
// Casos de uso (formato BDD, mismo estilo que los describe/it del resto
// del backend — ver cualquier *.spec.ts):
//
//   Escenario: primera cuenta de un correo nuevo
//     Dado que ADMIN_EMAIL no tiene ninguna cuenta de administración todavía
//     Cuando se corre este script pasando ADMIN_EMAIL y ADMIN_PASSWORD
//       como VARIABLES DE ENTORNO del comando (nunca escritas en un
//       archivo ni pegadas en este código — así un escáner de secretos
//       como GitGuardian no confunde un ejemplo de uso con una contraseña
//       real filtrada)
//     Entonces se crea una cuenta nueva, con la contraseña cifrada con
//       bcrypt antes de guardarse — nunca en texto plano
//
//   Escenario: alguien olvidó su contraseña
//     Dado que ADMIN_EMAIL YA tiene una cuenta de administración
//     Cuando se corre este script de nuevo con ese mismo correo y una
//       contraseña distinta
//     Entonces se actualiza la contraseña de esa cuenta — mismo camino
//       que "olvidé mi contraseña", no hace falta nada más
//
//   Escenario: rol opcional
//     Dado que no se pasa ADMIN_ROLE
//     Cuando se crea o actualiza la cuenta
//     Entonces queda como PRESIDENTE por defecto — hoy PRESIDENTE y
//       DIRECTOR entran igual al panel (ver admin.controller.ts, cualquier
//       AdminAccount válida entra), el rol solo queda registrado por si
//       se diferencia más adelante
//
// Invocación real (dentro del contenedor):
//   ADMIN_EMAIL=<tu-correo> ADMIN_PASSWORD=<contraseña-de-8+-caracteres> [ADMIN_ROLE=PRESIDENTE|DIRECTOR] node create-admin-account.js
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const role = process.env.ADMIN_ROLE || "PRESIDENTE";

  if (!email || !password) {
    console.error("Uso: ADMIN_EMAIL=<correo> ADMIN_PASSWORD=<contraseña> [ADMIN_ROLE=PRESIDENTE|DIRECTOR] node create-admin-account.js");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("La contraseña debe tener al menos 8 caracteres.");
    process.exit(1);
  }
  if (!["PRESIDENTE", "DIRECTOR"].includes(role)) {
    console.error("ADMIN_ROLE debe ser PRESIDENTE o DIRECTOR.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 10);
    const account = await prisma.adminAccount.upsert({
      where: { email: normalizedEmail },
      update: { passwordHash, role },
      create: { email: normalizedEmail, passwordHash, role },
    });
    console.log(`Cuenta de administración lista: ${account.email} (${account.role})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
