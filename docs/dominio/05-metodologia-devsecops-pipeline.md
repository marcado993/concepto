# 05 · Metodología de Ingeniería: TDD, BDD, SDD y Pipeline DevSecOps

**Proceso ISO/IEC/IEEE 12207 — grupo Gestión Técnica.** Este documento formaliza los
procesos de **Quality Assurance** y **Configuration Management** para AEIS-APP: cómo se
prueba el código (TDD/BDD), cómo se especifica antes de construir (SDD), y cómo el
pipeline hace cumplir todo eso automáticamente (DevSecOps + Policy as Code).

- **Input:** `01-analisis-negocio-mision.md` §9 (metodologías ya acordadas: BDD+TDD+SDD),
  `04-alternativas-tecnologicas-y-costos.md` §1 (catálogo de herramientas DevSecOps ya
  decidido)
- **Artefactos creados junto con este documento** (no solo prosa — el pipeline ya existe):
  - [`.github/workflows/devsecops.yml`](../../.github/workflows/devsecops.yml) — pipeline CI
  - [`.github/dependabot.yml`](../../.github/dependabot.yml) — actualización de dependencias
  - [`policy/semgrep-rules.yml`](../../policy/semgrep-rules.yml) — Policy as Code
  - [`vite.config.ts`](../../vite.config.ts) — configuración de Vitest (TDD)
  - [`src/lib/iso.test.ts`](../../src/lib/iso.test.ts) — primer test, sirve de plantilla
  - **`backend/`** — primer código real del backend NestJS (ver §7)

---

## 0. Estado: el backend ya existe, no es solo diseño

`backend/` contiene un NestJS funcional — monolito modular, desacoplado del frontend en el
despliegue (frontend → Vercel desde la raíz del repo; backend → VPS vía Docker desde
`backend/`, cada uno con su propio `package.json`). Cubre los dos flujos de dinero
pedidos primero — **alquiler de casillero** y **suscripción/aportación** — con Prisma
(PostgreSQL), Jest (TDD/BDD) y los principios de seguridad de este documento ya aplicados,
no solo descritos. Detalle completo en §7.

## 0.1 Convención obligatoria — tests en español, en el vocabulario del dominio

**Regla, no estilo:** todo `describe`/`it` se escribe en **español**, en formato **"Dado
[contexto del dominio], Cuando [acción], Entonces [resultado]"**, citando el hallazgo o la
regla de negocio de `01`-`04` que motiva ese caso — nunca en inglés genérico
("should create X"). Ejemplos ya en el repo:
`locker.service.spec.ts` ("Dado dos estudiantes alquilando el mismo casillero a la vez
(condición de carrera)..."), `resource-monitor.service.spec.ts` ("...a punto de morir..."),
`map-data.spec.ts` ("...nunca se presenta una cifra estimada como si fuera oficial").

**Por qué:** el sponsor lo pidió explícitamente para que la suite de tests funcione como
**documentación viva del dominio** — alguien nuevo en el proyecto (o el propio sponsor,
meses después) debe poder leer `npm test` y entender qué reglas de negocio existen y por
qué, sin tener que releer los 8 documentos de `docs/dominio/` primero. Un test en inglés
genérico no cumple esa función aunque pase igual de verde.

## 1. TDD (Test-Driven Development)

**Herramienta:** Vitest (ya integrado con Vite, cero configuración adicional de bundler).
Playwright se mantiene para e2e (`e2e/*.spec.ts`, ya existía en el repo).

**Convención:** ciclo rojo-verde-refactor real, no tests escritos después. El primer test
del repo (`src/lib/iso.test.ts`) sirvió literalmente como ejemplo: una aserción inicial
($h$+depth$) resultó **incorrecta contra el comportamiento real** de `cube()`, el test
falló, y se corrigió el test (no el código, que era intencional) — así se ve TDD
funcionando, no solo declarado.

**Dónde importa más (prioridad, no todo por igual):**

1. `RentalCalculator`-equivalente en NestJS (precio por método de pago, ver
   `03-analisis-financiero-costos.md` §4) — es dinero real, ya hay precedente de déficit de
   caja sin explicar.
2. Lógica de concurrencia de casilleros (evitar doble-reserva) — el riesgo más alto
   identificado en `01-analisis-negocio-mision.md` §10.
3. Cálculo de beneficios por tier de Aportaciones, una vez definidos los montos.

**Comando:** `npm run test` (una vez) / `npm run test:watch` (ciclo TDD interactivo).

## 2. BDD (Behavior-Driven Development)

**Convención adoptada:** escenarios Given/When/Then, hoy expresados como `describe`/`it`
con esa estructura en el nombre del test (ver `iso.test.ts`) — suficiente para el frontend
actual, sin herramienta de Gherkin dedicada. Cuando exista el backend NestJS, los
escenarios de **negocio** (no de UI) pasan a `.feature` reales vía `@cucumber/cucumber` o
`jest-cucumber`, porque ahí es donde vive la ambigüedad que BDD existe para resolver.

**Escenarios BDD ya redactables hoy** (aunque el backend no exista todavía — esto es
Spec-Driven: la especificación antecede al código):

```gherkin
Característica: Alquiler de casillero con pago dual

  Escenario: Pago por transferencia y comprobante
    Dado que el estudiante "E123" tiene código único verificado
    Y el casillero "A07" está disponible
    Cuando el estudiante selecciona "A07" y paga por transferencia con comprobante
    Entonces el precio cobrado es $6.50
    Y el casillero "A07" pasa a estado "reservado" hasta que el OCR valide el comprobante
    Y se genera un registro de auditoría con IP, timestamp y resultado del KYC

  Escenario: Pago por PayPhone (tarjeta)
    Dado que el estudiante "E124" tiene código único verificado
    Y el casillero "A08" está disponible
    Cuando el estudiante selecciona "A08" y paga con PayPhone
    Entonces el precio cobrado es $6.90
    Y el casillero "A08" pasa a estado "alquilado" inmediatamente tras la confirmación de PayPhone
    Y se genera un registro de auditoría

  Escenario: Condición de carrera — dos estudiantes, un casillero
    Dado que el casillero "A09" está disponible
    Y los estudiantes "E200" y "E201" lo seleccionan en la misma fracción de segundo
    Cuando ambos intentan confirmar el pago
    Entonces solo una de las dos transacciones se completa
    Y la otra recibe un error explícito de "casillero ya no disponible", no un cobro fantasma
```

```gherkin
Característica: Aportaciones con niveles

  Escenario: Selección de tier
    Dado que existen los niveles "Bronce", "Platino" y "Pantera" con sus montos vigentes
    Cuando un estudiante-aportante elige el nivel "Platino"
    Entonces recibe exactamente los beneficios definidos para "Platino" en el periodo actual
    Y el nivel y monto pagado quedan asociados al periodo académico vigente, no a un valor global mutable
```

Estos escenarios son intencionalmente los que **ya generaron ambigüedad real** en la
elicitación de dominio (pago dual, concurrencia, tiers que cambian entre periodos) — BDD
aquí no es ceremonia, es la respuesta directa a preguntas que ya se hicieron mal una vez
(el histórico de aportaciones cambió de esquema sin dejar rastro claro, ver
`03-analisis-financiero-costos.md` §3).

## 3. SDD (Spec-Driven + Security-Driven Development)

**Spec-Driven:** este documento, y los `01`-`04` que lo preceden, son la especificación —
se escriben antes del código NestJS, no después. La regla operativa: **ningún módulo nuevo
se empieza sin que exista al menos un escenario BDD y una fila en la matriz OWASP de abajo
marcada como revisada.**

**Security-Driven — mapeo a OWASP Top 10** (qué le aplica a AEIS-APP específicamente, no
una checklist genérica):

| OWASP Top 10 | Riesgo concreto en AEIS-APP | Mitigación ya decidida |
|---|---|---|
| A01 Broken Access Control | Director/Presidente/Estudiante mal separados — un estudiante viendo analítica ajena | Jerarquía de roles en Logto (`02-necesidades-stakeholders.md` §1); regla `payment-endpoint-requires-guard` en Policy as Code |
| A02 Cryptographic Failures | Código único + nombre real + dato **biométrico** (CompreFace) en texto plano | Cifrado en reposo pendiente de decidir en Arquitectura; regla `no-disabled-tls-verification` |
| A03 Injection | `{@html}` sin sanitizar en Svelte; `eval`/`Function` dinámico | Reglas `no-unsafe-svelte-html`, `no-eval-or-dynamic-function` |
| A04 Insecure Design | Doble-reserva de casillero por diseño de datos sin locking | Escenario BDD "condición de carrera" arriba — debe fallar hasta que se implemente el locking |
| A05 Security Misconfiguration | Pipeline sin gates obligatorios, secretos en variables de entorno mal manejadas | `devsecops.yml` + branch protection (ver §6) |
| A07 Identification and Authentication Failures | Login social (Google/GitHub vía Logto) mal configurado, sesión no expira | Cubierto por Logto — validar configuración en fase de Arquitectura |
| A08 Software and Data Integrity Failures | Dependencia comprometida en la cadena de CI/CD | Dependabot + OSV-Scanner + SBOM (CycloneDX) en `devsecops.yml` |
| A09 Security Logging and Monitoring Failures | **Es literalmente el hallazgo de negocio** — 277 registros, 91 concretados, déficit de caja sin rastro | Regla `mutating-endpoint-must-audit-log`; ver `01-analisis-negocio-mision.md` §2.1 |
| A10 SSRF | Llamadas salientes a PayPhone/Google Vision/CompreFace sin validar destino | A revisar en Arquitectura cuando se implementen esos clientes HTTP |

### 3.0.1 Verificación en el pipeline — las 10 categorías, no solo las que ya tenían mitigación de código

La tabla de arriba es la matriz de riesgo/diseño. Esta es la matriz de **verificación
automática**: qué motor del pipeline (`.github/workflows/devsecops.yml`, job
`policy-and-sast` salvo que se indique otro) cubre cada categoría, confirmada corriendo
Semgrep localmente contra el repo real antes de comprometer los paquetes en CI — no se
asumió que un nombre de paquete del registro público hacía lo que su nombre sugiere.

| Categoría OWASP 2021 | Motor(es) en el pipeline |
|---|---|
| A01 Broken Access Control | `policy/semgrep-rules.yml` (`money-endpoint-requires-roles-decorator`) + `p/owasp-top-ten` + CodeQL |
| A02 Cryptographic Failures | `p/owasp-top-ten` + `p/security-audit` + CodeQL |
| A03 Injection | `p/owasp-top-ten` + `no-eval-or-dynamic-function` / `no-unsafe-svelte-html` (propias) + CodeQL |
| A04 Insecure Design | `money-mutation-must-call-audit-service` (propia) + escenarios BDD de concurrencia (§2) — en gran parte proceso, no solo escaneo |
| A05 Security Misconfiguration | `p/security-audit` + job `trivy-fs-scan`/`trivy-image-scan` |
| A06 Vulnerable and Outdated Components | job `dependency-scan` (OSV-Scanner) + Dependabot + Trivy + SBOM |
| A07 Identification and Authentication Failures | `p/owasp-top-ten` + CodeQL (JWT/sesión) |
| A08 Software and Data Integrity Failures | job `sbom` (CycloneDX) + job `secret-scan` (Gitleaks) + Dependabot (supply chain del propio pipeline) |
| A09 Security Logging and Monitoring Failures | `no-console-of-sensitive-fields` + `money-mutation-must-call-audit-service` (ambas propias — es la categoría con más cobertura a medida, por ser el driver de negocio del proyecto) |
| A10 SSRF | `p/owasp-top-ten` + `p/security-audit` — cobertura parcial, revisar manualmente cuando existan los clientes HTTP salientes reales (PayPhone/Google Vision/CompreFace) |

**Segundo motor SAST independiente (job `codeql-analysis`):** CodeQL corre en paralelo a
Semgrep, no en su reemplazo — dos motores con heurísticas de análisis distintas encuentran
categorías de bug distintas (uno puede modelar flujo de datos de una forma que el otro no).

**Paquete descartado a propósito — `p/nodejsscan`:** se probó localmente y sus reglas
`ajinabraham.njsscan.good.*` resultaron ser confirmaciones de buenas prácticas (ej. "helmet
está bien configurado"), no vulnerabilidades — Semgrep las reporta igual como "finding", lo
que habría bloqueado el gate por código correcto. Confirmado con dos corridas reales: 247
reglas con `p/nodejsscan` → 6 findings, los 6 "good_*"; 134 reglas sin él → 0 findings,
limpio de verdad. Se documenta la decisión en vez de dejar un paquete en el pipeline que
nadie recuerde por qué está.

### 3.1 Principio fundamental: ningún dato desacoplado

Se agrega un principio de diseño explícito al enfoque security-driven, más estricto que
"cada endpoint tiene su guard": **ningún dato del sistema puede existir sin un vínculo
verificable a quién lo generó y en qué contexto de negocio** — ni un pago sin dueño, ni un
registro de alquiler sin el pago que lo respalda, ni un dato biométrico sin el KYC que lo
originó.

**Por qué esto es seguridad, no solo modelado de datos.** Un dato "desacoplado" — un pago
sin `userId` obligatorio, un registro que se puede insertar sin apuntar a una transacción
verificada, un log que no referencia el request que lo generó — es exactamente el tipo de
vector que:

1. **Rompe la no-repudiación.** Si un movimiento de dinero puede existir sin una llave
   foránea obligatoria a un usuario KYC-verificado y a un evento de negocio concreto,
   nadie puede probar después quién lo originó ni por qué. Esto **no es hipotético** —
   es la causa raíz plausible del hallazgo de `01-analisis-negocio-mision.md` §2.1: 277
   registros de alquiler y solo 91 casilleros efectivamente asignados, sin que la
   directiva pueda reconstruir qué pasó con los otros 186. Un modelo de datos con
   acoplamiento estricto (registro ⇄ pago ⇄ asignación, todos con llaves foráneas
   `NOT NULL`, nunca un string libre haciendo de referencia) hace que esa pregunta se
   pueda responder con una consulta, no con una sospecha.
2. **Amplía la superficie de exfiltración.** Un dato biométrico o un código único
   almacenado sin acoplamiento estricto a un solo registro de estudiante (p. ej. copiado
   como texto suelto en varias tablas "por conveniencia") multiplica los lugares donde
   una fuga puede ocurrir y dificulta aplicar borrado/retención (LOPDP) de forma completa.
3. **Invalida la auditoría (OWASP A09).** Un log o un dashboard de analítica construido
   sobre datos desacoplados es analítica sobre datos que no se pueden verificar — el
   dashboard de Presidente/Director dejaría de ser confiable exactamente en el escenario
   que más importa (dinero faltante), que es el peor momento para que falle.

**Regla operativa para la Arquitectura (próximo proceso ISO 12207):** toda tabla que
representa dinero, identidad o biometría usa llaves foráneas `NOT NULL` reales a nivel de
base de datos — no solo validación en la capa de aplicación. La capa de aplicación puede
tener bugs; una restricción `FOREIGN KEY ... NOT NULL` en PostgreSQL no. Esto es defensa en
profundidad: incluso si `payment-endpoint-requires-guard` o
`mutating-endpoint-must-audit-log` (§5) fallan por un error de código, la base de datos
misma rechaza el registro huérfano.

## 4. Pipeline DevSecOps

Implementado en [`.github/workflows/devsecops.yml`](../../.github/workflows/devsecops.yml),
corre en cada push/PR a `main`. Orden deliberado — barato y rápido primero:

1. **Lint · Tipos · Tests** (`npm run check` + `npm run test` + `npm run build`) — el gate
   TDD/BDD.
2. **Gitleaks** — escaneo de secretos con historial completo.
3. **Semgrep** — Policy as Code (`policy/semgrep-rules.yml`) + ruleset público
   `p/owasp-top-ten`, resultados subidos a la pestaña Security de GitHub (SARIF).
4. **OSV-Scanner** — CVEs conocidas en dependencias.
5. **Trivy** — escaneo de filesystem hoy; listo para escanear imagen de contenedor cuando
   exista el Dockerfile del backend NestJS.
6. **SBOM (CycloneDX)** — inventario de dependencias, archivado como artefacto de cada
   corrida (retención 90 días) para trazabilidad de supply chain.
7. **Policy Gate** — job final que depende de todos los anteriores; es el que se marca
   como *required status check* en la protección de rama.

Todas las herramientas son **open source** (coherente con `04-alternativas-tecnologicas-y-costos.md`
§1 y con el objetivo de publicar AEIS-APP como proyecto open source) — costo de licencia
$0, el único costo es el tiempo de ejecución de GitHub Actions (gratuito para repos
públicos).

## 5. Policy as Code

Implementado en [`policy/semgrep-rules.yml`](../../policy/semgrep-rules.yml) — la política
de seguridad del proyecto **es código versionado**, no un documento que alguien debe
recordar leer y aplicar manualmente. Dos grupos de reglas:

- **Activas hoy** (aplican al frontend Svelte/TS actual): prohibir `eval`/`Function`
  dinámico, prohibir `{@html}` sin sanitizar, prohibir deshabilitar verificación TLS,
  advertir sobre `console.*` de campos sensibles (contraseña, token, código único,
  biométrico).
- **Reservadas** (sintaxis válida ya, pero sin código NestJS que igualar todavía):
  endpoints de pago/casillero sin `@UseGuards`, endpoints que mutan estado sin llamar a un
  servicio de auditoría — se activan solas en cuanto exista ese código, sin tocar el
  pipeline.

**Por qué Semgrep y no OPA/Rego:** el proyecto no tiene infraestructura como código
(Kubernetes, Terraform) donde OPA/Conftest brilla — es una app Node.js sobre un único
Droplet. Semgrep permite expresar política **sobre el código fuente mismo** (TypeScript,
Svelte), que es exactamente donde viven los riesgos identificados en la matriz OWASP de
arriba.

## 6. Pendiente — requiere acción del sponsor, no solo código

- **Protección de rama (`main`)**: configurar en GitHub que el job `Policy Gate` sea un
  *required status check* antes de poder fusionar — esto es un cambio de configuración del
  repositorio, no algo que se deba automatizar sin tu confirmación explícita. Recomendado:
  Settings → Branches → Branch protection rules → exigir `Policy Gate` + al menos 1
  aprobación de revisión.
- **Secretos del pipeline**: `GITHUB_TOKEN` ya lo provee GitHub automáticamente; cuando se
  agreguen credenciales reales (Logto, PayPhone, Google Vision, CompreFace), van como
  *repository secrets* de GitHub Actions, nunca en el código — la regla
  `no-console-of-sensitive-fields` y Gitleaks son la red de seguridad, no el mecanismo
  principal.
- **Primer Dockerfile**: cuando exista el backend NestJS, el job Trivy pasa de escanear
  filesystem a escanear la imagen construida — no requiere cambios de política, solo
  agregar el paso de build de imagen antes del escaneo. **Hecho** — ver §7, job
  `trivy-image-scan`.

## 7. Backend NestJS — qué se construyó y qué falta

**Módulos implementados** (con tests, no solo el archivo del módulo):

| Módulo | Responsabilidad | Tests |
|---|---|---|
| `shared/prisma` | Cliente de base de datos, ciclo de vida de conexión | — |
| `shared/audit` | `AuditService.record()` — un solo punto de escritura de auditoría, acepta cliente de transacción explícito para que el registro viva o muera con la operación que audita | 2 |
| `shared/auth` | `RolesGuard` con jerarquía Director ⊇ Presidente ⊇ (nada de Estudiante) real, no comentada; `JwtStrategy` valida JWT de Logto contra su JWKS | 5 |
| `locker` | `calculateLockerPrice` (precio por método de pago) + `LockerService.rent` (transacción atómica: pago → alquiler → actualización de estado → auditoría, con la restricción `@@unique([lockerId, periodId])` de Prisma como defensa real contra doble-reserva) | 11 |
| `subscription` | `SubscriptionService.subscribe` — monto leído de `SubscriptionTier` (base de datos), nunca hardcodeado, porque el histórico real ya demostró que los tiers cambian | 4 |

**22 tests, 5 suites, todos verdes** — corridos localmente antes de darlos por hechos, no
solo escritos.

**Esquema de datos** (`backend/prisma/schema.prisma`) aplica el principio de §3.1 al pie de
la letra: `Payment`, `LockerRental` y `Subscription` tienen llaves foráneas `NOT NULL` a su
`User`, y `LockerRental`/`Subscription` a su `Payment` — un pago nunca puede quedar sin
dueño, un alquiler nunca puede existir sin el pago que lo respalda.

**Decisiones tomadas al escribir código, no antes:**

- **Base de datos:** PostgreSQL + Prisma (no TypeORM) — schema declarativo, migraciones
  explícitas, y el tipo de restricciones `NOT NULL`/`@@unique` que exige §3.1 se escriben
  una vez en `schema.prisma`, no se reconstruyen a mano en cada entidad.
- **PayPhone es un stub explícito** (`shared/payment/payphone.client.ts`) que lanza error
  si se invoca — no una integración falsa que "compila pero no cobra". Se reemplaza cuando
  se porte el `PayPhoneService` real de `aeis-app` (Spring Boot).
- **El periodo académico activo (`periodId`) queda como `TODO` explícito** en los dos
  controllers, en vez de un valor hardcodeado que parecería real — no existe todavía un
  `PeriodModule` que resuelva el periodo vigente por calendario.
- **Los montos de tier (Bronce/Platino/Pantera) son placeholders marcados como tales** en
  `backend/prisma/seed.ts` ($7.99 / $19.99 / $35.00, derivados del único dato histórico
  real) — sirven para probar el flujo, no son precio final. Sigue bloqueado por
  `02-necesidades-stakeholders.md` §4 #1.

**Autocrítica de Policy as Code — un hallazgo real, no cosmético:** las dos reglas
"reservadas" de la primera versión de `policy/semgrep-rules.yml` (§5) buscaban
`@UseGuards(...)` y coincidencias de texto en la ruta HTTP (`"locker"`, `"pago"`, etc.).
Al correrlas contra el código real del backend, **dieron 0 hallazgos — un falso negativo
silencioso**, porque este proyecto protege rutas con guards globales (`APP_GUARD`) +
`@Roles(...)`, no con `@UseGuards` por método, y la ruta real es `@Post("rent")`, sin la
palabra "locker" en ningún lado. Se reescribieron como `money-endpoint-requires-roles-decorator`
y `money-mutation-must-call-audit-service`, con matching por carpeta del dominio
(`locker/`, `subscription/`) en vez de por texto de la ruta. Verificado con un
autotest deliberado (controller/servicio "malos" en un directorio descartable): **ahora sí
disparan** sobre la violación y siguen en silencio sobre el código real y conforme. Una
regla de policy as code que nunca se prueba contra una violación real es tan útil como no
tenerla — se deja este hallazgo documentado a propósito, en vez de pulido como si siempre
hubiera funcionado.

**Pendiente inmediato** (para que "comprar casillero" y "suscribirse" funcionen de extremo
a extremo, no solo pasen tests unitarios):

1. `PeriodModule` — resolver el periodo académico activo.
2. Migraciones reales de Prisma contra una base de Postgres (`prisma migrate dev`) — el
   schema está escrito y validado por `prisma generate`, falta correrlo contra una base.
3. Confirmar/reemplazar `payphone.client.ts` con la integración real portada de `aeis-app`.
4. Endpoint de confirmación de transferencia (OCR) — hoy un pago por transferencia queda
   `PENDING` sin nada que lo mueva a `CONFIRMED`.
5. Endpoints de lectura (`GET /lockers`, `GET /subscriptions/tiers`) — todo lo construido
   hasta ahora es de escritura (comprar/suscribirse); un estudiante no puede ver
   disponibilidad todavía.
