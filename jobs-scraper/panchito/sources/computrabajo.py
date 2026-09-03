"""Computrabajo Ecuador (ec.computrabajo.com).

Estructura verificada el 2026-09-01:
  - Búsqueda:    /trabajo-de-<termino-en-slug>
  - Paginación:  ?p=N
  - Tarjeta:     article[data-id]  (20 por página)
      título   -> h2 a.js-o-link
      empresa  -> p.dFlex a          (ausente si el aviso es confidencial)
      lugar    -> el <p> siguiente al de empresa
      fecha    -> p.fc_aux           ("Hace 2 horas" | "Ayer" | "7 de agosto")

El salario NO aparece en el listado, solo en el detalle de cada oferta; entrar a
cada detalle multiplicaría los requests por 20, así que se deja vacío.
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

BASE = "https://ec.computrabajo.com"
PAGINAS_MAX = 3  # 20 avisos por página; más atrás la relevancia cae en picada


def _slug_busqueda(termino: str) -> str:
    """'pasantia desarrollo software' -> 'pasantia-desarrollo-software'."""
    t = quitar_acentos(termino).lower()
    t = re.sub(r"[^a-z0-9]+", "-", t)
    return t.strip("-")


def _extraer_tarjetas(page) -> list[dict]:
    """Se extrae todo en un solo evaluate: cruzar el puente Python<->JS por cada
    campo de cada tarjeta es órdenes de magnitud más lento."""
    return page.evaluate(
        r"""() => [...document.querySelectorAll('article[data-id]')].map(a => {
            const enlace = a.querySelector('h2 a');
            const empresa = a.querySelector('p.dFlex a');
            const parrafos = [...a.querySelectorAll('p')]
                .map(p => p.textContent.replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            const fecha = a.querySelector('p.fc_aux');
            // El <p> de la empresa lleva un <a> dentro; el del lugar, un <span>.
            // Distinguirlos por estructura evita confundir el lugar con el
            // nombre de la empresa cuando viene con el rating pegado ("4,3 ACME").
            const lugar = [...a.querySelectorAll('p')].find(
                p => !p.querySelector('a') && p !== fecha && p.querySelector('span')
            );
            return {
                id: a.dataset.id || '',
                titulo: enlace ? enlace.textContent.trim() : '',
                href: enlace ? enlace.getAttribute('href') : '',
                empresa: empresa ? empresa.textContent.trim() : '',
                ubicacion: lugar ? lugar.textContent.replace(/\s+/g, ' ').trim() : '',
                parrafos,
                fecha: fecha ? fecha.textContent.replace(/\s+/g, ' ').trim() : '',
            };
        })"""
    )


def _extracto(parrafos: list[str], ubicacion: str, fecha: str, empresa: str) -> str:
    """El párrafo más largo que NO sea un dato que ya tenemos aparte.

    Se descartan ubicación, fecha y empresa porque ya viajan en sus propios
    campos: repetirlos como "descripción" solo le daría al motor las mismas
    señales dos veces, y ninguna de ellas dice de qué trata el puesto.

    El mínimo de 60 caracteres evita quedarse con una etiqueta suelta
    ("Postulación rápida", "Contrato fijo") y llamarla descripción.
    """
    ya_conocidos = {t.strip() for t in (ubicacion, fecha, empresa) if t}
    candidatos = [p for p in parrafos if p and p.strip() not in ya_conocidos]
    if not candidatos:
        return ""
    mejor = max(candidatos, key=len)
    return mejor if len(mejor) >= 60 else ""


def _tarjeta_a_job(t: dict, ahora: datetime) -> Job | None:
    titulo = limpiar_titulo(t.get("titulo", ""))
    if not titulo:
        return None

    empresa = t.get("empresa", "")
    parrafos = t.get("parrafos", [])

    ubicacion = t.get("ubicacion", "")

    href = t.get("href", "")
    url = href if href.startswith("http") else f"{BASE}{href}"
    url = url.split("#")[0]  # el ancla #lc=ListOffers-... es tracking de la sesión

    # Extracto de la tarjeta como descripción.
    #
    # Los párrafos ya se extraían, pero solo se usaban para detectar si era
    # remoto y después se tiraban. Guardarlos cambia el resultado por
    # completo: SIN descripción el motor de relevancia solo puede leer el
    # título, y medido contra datos reales las 572 ofertas descartadas de
    # esta fuente y la EPN eran TODAS sin descripción — "Administrador/a de
    # redes" caía por no tener ni una línea que leer.
    #
    # No es la descripción completa (esa vive en el detalle, y entrar a cada
    # aviso multiplicaría los requests por 20), pero el extracto de la
    # tarjeta ya trae el área y a veces el stack, que es lo que el motor
    # necesita.
    descripcion = _extracto(parrafos, ubicacion, t.get("fecha", ""), empresa)

    return Job(
        dedupe_key=calcular_dedupe_key(titulo, empresa),
        source="computrabajo",
        source_id=t.get("id", ""),
        url=url,
        title=titulo,
        company=empresa,
        location=ubicacion,
        is_remote=detectar_remoto(titulo, ubicacion, " ".join(parrafos)),
        is_internship=detectar_pasantia(titulo, descripcion),
        description=descripcion,
        posted_at=parsear_fecha(t.get("fecha", "")),
        scraped_at=ahora,
    )


def recolectar(cfg: Config) -> list[Job]:
    from playwright.sync_api import sync_playwright

    ahora = datetime.now(timezone.utc)
    jobs: list[Job] = []

    with sync_playwright() as p:
        navegador = lanzar_navegador(p, cfg)
        ctx = contexto_navegador(navegador)
        page = ctx.new_page()
        # Imágenes y fuentes son el grueso del peso y no aportan nada al scraping.
        page.route(
            re.compile(r"\.(png|jpe?g|gif|webp|svg|woff2?|ttf|mp4)$"),
            lambda ruta: ruta.abort(),
        )

        try:
            for termino in cfg.terminos_locales:
                slug = _slug_busqueda(termino)
                for pagina in range(1, PAGINAS_MAX + 1):
                    url = f"{BASE}/trabajo-de-{slug}"
                    if pagina > 1:
                        url += f"?p={pagina}"

                    try:
                        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                        page.wait_for_selector("article[data-id]", timeout=8_000)
                    except Exception as e:
                        # Sin resultados para ese término, o nos cortaron. Ambos
                        # casos significan lo mismo: pasar al siguiente término.
                        log.debug("  computrabajo %s p%d: %s", slug, pagina, type(e).__name__)
                        break

                    tarjetas = _extraer_tarjetas(page)
                    if not tarjetas:
                        break

                    for t in tarjetas:
                        job = _tarjeta_a_job(t, ahora)
                        if job:
                            jobs.append(job)

                    log.info("  computrabajo / %r p%d -> %d", termino, pagina, len(tarjetas))
                    pausa(cfg.delay_min_seg, cfg.delay_max_seg)

                    if len(tarjetas) < 20:
                        break  # última página
        finally:
            ctx.close()
            navegador.close()

    return jobs
