# 02 · Necesidades y Requisitos de Stakeholders (Stakeholder Needs and Requirements Definition)

**Proceso ISO/IEC/IEEE 12207 — grupo Técnico.** Propósito: transformar la perspectiva de
los stakeholders sobre el problema (definido en `01-analisis-negocio-mision.md`) en un
conjunto de necesidades y requisitos deseados, con sus prioridades y restricciones.

- **Input:** `01-analisis-negocio-mision.md`
- **Estado:** borrador — requiere confirmación de gaps antes de pasar a
  System/Software Requirements Definition
- **Proceso siguiente:** `03-requisitos-sistema-software.md` (a crear tras cerrar gaps)

---

## 1. Mapa de stakeholders

| Rol | Quién | Permisos confirmados | Tipo de acceso esperado |
|---|---|---|---|
| Estudiante | Miembro EPN-Sistemas | Alquilar casillero, ver eventos/recursos, ver seguridad, ser aportante | Usuario autenticado (Logto) |
| Presidente AEIS | Directiva | **Ver analítica de datos** + **crear usuarios** | Rol administrativo |
| Director de Innovación y Vinculación | Directiva | **Ver analítica de datos** + **crear usuarios** + **auditar seguridad** (logs del servidor, picos de tráfico, salud del pipeline CI/CD) — superset de Presidente | Rol administrativo + técnico |
| Administración | `[Confirmar]` — ¿es el mismo Presidente/Director, o un rol operativo distinto (ej. secretaría) que verifica pagos y asigna casilleros? | Operación diaria del alquiler | Rol operativo |

**RESUELTO** (respuesta directa del sponsor): Director de Innovación y Vinculación tiene
permisos **estrictamente mayores** que Presidente — todo lo de Presidente, más auditoría
técnica/seguridad. Esto implica que el modelo de roles en Logto no es plano
(estudiante/admin), sino al menos 3 niveles: `estudiante`, `presidente`, `director` (con
`director` ⊇ `presidente` en permisos). Sigue abierto si "Administración" es un cuarto rol
operativo o se cubre con los dos anteriores.

## 2. Necesidades por dominio funcional

### 2.1 Casilleros

- Como **estudiante**, quiero ver disponibilidad real de los 108 casilleros y alquilar uno
  sin llenar un Forms externo.
- Como **estudiante**, quiero ver el precio vigente del semestre según el método de pago
  elegido — **RESUELTO**: $6.50 transferencia+comprobante / $6.90 PayPhone (tarjeta). El
  precio único por semestre se fija por utilidad objetivo (VAN), no por disponibilidad de
  casilleros — ver `03-analisis-financiero-costos.md` §4 y
  `04-alternativas-tecnologicas-y-costos.md` §4.
- Como **estudiante**, quiero pagar con **PayPhone (tarjeta)** o por **transferencia +
  comprobante** — ambas vías, porque parte de la comunidad desconfía de ingresar su
  tarjeta si el sistema no se percibe como seguro (RESUELTO, ver
  `01-analisis-negocio-mision.md` §5 Pago).
- Como **administración**, quiero verificar el pago (comprobante de transferencia) sin
  procesar manualmente cada caso por fuera del sistema.
- Como **presidente** o **director**, quiero ver ocupación e ingresos en tiempo real.

**Abiertas:** confirmar la propuesta exacta de bandas de precio (§ arriba); si la
verificación del comprobante de transferencia es manual asistida o vía OCR; qué
constituye el "contrato" (¿PDF generado, registro en BD, firma digital?).

### 2.2 Aportaciones — parcialmente resuelto

- Como **estudiante-aportante**, quiero elegir entre 3 niveles — **Bronce, Platino,
  Pantera** (RESUELTO: nombres confirmados por el sponsor) — y recibir beneficios
  (descuento en casillero, descuento en mesas de billar, PS4, etc.).
- Como **administración**, quiero definir/mantener los niveles de aportación y sus
  beneficios asociados.

**Dato real de contexto** (ver `03-analisis-financiero-costos.md` §3): históricamente ya
hubo un esquema de 2 tiers (~$7.99 y ~$19.99) que luego cambió a un plan único de $35 —
el esquema de aportaciones **ya cambió de forma antes**, así que el modelo de datos debe
soportar que los tiers y sus precios/beneficios cambien entre periodos sin romper el
histórico.

**Abiertas (bloquean diseño de este dominio):**
- Monto de cada tier (Bronce / Platino / Pantera) — sin resolver.
- ¿Los beneficios escalan por tier (ej. Pantera > Platino > Bronce en % de descuento) o
  son beneficios distintos por tier, no necesariamente "más de lo mismo"?
- ¿Monto fijo o variable, recurrente (¿semestral, como sugiere el patrón 2025-A/2025-B?) o
  único?
- ¿Los beneficios "billar" y "PS4" implican un sistema de reserva de esos recursos
  (similar al dominio `resources` ya existente), o solo control de acceso/descuento?
- ¿Un aportante puede dejar de serlo (vigencia, renovación)?

### 2.3 Emprendimientos (reemplaza "Comunidad") — RESUELTO

- Como **estudiante emprendedor**, quiero dar visibilidad a mi emprendimiento dentro de
  la comunidad politécnica, con un botón de contacto que abre WhatsApp directamente
  (`wa.me`, mensaje precargado) — sin chat propio dentro de la app.
- Como **estudiante**, quiero descubrir emprendimientos de otros politécnicos.

Diseño confirmado: **vitrina/directorio informativo** (nombre, descripción, categoría,
foto, contacto WhatsApp) — sin transacción in-app. Coincide con el "Marketplace fase 1" ya
diseñado en `aeis-app` (ver `01-analisis-negocio-mision.md` §4) — se reutiliza ese diseño.
Sigue abierto si requiere aprobación de administración antes de publicarse (moderación).

### 2.4 Eventos y Recursos — alcance RESUELTO

- Sin cambios de fondo respecto al prototipo actual (calendario de eventos, reserva de
  recursos/equipos). El sponsor confirmó que **sí entran en el alcance de esta fase**
  (~3-4 semanas), justamente porque son en gran parte contenido informativo (CRUD +
  listado), no lógica de negocio compleja como casilleros/aportaciones.

### 2.5 Seguridad

- Como **estudiante**, quiero ver el estado de seguridad de mi zona/campus.
- Ya existe prototipo frontend funcional con datos reales (DMQ 2025). Necesidad principal
  pendiente: `[Confirmar]` si se requiere alguna interacción nueva (ej. reportar un
  incidente) o si el alcance de esta fase es mantener el mapa informativo tal como está.

### 2.6 Analítica

- Como **presidente**, quiero ver los datos de analítica: ingresos vs. techo teórico
  semestral (91/108 casilleros = $591.50 real vs. $702 techo, ver
  `03-analisis-financiero-costos.md` §2), ocupación de casilleros, aportantes activos,
  tráfico de la app, y **trazabilidad de los 277 registros del proceso de alquiler frente
  a los 91 efectivamente concretados** (hallazgo del déficit de caja, ver
  `01-analisis-negocio-mision.md` §2.1 — este cruce es ahora un requisito Must, no
  analítica opcional).
- Como **director de innovación y vinculación**, quiero lo mismo que el presidente, más
  auditoría técnica: logs del servidor, picos de tráfico, salud del pipeline CI/CD/DevSecOps.

Cifras base ya validadas contra datos reales — ya no bloquea el diseño del modelo de datos
de analítica (ver `03-analisis-financiero-costos.md`).

## 3. Priorización tentativa (MoSCoW) — actualizada tras resolver gaps

| Prioridad | Dominio / capacidad |
|---|---|
| Must | Autenticación (Logto: Google/GitHub/credenciales) con 3 niveles de rol (estudiante/presidente/director) |
| Must | Casilleros: alquiler + pago dual (PayPhone + transferencia/comprobante) + asignación, con concurrencia segura a ~1000 estudiantes |
| Must | Analítica básica de casilleros (ingresos, ocupación) para Presidente/Director |
| Must | Eventos y Recursos (CRUD + listado — confirmado como bajo esfuerzo relativo) |
| Must | Trazabilidad/auditoría de alquiler (277 registros → 91 concretados, hallazgo de déficit de caja — `01-analisis-negocio-mision.md` §2.1) |
| Should | Aportaciones — 3 tiers (Bronce/Platino/Pantera) confirmados, montos pendientes |
| Should | Emprendimientos (diseño ya resuelto — vitrina + WhatsApp, reutilizando `aeis-app`) |
| Could | Analítica extendida (tráfico, tendencias, auditoría de seguridad detallada para Director) |
| Could | OCR automático del comprobante de transferencia (MVP puede ser verificación manual asistida) |

Con el alcance confirmado como "todo cabe" (§2.4), el riesgo principal ya no es de alcance
sino de secuencia: construir primero los "Must" (auth + casilleros con concurrencia +
analítica básica) antes que Aportaciones/Emprendimientos, que dependen menos de
infraestructura crítica.

## 4. Preguntas abiertas consolidadas — actualizado

**Resueltas en esta ronda:** definición de $277/$702, permisos Presidente/Director,
alcance de Emprendimientos (vitrina + WhatsApp), flujo de pago (PayPhone + comprobante,
ambos), alcance temporal de Eventos/Recursos, nombres de tiers de Aportaciones
(Bronce/Platino/Pantera), metodologías (BDD/TDD/SDD).

**Siguen abiertas (bloquean `03-requisitos-sistema-software.md` en distinto grado):**

1. Montos y beneficios exactos de cada tier de Aportaciones (Bronce/Platino/Pantera) —
   **crítica**, bloquea el modelo de datos de ese dominio.
2. Precio semestral exacto a fijar dentro del rango $5.50-$9.00 (Tabla 8.5 del PDF) —
   decisión de utilidad objetivo, ya no de reglas de disponibilidad.
3. Rol "Administración": ¿es un cuarto rol operativo o lo cubren Presidente/Director?
4. Naturaleza del "contrato" de alquiler — **RESUELTO**: clickwrap + KYC (ver
   `01-analisis-negocio-mision.md` § Datos personales).
5. Logto: modo de despliegue — **RESUELTO**: self-hosted, en la misma instancia OCI
   (`docker-compose.prod.yml`, imagen `svhd/logto`), no Logto Cloud. Modelo de
   tenant/organización sigue sin definir (un solo tenant alcanza para el alcance actual).
6. Retención y marco regulatorio de datos personales (código único, nombre real, y ahora
   datos **biométricos** por CompreFace) — LOPDP Ecuador; `aeis-app` ya identificó un
   riesgo similar con la cédula como PK.
7. Confirmar el rol final de SvelteKit/Vue en el frontend (respuesta del sponsor no fue
   concluyente — ver `01-analisis-negocio-mision.md` §5 Técnicas).
8. Moderación de Emprendimientos: ¿requiere aprobación de administración antes de
   publicarse?
9. ¿Se adopta la verificación biométrica facial (CompreFace) propuesta en
   `04-alternativas-tecnologicas-y-costos.md`, o el KYC se queda solo en código único +
   comprobante?
