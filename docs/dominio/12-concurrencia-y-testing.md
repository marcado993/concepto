# 12 · Concurrencia y Estrategia de Testing (módulo de alquiler)

Responde a *"documenta los casos donde sí aplica concurrencia, y pruebas e2e y unitarias
caja negra/caja blanca a los nuevos módulos"*. Cubre el módulo de alquiler de casilleros
(`backend/src/locker/`) — el único de los módulos nuevos con verdadero riesgo de
concurrencia, porque es el único con una operación de "solo puede pasar una vez" (un
casillero, un alquiler) bajo tráfico de hasta 1.439 estudiantes potenciales.

## 1. Dónde SÍ aplica concurrencia — dos casos, no uno

### Caso 1 — dos estudiantes alquilando el mismo casillero a la vez

Es el caso obvio: 108 casilleros, potencialmente cientos de estudiantes mirando el mismo
mapa al abrir el periodo. Dos clicks casi simultáneos en el mismo casillero código A07 no
son un escenario raro, son el día de apertura del semestre.

```mermaid
sequenceDiagram
    participant EA as Estudiante A
    participant EB as Estudiante B
    participant API as LockerService.rent()
    participant DB as Postgres (@@unique[lockerId, periodId])

    EA->>API: POST /lockers/rent {A07, TRANSFER}
    EB->>API: POST /lockers/rent {A07, TRANSFER}
    Note over EA,EB: Llegan casi a la vez — ambos ven<br/>locker.status="AVAILABLE" al leer
    API->>DB: INSERT LockerRental (A, A07)
    API->>DB: INSERT LockerRental (B, A07)
    DB-->>API: OK — primera fila insertada
    DB-->>API: ERROR P2002 — unique constraint failed
    API-->>EA: 201 Created
    API-->>EB: 409 LockerUnavailableError
```

**Por qué el chequeo de `locker.status` NO es la protección real:** `LockerService.rent()`
sí lee `locker.status` antes de insertar, pero esa lectura y el `INSERT` no son atómicos —
ambas peticiones pueden leer `"AVAILABLE"` en el mismo instante. La garantía real es la
restricción `@@unique([lockerId, periodId])` de `schema.prisma`: la base de datos rechaza
la segunda fila sin importar qué vio la aplicación. `onConflict` en
`money-mutation.helper.ts` traduce ese error de Postgres (`P2002`) a
`LockerUnavailableError` (409), no a un 500 genérico.

### Caso 2 — el mismo comprobante confirmado dos veces (bug real, ya corregido)

Este NO era obvio y se encontró auditando el código, no por un reporte de bug: un doble
click en "Subir y confirmar", o el navegador reintentando una petición que en realidad ya
llegó, dispara dos peticiones para el **mismo** `rentalId` casi a la vez.

```mermaid
sequenceDiagram
    participant Nav as Navegador (doble click)
    participant API as LockerService.confirmReceipt()
    participant DB as Postgres

    Nav->>API: POST confirm-receipt (petición 1)
    Nav->>API: POST confirm-receipt (petición 2)
    Note over API: ANTES DEL FIX — ambas leen<br/>payment.status="PENDING" antes de escribir
    API->>DB: UPDATE payment SET status=CONFIRMED (petición 1)
    API->>DB: UPDATE payment SET status=CONFIRMED (petición 2)
    Note over DB: Sin WHERE status="PENDING" — Postgres<br/>ejecuta las DOS escrituras sin quejarse
    DB-->>API: OK (petición 1)
    DB-->>API: OK (petición 2)
    Note over API: Ambas devuelven 201 — OCR corrido dos<br/>veces, auditoría duplicada
```

**El fix** (`locker.service.ts`, `confirmReceipt()`) cambia el `UPDATE` simple por un
`updateMany` con `WHERE id=paymentId AND status="PENDING"`, y revisa `count`:

```mermaid
sequenceDiagram
    participant Nav as Navegador (doble click)
    participant API as LockerService.confirmReceipt()
    participant DB as Postgres

    Nav->>API: POST confirm-receipt (petición 1)
    Nav->>API: POST confirm-receipt (petición 2)
    API->>DB: UPDATE...WHERE status="PENDING" (petición 1)
    API->>DB: UPDATE...WHERE status="PENDING" (petición 2)
    Note over DB: Solo la primera fila SIGUE en PENDING<br/>cuando cada UPDATE se ejecuta
    DB-->>API: count=1 (petición 1)
    DB-->>API: count=0 (petición 2 — ya no había nada que tocar)
    API-->>Nav: 201 Confirmado (petición 1)
    API-->>Nav: 409 ConflictException (petición 2)
```

Este patrón — `updateMany` + `WHERE` sobre el estado esperado + revisar `count`, en vez de
`findUnique` → chequear en memoria → `update` — es la forma correcta de hacer un
"check-then-act" atómico contra Postgres sin necesitar un lock explícito
(`SELECT ... FOR UPDATE`), que habría sido más lento y más código para el mismo resultado.

### Lo que NO es un caso de concurrencia aquí (para no confundir)

100 estudiantes *distintos* alquilando 100 casilleros *distintos* a la vez es carga
legítima, no una condición de carrera — cada petición toca una fila distinta, no hay nada
que coordinar. El rate limiting de `locker.controller.ts` (`@Throttle` 3 intentos/10s)
tampoco es la defensa aquí: existe para frenar a **un** actor abusando (bug de cliente o
script), no para resolver dos actores compitiendo por el mismo recurso — son dos problemas
distintos, con dos mecanismos distintos (ver `08-observabilidad-resiliencia.md` §1, mismo
razonamiento ya aplicado ahí).

## 2. Pirámide de testing aplicada a estos dos casos

```mermaid
graph TB
    E2E["E2E — caja negra<br/>test/lockers.e2e-spec.ts<br/>Postgres real, HTTP real, guards reales"]
    UNIT["Unitarios — caja blanca<br/>locker.service.spec.ts, ocr.service.spec.ts,<br/>receipt-validator.spec.ts<br/>Prisma mockeado"]
    UNIT --> E2E
```

**Por qué hacen falta los dos niveles, no solo uno:**

- Los **unitarios** (`locker.service.spec.ts`) prueban la *lógica* con Prisma mockeado —
  rápidos (segundos), aíslan el caso exacto (ej. "si `updateMany` devuelve `count=0`,
  lanza `ConflictException`"). Pero un mock de Prisma no tiene estado real: **no puede
  probar que la restricción `@@unique` de Postgres de verdad existe y de verdad
  funciona bajo carga concurrente real** — solo puede simular la respuesta que el
  desarrollador *cree* que Postgres daría.
- El **E2E** (`test/lockers.e2e-spec.ts`) dispara peticiones HTTP concurrentes reales
  (`Promise.all`, no en secuencia) contra la app NestJS completa corriendo sobre el
  Postgres real de `docker-compose.yml` — sin mockear Prisma en ningún punto. Es la única
  prueba que de verdad demuestra que el Caso 1 y el Caso 2 de arriba se resuelven
  correctamente contra la base de datos real, no solo contra la idea que el código tiene
  de cómo se comporta la base de datos.

### Qué se sustituye en el E2E, y por qué eso no lo vuelve "caja gris"

Dos cosas se reemplazan a propósito, ninguna toca lo que realmente se está probando:

| Se sustituye | Por qué | Lo que SÍ sigue siendo real |
|---|---|---|
| `JwtAuthGuard` | No hay forma de firmar un JWT real de Logto sin credenciales de un tenant (`10-despliegue-vps-vercel.md`) | `RolesGuard`, `@Public()`, y el propio guard de prueba respeta la misma jerarquía de roles que el real |
| `OcrService` | `tesseract.js` contra una imagen sintética tarda 1-2s y no es determinístico — ralentizaría el test de concurrencia sin aportar nada a lo que se prueba ahí | La transacción de Prisma, el `updateMany` con `WHERE`, la restricción `@@unique` — todo eso es 100% real |

La calidad del reconocimiento de OCR en sí ya está cubierta aparte, con datos reales, en
`ocr.service.spec.ts` y `receipt-validator.spec.ts` — no hacía falta repetirlo en el E2E.

## 3. Cobertura por módulo nuevo

| Módulo | Caja blanca (unit) | Caja negra (e2e) |
|---|---|---|
| `locker.service.ts` (`rent`, `confirmReceipt`, resolución de periodo) | ✅ `locker.service.spec.ts` — 12 casos, incluida la simulación de la carrera con mocks | ✅ `lockers.e2e-spec.ts` — 5 casos, incluidas las DOS carreras reales contra Postgres |
| `receipt-validator.ts` (heurística de monto en el texto OCR) | ✅ `receipt-validator.spec.ts` — 5 casos (punto/coma decimal, sin cero final, monto distinto, texto vacío) | Cubierto indirectamente por el E2E (el `OcrService` sustituido siempre devuelve texto válido, así que el E2E no vuelve a probar el parseo — sería redundante) |
| `ocr.service.ts` (wrapper de tesseract.js) | ✅ `ocr.service.spec.ts` — 4 casos, incluido que el worker se libera aunque falle el reconocimiento | Sustituido en el E2E (ver tabla de arriba) |
| `auth.controller.ts` → `GET /auth/me` | ✅ `auth.controller.spec.ts` — 2 casos nuevos | Cubierto indirectamente (el guard de prueba simula la identidad que este endpoint expone) |

## 4. Cómo correr cada nivel

```bash
# Unitarios — rápidos, no necesitan nada corriendo aparte
cd backend && npm test

# E2E — necesita Postgres real corriendo (docker-compose.yml, puerto 5433)
# y backend/.env con DATABASE_URL apuntando a localhost:5433
cd backend && npm run test:e2e
```

**Detalle no obvio del `test:e2e`:** corre con `cross-env NODE_OPTIONS=--experimental-vm-modules`
— sin ese flag, el validador nativo de tipo de archivo de NestJS (`FileTypeValidator`, usa
el paquete `file-type` vía import ESM dinámico para detectar el tipo real por
magic-bytes, no por el `Content-Type` declarado) falla en silencio bajo Jest y rechaza
**cualquier** archivo subido, incluida una imagen real y válida. Es una limitación conocida
de la librería (documentada en su propio código fuente), no un bug de este proyecto.

## 5. Cambio de código que esto forzó — `JwtAuthGuard`/`RolesGuard` ahora son providers propios

`auth.module.ts` registraba los guards **solo** dentro del multi-provider `APP_GUARD`
(`{ provide: APP_GUARD, useClass: JwtAuthGuard }`) — sin registrarlos también como su
propia clase inyectable, NestJS no expone ningún token contra el cual hacer
`overrideProvider(JwtAuthGuard)` en un test, y el override simplemente no hace nada (sin
error, sin aviso). El fix — registrar la clase como provider propio y usar
`useExisting` (no `useClass`, que crearía una segunda instancia distinta) en el binding de
`APP_GUARD` — es una corrección de testabilidad genuina, no un hack: la instancia que corre
como guard global ahora es la MISMA que la que un test puede reemplazar.
