"""Trabajo.org Ecuador (ec.trabajo.org).

Estructura verificada el 2026-09-03:
  - Busqueda:    /empleo-<termino-en-slug>
  - Paginacion:  ?page=N   (20 avisos por pagina, hasta la 50)
  - Tarjeta:     li.nf-job[data-id]
      titulo   -> h3 a                       (+ data-url lleva la URL limpia)
      fecha    -> p.text-muted small         ("Hace 1 dia", "Hace 3 dias")
      lugar    -> .nf-job-list-info span > i.lnr-map-marker
      empresa  -> .nf-job-list-info span > i.lnr-briefcase
      jornada  -> .nf-job-list-info span > i.lnr-clock
      extracto -> .nf-job-list-desc p.mb-0
      logo     -> img.img-logo

Esta fuente NO usa navegador. La pagina viene renderizada del servidor: un GET
pelado ya trae los 20 avisos con su descripcion. Levantar Chromium para leer
HTML que ya esta ahi seria pagar ~40x el costo por nada.

Lo que si aporta Scrapling es la parte que un GET pelado no cubre: la huella
TLS (`impersonate`) y las cabeceras coherentes con ese navegador
(`stealthy_headers`). Un `requests.get` con User-Agent de Chrome miente en la
cabecera pero saluda en TLS como Python, y esa contradiccion es exactamente
lo que mira un WAF. Ademas trae reintentos con espera, que aca hacen falta
porque son ~50 paginas por termino.

Por que vale la pena esta fuente: el extracto SI viene en el listado (94% de
los avisos lo traen), a diferencia de Computrabajo, donde la tarjeta solo
tiene empresa/ciudad/fecha y el motor de relevancia se queda leyendo nada mas
que el titulo.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from ..config import Config
from ..models import Job
from ..normalize import (
    calcular_dedupe_key,
    detectar_pasantia,
    detectar_remoto,
    limpiar_titulo,
    parsear_fecha,
    quitar_acentos,
)
from .base import pausa

log = logging.getLogger(__name__)

BASE = "https://ec.trabajo.org"
PAGINAS_MAX = 5          # 20 por pagina; mas atras la relevancia cae en picada
POR_PAGINA = 20
TIMEOUT_SEG = 30

# Los iconos identifican cada dato. Verificado que 1 de cada 20 tarjetas trae
# solo DOS spans (le falta la jornada), asi que leerlos por posicion —
# spans[0], spans[1], spans[2] — se rompe justo en esas: la empresa se leeria
# como jornada. El icono es estructura, no orden.
CAMPOS = {
    "ubicacion": "lnr-map-marker",
    "empresa": "lnr-briefcase",
    "jornada": "lnr-clock",
}


def _limpiar(texto: str) -> str:
    return re.sub(r"\s+", " ", texto or "").strip()


def _slug_busqueda(termino: str) -> str:
    """'soporte tecnico' -> 'soporte-tecnico'."""
    t = quitar_acentos(termino).lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def _texto(elemento) -> str:
    """El texto del elemento INCLUYENDO sus hijos.

    `.text` devuelve solo los nodos de texto directos, y aca todos los datos
    viven junto a un <i> del icono: leerlos con `.text` devuelve cadena vacia.
    """
    return _limpiar(elemento.get_all_text())


def _campo(tarjeta, icono: str) -> str:
    encontrados = tarjeta.css(f".nf-job-list-info span:has(i.{icono})")
    return _texto(encontrados[0]) if encontrados else ""


def _primero(tarjeta, selector: str) -> str:
    encontrados = tarjeta.css(selector)
    return _texto(encontrados[0]) if encontrados else ""


def _tarjeta_a_job(tarjeta, ahora: datetime) -> Job | None:
    titulo = limpiar_titulo(_primero(tarjeta, "h3 a"))
    if not titulo:
        return None

    empresa = _campo(tarjeta, CAMPOS["empresa"])
    ubicacion = _campo(tarjeta, CAMPOS["ubicacion"])
    jornada = _campo(tarjeta, CAMPOS["jornada"])
    descripcion = _primero(tarjeta, ".nf-job-list-desc p.mb-0")

    # El titulo de esta fuente es casi siempre generico ("Pasante" a secas):
    # el area del puesto vive en el extracto. Sin el, el motor de relevancia
    # no tendria como distinguir un pasante de sistemas de uno de contabilidad.
    if descripcion.startswith("Descripcion del puesto"):
        descripcion = descripcion[len("Descripcion del puesto"):].strip()

    logo = tarjeta.css("img.img-logo::attr(src)")
    # El sitio pone un SVG en data: como respaldo cuando la empresa no tiene
    # logo. Guardarlo seria guardar un placeholder disfrazado de logo.
    url_logo = str(logo[0]) if logo else ""
    if url_logo.startswith("data:"):
        url_logo = ""

    url = tarjeta.attrib.get("data-url", "") or ""
    if url and not url.startswith("http"):
        url = f"{BASE}{url}"

    return Job(
        dedupe_key=calcular_dedupe_key(titulo, empresa),
        source="trabajo_org",
        source_id=tarjeta.attrib.get("data-id", "") or "",
        url=url.split("#")[0],
        company_logo=url_logo,
        title=titulo,
        company=empresa,
        location=ubicacion,
        is_remote=detectar_remoto(titulo, ubicacion, descripcion),
        is_internship=detectar_pasantia(titulo, f"{descripcion} {jornada}"),
        description=descripcion,
        posted_at=parsear_fecha(_primero(tarjeta, "p.text-muted small")),
        scraped_at=ahora,
    )


def _pedir(url: str, cfg: Config):
    """GET con huella de navegador real. Import diferido: Scrapling arrastra
    curl_cffi y browserforge, y no todas las corridas usan esta fuente."""
    from scrapling.fetchers import Fetcher

    opciones = {
        # Copia la huella TLS/HTTP2 de Chrome. Es lo que separa a Scrapling de
        # un `requests` con User-Agent cambiado.
        "impersonate": "chrome",
        "stealthy_headers": True,
        "timeout": TIMEOUT_SEG,
        "retries": 2,
        "retry_delay": 3,
    }
    if cfg.proxies:
        opciones["proxy"] = cfg.proxies[0]
    return Fetcher.get(url, **opciones)


def recolectar(cfg: Config) -> list[Job]:
    ahora = datetime.now(timezone.utc)
    jobs: list[Job] = []

    for termino in cfg.terminos_locales:
        slug = _slug_busqueda(termino)
        for pagina in range(1, PAGINAS_MAX + 1):
            url = f"{BASE}/empleo-{slug}"
            if pagina > 1:
                url += f"?page={pagina}"

            try:
                respuesta = _pedir(url, cfg)
            except Exception as e:
                log.debug("  trabajo_org %s p%d: %s", slug, pagina, type(e).__name__)
                break

            if respuesta.status != 200:
                log.debug("  trabajo_org %s p%d: HTTP %s", slug, pagina, respuesta.status)
                break

            tarjetas = respuesta.css("li.nf-job")
            if not tarjetas:
                break

            for tarjeta in tarjetas:
                try:
                    job = _tarjeta_a_job(tarjeta, ahora)
                except Exception as e:
                    # Una tarjeta rota no puede tumbar la corrida entera.
                    log.debug("  trabajo_org tarjeta ilegible: %s", type(e).__name__)
                    continue
                if job:
                    jobs.append(job)

            log.info("  trabajo_org / %r p%d -> %d", termino, pagina, len(tarjetas))

            if len(tarjetas) < POR_PAGINA:
                break  # ultima pagina
            pausa(cfg.delay_min_seg, cfg.delay_max_seg)

    return jobs
