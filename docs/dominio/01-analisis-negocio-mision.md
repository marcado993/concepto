# 01 · Análisis de Negocio / Misión (Business or Mission Analysis)

**Proceso ISO/IEC/IEEE 12207 — grupo Técnico.** Propósito: caracterizar el problema u
oportunidad de negocio, acotar el espacio de solución y proponer clases de solución
candidatas, antes de definir requisitos formales.

- **Fecha de elicitación:** 2026-08-10
- **Fuente de los inputs:** entrevista directa con el sponsor/desarrollador (Luis Guerrero)
- **Estado:** borrador — contiene supuestos marcados `[Confirmar]` pendientes de validación
- **Proceso siguiente:** `02-necesidades-stakeholders.md` (Stakeholder Needs and
  Requirements Definition), `03-analisis-financiero-costos.md` (datos financieros reales),
  `04-alternativas-tecnologicas-y-costos.md` (input externo: PDF formal de la EPN con
  análisis de alternativas, CAPEX/OPEX y VAN/TIR/PRI)

> ✅ **Conflictos con `Propuesta.pdf` resueltos por el sponsor:** se mantiene **NestJS +
> Logto** (no SvelteKit + Keycloak — se revisó la recomendación del PDF y se descarta
> explícitamente para este proyecto) y el plazo real es **3 semanas** (no 3-4 semanas ni
> 3-4 meses — el PDF está desactualizado en ese punto). El único punto que sigue abierto es
> la reconciliación exacta de las cifras de ingreso de casilleros (ver §6 y
> `03-analisis-financiero-costos.md` §2) — y esa apertura reveló un hallazgo de negocio más
> serio que un simple error de dato: ver §2.1 abajo.

## 0. Relación con el proyecto académico previo (`aeis-app`)

Existe un proyecto previo real, **no un concepto** — `D:\aso-app\aeis-app`, hecho en clase
(equipo "team02", curso ISWD622_2025A, EPN) con:

- Backend **Spring Boot (Java)**, con `LockerRentalService`, `LockerBlockService`,
  `RentalCalculator`, `PeriodService`, schedulers, y **tests unitarios ya escritos**.
- **PayPhone ya integrado y probado** (`PayPhoneServiceTest`) para el pago de casilleros.
- Autenticación **nativa** (Spring Security + BCrypt) + login social Google/GitHub — el
  equipo evaluó Logto/Keycloak y **los descartó explícitamente** (ver
  `aeis-app/docs/arquitectura-nuevos-modulos.md` §6) por latencia del redirect OIDC en
  wifi universitaria inestable y costo operativo de mantener un IdP aparte.
- Diseño ya hecho para un módulo de **descuentos en negocios aliados** y un
  **marketplace de emprendimientos** (vitrina + contacto WhatsApp `wa.me`, sin chat
  propio) — prácticamente idéntico a lo que se pide como "Aportaciones" y
  "Emprendimientos" en este documento (ver §4).
- Notificaciones, carnet estudiantil digital con QR, PWA/Service Worker ya diseñados o
  implementados.

**Decisión del sponsor:** `aeis-app` fue el proyecto académico de clase; **este repo
(`asoAPPconcepto1`) inicia una migración del backend a NestJS**, para poder trabajar con
**Logto** (divergencia deliberada de la decisión previa del equipo) y para **abstraer los
dominios correctamente pensando en concurrencia real a escala de ~1000 estudiantes**
(evitar condiciones de carrera, p. ej. doble-reserva del mismo casillero, doble-cobro).

**Implicación práctica:** las reglas de negocio ya validadas en `aeis-app` (cálculo de
renta de casillero, ciclo de vida de periodo, diseño de marketplace/WhatsApp, diseño de
descuentos) son **insumo directo a reutilizar**, no partir de cero — lo que cambia es la
plataforma técnica (NestJS en vez de Spring Boot) y el proveedor de identidad (Logto en
vez de auth nativa), no necesariamente la lógica de dominio.

---

## 1. Organización y contexto

**AEIS** — asociación estudiantil sin fines de lucro, con sede en la Escuela Politécnica
Nacional (EPN, Quito, Ecuador), para estudiantes de la carrera de Sistemas.

La asociación ya opera hoy (no es un concepto sin cliente): gestiona un servicio real de
alquiler de casilleros para sus miembros.

## 2. Problema de negocio / oportunidad

**Proceso actual (manual):**

1. El estudiante llena un Google Forms indicando: número único de estudiante, el
   casillero que desea, y evidencia de la transferencia bancaria del pago.
2. La verificación de pago y asignación de casillero se hace manualmente.
3. No existe analítica de datos sobre el proceso (ocupación, ingresos, tendencias).

**Oportunidad:** automatizar el ciclo completo de alquiler (selección → pago → asignación
→ contrato) y generar analítica de datos para la directiva.

### 2.1 Hallazgo de negocio: el proceso manual no da trazabilidad financiera confiable

Al tratar de conciliar las cifras de ingreso de casilleros (§6, y
`03-analisis-financiero-costos.md` §2), el sponsor aclaró que de **277 registros** del
proceso de alquiler solo **91 corresponden a casilleros efectivamente alquilados**, y que
existe un **déficit de caja** cuyo origen la directiva no tiene claro — no se descarta
manejo indebido de fondos ni error operativo, y hoy no hay forma sistemática de
distinguir entre ambos casos con el proceso manual actual (Forms + comprobante suelto).

Esto **eleva la prioridad** de un requisito que antes se trataba como "nice to have"
(analítica): el sistema debe dejar un **rastro de auditoría verificable** — quién registró
qué, cuánto se cobró, cuándo, por qué medio, y quién lo confirmó — no solo un dashboard de
métricas agregadas. Es, en la práctica, el driver de negocio más fuerte para automatizar,
más que la conveniencia de no usar un Forms.

## 3. Motivación del módulo de seguridad

Se incorpora un módulo de seguridad (mapa + indicadores) por el contexto de inseguridad en
Quito y, en particular, un antecedente reciente mencionado por el sponsor relacionado con
la seguridad de estudiantes (caso de Nathaly Mafla). Este módulo ya tiene un prototipo
frontend funcional (`SecurityMap.svelte`) con datos reales del Observatorio Metropolitano
de Seguridad Ciudadana (DMQ, cierre 2025).

No se requiere que este documento profundice en el hecho en sí — se registra únicamente
como **driver de negocio** que justifica priorizar la seguridad percibida de los
estudiantes como objetivo del producto.

## 4. Alcance de la solución

### Dominios funcionales confirmados para esta fase

| Dominio | Descripción | Estado actual |
|---|---|---|
| **Casilleros** (`lockers`) | Alquiler automatizado de 108 casilleros físicos, $6.50 c/u como precio base | Frontend prototipo (datos mock) |
| **Aportaciones** | Un "aportante" contribuye y recibe beneficios (descuento en casillero, billar, PS4, etc.) — históricamente ya existe como categoría contable ("S/B Aportaciones AEIS", "Plan Aportaciones") pero sin app propia | No existe app — a diseñar; niveles Bronce/Platino/Pantera confirmados, montos exactos pendientes (ver `03-analisis-financiero-costos.md`) |
| **Eventos** (`events`) | Calendario de actividades AEIS | Frontend prototipo (datos mock) |
| **Recursos** (`resources`) | Reserva de equipos/racks/kits | Frontend prototipo (datos mock) |
| **Seguridad** (`security`) | Mapa + indicadores de seguridad del campus/zona | Frontend prototipo (datos reales estáticos) |
| **Analítica** | Dashboard para Presidente / Director de innovación y vinculación | No existe aún — a diseñar |

### Cambio de alcance respecto al prototipo actual — RESUELTO

El dominio **"Comunidad"** (`community`, noticias) se **reemplaza** por
**"Emprendimientos"**: vitrina/directorio informativo (nombre, descripción, categoría,
contacto) de emprendimientos de estudiantes politécnicos, **con contacto vía WhatsApp**
(enlace `wa.me`, click-to-chat) — no chat propio dentro de la app.

Esto coincide, casi al detalle, con el módulo de "Marketplace fase 1" ya diseñado en
`aeis-app/docs/arquitectura-nuevos-modulos.md` §3.4: mismo patrón (directorio + WhatsApp,
sin construir infraestructura de chat propia, venta directa in-app queda fuera de esta
fase). Se recomienda **reutilizar ese diseño tal cual** en vez de rediseñarlo — ya
justifica por qué WhatsApp y no un chat propio (evita responsabilidad de privacidad extra,
evita infraestructura de WebSocket/polling innecesaria).

## 5. Restricciones

### Técnicas

- **Autenticación:** Logto, con login por Google, GitHub, y credenciales propias
  (email/password). `[Confirmar]` — ¿Logto self-hosted o cloud? ¿un solo tenant para todos
  los roles o tenants/organizaciones separadas?
- **Backend:** NestJS, como **monolito desacoplado** (módulos internos bien separados,
  no microservicios) — prioriza mantenibilidad y auditabilidad por un equipo de
  desarrollo de una sola persona.
- **Costo de infraestructura (OPEX), stack confirmado:** NestJS + Logto + DigitalOcean
  Droplet (2 vCPU/2 GB) ≈ **USD 27.60/mes** (Droplet $18.00 + backups $3.60 + Spaces $5.00
  + dominio $1.00 + Logto $0.00 en el plan Free/self-hosted) — derivado de
  `04-alternativas-tecnologicas-y-costos.md` §5-6. Esta cifra es la que debe repetirse como
  output de costo en cada fase/proceso siguiente (Requisitos, Arquitectura, etc.), no solo
  aquí.
- **Frontend:** se mantiene Svelte + MapLibre GL como base. `[Confirmar]` — el sponsor
  mencionó SvelteKit y Vue como posibles piezas adicionales pero la respuesta no fue
  concluyente ("svelte responsive... con vite... creo"); se asume por ahora que se
  continúa con el Svelte 5 + Vite ya existente en este repo, con foco en que sea
  responsive/mobile-first (coherente con la conectividad de campus variable), sin sumar
  SvelteKit ni Vue todavía. Si se confirma un panel de administración aparte, ese sería el
  candidato natural para un segundo framework (p. ej. Vue) — pendiente de decisión
  explícita.

### Datos personales — ampliado con `Propuesta.pdf`

- Los datos más sensibles/importantes a tratar: **código único de estudiante** y
  **nombre real** (requerido para el contrato de alquiler).
- **Nuevo (del PDF, no mencionado antes por el sponsor):** el flujo de KYC no es solo
  datos + comprobante — incluye **verificación biométrica facial**: comparar la foto de
  la cédula/carné estudiantil contra una selfie del solicitante, vía **CompreFace**
  (Exadel, open source, self-hosted). Esto añade una categoría de dato personal sensible
  (biométrico) que antes no estaba en el alcance registrado. `[Confirmar]` con el sponsor
  si este componente biométrico se adopta tal cual lo propone el PDF.
- **RESUELTO (contrato):** clickwrap + KYC (checkbox + botón de aceptación), sin firma
  manuscrita ni firma electrónica certificada — amparado en la Ley de Comercio
  Electrónico, Firmas Electrónicas y Mensajes de Datos de Ecuador. Se registra evidencia
  (IP, timestamp, hash del documento, resultado del KYC) como respaldo probatorio.
- `[Confirmar]` — marco regulatorio aplicable (Ecuador: LOPDP — Ley Orgánica de
  Protección de Datos Personales), tiempo de retención de datos — ahora con mayor peso al
  sumarse datos biométricos al alcance.

### Pago — RESUELTO

**Se implementan ambos métodos, no uno solo:**

1. **PayPhone** (pasarela con tarjeta) — reutilizando/portando `PayPhoneService`, ya
   implementado y probado en `aeis-app`, a NestJS.
2. **Transferencia + comprobante** (verificación asistida, candidato a OCR) — se mantiene
   porque, según el sponsor, hay resistencia real de una parte de los estudiantes a
   ingresar su tarjeta si perciben el sistema como inseguro. Ofrecer ambas vías es en sí
   mismo un requisito de adopción, no solo de conveniencia técnica.

Justifica además el enfoque **security-driven** (ver §9 Metodologías): si el pago con
tarjeta debe ganarse la confianza de usuarios escépticos, la superficie de seguridad
(OWASP Top 10, manejo de PCI-scope de PayPhone, protección del flujo de comprobantes)
importa tanto como la funcionalidad.

## 6. Criterios de éxito preliminares

1. **Negocio (casilleros) — corregido, ver §2.1:** $277 **no es dólares** — es el conteo
   de registros del proceso de alquiler; de esos, 91 terminaron en casillero pagado y
   asignado (= $591.50 según `Propuesta.pdf`, dato EPN). $702 = capacidad real de UN
   semestre (108 casilleros × $6.50); el techo anual real es $1,404 (2 semestres). El
   detalle de las 3 cifras que aún no reconcilian del todo está en
   `03-analisis-financiero-costos.md` §2.
2. **Pricing dinámico:** definir bandas de precio — ej. descuento cuando quedan pocos
   casilleros disponibles, o tarifa preferencial ($5) para los primeros 20 alquileres.
   `[Confirmar]` — reglas exactas de las bandas (umbrales, porcentajes, cuántas bandas).
3. **Datos reales:** obtener analítica real de uso (no simulada) para la directiva.
4. **Adopción mínima:** al menos 10 visitas mensuales a la app ya se considera un
   resultado aceptable para el brief del proyecto (meta modesta, MVP).
5. **Rendimiento:** tiempos de respuesta aceptables incluso con internet lento (contexto
   de campus con conectividad variable).
6. **DevSecOps:** pipeline CI/CD con pocos incidentes, con herramientas de auditoría
   apropiadas para un desarrollador único, y desarrollo con enfoque en seguridad.

## 7. Stakeholders y permisos — RESUELTO

- **Estudiantes** — usuarios finales / arrendatarios / aportantes.
- **Presidente de AEIS** — puede **ver datos de analítica** y **crear usuarios**.
- **Director de Innovación y Vinculación** — puede **ver datos de analítica**, **crear
  usuarios**, **auditar seguridad** (logs del servidor, picos de tráfico, incidentes del
  pipeline). Tiene permisos estrictamente mayores que Presidente: todo lo de Presidente +
  auditoría técnica/seguridad.
- **Administración** — `[Confirmar]` aún si es un rol operativo distinto (ej. verificación
  de pagos día a día) o si en la práctica lo cubren Presidente/Director.

(Detalle completo de la matriz en `02-necesidades-stakeholders.md`.)

## 8. Plazos y alcance temporal — RESUELTO

- **Fecha objetivo confirmada: 3 semanas** desde la fecha de este documento (no 3-4
  semanas, no 3-4 meses). El sponsor revisó explícitamente el "3-4 meses" del Project
  Charter de `Propuesta.pdf` y lo descartó como desactualizado para esta iteración.
- Este plazo, más ajustado que el ya ajustado "3-4 semanas" inicial, refuerza la necesidad
  de un MVP estrictamente priorizado (ver MoSCoW en `02-necesidades-stakeholders.md` §3) —
  el hallazgo de §2.1 (trazabilidad financiera) debería entrar como parte del "Must", no
  como algo diferible, dado que es el driver de negocio más fuerte identificado hasta
  ahora.
- **Alcance confirmado:** el sponsor confirmó que **todos** los dominios (casilleros,
  aportaciones, emprendimientos, eventos, recursos, seguridad) caben en el plazo, "porque
  solo es info" — es decir, buena parte del trabajo de Eventos/Recursos/Emprendimientos es
  CRUD + listado informativo (menor esfuerzo relativo), mientras que el esfuerzo real se
  concentra en casilleros (pago dual PayPhone+comprobante, pricing dinámico, concurrencia)
  y en la migración de auth/backend. Aun así, ver riesgo de alcance en §10.

## 9. Metodologías de desarrollo — RESUELTO

El sponsor pidió explícitamente **BDD + TDD + SDD**:

- **BDD (Behavior-Driven Development):** especificar comportamiento en escenarios
  Given/When/Then antes de implementar, especialmente para las reglas de negocio con más
  ambigüedad histórica (pricing bands, aportaciones, verificación de pago dual).
- **TDD (Test-Driven Development):** ya hay precedente directo — `aeis-app` tiene tests
  unitarios para `RentalCalculator`, `RentalValidator`, `LockerRentalService`, etc. — ese
  hábito se traslada a NestJS.
- **SDD — doble sentido, confirmado por el sponsor:**
  1. **Spec-Driven Development:** escribir la especificación (este documento y los que le
     siguen) antes de generar código, particularmente relevante si se usa asistencia de
     IA para parte de la implementación.
  2. **Security-Driven Development:** diseñar con seguridad como criterio de primer orden
     desde el inicio, con foco explícito en **evitar el OWASP Top 10** — coherente con
     que parte de la base de usuarios desconfía de ingresar su tarjeta (§5 Pago) y con
     que los datos tratados incluyen identificadores sensibles de estudiantes (§ Datos
     personales).

Esto define un requisito no funcional transversal: cada módulo nuevo debe tener escenarios
BDD documentados, cobertura de tests (TDD) y una revisión explícita contra OWASP Top 10
antes de considerarse terminado — insumo directo para el proceso de Aseguramiento de
Calidad (Quality Assurance) más adelante.

## 10. Riesgos identificados

| Riesgo | Impacto | Nota |
|---|---|---|
| Alcance amplio (auth, backend NestJS completo, pricing dinámico, aportaciones, emprendimientos, analítica, DevSecOps, BDD+TDD+SDD) vs. plazo de ~3-4 semanas con un solo desarrollador | Alto | Aunque el sponsor confirmó que "todo cabe" por ser mayormente CRUD informativo, la migración de auth (Logto) + pago dual (PayPhone+OCR) + concurrencia a 1000 estudiantes es trabajo no trivial; se recomienda igual un MVP explícito con MoSCoW (ver `02-necesidades-stakeholders.md` §3) |
| Divergencia deliberada de la decisión previa del equipo (`aeis-app` descartó Logto por latencia/costo operativo; este proyecto sí lo adopta) | Medio | No es un error — es una decisión consciente del sponsor — pero conviene medir la latencia del redirect OIDC en wifi de campus una vez implementado, ya que fue justo el motivo del rechazo anterior |
| Datos personales sensibles (nombre real + código único) sin marco de retención definido | Medio-Alto | Revisar antes de implementar persistencia; `aeis-app` ya identificó riesgo similar con la cédula como PK (ver `arquitectura-nuevos-modulos.md` §6) |
| Concurrencia a ~1000 estudiantes (doble-reserva de casillero, doble-cobro) | Alto | Requiere diseño explícito de transacciones/locking optimista en la Definición de Arquitectura — no es solo "usar NestJS", es una decisión de modelo de datos |
| Déficit histórico real: el periodo 2025-B cerró con balance **-$1864.30** (ver `03-analisis-financiero-costos.md`) | Medio | Contexto de negocio: la app no solo automatiza, tiene presión real de sostenibilidad financiera detrás — refuerza la importancia del pricing dinámico y de que el dashboard de analítica sea confiable |
