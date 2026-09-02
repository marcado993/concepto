# Scraper de ofertas de empleo — servicio interno, nunca expuesto al host.
#
# Imagen "slim" y no "alpine": JobSpy arrastra pandas/numpy, que en Alpine
# (musl) no tienen rueda precompilada y obligan a compilarlos desde fuente —
# la build pasaba de ~1 minuto a mas de 15 en el ARM del VPS. Con slim
# (glibc) las ruedas oficiales sirven tal cual.
# Release de Debian FIJO, no "slim" a secas.
#
# `python:3.12-slim` es una etiqueta movil: apunta al Debian estable del
# momento y salto de bookworm a trixie (Debian 13) sin aviso. Eso NO es
# teorico — rompio esta imagen: en trixie varias librerias de Chromium
# cambiaron de nombre por la transicion time_t de 64 bits (libasound2 ->
# libasound2t64, libcups2 -> libcups2t64, libatk...-0 -> ...-0t64), y
# `libasound2` paso a "Candidate: (none)". La build seguia pasando en local
# con la base vieja cacheada mientras habria fallado en el VPS, que hace
# pull limpio. Fijando el release, la imagen solo cambia cuando alguien lo
# decide.
FROM python:3.12-slim-trixie

# Parches del SO en cada build, mismo criterio que backend/Dockerfile: entre
# un despliegue y otro puede pasar un mes, y las CVEs de la imagen base se
# acumulan hasta bloquear un deploy que no tiene nada que ver.
RUN apt-get update && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/*

# PYTHONUNBUFFERED: sin esto los logs se quedan en el buffer y `docker logs`
# no muestra nada hasta que el proceso muere — justo cuando mas hacen falta.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Chromium del SISTEMA, no el que baja Playwright.
#
# El VPS es Oracle Ampere (Linux ARM64) y Playwright no publica build de
# Chromium para esa arquitectura: `playwright install chromium` falla o baja
# un binario x86 que no ejecuta. El Chromium de Debian si tiene paquete
# arm64, asi que se instala por apt y se le apunta con SCRAPER_CHROMIUM
# (ver panchito/sources/base.py::lanzar_navegador, que ademas agrega
# --no-sandbox porque dentro del contenedor no hay sandbox de kernel).
#
# Las libs de abajo no son opcionales: Chromium headless no arranca sin
# ellas y falla con un "error while loading shared libraries" que no dice
# cual falta.
#
# Los sufijos "t64" son obligatorios en trixie: la transicion a time_t de
# 64 bits renombro estos paquetes, y los nombres viejos ya no tienen
# candidato instalable (verificado con `apt-cache policy` contra la base
# real). Sin ellos la build falla con "has no installation candidate".
RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium \
        fonts-liberation \
        libnss3 libnspr4 \
        libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libasound2t64 \
        libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
        libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*

ENV SCRAPER_CHROMIUM=/usr/bin/chromium

WORKDIR /app

# requirements aparte del codigo para que cambiar app.py no invalide la capa
# de dependencias (que es la cara: compila e instala pandas).
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./
COPY panchito ./panchito

# Usuario sin privilegios — mismo criterio que el backend. Un scraper
# procesa HTML de terceros dentro de un navegador real: es de los procesos
# que menos conviene correr como root.
RUN useradd --create-home --shell /usr/sbin/nologin scraper \
    && chown -R scraper:scraper /app
USER scraper

EXPOSE 8000

# Un solo worker a proposito: el paralelismo real ya lo maneja el
# ThreadPoolExecutor de app.py, acotado para no gatillar el rate limiting de
# los portales. Varios workers de uvicorn multiplicarian ese paralelismo por
# detras y anularian ese limite.
#
# --timeout-keep-alive alto: una corrida completa levanta Chromium contra
# tres portales con pausas de cortesia entre paginas y pasa de los 10
# minutos. Con el default (5s) uvicorn cortaba la conexion antes de que el
# backend recibiera la respuesta.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--timeout-keep-alive", "1200"]
