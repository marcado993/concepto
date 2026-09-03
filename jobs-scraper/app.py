"""Servicio de recoleccion de ofertas de empleo.

Que hace
--------
Corre los scrapers de las cinco fuentes que cubren Ecuador y devuelve las
vacantes crudas por HTTP. NO puntua, NO deduplica y NO guarda nada: de eso
se encarga el backend de NestJS (backend/src/jobs/), que ya tiene el motor
de relevancia y la base de datos.

Fuentes
-------
  Bolsa EPN      Playwright propio   la de mayor senal: exclusiva de la EPN
  Indeed Ecuador JobSpy              la mas confiable
  LinkedIn       JobSpy              funciona sin login; bloquea si se abusa
  Multitrabajos  Playwright propio   la marca de Bumeran en Ecuador
  Computrabajo   Playwright propio   sin salario en el listado

Los tres scrapers propios y la normalizacion vienen del worker Panchito GPT
(ver panchito/__init__.py). Glassdoor, ZipRecruiter, Naukri, Bayt y BDJobs
quedaron fuera por no tener cobertura real en Ecuador.

Postura de seguridad
--------------------
Este servicio NO publica puertos al host (ver docker-compose.prod.yml, misma
decision que postgres): solo el backend lo alcanza por la red interna del
compose. No tiene autenticacion propia porque no la necesita — nadie de
afuera puede hablarle.

Realidad operativa, sin adornos
-------------------------------
Los portales cambian su HTML sin avisar: que un scraper deje de traer
resultados es cuestion de tiempo, no un accidente. Por eso cada fuente se
aisla — si Multitrabajos cambia el DOM o LinkedIn devuelve 429, las demas
igual entregan y el backend recibe un 200 con lo que haya, mas la lista de
errores. Nunca se propaga un 500 por una fuente caida, porque eso dejaria
el listado sin actualizar para todos.
"""

from __future__ import annotations

import logging
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

from panchito.config import Config
from panchito.models import Job

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("jobs-scraper")

app = FastAPI(title="AEIS jobs scraper", docs_url=None, redoc_url=None)

# Cuantas fuentes corren a la vez. Deliberadamente bajo: son peticiones
# reales contra sitios de terceros, y paralelizar de mas es la forma mas
# rapida de que bloqueen la IP del VPS. Tambien acota la RAM, porque cada
# scraper de Playwright levanta su propio Chromium.
MAX_WORKERS = int(os.environ.get("SCRAPER_WORKERS", "2"))

# Fuentes que corren por JobSpy en vez de con un scraper propio.
FUENTES_JOBSPY = {"indeed", "linkedin"}


class ScrapeRequest(BaseModel):
    """Cuerpo opcional: permite pedir un subconjunto de fuentes.

    Sirve para el caso real de "Multitrabajos se rompio, probemos solo esa"
    sin tener que esperar la corrida completa ni tocar la config.
    """

    sources: list[str] | None = None


# ---------------------------------------------------------------------
# Estado de la corrida.
#
# La recoleccion es ASINCRONA y no una peticion larga, por un fallo real:
# antes /scrape hacia todo el trabajo y recien entonces respondia, lo que
# significaba sostener una conexion HTTP unos 15 minutos. El `fetch` de
# Node (undici) corta a los 300 s por su `headersTimeout`, y ese limite no
# se puede subir desde las opciones estandar de fetch — la corrida moria
# siempre a los 5.0 minutos exactos, con un "fetch failed" que no decia
# nada. Subir timeouts solo habria movido el problema: una conexion abierta
# 15 minutos es fragil de todas formas (proxies, reinicios, red del
# compose).
#
# Ahora POST /scrape arranca y responde al instante; el backend consulta
# GET /scrape/result cada tanto. Cada peticion HTTP dura milisegundos.
#
# Estado a nivel de modulo y no en una base: uvicorn corre con UN worker a
# proposito (ver el CMD del Dockerfile), asi que hay un solo proceso y esto
# alcanza. Guardar una corrida en Postgres solo para releerla dos minutos
# despues seria complejidad sin nada a cambio.
# ---------------------------------------------------------------------
_estado_lock = threading.Lock()
_estado: dict[str, Any] = {"status": "idle", "started_at": None, "finished_at": None, "result": None}


def _correr_en_hilo(fuentes: list[str], desconocidas: list[str]) -> None:
    """Cuerpo de la corrida. Nunca lanza: los fallos quedan en el estado."""
    try:
        resultado = _recolectar_todo(fuentes, desconocidas)
        with _estado_lock:
            _estado.update(status="done", finished_at=time.time(), result=resultado)
    except Exception as exc:  # noqa: BLE001 — el hilo no puede propagar nada
        log.exception("corrida fallo entera")
        with _estado_lock:
            _estado.update(
                status="error",
                finished_at=time.time(),
                result={"jobs": [], "errors": [f"corrida fallo: {type(exc).__name__}: {exc}"], "stats": {}},
            )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/sources")
def sources() -> dict[str, Any]:
    cfg = Config()
    return {
        "disponibles": cfg.fuentes,
        "terminos": len(cfg.terminos),
        "terminos_locales": len(cfg.terminos_locales),
    }


@app.post("/scrape")
def scrape(req: ScrapeRequest | None = None) -> dict[str, Any]:
    """Arranca una corrida y responde AL INSTANTE.

    No devuelve las vacantes: para eso esta GET /scrape/result. Ver la nota
    grande del estado, arriba, para por que la recoleccion dejo de ser una
    peticion larga.

    Si ya hay una corrida en curso NO se arranca otra y se responde
    "running": dos corridas simultaneas duplicarian el trabajo y, peor,
    el consumo de cuota contra los portales — que es justo lo que provoca
    que bloqueen la IP del VPS.
    """
    cfg = Config()
    pedidas = (req.sources if req and req.sources else None) or cfg.fuentes
    # Se filtra contra las fuentes configuradas para que un cuerpo con una
    # fuente inventada no explote — se reporta en `errors` del resultado.
    activas = [f for f in pedidas if f in cfg.fuentes]
    desconocidas = [f for f in pedidas if f not in cfg.fuentes]

    with _estado_lock:
        if _estado["status"] == "running":
            return {"status": "running", "started_at": _estado["started_at"]}
        _estado.update(status="running", started_at=time.time(), finished_at=None, result=None)

    hilo = threading.Thread(target=_correr_en_hilo, args=(activas, desconocidas), daemon=True)
    hilo.start()
    log.info("corrida arrancada con fuentes: %s", activas)
    return {"status": "started", "sources": activas}


@app.get("/scrape/result")
def scrape_result() -> dict[str, Any]:
    """Estado de la corrida y, si termino, las vacantes.

    El resultado NO se borra al leerlo: el backend puede reintentar la
    lectura si se le corta la red sin perder 15 minutos de scraping.
    """
    with _estado_lock:
        estado = dict(_estado)

    salida: dict[str, Any] = {
        "status": estado["status"],
        "started_at": estado["started_at"],
        "finished_at": estado["finished_at"],
    }
    if estado["status"] in ("done", "error") and estado["result"]:
        salida.update(estado["result"])
    else:
        # Forma estable pase lo que pase: el backend siempre puede leer
        # `jobs` sin comprobar antes si existe.
        salida.update({"jobs": [], "errors": [], "stats": {}})
    return salida


def _recolectar_todo(activas: list[str], desconocidas: list[str]) -> dict[str, Any]:
    """Corre las fuentes en paralelo y arma el resultado.

    Cada fuente se aisla: si Multitrabajos cambia el DOM o LinkedIn devuelve
    429, las demas igual entregan. Un portal roto no puede tirar la corrida
    entera, porque eso dejaria el listado sin actualizar para todos.
    """
    cfg = Config()
    jobs: list[Job] = []
    errors: list[str] = [f"fuente desconocida: {f}" for f in desconocidas]
    stats: dict[str, int] = {}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futuros = {pool.submit(_recolectar_fuente, fuente, cfg): fuente for fuente in activas}
        for futuro, fuente in futuros.items():
            try:
                encontrados = futuro.result()
                jobs.extend(encontrados)
                stats[fuente] = len(encontrados)
                log.info("fuente %s -> %d ofertas", fuente, len(encontrados))
            except Exception as exc:  # noqa: BLE001 — a proposito: aislar la fuente
                stats[fuente] = 0
                errors.append(f"{fuente}: {type(exc).__name__}: {exc}")
                log.warning("fuente %s fallo: %s", fuente, exc)

    log.info("corrida terminada: %d ofertas, %d errores", len(jobs), len(errors))
    return {"jobs": [_serializar(j) for j in jobs], "errors": errors, "stats": stats}


def _recolectar_fuente(fuente: str, cfg: Config) -> list[Job]:
    # Imports diferidos: `jobspy` arrastra pandas y Playwright levanta su
    # propio modulo. Hacerlo al importar app.py retrasaba el arranque lo
    # suficiente como para que el healthcheck del compose fallara.
    if fuente in FUENTES_JOBSPY:
        from panchito.sources import jobspy_source

        return jobspy_source.recolectar(cfg, fuente)

    if fuente == "epn":
        from panchito.sources import epn

        return epn.recolectar(cfg)

    if fuente == "multitrabajos":
        from panchito.sources import multitrabajos

        return multitrabajos.recolectar(cfg)

    if fuente == "computrabajo":
        from panchito.sources import computrabajo

        return computrabajo.recolectar(cfg)

    if fuente == "trabajo_org":
        from panchito.sources import trabajo_org

        return trabajo_org.recolectar(cfg)

    if fuente == "ats_scrapers":
        from panchito.sources import ats_dataset

        return ats_dataset.recolectar(cfg)

    raise ValueError(f"sin recolector para {fuente!r}")


def _serializar(job: Job) -> dict[str, Any]:
    """Job -> dict JSON-serializable.

    `date`/`datetime` y los NaN de pandas no sobreviven a `json.dumps`.
    Antes de limpiarlos, la respuesta reventaba con "Out of range float
    value" en cuanto una fuente omitia el salario — que es casi siempre.
    """
    fila = asdict(job)
    return {clave: _limpiar(valor) for clave, valor in fila.items()}


def _limpiar(valor: Any) -> Any:
    if valor is None:
        return None
    if isinstance(valor, bool):  # antes que int: bool ES int en Python
        return valor
    if isinstance(valor, float) and math.isnan(valor):
        return None
    # NaT (el "null" de fechas de pandas) SI tiene .isoformat() y devuelve
    # la cadena "NaT", que llegaba al backend como si fuera una fecha y
    # `new Date("NaT")` daba Invalid Date. Hay que atajarlo antes.
    if str(valor) == "NaT":
        return None
    if hasattr(valor, "isoformat"):  # date / datetime
        return valor.isoformat()
    if isinstance(valor, (str, int, float)):
        return valor
    if isinstance(valor, list):
        return [_limpiar(v) for v in valor]
    texto = str(valor)
    return None if texto.lower() in ("nan", "nat", "none", "") else texto
