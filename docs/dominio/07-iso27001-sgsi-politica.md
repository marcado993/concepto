# 07 · Política del SGSI — ISO/IEC 27001:2018

**Respuesta directa a la pregunta del sponsor: sí, esto es un SGSI** (Sistema de Gestión de
Seguridad de la Información) en el sentido de ISO/IEC 27001:2018 — un conjunto de
políticas, procesos y controles gestionados de forma continua, no un proyecto que "se
asegura una vez". `06-iso27701-privacidad.md` ya es la extensión de privacidad (PIMS) sobre
este mismo SGSI; este documento es la base 27001 sobre la que se apoya esa extensión, con
foco explícito en la cláusula 5.2 — la política debe demostrar que toma en cuenta los
requisitos de las partes interesadas, no solo declarar principios genéricos de seguridad.

---

## 1. Contexto de la organización (cláusula 4.1)

- **Organización:** AEIS — Asociación de Estudiantes de Ingeniería en Sistemas, Escuela
  Politécnica Nacional (EPN), Quito, Ecuador.
- **Población atendida:** **1,439 estudiantes** de la carrera de Sistemas (cifra provista
  directamente por el sponsor — actualiza la estimación de 1,402 del TAM/SAM/SOM de
  `Propuesta.pdf` §7.2; se usa esta cifra de aquí en adelante por ser la más reciente).
- **Sistema en alcance:** AEIS-APP — backend NestJS (`backend/`) + frontend Svelte (raíz
  del repo), y los datos que procesan (identidad, pagos, aportaciones, datos de seguridad
  ciudadana).
- **Equipo:** un desarrollador (el sponsor), no un equipo de seguridad dedicado — esto
  condiciona directamente qué controles son realistas (ver §4, "proporcional al contexto").

## 2. Partes interesadas y sus requisitos (cláusula 4.2)

Esta es la tabla que la cláusula 5.2 exige que la política pueda demostrar que tuvo en
cuenta — no es un anexo decorativo, es la evidencia de cumplimiento.

| Parte interesada | Requisito de seguridad/privacidad | Dónde se atiende en el sistema |
|---|---|---|
| **Estudiantes (1,439)** | Que su código único, nombre y — si se adopta — su dato biométrico no se filtren ni se usen para otra cosa que alquilar/aportar | `06-iso27701-privacidad.md` §2 (inventario de PII), autenticación vía Logto, `no-console-of-sensitive-fields` en `policy/semgrep-rules.yml` |
| **Estudiantes (1,439)** | Que el cobro sea transparente — no otro "déficit de caja sin explicar" | Principio "ningún dato desacoplado" (`05-metodologia-devsecops-pipeline.md` §3.1), `AuditLog` obligatorio en cada `Payment`/`LockerRental`/`Subscription` |
| **Presidente AEIS** | Visibilidad financiera confiable para tomar decisiones | Módulo de analítica (pendiente, `02-necesidades-stakeholders.md` §3), permisos de solo-lectura sobre datos agregados |
| **Director de Innovación y Vinculación** | Auditoría técnica real — logs, picos de tráfico, salud del pipeline | `RolesGuard` con jerarquía Director ⊇ Presidente, `GET /metrics`, `ResourceMonitorService` (alertas de CPU/memoria) |
| **EPN (institución)** | Que un incidente de AEIS-APP no dañe la reputación institucional ni viole normativa | Pipeline DevSecOps (`.github/workflows/devsecops.yml`), este mismo documento |
| **Regulador — LOPDP Ecuador** | Base legal, minimización, derechos del titular, retención definida | `06-iso27701-privacidad.md` completo |
| **Proveedores externos** (Logto, PayPhone, GitHub OAuth) | Uso correcto de sus APIs, no abuso que dispare bloqueos | Rate limiting (`RateLimitModule`), PKCE en el login, nunca se retiene el access/refresh token de terceros |
| **El propio desarrollador/sponsor** | Que la seguridad sea sostenible con recursos de una sola persona, sin gasto recurrente que no se pueda pagar | Stack 100% open source (`04-alternativas-tecnologicas-y-costos.md` §1), monitoreo sin Prometheus/Alertmanager como proceso aparte (`08-observabilidad-resiliencia.md`) |

## 3. Alcance del SGSI (cláusula 4.3)

**Dentro de alcance:** el backend NestJS (`backend/`), el frontend Svelte, los datos que
ambos procesan (identidad, financieros, de seguridad ciudadana), el pipeline CI/CD, y la
infraestructura de despliegue (Droplet + Vercel).

**Fuera de alcance:** la infraestructura de Logto/PayPhone/GitHub en sí (son encargados de
PII con su propio SGSI — AEIS-APP los usa, no los audita), la red física de la EPN, y —
igual que ya delimitó `Propuesta.pdf` §3.3 — la fabricación/instalación de los casilleros
físicos.

## 4. Política del SGSI (cláusula 5.2)

> AEIS se compromete a proteger la confidencialidad, integridad y disponibilidad de la
> información de sus 1,439 estudiantes y de la propia asociación, procesada por AEIS-APP,
> mediante controles **proporcionales al contexto real del proyecto** — un equipo de un
> solo desarrollador, presupuesto de infraestructura de ~$27.60/mes, y un plazo de
> desarrollo de 3 semanas — sin que esa proporcionalidad signifique renunciar a los
> requisitos identificados en §2 de este documento.
>
> Esta política se cumple, específicamente, mediante:
>
> 1. **Minimización de datos** — no se retiene ningún dato que no tenga un propósito de
>    negocio declarado (§2 de `06-iso27701-privacidad.md`).
> 2. **Trazabilidad obligatoria** — ningún movimiento de dinero ni cambio de estado queda
>    sin un actor identificado (`AuditLog`, principio de §3.1 de `05`), como respuesta
>    directa al hallazgo de déficit de caja que motivó todo este SGSI.
> 3. **Defensa en profundidad, no un solo control** — autenticación (Logto/JWT) +
>    autorización por rol (`RolesGuard`) + rate limiting + Policy as Code (Semgrep) +
>    escaneo de dependencias/secretos/contenedor (pipeline DevSecOps) + monitoreo activo de
>    recursos, todos capas independientes, ninguna es "la única línea de defensa".
> 4. **Herramientas open source por defecto** — sostenible para un desarrollador único sin
>    depender de licencias que la asociación no pueda pagar de forma recurrente.
> 5. **Mejora continua** — cada hallazgo (el propio déficit de caja, el falso negativo de
>    las reglas de Policy as Code corregido en `05` §7) se documenta y se corrige en el
>    código, no solo se anota.
>
> Esta política se revisa cada vez que cambie el contexto (§1) — nuevo dato personal en
> alcance, cambio de proveedor externo, o cambio de escala (más allá de los 1,439
> estudiantes actuales) — no en un ciclo fijo arbitrario.

## 5. Objetivos de seguridad medibles (cláusula 6.2)

| Objetivo | Métrica | Estado actual |
|---|---|---|
| Cero incidentes de seguridad sobre datos KYC/PII en el primer año | Incidentes reportados | Objetivo heredado de `Propuesta.pdf` §2 (Project Charter) — vigente |
| Ningún dato financiero/de identidad huérfano | % de filas con FK `NOT NULL` cumplida | 100% por diseño de esquema (`backend/prisma/schema.prisma`) |
| Rate limiting activo en el 100% de endpoints de dinero | Endpoints con `@Throttle` | 2/2 (`locker.controller.ts`, `subscription.controller.ts`) |
| Tiempo de detección de CPU/memoria crítica | Minutos desde el evento hasta la alerta | ≤1 minuto (`ResourceMonitorService`, cron cada minuto) |
| Cobertura de Policy as Code verificada contra violaciones reales, no solo contra código conforme | Autotest adversarial documentado | Hecho — `05-metodologia-devsecops-pipeline.md` §7 |

## 6. Relación con el resto de la documentación

Este documento es el "por qué" (política); `05-metodologia-devsecops-pipeline.md` es el
"cómo técnico" (DevSecOps, Policy as Code); `06-iso27701-privacidad.md` es la extensión de
privacidad; `08-observabilidad-resiliencia.md` es el detalle de monitoreo/rate
limiting/pruebas de carga que sustenta el objetivo de la fila 4 de §5.
