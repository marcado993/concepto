"""Multitrabajos (multitrabajos.com), la marca de Bumeran en Ecuador.

Estructura verificada el 2026-09-01:
  - Búsqueda:    /empleos-busqueda-<termino-en-slug>.html
  - Paginación:  ?page=N
  - Tarjeta:     el propio <a href="/empleos/...-<id>.html">, que envuelve todo

El sitio es React con styled-components: las clases son hashes (`sc-jBQhSp`) que
cambian en cada deploy, así que apuntar a ellas garantiza romperse. Aquí se usan
dos anclas que sí son estables:
  1. el patrón de URL de los avisos, y
  2. los <i name="icon-light-*">, cuyos nombres son semánticos.
Título, empresa y fecha salen de las primeras líneas del texto de la tarjeta.
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
from .base import contexto_navegador, lanzar_navegador, pausa

log = logging.getLogger(__name__)

BASE = "https://www.multitrabajos.com"
PAGINAS_MAX = 3

# Las tarjetas abren con "Publicado ayer" / "Actualizado hace 6 horas".
_LINEA_FECHA = re.compile(r"^(publicado|actualizado)\b", re.IGNORECASE)
# El rating de la empresa aparece como línea suelta: "4.2".
_LINEA_RATING = re.compile(r"^\d[.,]\d$")
_ID_EN_URL = re.compile(r"-(\d+)\.html$")


def _slug_busqueda(termino: str) -> str:
    t = quitar_acentos(termino).lower()
    t = re.sub(r"[^a-z0-9]+", "-", t)
    return t.strip("-")


def _extraer_tarjetas(page) -> list[dict]:
    return page.evaluate(
        r"""() => [...document.querySelectorAll('a[href^="/empleos/"]')].map(a => {
            const iconos = {};
            a.querySelectorAll('i[name]').forEach(i => {
                iconos[i.getAttribute('name')] =
                    i.parentElement.textContent.replace(/\s+/g, ' ').trim();
            });
            // El logo de la empresa. El scraper aborta la descarga de imagenes
            // por peso, pero el atributo src sigue en el DOM igual.
            const img = a.querySelector('img');
            return {
                href: a.getAttribute('href'),
                logo: img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '',
                lineas: a.innerText.split('\n').map(s => s.trim()).filter(Boolean),
                iconos,
            };
        })"""
    )


def _logo_valido(bruto: str | None) -> str:
    """Normaliza la URL del logo y descarta los que no aportan nada.

    El portal sirve un SVG genérico ("empresa-pro") cuando la empresa no subió
    logo. Guardarlo sería peor que no guardar nada: la interfaz mostraria el
    mismo icono anonimo en decenas de filas en vez de la inicial, que al menos
    distingue una empresa de otra. Las rutas relativas se absolutizan, porque
    guardadas tal cual el navegador las resuelve contra el dashboard.
    """
    url = (bruto or "").strip()
    if not url:
        return ""
    if any(x in url.lower() for x in ("empresa-pro", "default", "placeholder", "no-image")):
        return ""
    if url.startswith("//"):
        return f"https:{url}"
    if url.startswith("/"):
        return f"{BASE}{url}"
    return url if url.startswith("http") else ""


def _tarjeta_a_job(t: dict, ahora: datetime) -> Job | None:
    lineas: list[str] = t.get("lineas", [])
    if not lineas:
        return None

    iconos: dict = t.get("iconos", {})
    ubicacion = iconos.get("icon-light-location-pin", "")
    modalidad = iconos.get("icon-light-office", "")  # Presencial | Remoto | Híbrido

    # Se descartan las líneas que no son contenido: la fecha, el rating y las
    # que solo repiten lo que ya sacamos de los iconos.
    fecha_txt = ""
    utiles: list[str] = []
    for linea in lineas:
        if _LINEA_FECHA.match(linea):
            fecha_txt = fecha_txt or linea
            continue
        if _LINEA_RATING.match(linea) or linea == ubicacion or linea == modalidad:
            continue
        utiles.append(linea)

    if not utiles:
        return None

    titulo = limpiar_titulo(utiles[0])
    if not titulo:
        return None
    empresa = utiles[1] if len(utiles) > 1 else ""

    # La descripción es, con diferencia, la línea más larga de la tarjeta.
    descripcion = max(utiles[2:], key=len, default="") if len(utiles) > 2 else ""
    if len(descripcion) < 80:
        descripcion = ""  # era un badge ("Postulación rápida"), no la descripción

    href = t.get("href", "")
    m = _ID_EN_URL.search(href)

    return Job(
        dedupe_key=calcular_dedupe_key(titulo, empresa),
        source="multitrabajos",
        source_id=m.group(1) if m else "",
        url=f"{BASE}{href}",
        company_logo=_logo_valido(t.get("logo")),
        title=titulo,
        company=empresa,
        location=ubicacion,
        is_remote=detectar_remoto(modalidad, titulo, ubicacion),
        is_internship=detectar_pasantia(titulo, descripcion[:600]),
        description=descripcion,
        posted_at=parsear_fecha(fecha_txt),
        scraped_at=ahora,
        tags=[modalidad] if modalidad else [],
    )


def recolectar(cfg: Config) -> list[Job]:
    from playwright.sync_api import sync_playwright

    ahora = datetime.now(timezone.utc)
    jobs: list[Job] = []

    with sync_playwright() as p:
        navegador = lanzar_navegador(p, cfg)
        ctx = contexto_navegador(navegador)
        page = ctx.new_page()
        page.route(
            re.compile(r"\.(png|jpe?g|gif|webp|woff2?|ttf|mp4)$"),
            lambda ruta: ruta.abort(),
        )

        try:
            for termino in cfg.terminos_locales:
                slug = _slug_busqueda(termino)
                for pagina in range(1, PAGINAS_MAX + 1):
                    url = f"{BASE}/empleos-busqueda-{slug}.html"
                    if pagina > 1:
                        url += f"?page={pagina}"

                    try:
                        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                        # Es React: el HTML inicial llega vacío y las tarjetas
                        # aparecen recién cuando hidrata.
                        page.wait_for_selector('a[href^="/empleos/"]', timeout=12_000)
                    except Exception as e:
                        log.debug("  multitrabajos %s p%d: %s", slug, pagina, type(e).__name__)
                        break

                    tarjetas = _extraer_tarjetas(page)
                    if not tarjetas:
                        break

                    for t in tarjetas:
                        job = _tarjeta_a_job(t, ahora)
                        if job:
                            jobs.append(job)

                    log.info("  multitrabajos / %r p%d -> %d", termino, pagina, len(tarjetas))
                    pausa(cfg.delay_min_seg, cfg.delay_max_seg)

                    if len(tarjetas) < 20:
                        break
        finally:
            ctx.close()
            navegador.close()

    return jobs
