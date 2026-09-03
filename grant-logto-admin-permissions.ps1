# Segundo paso despues de create-logto-admin.ps1: el login ya funciona
# (usuario/contrasena aceptados) pero la consola daba "Acceso denegado" al
# pedir el token de la organizacion (getOrganizationTokenClaims) - la
# cuenta nueva no estaba vinculada a ninguna organizacion ni rol.
#
# Logto modela el acceso de la consola a un tenant especifico (aqui,
# "default" = tu app real) como membresia de ORGANIZACION dentro del
# tenant "admin", mas los roles RBAC de tipo User. Verificado en la base
# (solo lectura, nada de esto es una suposicion):
#   - organizations: t-default ("Tenant default"), t-admin ("Tenant admin")
#   - organization_roles: admin, collaborator
#   - roles tipo User en tenant admin: "default:admin" y "user"
#   - las tablas de vinculo (organization_user_relations,
#     organization_role_user_relations, users_roles) estaban TODAS vacias
#     - por eso ninguna cuenta, ni la anterior ni la nueva, tenia permiso
#     real aunque el login si funcionara.
#
# Este script vincula la cuenta indicada como admin de AMBAS organizaciones
# (t-default y t-admin) y le da los dos roles RBAC de tipo User que existen
# (default:admin, user). No toca el tenant "default" (los usuarios reales
# de estudiante) ni ninguna configuracion de la app.
#
# ASCII puro a proposito - ver el comentario de encoding en
# create-logto-admin.ps1/wipe-all-to-zero.ps1.
#
# Uso: .\grant-logto-admin-permissions.ps1 -Usuario aeisapp

param(
    [Parameter(Mandatory = $true)][string]$Usuario
)

$sshKey = "$HOME\.ssh\aeis-key.key"
$vpsHost = "opc@100.74.53.122"

$usuarioSql = $Usuario.Replace("'", "''")

# Los ids se RESUELVEN por nombre en vez de venir escritos.
#
# Antes estaban fijos (el id de la cuenta y los dos ids de rol), lo que
# ataba este script a UNA cuenta concreta creada a mano: create-logto-admin
# genera un id nuevo cada vez, asi que la pareja de scripts quedaba rota.
# Resolver por nombre lo hace sobrevivir ademas a una reinstalacion de
# Logto, donde los ids de rol serian otros.
#
# Los ON CONFLICT DO NOTHING lo hacen repetible: correrlo dos veces no
# falla ni duplica nada.
$sql = @"
BEGIN;

-- Falla temprano y con un mensaje claro si la cuenta no existe, en vez de
-- insertar vinculos que no apuntan a nadie.
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE tenant_id = 'admin' AND username = '$usuarioSql') THEN
    RAISE EXCEPTION 'No existe el usuario % en el tenant admin. Crealo antes con create-logto-admin.ps1', '$usuarioSql';
  END IF;
END \$\$;

INSERT INTO organization_user_relations (tenant_id, organization_id, user_id)
SELECT 'admin', o.id, u.id
FROM (VALUES ('t-default'), ('t-admin')) AS o(id)
CROSS JOIN (SELECT id FROM users WHERE tenant_id = 'admin' AND username = '$usuarioSql') u
ON CONFLICT DO NOTHING;

INSERT INTO organization_role_user_relations (tenant_id, organization_id, organization_role_id, user_id)
SELECT 'admin', o.id, 'admin', u.id
FROM (VALUES ('t-default'), ('t-admin')) AS o(id)
CROSS JOIN (SELECT id FROM users WHERE tenant_id = 'admin' AND username = '$usuarioSql') u
ON CONFLICT DO NOTHING;

-- Los dos roles RBAC de tipo User del tenant admin, cualesquiera sean sus
-- ids en esta instalacion.
INSERT INTO users_roles (tenant_id, id, user_id, role_id)
SELECT 'admin', substr(md5(random()::text), 1, 12), u.id, r.id
FROM (SELECT id FROM users WHERE tenant_id = 'admin' AND username = '$usuarioSql') u
CROSS JOIN (SELECT id FROM roles WHERE tenant_id = 'admin' AND type = 'User') r
ON CONFLICT DO NOTHING;

COMMIT;
"@

$sql | ssh -i $sshKey $vpsHost "sudo docker exec -i aeis-postgres psql -U aeis -d logto"

Write-Host "Listo - cierra sesion en la consola (o abre una pestana nueva/incognito) y vuelve a entrar para que tome los permisos nuevos."
