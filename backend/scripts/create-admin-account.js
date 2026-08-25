// Crea (o resetea la contraseña de) una cuenta del panel de administración
// — completamente aparte de User/Logto, ver src/admin/admin-auth/. Se
// corre a mano, UNA vez por cuenta nueva (o cuando alguien olvida su
// contraseña), nunca desde la app.
//
// Uso (dentro del contenedor del backend, para tener DATABASE_URL real):
//   ADMIN_EMAIL="correo@real.com" ADMIN_PASSWORD="una-contraseña-de-verdad" node create-admin-account.js
//   ADMIN_ROLE=DIRECTOR opcional (por defecto PRESIDENTE) — no cambia qué
//   puede hacer en el panel hoy (ver admin.controller.ts: cualquier
//   AdminAccount válida entra igual), solo queda registrado para más
//   adelante si se diferencia.
//
// Es un upsert por correo: correrlo de nuevo con el MISMO correo y una
// contraseña distinta actualiza esa cuenta — es el mecanismo para
// "olvidé mi contraseña", no hace falta nada más.
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const role = process.env.ADMIN_ROLE || "PRESIDENTE";

  if (!email || !password) {
    console.error('Uso: ADMIN_EMAIL="..." ADMIN_PASSWORD="..." [ADMIN_ROLE=PRESIDENTE|DIRECTOR] node create-admin-account.js');
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
