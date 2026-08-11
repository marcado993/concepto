# 11 · Hardening del Servidor (Oracle Cloud, Oracle Linux 9)

Aplicado **antes** de desplegar ningún contenedor real (`10-despliegue-vps-vercel.md` va
después de este documento, no antes) sobre la instancia Always Free `VM.Standard.A1.Flex`
(2 OCPU/12GB, Oracle Linux 9.8). Todo lo de este documento ya
se ejecutó y se verificó en vivo por SSH — no es un plan pendiente, es lo que corre ahora
mismo en el servidor.

## Mapa contra el marco ISO/DevSecOps ya establecido

| Capa | Qué se hizo | Se conecta con |
|---|---|---|
| SSH | Sin login por contraseña, sin `root` por SSH, `MaxAuthTries 3`, timeout de sesión 5 min | Primera vez que se toca el SO en sí — antes todo el trabajo de seguridad era a nivel de código de la app |
| Firewall (2 capas) | `firewalld` local (solo 22/80/443) + Security List de OCI (pendiente de confirmar en consola) | `10-despliegue-vps-vercel.md` §1.1/§1.6 — este documento lo ejecuta |
| Parcheo automático | `dnf-automatic`, solo actualizaciones de seguridad, corre diario | `05-metodologia-devsecops-pipeline.md` §3.0.1 (OWASP A06:2021 — Vulnerable/Outdated Components), hasta ahora solo cubierto a nivel de dependencias npm |
| Fail2ban | Jail de `sshd` vía `journald`, baneo escalable (1h → hasta 1 semana en reincidencia) | Complementa el rate limiting de la API (`08-observabilidad-resiliencia.md` §1) — ese protege la API, esto protege el acceso SSH al servidor |
| SELinux | Ya viene `Enforcing` por defecto en Oracle Linux 9 — **no se desactivó** | ISO/IEC 27001 Anexo A — A.8.9 "Configuration management" (`07-iso27001-sgsi-politica.md`) |
| Sysctl / kernel | SYN cookies, sin redirecciones ICMP, sin source routing, `log_martians`, protección de hardlinks/symlinks | Extiende el hallazgo de `09-auditoria-pentest.md` §2 — misma lógica de "reducir superficie", ahora a nivel de kernel |
| Docker daemon | Rotación de logs (10MB×3), `no-new-privileges`, `icc:false`, `live-restore` | El non-root de los contenedores ya estaba en el `Dockerfile` desde el principio — esto es lo nuevo del *daemon* del host |

## 1. SSH — `/etc/ssh/sshd_config.d/10-aeis-hardening.conf`

```
PermitRootLogin no
PubkeyAuthentication yes
PasswordAuthentication no
PermitEmptyPasswords no
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
```

**Detalle no obvio:** el archivo se nombra `10-` (no `99-`) a propósito. `sshd` aplica la
**primera** coincidencia de cada directiva al leer `/etc/ssh/sshd_config.d/*.conf` en orden
alfabético — los archivos que ya traía Oracle Linux (`50-cloud-init.conf`,
`50-redhat.conf`, que dejan `X11Forwarding yes`) se leen *después* del `10-`, así que
nuestros valores ganan. Un archivo `99-` habría perdido silenciosamente contra esos
defaults. Verificado con `sudo sshd -T` tras aplicar (ver tabla de verificación al final).

`PasswordAuthentication no` ya venía forzado por `cloud-init` desde la creación de la
instancia — se repite aquí de forma explícita para que quede documentado como decisión
propia, no como un default que podría cambiar si algún día se recrea la instancia sin
`cloud-init` de por medio.

## 2. Firewall local — `firewalld`

```bash
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload
```

Puerto 22 ya viene permitido por defecto en la zona `public`. Estado final: `ports: 80/tcp
443/tcp`, `services: dhcpv6-client ssh` — nada más. **Falta confirmar la segunda capa**: el
Security List de la VCN en la consola de OCI (Networking → VCN → Security Lists → Add
Ingress Rules, puertos 80/443, `0.0.0.0/0`) — sin eso, `firewalld` deja pasar el tráfico
pero nunca llega porque OCI lo bloquea un nivel antes.

## 3. Parcheo automático — `dnf-automatic`

```bash
sudo dnf install -y dnf-automatic
# /etc/dnf/automatic.conf: upgrade_type = security, apply_updates = yes
sudo systemctl enable --now dnf-automatic.timer
```

Corre una vez al día, aplica **solo** actualizaciones de seguridad (no todo el sistema, a
propósito — evita que un `apt upgrade` completo sin supervisión rompa algo sin que nadie se
entere). Verificado activo con `systemctl list-timers`.

## 4. Fail2ban — `/etc/fail2ban/jail.d/aeis-sshd.local`

```ini
[sshd]
enabled = true
backend = systemd
maxretry = 4
findtime = 10m
bantime = 1h
bantime.increment = true
bantime.factor = 4
bantime.maxtime = 1w
```

No viene en los repos base de Oracle Linux — se instaló habilitando el repo
`ol9_developer_EPEL` (ya presente pero deshabilitado por defecto:
`sudo dnf config-manager --set-enabled ol9_developer_EPEL`). `backend = systemd` porque
Oracle Linux usa `journald`, no archivos de log planos como `/var/log/auth.log` de Debian.
El baneo escala (`bantime.increment`) — un atacante que reincide después de cumplir el
primer baneo de 1h se enfrenta a baneos cada vez más largos, hasta 1 semana.

## 5. SELinux

Ya viene `Enforcing` en la imagen oficial de Oracle Linux 9 de OCI — **no se tocó**, es
la postura correcta por defecto. Único efecto práctico ya identificado: los bind mounts de
Docker necesitan la etiqueta `:Z`/`:z` o SELinux los bloquea con "permission denied" aunque
los permisos Unix estén bien — ya corregido en `docker-compose.prod.yml` (el mount del
`Caddyfile` lleva `:ro,Z`).

## 6. Sysctl — `/etc/sysctl.d/99-aeis-hardening.conf`

SYN cookies, sin aceptar redirecciones/source-routing ICMP (previene ataques
man-in-the-middle vía ICMP falso), `log_martians` (registra paquetes con IP de origen
imposible para la interfaz — señal de spoofing), `fs.protected_hardlinks`/
`protected_symlinks` (mitiga una clase de ataques de escalación de privilegios vía
symlinks en directorios compartidos como `/tmp`). **A propósito no se tocó**
`net.ipv4.ip_forward` — Docker lo necesita en `1` para las redes bridge de los
contenedores y lo gestiona el propio daemon al arrancar.

## 7. Docker daemon — `/etc/docker/daemon.json`

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "no-new-privileges": true,
  "icc": false,
  "live-restore": true
}
```

- **Rotación de logs**: sin esto, los logs de contenedores de larga duración pueden llenar
  el disco de una instancia con solo 12GB.
- **`no-new-privileges`**: ningún proceso dentro de un contenedor puede ganar privilegios
  vía binarios `setuid`, aunque el propio contenedor esté mal configurado.
- **`icc: false`**: desactiva comunicación entre contenedores en la red `bridge` por
  defecto de Docker — **no afecta** a `docker-compose.prod.yml`, que crea su propia red de
  proyecto (Compose siempre usa redes definidas por usuario, con su propia resolución DNS
  entre servicios, independiente de este flag global).
- **`live-restore`**: si el daemon de Docker se reinicia (por ejemplo, tras aplicar un
  parche de seguridad de `dnf-automatic` que lo toque), los contenedores siguen corriendo
  sin interrupción en vez de detenerse.

## 8. Verificación final (todo confirmado en vivo por SSH)

| Chequeo | Resultado |
|---|---|
| `getenforce` | `Enforcing` |
| `sudo sshd -T \| grep permitrootlogin` | `no` |
| `sudo sshd -T \| grep passwordauthentication` | `no` |
| `sudo firewall-cmd --list-ports` | `80/tcp 443/tcp` |
| `systemctl is-active dnf-automatic.timer` | `active` |
| `sudo systemctl is-active fail2ban` | `active`, jail `sshd` cargado |
| `sysctl net.ipv4.tcp_syncookies` | `1` |
| `sudo systemctl is-active docker` | `active`, Docker 29.7.2 + Compose v5.4.0 |

## 9. Pendiente antes de pasar a `10-despliegue-vps-vercel.md`

- Confirmar en la consola de OCI que el Security List de la VCN tiene 80/443 abiertos
  (capa externa — sin esto, `firewalld` no es suficiente).
- Activar Cloud Guard y Vulnerability Scanning en la consola (ambos gratis, cubren
  detección continua que este documento no reemplaza, solo complementa).
