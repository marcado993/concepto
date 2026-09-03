# Deja AMBAS bases en 0 para arrancar produccion de verdad: aeis_app
# (usuarios/pagos/alquileres/aportaciones/emprendimientos/audit_logs de
# estudiante) Y logto tenant "default" (usuarios de auth de estudiante -
# sus 15 tablas hijas relacionadas tienen ON DELETE CASCADE confirmado, asi
# que un DELETE FROM users ahi arrastra limpio sesiones/identidades/tokens
# sin dejar huerfanos).
#
# ASCII puro a proposito (sin acentos/enies/rayas largas) - una version
# anterior de este archivo tenia esos caracteres y Windows PowerShell la
# leyo con el codepage equivocado, lo que rompe el parser entero aunque el
# archivo se vea bien - probablemente por eso nunca corrio de verdad antes.
#
# CORREGIDO ademas - la primera version de este script borraba TODO
# `logto.users` sin filtrar por tenant y se hubiera llevado por delante la
# cuenta de la CONSOLA de Logto (tenant "admin"), no solo las cuentas de
# estudiante (tenant "default"): la misma tabla fisica guarda los dos
# tenants juntos. El `WHERE tenant_id = 'default'` de abajo es lo que
# faltaba - asi el wipe nunca toca la cuenta con la que entras a
# admin.aeis-app.online.
#
# SE CONSERVAN a proposito (son configuracion real, no datos de prueba):
#   - periods (rompe "no hay periodo activo" en toda la app si se borra)
#   - subscription_tiers (precios/beneficios configurados)
#   - admin_accounts (te deja afuera de tu propio panel si se borra)
#   - app_settings (feature flags)
#   - audit_logs de acciones de ADMIN (adminActorId) - solo se borran los
#     de estudiante (actorId), igual que siempre
#   - logto.users del tenant "admin" (tu cuenta de la consola) - solo se
#     borra el tenant "default" (estudiantes)
#
# Respaldo YA tomado antes de generar la primera version de este script
# (no destructivo):
#   ~/backups/aeis_app_pre_wipe_final_20260828_002347.sql
#   ~/backups/logto_pre_wipe_final_20260828_002347.sql
# Para restaurar si algo sale mal:
#   cat ~/backups/aeis_app_pre_wipe_final_20260828_002347.sql | ssh -i $sshKey $vpsHost "docker exec -i aeis-postgres psql -U aeis -d aeis_app"
#   cat ~/backups/logto_pre_wipe_final_20260828_002347.sql   | ssh -i $sshKey $vpsHost "docker exec -i aeis-postgres psql -U aeis -d logto"
#
# Uso: .\wipe-all-to-zero.ps1

$sshKey = "$HOME\.ssh\aeis-key.key"
$vpsHost = "opc@100.74.53.122"

Write-Host "Borrando aeis_app (usuarios/pagos/alquileres/aportaciones/emprendimientos)..."
$sqlApp = @'
BEGIN;
UPDATE lockers SET status = 'AVAILABLE' WHERE status != 'AVAILABLE';
DELETE FROM audit_logs WHERE "actorId" IS NOT NULL;
DELETE FROM ventures;
DELETE FROM locker_rentals;
DELETE FROM subscriptions;
DELETE FROM payments;
DELETE FROM users;
COMMIT;
'@
$sqlApp | ssh -i $sshKey $vpsHost "docker exec -i aeis-postgres psql -U aeis -d aeis_app"

Write-Host "Borrando logto tenant 'default' (usuarios de auth de estudiante - el tenant 'admin' de la consola NUNCA se toca)..."
$sqlLogto = @'
BEGIN;
DELETE FROM users WHERE tenant_id = 'default';
COMMIT;
'@
$sqlLogto | ssh -i $sshKey $vpsHost "docker exec -i aeis-postgres psql -U aeis -d logto"

Write-Host "Listo - aeis_app y logto (tenant default) en 0. periods/subscription_tiers/admin_accounts/app_settings y tu cuenta de consola (tenant admin) intactos."
