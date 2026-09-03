"""ats-scrapers (kalil0321/ats-scrapers) — dataset alojado de ofertas de ATS.

Documentacion leida completa antes de escribir esto: README, JOB_SCHEMA.md,
DISCOVERY_RULES.md, provider-description-matrix.md, CHANGELOG.md,
pyproject.toml, los dos ejemplos, y el codigo fuente de client.py y
manifest.py (github.com/kalil0321/ats-scrapers, verificado 2026-09-03).

Por que DuckDB y NO el paquete `ats-scrapers` (pip install ats-scrapers):
------------------------------------------------------------------------
El propio `Client.search()` del paquete llama a `Client.load()`, que sin un
filtro de `ats=` descarga el snapshot COMPLETO (`url_for_all`) entero a
memoria antes de filtrar nada — el modulo lo dice en su propio docstring:
"the full cross-source snapshot is multi-gigabyte" y "For large-scale or
real-time use, swap Client for the per-ATS scrapers". No hay recorte por
pais ni por ubicacion en el manifiesto: solo por ATS completo o por fecha.

Para un contenedor con recursos acotados que corre cada 3 horas, descargar
2+ GB por corrida para quedarse con 665 filas de Ecuador no es viable. DuckDB
lee el mismo Parquet por RANGOS HTTP -verificado empiricamente: la consulta
de abajo tarda ~4 segundos y nunca baja el archivo completo.

Que SI se usa del dataset (via lectura directa, sin instalar el paquete):
--------------------------------------------------------------------------
  - El manifiesto (`/v1/manifest.json`) para resolver la URL del Parquet en
    vez de fijarla — el mismo patron que usa su propio `Manifest.fetch()`.
  - country_iso NO se usa para filtrar: JOB_SCHEMA.md confirma que solo se
    llena "cuando el ATS de origen expone un pais estructurado (Bundesagentur,
    EURES, SuccessFactors)" y para el resto queda vacio a proposito, para que
    lo llene un enriquecimiento por LLM que este proyecto no tiene. Filtrar
    por texto de `location` es la via correcta segun su propia documentacion,
    no un atajo.
  - `employment_type` (enum FULL_TIME/PART_TIME/CONTRACT/INTERN/TEMPORARY) SI
    se usa como senal extra de pasantia cuando esta presente (34 de 665 filas
    de Ecuador lo traen).
  - `is_remote=true` global NO se usa: son 143.934 filas en todo el mundo,
    nada acotado a Ecuador o Latinoamerica. Se dejo fuera a proposito -
    inundaria la base sin ningun criterio real.

Verificado sobre la corrida real del 2026-09-03: 665 avisos alcanzables
desde Ecuador, 97% con descripcion util (contra 0% de Computrabajo), entre
ellos pasantias de TECNOLOGIA en Banco Guayaquil (SuccessFactors, aparece
como tenant "Fa Ewnb Saasfaprod1" -ver `_LOGOS_EMPRESA` mas abajo) y Devsu.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import requests

from ..config import Config
from ..models import Job
from ..normalize import calcular_dedupe_key, detectar_pasantia, detectar_remoto, limpiar_titulo

log = logging.getLogger(__name__)

MANIFEST_URL = "https://storage.stapply.ai/jobhive/v1/manifest.json"
# Respaldo si el manifiesto no responde: la misma ruta estable que usa su
# propio Manifest por defecto cuando no hay snapshot fechado.
PARQUET_FALLBACK = "https://storage.stapply.ai/jobhive/v1/all.parquet"

# Coincide con ECUADOR_TERMS del motor de relevancia del backend
# (backend/src/jobs/relevance/taxonomy.ts) - se mantiene independiente a
# proposito: este es Python, ese es TypeScript, y son dos sistemas que
# corren en momentos distintos del pipeline.
_ECUADOR_SQL = (
    "regexp_matches(lower(coalesce(location,'')), "
    "'ecuador|quito|guayaquil|cuenca, ec|cuenca,ec')"
)

# Nombres de empresa que llegan como el identificador interno del tenant en
# vez del nombre real - visto en produccion con SuccessFactors, que expone
# el codigo de sistema en vez de un nombre para mostrar. JOB_SCHEMA.md no
# promete limpieza aca ("company" es "Display name... " pero depende de lo
# que el ATS de origen entregue). Sin este mapeo, Banco Guayaquil apareceria
# en la app como "Fa Ewnb Saasfaprod1".
_NOMBRES_EMPRESA = {
    "fa ewnb saasfaprod1": "Banco Guayaquil",
}


def _nombre_empresa(bruto: str) -> str:
    return _NOMBRES_EMPRESA.get((bruto or "").strip().lower(), bruto)


def _resolver_url_parquet() -> str:
    """Lee el manifiesto para la URL vigente del snapshot completo.

    No se fija la URL a mano: el manifiesto es justo el mecanismo que el
    propio proyecto expone para no romperse si rotan el artefacto. Si el
    manifiesto no responde, se cae al path estable conocido en vez de
    abortar la fuente entera por un solo request de configuracion.

    `requests` y no `urllib.request` a proposito: Semgrep (policy propia del
    pipeline, ver .github/workflows/devsecops.yml) marca urllib como
    bloqueante porque soporta el esquema `file://` -si la URL viniera de un
    input externo, es una via de lectura arbitraria de archivos. Acá
    `MANIFEST_URL` es una constante fija, nunca dato de un tercero, pero
    `requests` no soporta ese esquema de fabrica y evita la clase entera de
    problema sin tener que justificar caso por caso.
    """
    try:
        resp = requests.get(MANIFEST_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
        resp.raise_for_status()
        return resp.json()["all"]["parquet"]
    except Exception as e:
        log.warning("  ats_dataset: manifiesto no disponible (%s), usando URL fija", type(e).__name__)
        return PARQUET_FALLBACK


def _fila_a_job(fila: dict, ahora: datetime) -> Job | None:
    titulo = limpiar_titulo(fila.get("title") or "")
    if not titulo:
        return None

    empresa = _nombre_empresa(fila.get("company") or "")
    descripcion = (fila.get("description") or "").strip()
    ubicacion = fila.get("location") or ""

    url = fila.get("apply_url") or fila.get("url") or ""
    if not url:
        return None  # sin URL no hay a donde postular; JOB_SCHEMA promete "url" siempre, pero no se confia ciegamente

    posted_at = None
    crudo = fila.get("posted_at")
    if crudo:
        try:
            posted_at = datetime.fromisoformat(crudo).date()
        except ValueError:
            pass

    es_pasantia_por_esquema = fila.get("employment_type") == "INTERN"

    return Job(
        dedupe_key=calcular_dedupe_key(titulo, empresa),
        source="ats_scrapers",
        source_id=f"{fila.get('ats_type', '')}:{fila.get('ats_id', '')}",
        url=url,
        title=titulo,
        company=empresa,
        location=ubicacion,
        is_remote=bool(fila.get("is_remote")) or detectar_remoto(titulo, ubicacion, descripcion),
        is_internship=es_pasantia_por_esquema or detectar_pasantia(titulo, descripcion),
        description=descripcion,
        posted_at=posted_at,
        scraped_at=ahora,
    )


def recolectar(cfg: Config) -> list[Job]:
    import duckdb

    ahora = datetime.now(timezone.utc)
    url_parquet = _resolver_url_parquet()

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")

    consulta = f"""
        SELECT ats_type, ats_id, title, company, location, description,
               url, apply_url, posted_at, is_remote, employment_type
        FROM read_parquet('{url_parquet}')
        WHERE {_ECUADOR_SQL}
    """

    try:
        con.execute(consulta)
        columnas = [d[0] for d in con.description]
        filas = [dict(zip(columnas, fila)) for fila in con.fetchall()]
    except Exception as e:
        log.warning("  ats_dataset: consulta fallo (%s), 0 avisos", type(e).__name__)
        return []
    finally:
        con.close()

    jobs: list[Job] = []
    for fila in filas:
        job = _fila_a_job(fila, ahora)
        if job:
            jobs.append(job)

    log.info("  ats_dataset -> %d de %d filas de Ecuador", len(jobs), len(filas))
    return jobs
