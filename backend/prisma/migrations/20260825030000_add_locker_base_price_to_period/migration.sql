-- Precio base del casillero por periodo — reemplaza la constante
-- DEFAULT_LOCKER_BASE_PRICE ($6.50) escrita a mano en locker.service.ts, para
-- que la directiva (PRESIDENTE/DIRECTOR) pueda cambiarla desde el dashboard
-- de administración sin necesitar un redeploy. Default 6.50 preserva el
-- precio real vigente para los periodos ya existentes.
ALTER TABLE "periods" ADD COLUMN "lockerBasePrice" DECIMAL(10,2) NOT NULL DEFAULT 6.50;
