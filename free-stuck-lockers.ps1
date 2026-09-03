# Libera casilleros que quedaron en RESERVED/RENTED sin ningún
# LockerRental que los respalde (huérfanos de un reset parcial anterior).
# Seguro de correr en cualquier momento: solo toca lockers sin rentals reales.
$sshKey = "$HOME\.ssh\aeis-key.key"
$vpsHost = "opc@100.74.53.122"

$sql = @"
UPDATE lockers SET status = 'AVAILABLE'
WHERE status != 'AVAILABLE'
  AND id NOT IN (SELECT "lockerId" FROM locker_rentals);
"@

$sql | ssh -i $sshKey $vpsHost "docker exec -i aeis-postgres psql -U aeis -d aeis_app"
