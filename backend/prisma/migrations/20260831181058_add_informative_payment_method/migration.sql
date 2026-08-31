-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'INFORMATIVE';

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actorId_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_adminActorId_fkey";

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_adminActorId_fkey" FOREIGN KEY ("adminActorId") REFERENCES "admin_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
