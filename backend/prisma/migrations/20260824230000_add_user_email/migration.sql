-- Correo del usuario. Permite decidir ANTES de mandar el código si la
-- interacción con Logto es SignIn o Register — sin esto había que adivinar
-- y, al fallar, pedir un segundo código (bug real: dos correos al
-- registrarse por primera vez). Nullable: se rellena en el login.
ALTER TABLE "users" ADD COLUMN "email" TEXT;
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
