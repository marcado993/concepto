# Crea una cuenta nueva de consola de Logto (tenant "admin") cuando quedaste
# afuera y la pantalla de admin.aeis-app.online solo muestra login (nunca
# "crear cuenta") - Logto OSS solo ofrece el registro de consola UNA vez, en
# el primer arranque; si esa cuenta se pierde despues, no hay forma de
# volver a registrarse desde la web. Esta es la via soportada para ese caso:
# insertar la fila directo con el MISMO algoritmo que usa Logto internamente.
#
# El hash NO viene escrito aca, y no es un detalle menor: la version anterior
# de este archivo llevaba la contrasena en texto plano en un comentario Y su
# hash Argon2i en el INSERT. Eso es una credencial de la cuenta con la que se
# entra al panel - en un repo queda para siempre en el historial, aunque
# despues se borre el archivo.
#
# En vez de eso, el hash se genera EN EL CONTENEDOR llamando al propio modulo
# de Logto (packages/core/build/workers/tasks/argon2i.js: Argon2i, 8
# iteraciones, 8 MB, paralelismo 1, salt aleatorio de 16 bytes). No es un
# hash inventado ni una reimplementacion: es el mismo codigo que Logto corre
# al registrar a alguien, asi que el login lo acepta tal cual.
#
# NO toca el tenant "default" (los usuarios reales de estudiante) ni ninguna
# configuracion (aeis-app, conectores, AEIS API) - son tablas/filas aparte.
#
# Uso:
#   .\create-logto-admin.ps1 -Usuario aeisapp -Password 'LaQueQuieras!123'
#
# Despues de entrar hay un SEGUNDO paso obligatorio: la cuenta nace sin
# permisos y la consola responde "Acceso denegado" al pedir el token de la
# organizacion. Correr .\grant-logto-admin-permissions.ps1 para vincularla.
#
# ASCII puro a proposito (sin acentos/enies/rayas largas) - la version
# anterior de este archivo tenia esos caracteres y Windows PowerShell la
# leyo con el codepage equivocado, lo que rompio el parser entero
# ("Falta la cadena en el terminador") aunque el archivo se viera bien.

param(
    [Parameter(Mandatory = $true)][string]$Usuario,
    [Parameter(Mandatory = $true)][string]$Password,
    [string]$Nombre = "AEIS Admin"
)

$sshKey = "$HOME\.ssh\aeis-key.key"
$vpsHost = "opc@100.74.53.122"

# El id de Logto es de 12 caracteres alfanumericos en minuscula.
$alfabeto = "abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray()
$idUsuario = -join (1..12 | ForEach-Object { $alfabeto | Get-Random })

Write-Host "Generando el hash con el modulo de Logto (dentro del contenedor)..."

# La contrasena viaja como variable de entorno del contenedor, NO como
# argumento: los argumentos quedan visibles en `ps` para cualquiera que
# tenga una sesion en el VPS mientras el comando corre.
$generador = @'
const m = await import("/etc/logto/packages/core/build/workers/tasks/argon2i.js");
process.stdout.write(await m.default(process.env.LOGTO_NEW_PASSWORD));
'@

$hash = ssh -i $sshKey $vpsHost "sudo docker exec -e LOGTO_NEW_PASSWORD='$Password' -i aeis-logto node --input-type=module -e '$generador'"

if (-not $hash -or $hash -notlike '$argon2i$*') {
    Write-Error "No se pudo generar el hash. Respuesta: $hash"
    exit 1
}

# La comilla simple es el unico caracter que rompe un literal de SQL; se
# escapa duplicandola, que es como lo hace el estandar.
$usuarioSql = $Usuario.Replace("'", "''")
$nombreSql = $Nombre.Replace("'", "''")

$sql = @"
INSERT INTO users (
  tenant_id, id, username, password_encrypted, password_encryption_method, name,
  is_suspended, is_password_expired, created_at, updated_at
) VALUES (
  'admin',
  '$idUsuario',
  '$usuarioSql',
  '$hash',
  'Argon2i',
  '$nombreSql',
  false,
  false,
  now(),
  now()
);
"@

$sql | ssh -i $sshKey $vpsHost "sudo docker exec -i aeis-postgres psql -U aeis -d logto"

Write-Host ""
Write-Host "Listo. Usuario '$Usuario' (id $idUsuario) creado en el tenant admin."
Write-Host "Ahora corre .\grant-logto-admin-permissions.ps1 o la consola te dara 'Acceso denegado'."
Write-Host "Entra a https://admin.aeis-app.online (por Tailscale)."
