# Scraper de ofertas (JobSpy) — servicio interno, nunca expuesto al host.
#
# Imagen "slim" y no "alpine": JobSpy arrastra pandas/numpy, que en Alpine
# (musl) no tienen rueda precompilada y obligan a compilarlos desde fuente —
# la build pasaba de ~1 minuto a mas de 15 en el ARM del VPS. Con slim
# (glibc) las ruedas oficiales sirven tal cual.
FROM python:3.12-slim

# PYTHONUNBUFFERED: sin esto los logs se quedan en el buffer y `docker logs`
# no muestra nada hasta que el proceso muere — justo cuando mas hacen falta.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# requirements aparte del codigo para que cambiar app.py no invalide la capa
# de dependencias (que es la cara: compila e instala pandas).
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./

# Usuario sin privilegios — mismo criterio que el backend (ver
# backend/Dockerfile). Un scraper procesa HTML de terceros: es de los
# procesos que menos conviene correr como root.
RUN useradd --create-home --shell /usr/sbin/nologin scraper \
    && chown -R scraper:scraper /app
USER scraper

EXPOSE 8000

# Un solo worker a proposito: el paralelismo real ya lo maneja el
# ThreadPoolExecutor de app.py, acotado para no gatillar el rate limiting de
# las bolsas. Varios workers de uvicorn multiplicarian ese paralelismo por
# detras y anularian ese limite.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
