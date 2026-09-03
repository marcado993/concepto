# Borra un correo de prueba de AMBAS bases (aeis_app + logto) para poder
# repetir el flujo de login/registro desde cero con el mismo correo. Las dos
# bases tienen que quedar de acuerdo en que el correo es desconocido — si
# solo se borra de una, la app adivina mal si debe usar Sign in o Register
# (ver el comentario grande en full-name.pattern.ts / el fix del bug de los
# dos códigos) y vuelves a ver el mismo lío.
#
# Uso:
#   .\reset-test-email.ps1 -Email "correo@ejemplo.com"
param(
    [Parameter(Mandatory = $true)][string]$Email
)

$sshKey = "$HOME\.ssh\aeis-key.key"
$vpsHost = "opc@100.74.53.122"

$sql = @"
BEGIN;
UPDATE lockers SET status = 'AVAILABLE' WHERE id IN (
  SELECT "lockerId" FROM locker_rentals WHERE "userId" = (SELECT id FROM users WHERE email = '$Email')
);
DELETE FROM audit_logs WHERE "actorId" = (SELECT id FROM users WHERE email = '$Email');
DELETE FROM ventures WHERE "ownerId" = (SELECT id FROM users WHERE email = '$Email');
DELETE FROM locker_rentals WHERE "userId" = (SELECT id FROM users WHERE email = '$Email');
DELETE FROM subscriptions WHERE "userId" = (SELECT id FROM users WHERE email = '$Email');
DELETE FROM payments WHERE "userId" = (SELECT id FROM users WHERE email = '$Email');
DELETE FROM users WHERE email = '$Email';
COMMIT;
"@

Write-Host "Borrando '$Email' de aeis_app..."
$sql | ssh -i $sshKey $vpsHost "docker exec -i aeis-postgres psql -U aeis -d aeis_app"

Write-Host "Borrando '$Email' de logto..."
ssh -i $sshKey $vpsHost "docker exec aeis-postgres psql -U aeis -d logto -c `"DELETE FROM users WHERE primary_email = '$Email';`""

Write-Host "Listo — '$Email' borrado de ambas bases. Ya puedes repetir el flujo desde cero."
