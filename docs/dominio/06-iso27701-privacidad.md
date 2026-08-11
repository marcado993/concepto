# 06 · Gestión de Privacidad — ISO/IEC 27701 (extensión de ISO/IEC 27001)

**Marco de referencia adoptado por pedido explícito del sponsor.** ISO/IEC 27701 no es un
estándar independiente — es una **extensión de ISO/IEC 27001** (Sistema de Gestión de
Seguridad de la Información) que añade los requisitos de un **PIMS** (Privacy Information
Management System): quién controla qué dato personal, con qué base legal, por cuánto
tiempo, y qué pasa si algo sale mal. Los controles de seguridad de
`05-metodologia-devsecops-pipeline.md` (OWASP, DevSecOps, Policy as Code) son la base
27001; este documento es la capa 27701 que se apoya en ella — no la reemplaza.

Aplica directamente sobre lo ya construido en `backend/`: el flujo de login con Logto+GitHub
recién implementado, y los datos que `LockerService`/`SubscriptionService` ya persisten.

---

## 1. Roles PIMS (cláusula 5.2 de ISO/IEC 27701)

| Rol PIMS | Quién es | Para qué dato |
|---|---|---|
| **Controlador de PII** | AEIS (la asociación, vía este backend) | Decide el propósito: gestionar alquiler de casilleros y aportaciones de sus miembros |
| **Encargado de PII (processor)** | Logto | Autenticación — solo recibe `sub`/email/nombre del login social, nunca la cédula ni datos biométricos |
| **Encargado de PII (processor)** | PayPhone | Pago con tarjeta — el número de tarjeta nunca toca este backend (PCI scope fuera del alcance de AEIS-APP) |
| **Controlador Y encargado a la vez** | AEIS, si se adopta CompreFace self-hosted | El dato biométrico (selfie vs. carné) **no sale de la infraestructura de la EPN** — decisión ya tomada en `04-alternativas-tecnologicas-y-costos.md` §1 precisamente para minimizar cuántos terceros tocan el dato más sensible |

Esta tabla es lo primero que ISO/IEC 27701 pide formalizar (cláusula 7.2.1/8.2.1): sin
saber quién es controlador y quién encargado, no se puede aplicar el resto del estándar.

## 2. Inventario de PII (cláusula 7.2 / 8.2 — "identificar y documentar el propósito")

| Dato | Categoría | Dónde vive hoy | Propósito | Base legal/consentimiento |
|---|---|---|---|---|
| `logtoSub` | Identificador de sesión | `User.logtoSub` | Vincular la cuenta con el login social | Consentimiento al autenticarse (OAuth) |
| Código único de estudiante | Identificador institucional | `User.uniqueCode` | Verificar que quien alquila es estudiante EPN | Necesario para el contrato (no requiere consentimiento aparte — es la prestación del servicio) |
| Nombre real | Dato personal | `User.fullName` | Requerido en el contrato de alquiler | Necesario para el contrato |
| Email / nombre del proveedor social | Dato personal | Recibido en `/auth/callback`, **no persistido aparte** del uso para provisionar `fullName` | Provisionar la cuenta en el primer login | Consentimiento OAuth (scope `email profile`) |
| IP de origen | Dato técnico | `AuditLog.ipAddress` | Trazabilidad de auditoría (§2.1 de `01-analisis-negocio-mision.md`) | Interés legítimo — es la mitigación directa al hallazgo del déficit de caja |
| Monto y método de pago | Dato financiero | `Payment` | Registro contable, base del dashboard de analítica | Necesario para el contrato |
| **Dato biométrico** (selfie vs. carné, propuesto) | Categoría especial | **No implementado todavía** | Verificación de identidad (KYC) | Requiere consentimiento explícito y separado — más estricto que el resto de la tabla |

**Lo que este backend NO guarda, por diseño** (minimización, cláusula 7.4.5/8.4.5): el
`access_token`/`refresh_token` de Logto no se persiste — el `AuthController` construido en
esta iteración solo lee `sub`/`email`/`name` del `claims()` del token y descarta el resto.
Mismo principio que `aeis-app` ya documentó para su propio login social.

## 3. Consentimiento y aceptación (cláusula 7.3 / 8.3)

Ya resuelto en `01-analisis-negocio-mision.md` § Datos personales: **clickwrap + KYC**, sin
firma electrónica certificada, amparado en la Ley de Comercio Electrónico de Ecuador. ISO
27701 pide que el consentimiento sea **específico y separable** — el login social (que
solo identifica "quién eres en internet") NO debe presentarse como si fuera también la
aceptación del contrato de alquiler; son dos consentimientos distintos, en dos momentos
distintos:

1. **Login (Logto/GitHub)** → consentimiento OAuth de acceso a email/perfil.
2. **Alquiler/aportación** → clickwrap del contrato, separado, con su propio registro de
   auditoría (`AuditLog`).

`AuthController.provisionUser()` ya refleja esto: el primer login crea un `User` con
`uniqueCode` **placeholder** (`PENDIENTE-...`), no un usuario "activado" — completar el
código único institucional es un paso posterior y consciente, no implícito en el login
social. Esto es exactamente el patrón que `aeis-app` documentó ("el login social identifica
quién eres en internet, no que eres estudiante de la EPN").

## 4. Retención (cláusula 7.4.7 / 8.4.7) — RESUELTO en esta iteración

Era pregunta abierta en `02-necesidades-stakeholders.md` §4 #6. Se propone (a confirmar con
Dirección Jurídica de la EPN antes de producción, igual que recomendó `aeis-app` para su
propio caso):

| Dato | Retención propuesta | Justificación |
|---|---|---|
| `Payment`, `LockerRental`, `Subscription`, `AuditLog` | **7 años** desde su creación | Alineado a plazos típicos de retención de registros contables/tributarios en Ecuador — es además la evidencia que resuelve disputas como el déficit de caja de §2.1 |
| Dato biométrico (si se adopta CompreFace) | **No se almacena la imagen** — solo el resultado booleano de la verificación (`match: true/false`) y un hash, nunca la selfie ni la foto del carné más allá del tiempo de procesamiento de la solicitud | Minimización estricta — es la categoría de mayor riesgo, se retiene lo mínimo indispensable |
| `User.uniqueCode`, `User.fullName` | Mientras la cuenta esté activa + 2 años tras la última actividad, luego anonimización (no borrado duro, para no romper la integridad referencial de `Payment`/`AuditLog` que sí se retienen 7 años) | Balance entre el derecho de eliminación (LOPDP) y el principio de "ningún dato desacoplado" (§3.1 de 05) — un pago no puede quedar huérfano solo porque el usuario pidió borrar su perfil |
| `logtoSub`, cookie de sesión (`aeis_oidc_pending`) | 5 minutos (ya implementado — `maxAge` en `AuthController.login()`) | Solo existe para completar el handshake PKCE |

**Nota de diseño importante:** "anonimización, no borrado duro" para `User` es la solución
técnica al mismo problema que motivó el principio de §3.1 de `05-metodologia-devsecops-
pipeline.md` — si se borrara el `User` referenciado por un `Payment` de hace 3 años, se
volvería a crear exactamente el tipo de dato huérfano que causó el hallazgo del déficit de
caja. Anonimizar (reemplazar `fullName`/`uniqueCode` por un marcador, mantener el `id`)
preserva la integridad contable sin retener PII innecesaria.

## 5. Derechos del titular (cláusula 7.3.9/7.3.10 / 8.3 — pendiente de implementar)

LOPDP Ecuador y ISO 27701 exigen mecanismos de acceso y eliminación. **No implementado
todavía** — queda como el siguiente hueco concreto a cerrar en el backend:

- `GET /me` — un estudiante puede ver exactamente qué datos tiene AEIS-APP sobre él.
- `DELETE /me` — dispara la anonimización de §4 (no un borrado duro, por la razón de
  integridad referencial explicada arriba).

## 6. Evaluación de impacto (PIA/DPIA) — resumen, no el documento completo

ISO 27701 (vía ISO 29134) pide una evaluación de impacto cuando se procesan categorías
especiales de datos — el caso aquí es el **dato biométrico propuesto**. Resumen de riesgo:

- **Probabilidad de fuga:** baja si se mantiene self-hosted (CompreFace) — sube
  significativamente si se delega a un proveedor comercial de KYC (opción descartada en
  `04-alternativas-tecnologicas-y-costos.md` §1 precisamente por esto).
- **Impacto si ocurre:** alto — un dato biométrico no se puede "rotar" como una contraseña.
- **Mitigación ya de diseño:** no persistir la imagen (§4), self-hosting, y que este mismo
  backend sea controlador y encargado a la vez (menos partes que puedan fugar el dato).
- **Decisión pendiente del sponsor:** si se adopta la verificación biométrica en absoluto —
  sigue como pregunta abierta (`02-necesidades-stakeholders.md` §4 #9). Este documento deja
  la mitigación lista para cuando se decida, no obliga a implementarla ya.

## 7. Qué cambia en el pipeline DevSecOps por esto

`policy/semgrep-rules.yml` ya tenía `no-console-of-sensitive-fields`, que cubre parte de
esto (nunca loguear código único/token/biométrico). Se agrega como pendiente de la próxima
iteración: una regla que marque cualquier campo de modelo Prisma agregado a `User` sin que
se actualice la tabla de §2 de este documento — mantener el inventario de PII sincronizado
con el esquema real es, en sí mismo, un control de ISO/IEC 27701 (cláusula 7.2.2:
"mantener un inventario actualizado").
