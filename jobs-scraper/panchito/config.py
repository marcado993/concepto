"""Configuracion de la recoleccion.

Recorte de la config del worker original: aca no hay base de datos, ni
perfil extraido del CV, ni aviso por WhatsApp — ese trabajo lo hace el
backend de NestJS. Solo queda QUE buscar, DONDE, y con cuanta cortesia.

Todo se puede pisar por variable de entorno para no tener que reconstruir
la imagen por cambiar un termino de busqueda.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field


def _lista_env(nombre: str, por_defecto: list[str]) -> list[str]:
    """Lee una lista desde el entorno, como JSON o separada por comas."""
    bruto = os.environ.get(nombre, "").strip()
    if not bruto:
        return por_defecto
    if bruto.startswith("["):
        try:
            valores = json.loads(bruto)
            if isinstance(valores, list):
                return [str(v).strip() for v in valores if str(v).strip()]
        except json.JSONDecodeError:
            pass
    return [p.strip() for p in bruto.split(",") if p.strip()]


def _num_env(nombre: str, por_defecto: float) -> float:
    try:
        return float(os.environ.get(nombre, "") or por_defecto)
    except ValueError:
        return por_defecto


@dataclass
class Config:
    # --- que buscar ---
    # Indeed y LinkedIn indexan por relevancia y aguantan frases largas.
    terminos: list[str] = field(
        default_factory=lambda: _lista_env(
            "SCRAPER_TERMINOS",
            [
                "pasantia desarrollo software",
                "pasante de sistemas",
                "practicante desarrollo software",
                "desarrollador junior",
                "programador junior",
                "pasante tecnologias de la informacion",
                "analista de datos junior",
                "pasante ciberseguridad",
                "soporte tecnico junior",
                "software engineer intern",
            ],
        )
    )

    # Multitrabajos, Computrabajo y la bolsa de la EPN hacen match casi
    # literal: "pasantia desarrollo software" devuelve 16 avisos, mientras
    # "pasante" devuelve cientos. Por eso los portales locales usan terminos
    # CORTOS y el filtrado fino lo hace despues el motor de relevancia del
    # backend, no la busqueda.
    terminos_locales: list[str] = field(
        default_factory=lambda: _lista_env(
            "SCRAPER_TERMINOS_LOCALES",
            [
                "pasante",
                "practicante",
                "trainee",
                "desarrollador",
                "programador",
                "sistemas",
                "tecnologia",
                "soporte tecnico",
                "datos",
                "redes",
                "ciberseguridad",
            ],
        )
    )

    # --- donde ---
    ubicacion_indeed: str = os.environ.get("SCRAPER_UBICACION", "Ecuador")
    ubicacion_linkedin: str = os.environ.get("SCRAPER_UBICACION", "Ecuador")
    pais_indeed: str = "Ecuador"

    # 720h = 30 dias. Mas atras, la vacante casi siempre ya esta cerrada.
    horas_antiguedad: int = int(_num_env("SCRAPER_HORAS_ANTIGUEDAD", 720))
    resultados_por_termino: int = int(_num_env("SCRAPER_RESULTADOS", 25))

    # La EPN va primera: es la de mayor senal, solo se compite con gente de
    # la propia universidad y varias empresas publican ahi pasantias que
    # nunca llegan a los portales generales.
    fuentes: list[str] = field(
        default_factory=lambda: _lista_env(
            "SCRAPER_FUENTES",
            ["epn", "indeed", "linkedin", "multitrabajos", "computrabajo"],
        )
    )

    # --- cortesia con los servidores ---
    # LinkedIn tumba la IP alrededor de la pagina 10. Estos delays existen
    # para que una corrida completa no parezca una rafaga automatizada.
    delay_min_seg: float = _num_env("SCRAPER_DELAY_MIN", 3.0)
    delay_max_seg: float = _num_env("SCRAPER_DELAY_MAX", 8.0)

    proxies: list[str] = field(default_factory=lambda: _lista_env("SCRAPER_PROXIES", []))

    # Sin descripcion el motor solo puede leer el titulo, y la diferencia de
    # puntaje es enorme. El costo es una peticion EXTRA por vacante contra
    # LinkedIn, que es justo la fuente que bloquea — por eso es una opcion y
    # no un default silencioso: si empiezan los bloqueos, se apaga esto
    # primero (SCRAPER_DESCRIPCIONES_LINKEDIN=0).
    descripciones_linkedin: bool = os.environ.get("SCRAPER_DESCRIPCIONES_LINKEDIN", "1") != "0"

    # Playwright no publica Chromium para Linux ARM64, que es lo que corre el
    # VPS (Oracle Ampere). Ahi hay que apuntar al binario del sistema; la
    # imagen de este servicio lo instala y define la variable.
    ruta_chromium: str = os.environ.get("SCRAPER_CHROMIUM", "")
