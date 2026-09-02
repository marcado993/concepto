"""Utilidades compartidas por los scrapers propios."""

from __future__ import annotations

import random
import time

# Un User-Agent de escritorio real. El default de Playwright incluye
# "HeadlessChrome", que es la señal más barata de detectar.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def pausa(minimo: float, maximo: float) -> None:
    """Espera un rato variable. Un intervalo fijo entre requests es, por sí solo,
    una huella de bot."""
    time.sleep(random.uniform(minimo, maximo))


def lanzar_navegador(p, cfg):
    """Abre Chromium respetando la ruta configurada.

    En el VPS (Linux ARM64) Playwright no tiene binario propio, así que se usa
    el Chromium que instala el sistema. Los flags extra son los que hacen falta
    para correr headless dentro de un contenedor/VM sin sandbox de kernel.
    """
    opciones: dict = {"headless": True}
    if getattr(cfg, "ruta_chromium", ""):
        opciones["executable_path"] = cfg.ruta_chromium
        opciones["args"] = ["--no-sandbox", "--disable-dev-shm-usage"]
    return p.chromium.launch(**opciones)


def contexto_navegador(browser, **extra):
    """Contexto con los parches mínimos anti-detección."""
    ctx = browser.new_context(
        user_agent=USER_AGENT,
        locale="es-EC",
        timezone_id="America/Guayaquil",
        viewport={"width": 1366, "height": 768},
        **extra,
    )
    # navigator.webdriver === true delata a Playwright de inmediato.
    ctx.add_init_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
        "Object.defineProperty(navigator, 'languages', {get: () => ['es-EC','es','en']});"
    )
    return ctx
