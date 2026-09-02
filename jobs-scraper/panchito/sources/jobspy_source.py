"""Indeed Ecuador y LinkedIn vía JobSpy.

JobSpy devuelve un DataFrame con ~34 columnas propias; aquí se recorta al
esquema unificado. Cada término de búsqueda se consulta por separado porque
JobSpy no acepta varios términos en una sola llamada.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from ..config import Config
from ..models import Job
from ..normalize import (
    calcular_dedupe_key,
    detectar_pasantia,
    detectar_remoto,
    limpiar_titulo,
)
from .base import pausa

log = logging.getLogger(__name__)

# Ecuador solo tiene cobertura real en estas dos de todo el catálogo de JobSpy.
SITIOS_SOPORTADOS = {"indeed", "linkedin"}


def _texto(valor) -> str:
    """JobSpy usa NaN de pandas para los campos vacíos, no None."""
    if valor is None:
        return ""
    texto = str(valor).strip()
    return "" if texto.lower() in ("nan", "none", "nat") else texto


def _numero(valor) -> float | None:
    try:
        f = float(valor)
    except (TypeError, ValueError):
        return None
    return None if f != f else f  # NaN != NaN


def _fila_a_job(fila, fuente: str, ahora: datetime) -> Job | None:
    titulo = limpiar_titulo(_texto(fila.get("title")))
    if not titulo:
        return None

    empresa = _texto(fila.get("company"))
    ubicacion = _texto(fila.get("location"))
    descripcion = _texto(fila.get("description"))
    url = _texto(fila.get("job_url_direct")) or _texto(fila.get("job_url"))

    fecha = fila.get("date_posted")
    posted = None
    if fecha is not None and _texto(fecha):
        try:
            posted = fecha.date() if hasattr(fecha, "date") else datetime.fromisoformat(
                str(fecha)[:10]
            ).date()
        except (ValueError, TypeError):
            posted = None

    tipo = _texto(fila.get("job_type"))
    remoto_flag = fila.get("is_remote")

    return Job(
        dedupe_key=calcular_dedupe_key(titulo, empresa),
        source=fuente,
        source_id=_texto(fila.get("id")),
        url=url,
        company_logo=_texto(fila.get("company_logo")),
        title=titulo,
        company=empresa,
        location=ubicacion,
        is_remote=bool(remoto_flag) or detectar_remoto(ubicacion, titulo, tipo),
        is_internship=detectar_pasantia(titulo, tipo, descripcion[:600]),
        description=descripcion,
        salary_min=_numero(fila.get("min_amount")),
        salary_max=_numero(fila.get("max_amount")),
        salary_currency=_texto(fila.get("currency")) or None,
        salary_raw=_texto(fila.get("interval")) or None,
        posted_at=posted,
        scraped_at=ahora,
        tags=[t for t in (tipo, _texto(fila.get("job_level"))) if t],
    )


def recolectar(cfg: Config, sitio: str) -> list[Job]:
    """Corre todos los términos configurados contra un sitio de JobSpy."""
    if sitio not in SITIOS_SOPORTADOS:
        raise ValueError(f"JobSpy no cubre {sitio!r} con datos de Ecuador")

    from jobspy import scrape_jobs  # import perezoso: tarda ~2s en cargar pandas

    ahora = datetime.now(timezone.utc)
    jobs: list[Job] = []

    for i, termino in enumerate(cfg.terminos):
        if i:
            pausa(cfg.delay_min_seg, cfg.delay_max_seg)

        kwargs = {
            "site_name": [sitio],
            "search_term": termino,
            "results_wanted": cfg.resultados_por_termino,
            "hours_old": cfg.horas_antiguedad,
        }
        if sitio == "indeed":
            kwargs["location"] = cfg.ubicacion_indeed
            kwargs["country_indeed"] = cfg.pais_indeed
        else:
            kwargs["location"] = cfg.ubicacion_linkedin
            # Cada descripción es una petición extra a la fuente más restrictiva.
            # Se paga porque sin ella el score puntúa solo con el título, y eso
            # hunde a LinkedIn frente a Indeed sin que sus vacantes sean peores.
            kwargs["linkedin_fetch_description"] = cfg.descripciones_linkedin
        if cfg.proxies:
            kwargs["proxies"] = cfg.proxies

        try:
            df = scrape_jobs(**kwargs)
        except Exception as e:
            log.warning("  %s / %r falló: %s", sitio, termino, e)
            continue

        nuevos = 0
        for _, fila in df.iterrows():
            job = _fila_a_job(fila, sitio, ahora)
            if job:
                jobs.append(job)
                nuevos += 1
        log.info("  %s / %r -> %d", sitio, termino, nuevos)

    return jobs
