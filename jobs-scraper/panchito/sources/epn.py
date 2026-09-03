"""Bolsa de empleo de la Escuela Politécnica Nacional (epn.hiringroomcampus.com).

Corre sobre HiringRoom Campus, la plataforma que la EPN usa para publicar
ofertas dirigidas a sus propios estudiantes y egresados. Es la fuente de mayor
señal del proyecto: no hay que competir con todo el país, solo con gente de la
misma universidad, y muchas empresas publican aquí pasantías que no aparecen en
los portales generales.

El sitio es público — no exige sesión para ver el listado.

Estructura verificada el 2026-09-02:
  - Búsqueda:    /jobs?q=<termino>
  - Paginación:  &page=N  (10 avisos por página)
  - Tarjeta:     a.item-block
      título   -> h4
      empresa  -> h5
      lugar    -> .location        ("Quito - Pichincha, Ecuador")
      fecha    -> .publish_time    ("Publicado en 24/08/2026")
      tipo     -> .label           ("Pasantía", "Intern", "FULL-TIME", "EVENTUAL")
      logo     -> header img
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

BASE = "https://epn.hiringroomcampus.com"
POR_PAGINA = 10
PAGINAS_MAX = 4  # 40 avisos por término; la bolsa entera ronda los 400

# El propio HiringRoom sirve un marcador cuando la empresa no subió logo.
#
# El patrón real que devuelve el sitio es "../assets/img/no-company-logo.png"
# y la versión anterior de esta regex (no-logo|nologo|default) NO lo cazaba:
# "no-company-logo" no contiene "no-logo". Resultado medido en producción:
# 161 de 162 ofertas de la EPN llegaban con ese placeholder como si fuera un
# logo real. No se vio roto de casualidad — la ruta es relativa y el backend
# descarta lo que no sea http(s) — pero el día que HiringRoom lo sirva
# absoluto, la lista entera mostraría el mismo icono anónimo en vez de la
# inicial de cada empresa, que es justo lo que este filtro existe para
# evitar.
_LOGO_PLACEHOLDER = re.compile(r"no-?company-?logo|no-?logo|nologo|default|placeholder", re.IGNORECASE)


def _extraer_tarjetas(page) -> list[dict]:
    return page.evaluate(
        r"""() => [...document.querySelectorAll('a.item-block')].map(c => ({
            href:     c.getAttribute('href') || '',
            titulo:   c.querySelector('h4')?.textContent.trim() || '',
            empresa:  c.querySelector('h5')?.textContent.trim() || '',
            lugar:    c.querySelector('.location')?.textContent.replace(/\s+/g, ' ').trim() || '',
            fecha:    c.querySelector('.publish_time')?.textContent.replace(/\s+/g, ' ').trim() || '',
            etiquetas:[...c.querySelectorAll('.label')].map(e => e.textContent.trim()),
            logo:     c.querySelector('img')?.getAttribute('src') || '',
            texto:    (c.innerText || '').replace(/\s+/g, ' ').trim(),
        }))"""
    )


def _limpiar_texto(texto: str, titulo: str, empresa: str, lugar: str, etiquetas: list[str]) -> str:
    """Deja del texto de la tarjeta solo lo que aporta algo nuevo.

    `innerText` trae el título, la empresa, el lugar y las etiquetas
    repetidos, porque están dentro de la misma tarjeta. Dárselos al motor
    otra vez como "descripción" solo duplicaría señales que ya cuenta por
    su cuenta.
    """
    if not texto:
        return ""
    fuera = [titulo, empresa, lugar, *etiquetas]
    limpio = texto
    for parte in fuera:
        if parte:
            limpio = limpio.replace(parte, " ")
    limpio = " ".join(limpio.split())
    # Menos de 30 caracteres es ruido de maquetación, no una descripción.
    return limpio if len(limpio) >= 30 else ""


def _tarjeta_a_job(t: dict, ahora: datetime) -> Job | None:
    titulo = limpiar_titulo(t.get("titulo", ""))
    if not titulo:
        return None

    empresa = t.get("empresa", "")
    etiquetas = [e for e in t.get("etiquetas", []) if e]
    # "Quito - Pichincha, Ecuador" -> "Quito, Pichincha", que es como lo
    # escriben las otras fuentes. El país sobra: todo el proyecto es Ecuador.
    lugar = t.get("lugar", "").replace(", Ecuador", "").replace(" - ", ", ").strip()

    href = t.get("href", "")
    url = href if href.startswith("http") else f"{BASE}{href}"
    # El id va al final del slug: /jobs/pasante-de-calidad-6a95eb5c2c670
    m = re.search(r"-([0-9a-f]{8,})$", href)

    logo = (t.get("logo") or "").strip()
    if _LOGO_PLACEHOLDER.search(logo):
        logo = ""

    # Texto de la tarjeta como descripción, quitando lo que ya viaja en sus
    # propios campos. Sin esto el motor solo podía leer el título, y una
    # vacante como "Pasante de Ingeniería - Automatización de Sistemas" no
    # tenía ni una línea donde encontrar de qué área era.
    descripcion = _limpiar_texto(t.get("texto", ""), titulo, empresa, lugar, etiquetas)

    return Job(
        dedupe_key=calcular_dedupe_key(titulo, empresa),
        source="epn",
        source_id=m.group(1) if m else "",
        url=url,
        company_logo=logo,
        title=titulo,
        company=empresa,
        location=lugar,
        is_remote=detectar_remoto(titulo, lugar, " ".join(etiquetas)),
        # La plataforma etiqueta el tipo de contrato, así que aquí no hay que
        # adivinarlo desde el título como en los portales generales.
        is_internship=(
            any(quitar_acentos(e).lower() in ("pasantia", "intern", "trainee")
                for e in etiquetas)
            or detectar_pasantia(titulo)
        ),
        description=descripcion,
        posted_at=parsear_fecha(t.get("fecha", "")),
        scraped_at=ahora,
        tags=etiquetas,
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
                for pagina in range(1, PAGINAS_MAX + 1):
                    url = f"{BASE}/jobs?q={termino.replace(' ', '+')}"
                    if pagina > 1:
                        url += f"&page={pagina}"

                    try:
                        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                        # Es React: el HTML inicial llega sin tarjetas.
                        page.wait_for_selector("a.item-block", timeout=12_000)
                    except Exception as e:
                        log.debug("  epn %s p%d: %s", termino, pagina, type(e).__name__)
                        break

                    tarjetas = _extraer_tarjetas(page)
                    if not tarjetas:
                        break

                    for t in tarjetas:
                        job = _tarjeta_a_job(t, ahora)
                        if job:
                            jobs.append(job)

                    log.info("  epn / %r p%d -> %d", termino, pagina, len(tarjetas))
                    pausa(cfg.delay_min_seg, cfg.delay_max_seg)

                    if len(tarjetas) < POR_PAGINA:
                        break  # última página
        finally:
            ctx.close()
            navegador.close()

    return jobs
