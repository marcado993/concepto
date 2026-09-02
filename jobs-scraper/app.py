"""Microservicio de scraping de ofertas — envoltorio delgado sobre JobSpy.

Por que existe
--------------
JobSpy (https://github.com/speedyapply/JobSpy) es una libreria de PYTHON y
el backend de AEIS es NestJS. La alternativa era reimplementar en TypeScript
el parseo de cinco bolsas que cambian de HTML sin avisar; esto es un
contenedor mas en el mismo compose y un contrato HTTP de una sola ruta.

Postura de seguridad
--------------------
Este servicio NO publica puertos al host (ver docker-compose.prod.yml, misma
decision que postgres): solo el backend lo alcanza por la red interna del
compose. Un scraper es justamente la pieza que uno no quiere expuesta a
internet — no tiene autenticacion propia porque no la necesita: nadie de
afuera puede hablarle.

Realidad operativa, sin adornos
-------------------------------
Indeed es el scraper estable. LinkedIn limita por tasa (429) y a veces
devuelve vacio; Glassdoor va y viene. Por eso cada consulta se aisla: si una
bolsa falla, las demas igual devuelven sus resultados y el backend recibe un
200 con lo que haya, mas la lista de errores. Nunca se propaga un 500 por
una bolsa caida, porque eso dejaria el listado sin actualizar para todos.
"""

from __future__ import annotations

import logging
import math
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("jobs-scraper")

app = FastAPI(title="AEIS jobs scraper", docs_url=None, redoc_url=None)

# Tope duro de resultados por consulta. Sin el, un `resultsWanted` alto en el
# cuerpo del request convertia una peticion en varios minutos de scraping y
# en una invitacion al 429 de LinkedIn.
MAX_RESULTS_PER_QUERY = 100

# Cuantas consultas corren a la vez. Deliberadamente bajo: son requests
# reales contra bolsas de terceros, y paralelizar de mas es la forma mas
# rapida de que bloqueen la IP del VPS. Tambien acota la RAM, porque cada
# scrape arma su propio DataFrame.
MAX_WORKERS = int(os.getenv("SCRAPER_WORKERS", "2"))


class Query(BaseModel):
    siteNames: list[str] = Field(default_factory=lambda: ["indeed"])
    searchTerm: str
    location: str | None = None
    resultsWanted: int = 30
    hoursOld: int | None = None
    countryIndeed: str | None = None
    isRemote: bool | None = None


class ScrapeRequest(BaseModel):
    queries: list[Query]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/scrape")
def scrape(req: ScrapeRequest) -> dict[str, Any]:
    """Corre cada consulta y devuelve las filas juntas.

    Siempre 200: los fallos por-consulta van en `errors`, no en el codigo de
    estado. El backend ya sabe tolerar fuentes caidas (ver
    collectFromSources), y devolver 500 por una bolsa rota tiraria tambien
    las que si funcionaron.
    """
    jobs: list[dict[str, Any]] = []
    errors: list[str] = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_run_query, q): q for q in req.queries}
        for future, query in futures.items():
            label = f"{','.join(query.siteNames)}:{query.searchTerm}"
            try:
                rows = future.result()
                jobs.extend(rows)
                log.info("consulta %s -> %d ofertas", label, len(rows))
            except Exception as exc:  # noqa: BLE001 — a proposito: aislar la consulta
                errors.append(f"{label}: {type(exc).__name__}: {exc}")
                log.warning("consulta %s fallo: %s", label, exc)

    return {"jobs": jobs, "errors": errors}


def _run_query(query: Query) -> list[dict[str, Any]]:
    # Import diferido: `jobspy` tarda en cargar (arrastra pandas) y hacerlo
    # al importar el modulo retrasaba el arranque del contenedor lo
    # suficiente como para que el healthcheck del compose fallara.
    from jobspy import scrape_jobs

    kwargs: dict[str, Any] = {
        "site_name": query.siteNames,
        "search_term": query.searchTerm,
        "results_wanted": min(query.resultsWanted, MAX_RESULTS_PER_QUERY),
        # Descripcion completa de LinkedIn desactivada a proposito: obliga a
        # una peticion EXTRA por oferta, que es exactamente lo que dispara
        # su rate limiting. El motor de relevancia trabaja bien con el
        # titulo y el extracto.
        "linkedin_fetch_description": False,
    }
    if query.location:
        kwargs["location"] = query.location
    if query.hoursOld is not None:
        kwargs["hours_old"] = query.hoursOld
    if query.countryIndeed:
        kwargs["country_indeed"] = query.countryIndeed
    if query.isRemote is not None:
        kwargs["is_remote"] = query.isRemote

    df = scrape_jobs(**kwargs)
    if df is None or len(df) == 0:
        return []

    return [_clean_row(row) for row in df.to_dict(orient="records")]


def _clean_row(row: dict[str, Any]) -> dict[str, Any]:
    """Convierte una fila del DataFrame a JSON serializable.

    pandas usa NaN/NaT para los huecos y ninguno de los dos sobrevive a
    `json.dumps`. Antes de esto, la respuesta reventaba con "Out of range
    float value" en cuanto una bolsa omitia el salario — que es casi
    siempre.
    """
    out: dict[str, Any] = {}
    for key, value in row.items():
        out[key] = _clean_value(value)

    # `location` unificado: segun la bolsa, JobSpy devuelve una columna
    # `location` ya armada o city/state/country por separado. El backend
    # espera un solo campo, asi que se compone aca y no alla.
    if not out.get("location"):
        parts = [out.get("city"), out.get("state"), out.get("country")]
        joined = ", ".join(p for p in parts if p)
        out["location"] = joined or None

    return out


def _clean_value(value: Any) -> Any:
    if value is None:
        return None
    # NaN es el unico float que no es igual a si mismo; NaT de pandas cae en
    # la misma comprobacion via `isna`.
    if isinstance(value, float) and math.isnan(value):
        return None
    # NaT (el "null" de fechas de pandas) SI tiene .isoformat(), y devuelve
    # la cadena "NaT" — que llegaba al backend como si fuera una fecha y
    # `new Date("NaT")` daba Invalid Date. Hay que atajarlo antes.
    if str(value) == "NaT":
        return None
    if hasattr(value, "isoformat"):  # date / datetime / Timestamp
        return value.isoformat()
    if isinstance(value, (str, int, float, bool)):
        return value
    # Cualquier otro tipo de pandas/numpy se pasa a texto: es preferible un
    # string que el backend ignora a una respuesta que no serializa.
    text = str(value)
    return None if text.lower() in ("nan", "nat", "none", "") else text
