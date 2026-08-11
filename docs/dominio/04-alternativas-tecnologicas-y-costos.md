# 04 · Análisis de Alternativas Tecnológicas y Estimación de Costos (Input externo)

**Fuente:** `Propuesta.pdf` (provisto por el sponsor) — "AEIS-APP: Sistema de Gestión y
Alquiler de Casilleros Inteligentes — Alternatives Analysis & Technical Cost Estimation",
Escuela Politécnica Nacional, Quito, agosto de 2026, versión 1.0. Documento de 30 páginas
con Project Charter, análisis de alternativas, matriz de costos y evaluación financiera
(VAN/TIR/PRI), con evidencia de precios citada textualmente en su Anexo A.

Este documento resume ese input para que quede indexado junto al resto del dominio — **no
reemplaza la fuente**; ante cualquier duda de detalle, el PDF es la referencia completa.

---

## 0. Por qué este documento importa: contradice y resuelve cosas ya asumidas

Al compararlo contra `01-analisis-negocio-mision.md` y `02-necesidades-stakeholders.md`,
el PDF **resuelve varias preguntas abiertas** pero también **entra en conflicto directo**
con decisiones que el sponsor ya había dado en esta conversación. Ver §5 (Conflictos) —
son la parte más importante de este documento, no un detalle al final.

## 1. Decisiones técnicas que propone el PDF

| Dimensión | Decisión del PDF | Contraste con lo ya registrado en 01/02 |
|---|---|---|
| Framework | **SvelteKit** | El sponsor había pedido NestJS (backend) — ver §5 |
| Identidad | **Keycloak self-hosted** (Logto Cloud Free como alternativa de igual costo) | El sponsor había pedido explícitamente **Logto** — ver §5 |
| Arquitectura | Monolito modular (auth/locker/rental/help separados internamente), migrar a microservicios después | Coincide con lo ya registrado (monolito desacoplado) |
| Hosting | DigitalOcean, Droplet Premium AMD 2 vCPU/4 GB (≈ USD 35/mes) | El sponsor pidió "máquina VPS" sin especificar proveedor — esto lo resuelve |
| Pago | PayPhone (tarjeta) + transferencia/comprobante — **ambos**, tal como ya se había resuelto | Consistente con lo ya registrado |
| OCR | Google Cloud Vision API para el comprobante | Nuevo detalle — no estaba especificado antes |
| Verificación biométrica (KYC) | **CompreFace** (Exadel, open source, self-hosted) — compara foto de cédula/carné vs. selfie | **Requisito nuevo, no mencionado antes en el dominio** — el flujo de alquiler incluye biometría, no solo el pago |
| Contrato | Clickwrap + KYC, sin firma manuscrita ni firma electrónica certificada, amparado en la Ley de Comercio Electrónico de Ecuador | Resuelve una pregunta abierta de `02-necesidades-stakeholders.md` §4 |
| DevSecOps | Stack 100% open source: SonarQube/CodeQL, Dependabot, Gitleaks, Trivy, OWASP ZAP, OSV-Scanner, Syft/CycloneDX, HashiCorp Vault, Falco, Semgrep, Wazuh, ClamAV; pentest comercial (~USD 1.500/año) diferido a la Fase 3 | Concreta la "Security-Driven Development" que ya estaba en `01-analisis-negocio-mision.md` §9 |
| Repos de referencia | **Dos**, no uno: `Gabo0526/aeis-app` (monolito Spring Boot + Thymeleaf) y `Gabo0526/adv-web-apps-aeis-app` (migración a microservicios: auth/locker/rental/help-service + API Gateway + Keycloak + Prometheus/Grafana/Loki/Promtail) | Antes solo se había explorado `D:\aso-app\aeis-app` localmente — confirmar si es el mismo repo que `Gabo0526/aeis-app` o uno distinto |

## 2. Ciclo de negocio real — corrige un supuesto de `03-analisis-financiero-costos.md`

**El cobro es SEMESTRAL, no un "periodo" genérico.** La EPN tiene 2 semestres al año, así
que cada casillero genera como máximo **2 pagos de $6.50 al año**, no una renta continua.
Esto cambia la lectura del techo de $702:

- $702 = 108 casilleros × $6.50 = techo de **UN semestre**, no del año.
- Techo anual real (100% ocupación, ambos semestres) = **$1,404.00**, no $702.
- Dato real citado en el PDF (Project Charter, Sección 2): **91 de 108 casilleros
  alquilados este semestre = 84.3% de ocupación = $591.50** de ingreso real del semestre
  en curso, "dato provisto por la EPN".

## 3. CAPEX/OPEX y viabilidad financiera (nuevo — no existía en el dominio)

- **CAPEX real: USD 40.00** (dominio y registros) — el desarrollo lo hace la propia
  asociación sin costo de caja. El costo de mercado equivalente (USD 10,820.00) es solo
  referencia de costo de oportunidad, no un desembolso real.
- **OPEX mínimo recomendado:** ~USD 180/año (VPS económico + soporte y seguridad
  absorbidos por la propia asociación) → **VAN positivo de USD 3,818.01** a 5 años (12%),
  recuperación de la inversión en 0.04 años.
- **OPEX "a precio de mercado"** (soporte pagado + pentest comercial anual ~USD 1,500
  desde el año 3) → **VAN negativo de USD -3,674.78**: el ingreso semestral de 108
  casilleros no cubre ese nivel de gasto.
- **Riesgo principal identificado por el propio PDF:** empezar a pagar soporte/seguridad a
  precio de mercado antes de que el volumen del proyecto lo sostenga.
- Si se quisiera cubrir el esquema completo sin depender de trabajo voluntario, el precio
  de equilibrio sería ≈ **USD 11.80/semestre** (no los $6.50-6.90 actuales).

## 4. Política de precio — DIFERENTE de lo que se había pedido en el chat

El PDF resuelve "bandas de precio" como **precio por método de pago**, no por
disponibilidad/urgencia:

- **USD 6.50** — pago por transferencia + comprobante (OCR), costo marginal ≈ 0.
- **USD 6.90** — pago con tarjeta vía PayPhone, trasladando el fee de la pasarela (5% +
  IVA sobre la comisión ≈ USD 0.374/transacción) al usuario que elige esa conveniencia.

**RESUELTO por el sponsor:** la "banda de precio entre $5 y $7" nunca fue una segmentación
por disponibilidad/urgencia dentro del mismo semestre — es la tabla de sensibilidad
VAN/TIR/PRI del PDF (Sección 8.7): **un único precio por semestre**, elegido según cuánta
utilidad se quiere, leyendo el VAN resultante en la Tabla 8.5. Con esto, la propuesta de 4
tramos que quedó registrada en `03-analisis-financiero-costos.md` §4 (primeros 20 a $5,
estándar $6.50, escasez $7, liquidación $6) **queda descartada** — no es el modelo que se
va a construir. El conflicto #5 de la tabla de §5 queda cerrado: se usa el modelo del PDF
(precio único por semestre + método de pago con el ajuste de $6.50/$6.90), decidido por
utilidad objetivo, no por disponibilidad de casilleros.

## 5. Conflictos directos con lo ya registrado — requieren decisión del sponsor

| # | Tema | Lo que el sponsor dijo en el chat | Lo que dice el PDF | Resolución |
|---|---|---|---|---|
| 1 | Backend | NestJS | SvelteKit full-stack (recomendación final del PDF) | **RESUELTO — se mantiene NestJS.** El sponsor revisó la recomendación del PDF y la descartó explícitamente para este proyecto. |
| 2 | Identidad | Logto (explícitamente, para "abstraer los dominios") | Keycloak self-hosted (recomendado) | **RESUELTO — se mantiene Logto.** Misma decisión que el punto 1: el PDF queda como input informativo, no como mandato. |
| 3 | Duración del proyecto | "hasta principios de septiembre" (~3-4 semanas) | Project Charter: "3-4 **meses**" | **RESUELTO — el PDF está desactualizado en este punto.** Plazo real confirmado: **3 semanas**, aún más ajustado que el estimado inicial del chat. |
| 4 | Ingreso real de referencia | "$277 auditado real" | "$591.50" (91×$6.50, "dato provisto por la EPN") — y `Gobernanza_Datos_AEIS.xlsx` da $256.50 para 2026-A parcial | **Parcialmente aclarado, no cerrado.** El sponsor precisó: "91 [casilleros] están alquilados de 277 registrados" — es decir, **277 es un conteo de registros del proceso de alquiler, no una cifra en dólares** (contradice la lectura original "$277 auditado"). Esto no reconcilia las 3 cifras entre sí, pero sí explica el origen del número 277 y revela algo más importante — ver §7. |
| 5 | Bandas de precio | ~~Por disponibilidad/urgencia ($5/$6.50/$7/$6)~~ — RESUELTO | Por método de pago ($6.50/$6.90) + precio único por semestre por utilidad objetivo | **Cerrado** — se usa el modelo del PDF tal cual. |

**Costo de infraestructura del stack confirmado (NestJS + Logto + DigitalOcean):** el PDF
no calculó esta combinación exacta (solo calculó SvelteKit/Next.js con Logto), pero su
propia Tabla 4.1/4.4 establece que todas las apps Node.js (SvelteKit, Next.js, NestJS)
tienen un footprint de RAM equivalente (150-350 MB) y, por Tabla 5.1.1, el costo de
infraestructura no varía por framework a esta escala — solo por proveedor de hosting y
proveedor de identidad. Por lo tanto, el costo mensual de **NestJS + Logto (Cloud Free o
self-hosted OSS) + DigitalOcean Droplet (2 vCPU/2 GB)** es el mismo que la Tabla 5.1.1 ya
calculó para SvelteKit + Logto Cloud + DigitalOcean: **≈ USD 27.60/mes** (Droplet $18.00 +
backups $3.60 + Spaces $5.00 + dominio $1.00 + Logto $0.00). Esta es la cifra de OPEX de
infraestructura que debe repetirse como output de costo en cada fase del proyecto (ver
nota en `01-analisis-negocio-mision.md` §6 y `03-analisis-financiero-costos.md` §4).

**Conclusión sobre el PDF:** queda como input de referencia técnica y financiera valioso
(CAPEX/OPEX, VAN/TIR/PRI, catálogo de herramientas DevSecOps, evidencia de precios de
proveedores) — pero **no es la fuente de verdad para decisiones que el sponsor ya tomó
explícitamente en esta conversación** (stack, plazo). Donde el PDF y el sponsor
coinciden o el PDF aporta algo nuevo sin contradecir nada (KYC biométrico, clickwrap,
DevSecOps, hosting en DigitalOcean), se adopta. Donde contradice una decisión explícita
del sponsor, gana el sponsor.

## 7. Hallazgo de negocio: déficit de caja no explicado

Al aclarar el origen del "$277", el sponsor reveló algo con más peso que una cifra: de
**277 registros** del proceso de alquiler, solo **91 corresponden a casilleros
efectivamente alquilados** (cifra que sí coincide con el 91/108 del PDF), y existe un
**déficit de caja cuyo origen la directiva no tiene identificado** — sin descartar manejo
indebido de fondos ni error puramente operativo. Detalle completo y su implicación de
requisito (trazabilidad/auditoría como "Must", no como analítica opcional) en
`01-analisis-negocio-mision.md` §2.1.

## 6. Hoja de ruta de evolución (nuevo — complementa, no contradice, la Sección 8/9 de otros documentos)

El PDF propone 4 fases con disparadores medibles: Fase 1 (piloto, OPEX mínimo, validar
ocupación ≥84.3% ya alcanzada manualmente), Fase 2 (consolidación, ocupación ≥90%, cero
incidentes KYC/seguridad por 2 semestres), Fase 3 (expansión física del inventario y/o
tarifa institucional — la única palanca que cambia la conclusión financiera, dado que el
techo de $1,404/año con 108 unidades es estructuralmente bajo), Fase 4 (multicampus /
licenciamiento a otras instituciones). Cada fase tiene un disparador cuantitativo, no una
fecha — coherente con el enfoque de MVP que ya se venía recomendando en
`02-necesidades-stakeholders.md` §3.

## 7. Actualización real de OPEX de infraestructura — Oracle Cloud en vez de DigitalOcean

El proveedor finalmente aprovisionado **no fue DigitalOcean** (§1/§5, ~USD 27.60/mes) sino
**Oracle Cloud Infrastructure (OCI)**, usando el tier **Always Free**: instancia Ampere
`VM.Standard.A1.Flex` con 2 OCPU / 12 GB RAM — dentro del pool gratuito de hasta 4 OCPU/24GB
que Oracle ofrece **de forma indefinida** (no solo durante un período de prueba, a
diferencia del "free tier" de AWS/GCP). Costo real de infraestructura de cómputo:
**USD 0.00/mes**, contra los USD 27.60/mes presupuestados en §5.

Esto **mejora directamente el VAN calculado en §3**: el escenario "OPEX mínimo" (~USD
180/año, VAN positivo de USD 3,818.01 a 5 años) baja aún más de costo real, dando más
margen antes de necesitar la tarifa de equilibrio de USD 11.80/semestre calculada en ese
mismo apartado. El riesgo que sí se mantiene igual — y que aplica más, no menos, en un
tier gratuito — es no empezar a pagar soporte/seguridad a precio de mercado antes de que
el volumen del proyecto lo sostenga (§3, riesgo principal ya identificado por el PDF).

**Contrapartida a documentar, no solo el ahorro:** el Always Free de Oracle depende de la
disponibilidad de capacidad de Ampere en la región (Ashburn, en este caso), que se agota
con frecuencia — la instancia tardó varios intentos en aprovisionarse por errores "Out of
host capacity". No es una garantía de disponibilidad al mismo nivel que un Droplet de pago
de DigitalOcean, aunque una vez aprovisionada la instancia queda asignada de forma estable
(el problema es solo al crearla o redimensionarla, no una vez corriendo). Detalle completo
del despliegue en `10-despliegue-vps-vercel.md`.
