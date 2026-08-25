-- Cuenta del panel de administración — completamente separada de "users"
-- (Logto). Login propio de correo+contraseña, ver admin-auth.service.ts.
CREATE TABLE "admin_accounts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PRESIDENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_accounts_email_key" ON "admin_accounts"("email");

-- audit_logs ahora puede pertenecer a un User (Logto) O a un AdminAccount
-- (panel propio) — ver el comentario grande sobre AuditLog en schema.prisma.
ALTER TABLE "audit_logs" ALTER COLUMN "actorId" DROP NOT NULL;
ALTER TABLE "audit_logs" ADD COLUMN "adminActorId" TEXT;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_adminActorId_fkey"
    FOREIGN KEY ("adminActorId") REFERENCES "admin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_check"
    CHECK ("actorId" IS NOT NULL OR "adminActorId" IS NOT NULL);
