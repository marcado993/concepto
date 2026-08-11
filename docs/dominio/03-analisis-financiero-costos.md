# 03 · Análisis Financiero (Input real a Business/Mission Analysis)

**Fuente:** `Gobernanza_Datos_AEIS.xlsx` (`D:\GESTION-SISTEMAS\aso-streamlit\`) — modelo de
datos consolidado de finanzas AEIS, generado 2026-07-19 21:43, a partir de 17 archivos
mensuales (1027 movimientos, 39 incidencias de calidad ya identificadas y conservadas con
`Calidad_OK = No` para trazabilidad, periodos 2025-A / 2025-B / 2026-A).

Este documento existe para que `01-analisis-negocio-mision.md` y
`02-necesidades-stakeholders.md` citen cifras reales en vez de estimaciones — es
insumo del proceso de Business/Mission Analysis, no un reemplazo de él.

---

## 1. Balance por periodo académico/administrativo

| Periodo | Meses | Movimientos | Ingresos | Egresos | Balance |
|---|---|---|---|---|---|
| 2025-A | Mar–Jul 2025 | 362 | $5,800.15 | $5,351.80 | **+$448.35** |
| 2025-B | Ago 2025–Feb 2026 | 466 | $5,353.46 | $7,217.76 | **-$1,864.30** |
| 2026-A | Mar–Jul 2026 (actual, corte 19-jul) | 199 | $4,214.87 | $1,658.12 | **+$2,556.75** |

2025-B cerró con **déficit real** de -$1,864.30 — contexto de negocio relevante: la app no
es solo conveniencia operativa, hay presión real de sostenibilidad financiera detrás de
automatizar y optimizar precios.

## 2. Casilleros — ingreso real (valida §6.1 de `01-analisis-negocio-mision.md`)

| Periodo | Ingreso | Movimientos |
|---|---|---|
| 2025-A | $522.60 | 92 |
| 2025-B | $431.60 | 77 |
| 2026-A (corte 19-jul-2026) | **$256.50** | 40 |

- Techo teórico: 108 casilleros × $6.50 = **$702.00 por SEMESTRE** (no por año — corrección
  importante de `04-alternativas-tecnologicas-y-costos.md` §2: el cobro es semestral, hay 2
  semestres/año, así que el techo anual real es **$1,404.00**, el doble de lo asumido
  originalmente en este documento).
- Tres cifras de ingreso/actividad real, de tres fuentes distintas, **sin conciliar del
  todo** (ver `04-alternativas-tecnologicas-y-costos.md` §4 y §7 para el hallazgo
  completo):
  1. **277 — NO son dólares.** El sponsor aclaró que es un *conteo de registros* del
     proceso de alquiler (Forms), no una cifra de ingreso auditado como se asumió
     originalmente en este documento.
  2. $256.50 — reconstruido de `Gobernanza_Datos_AEIS.xlsx`, periodo 2026-A parcial
     (corte 19-jul-2026, no incluye el resto del semestre).
  3. **$591.50** — 91 de 108 casilleros alquilados = 84.3% de ocupación, "dato provisto
     por la EPN" citado en `Propuesta.pdf` (Project Charter). El sponsor confirmó que
     esos mismos 91 son "los alquilados de 277 registrados" — es decir, de 277 personas
     que iniciaron el proceso, solo 91 terminaron con un casillero pagado y asignado, y
     hay un **déficit de caja sin explicación identificada** en esa brecha.
- Ningún periodo se acerca al techo semestral de $702, ni siquiera el $591.50 mejor
  respaldado (≈84% de ocupación) — hay margen real de impacto en cerrar esa brecha antes
  de discutir si conviene subir el precio.

## 3. Aportaciones — datos reales, montos por tier NO resueltos todavía

| Periodo | Ingreso total | Movimientos |
|---|---|---|
| 2025-A | $95.95 | 7 |
| 2025-B | $94.99 | 3 |
| 2026-A | (sin movimientos categorizados como "Aportaciones" en este corte) | — |

**Montos individuales observados** (columna `Descripcion` del dato fuente):

| Descripción original | Monto | Frecuencia |
|---|---|---|
| "S Aportaciones AEIS" | $19.99 | 4 |
| "B Aportaciones AEIS" | $7.99 | 2 |
| "B Aportaciones AEIS" | $0.01 | 1 (probable ajuste/redondeo, no un tier real) |
| "Plan Aportaciones" | $35.00 | 2 (octubre 2025 — precio más alto, ¿reemplazó a S/B?) |
| "Aportaciones?" | $24.99 | 1 (etiqueta incierta en el dato origen) |

**Lectura:** el dato histórico muestra **dos** prefijos consistentes (`S` y `B`,
probablemente iniciales de dos nombres de tier anteriores) a $19.99 y $7.99, y luego un
salto a un "Plan Aportaciones" único de $35.00 en octubre 2025 — sugiere que el esquema de
tiers **ya cambió al menos una vez** en la historia real de la asociación.

**Esto NO resuelve** los montos actuales de los tres tiers vigentes que mencionó el
sponsor (**Bronce, Platino, Pantera**) — son nombres nuevos que no aparecen en este
dataset. `[Confirmar]`:
1. ¿Cuánto cuesta cada tier hoy (2026-A en adelante): Bronce, Platino, Pantera?
2. ¿Es periodicidad semestral (como sugiere el patrón por periodo 2025-A/2025-B) o
   distinta?
3. ¿"S" y "B" del histórico corresponden a dos de los tres tiers actuales, o el esquema se
   rediseñó completo?

## 4. Precio de casilleros — MODELO CORREGIDO (la propuesta de 4 tramos queda descartada)

**Descartado:** la propuesta original de este documento (4 tramos por disponibilidad —
madrugadores $5 / estándar $6.50 / escasez $7 / liquidación $6) partía de una lectura
incorrecta de lo que pidió el sponsor. Se mantiene tachada abajo solo por trazabilidad.

**Modelo real, aclarado por el sponsor y sustentado en `Propuesta.pdf`** (ver
`04-alternativas-tecnologicas-y-costos.md`):

1. **Precio único por semestre** (no varios tramos dentro del mismo semestre), ajustado
   por método de pago: **$6.50** transferencia+comprobante (OCR) / **$6.90** PayPhone
   (tarjeta) — el PDF §4.8 explica que ese +$0.40 traslada el fee de la pasarela (5% + IVA
   sobre la comisión) al usuario que elige pagar con tarjeta.
2. **La banda "$5 a $7" es el rango de sensibilidad financiera** (PDF Sección 8.7, Tabla
   8.5): a cuánto fijar el precio semestral **según cuánta utilidad se quiere**, leyendo
   directamente el VAN resultante — no una segmentación de la oferta de casilleros.
   Ejemplo de esa tabla: $6.50/semestre → VAN de $3,818.01 a 5 años (esquema OPEX mínimo);
   $9.00/semestre → VAN de $5,551.43. Cada +$1.00 de precio agrega ≈ $690-700 de VAN.

Esto reemplaza la lógica de "tramos por disponibilidad" — la decisión de precio es una
decisión de **utilidad objetivo**, tomada una vez por semestre, no una regla dinámica de
inventario en tiempo real.

<details>
<summary>Propuesta descartada (solo trazabilidad — no implementar)</summary>

| Tramo | Condición | Precio propuesto | Lógica |
|---|---|---|---|
| 1. Madrugadores | Primeros 20 alquileres del ciclo | ~~$5.00~~ | Genera adopción temprana |
| 2. Estándar | Disponibilidad media (21 a ~88) | ~~$6.50~~ | Precio ya validado |
| 3. Escasez | Quedan ≤20 casilleros (89 a ~98) | ~~$7.00~~ | Capitaliza urgencia |
| 4. Liquidación final | Quedan ≤10 casilleros | ~~$6.00~~ | Evita casilleros vacíos |

</details>

## 5. Estructura de costos (egresos) — contexto para el brief, no requisito de software

Para referencia del sponsor (no impacta el diseño de la app directamente, salvo quizás
como categorías del futuro dashboard de analítica):

| Categoría de egreso | Total histórico |
|---|---|
| Eventos institucionales | $3,146.82 |
| Torneos y deporte | $1,774.25 |
| Alimentación y bienestar | $1,753.30 |
| Infraestructura y remodelación | $1,481.34 |
| Limpieza y mantenimiento | $1,199.59 |
| Cursos y capacitación | $943.63 |
| Juegos y tecnología | $717.92 |
| Prendas, carnets y aportaciones ASO | $521.00 |
| Materiales y compras | $515.05 |
| Transporte | $264.61 |

## 6. Nota de calidad de datos

La hoja fuente ya documenta 39 incidencias (fechas vacías, principalmente) y dos fuentes
explícitamente **fuera de alcance** de este consolidado: `Aportaciones/Ganancias Lockers
AEIS *.xlsx` y `Aportaciones/Ganancias Planes AEIS *.xlsx` (estructura distinta, sin fecha
por fila, solo abril–mayo 2025). Si se necesita el detalle exacto de aportaciones de esos
dos meses, hay que ir a esos archivos originales — no están en `Hechos_Movimientos`.
