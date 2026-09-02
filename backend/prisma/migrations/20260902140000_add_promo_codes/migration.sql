-- AlterEnum
-- Postgres no deja USAR un valor de enum recién agregado dentro de la misma
-- transacción que lo crea. Acá no se usa: solo se declara, y el primer
-- Payment con method='PROMO' llega después, en tiempo de ejecución. Mismo
-- patrón que la migración que agregó 'INFORMATIVE'.
ALTER TYPE "PaymentMethod" ADD VALUE 'PROMO';

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByAdminId" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "redeemedByUserId" TEXT,
    "redeemedRentalId" TEXT,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_redeemedRentalId_key" ON "promo_codes"("redeemedRentalId");

-- CreateIndex
CREATE INDEX "promo_codes_redeemedAt_idx" ON "promo_codes"("redeemedAt");

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "admin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_redeemedByUserId_fkey" FOREIGN KEY ("redeemedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_redeemedRentalId_fkey" FOREIGN KEY ("redeemedRentalId") REFERENCES "locker_rentals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
