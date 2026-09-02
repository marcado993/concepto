"""Normalización: convierte datos crudos de cualquier sitio al esquema unificado.

Cada sitio entrega los campos con formato distinto (fechas relativas en español,
salarios como texto libre, nombres de empresa con sufijos legales). Aquí se
aplanan todos a la misma forma para que la deduplicación funcione.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import date, timedelta

# Sufijos legales que ensucian el nombre de la empresa y rompen el dedupe:
# "Kruger Corp S.A." y "KRUGER CORP" son la misma empresa.
_SUFIJOS_EMPRESA = re.compile(
    r"\b(s\.?a\.?s?|c\.?a\.?|cia\.?|compania|ltda?\.?|s\.?r\.?l\.?|inc\.?|llc|corp\.?|"
    r"corporation|group|grupo|ecuador|ec)\b\.?",
    re.IGNORECASE,
)

# Ruido que los portales meten en el título: "(Quito)", "- Urgente", "¡Nuevo!".
_RUIDO_TITULO = re.compile(
    r"\b(urgente|nuevo|inmediato|inmediata|vacante|se\s+busca|se\s+solicita|"
    r"contratacion\s+inmediata|postula\s+ya)\b",
    re.IGNORECASE,
)

_PALABRAS_REMOTO = re.compile(
    r"\b(remoto|remota|teletrabajo|home\s*office|desde\s+casa|work\s+from\s+home|remote)\b",
    re.IGNORECASE,
)

# Los avisos alternan singular y plural sin criterio ("Pasante de Sistemas" vs
# "Pasantes - Tecnología"), así que cada variante lleva su plural.
# El texto llega ya sin acentos desde detectar_pasantia, por eso no se escriben.
_PALABRAS_PASANTIA = re.compile(
    r"\b(pasantias?|pasantes?|practicantes?|practicas?\s+(pre)?profesionales?|"
    r"interns?(hips?)?|trainees?|becarios?)\b",
    re.IGNORECASE,
)


def quitar_acentos(texto: str) -> str:
    """'Ingeniería' -> 'Ingenieria'. Necesario porque los portales escriben
    el mismo puesto con y sin tildes."""
    nfkd = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def slug(texto: str) -> str:
    """Forma canónica para comparar: sin acentos, minúsculas, solo alfanumérico."""
    texto = quitar_acentos(texto or "").lower()
    texto = re.sub(r"[^a-z0-9\s]", " ", texto)
    return re.sub(r"\s+", " ", texto).strip()


def limpiar_titulo(titulo: str) -> str:
    titulo = _RUIDO_TITULO.sub(" ", titulo or "")
    titulo = re.sub(r"[\(\[\{].*?[\)\]\}]", " ", titulo)   # "(Quito)", "[Remoto]"
    titulo = re.sub(r"\s*[-–|/]\s*$", "", titulo)
    return re.sub(r"\s+", " ", titulo).strip()


def limpiar_empresa(empresa: str) -> str:
    empresa = _SUFIJOS_EMPRESA.sub(" ", empresa or "")
    empresa = re.sub(r"[.,]", " ", empresa)
    return re.sub(r"\s+", " ", empresa).strip()


def calcular_dedupe_key(titulo: str, empresa: str) -> str:
    """La misma vacante publicada en Indeed y LinkedIn debe colapsar a una sola fila.

    Se usa título + empresa (sin la fuente) porque el objetivo explícito es cruzar
    fuentes. Si la empresa viene vacía cae al título solo, que es más agresivo pero
    evita duplicar avisos anónimos del mismo puesto.
    """
    t = slug(limpiar_titulo(titulo))
    e = slug(limpiar_empresa(empresa))
    base = f"{t}|{e}" if e else t
    return hashlib.sha1(base.encode("utf-8")).hexdigest()[:16]


def detectar_remoto(*textos: str) -> bool:
    return any(_PALABRAS_REMOTO.search(t or "") for t in textos)


def detectar_pasantia(*textos: str) -> bool:
    # Se quitan los acentos antes de comparar: el mismo puesto aparece como
    # "pasantía", "pasantia" y "PASANTÍA" según quién publicó el aviso.
    return any(_PALABRAS_PASANTIA.search(quitar_acentos(t or "")) for t in textos)


# --------------------------------------------------------------------------
# Fechas
# --------------------------------------------------------------------------

_RELATIVA = re.compile(
    r"(?:hace\s+)?(\d+)\s*\+?\s*(minuto|hora|d[ií]a|semana|mes|a[nñ]o)",
    re.IGNORECASE,
)
_UNIDAD_DIAS = {"minuto": 0, "hora": 0, "dia": 1, "día": 1, "semana": 7, "mes": 30, "ano": 365, "año": 365}


def parsear_fecha_relativa(texto: str, hoy: date | None = None) -> date | None:
    """'hace 3 días' -> 2026-08-29. Los portales locales casi nunca dan fecha absoluta."""
    if not texto:
        return None
    hoy = hoy or date.today()
    t = quitar_acentos(texto).lower()

    if "hoy" in t or "ahora" in t or "reciente" in t or "minuto" in t:
        return hoy
    if "ayer" in t:
        return hoy - timedelta(days=1)

    m = _RELATIVA.search(t)
    if not m:
        return None
    cantidad = int(m.group(1))
    unidad = quitar_acentos(m.group(2)).lower()
    return hoy - timedelta(days=cantidad * _UNIDAD_DIAS.get(unidad, 0))


# --------------------------------------------------------------------------
# Salario
# --------------------------------------------------------------------------

_NUMERO = r"\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?"
_RANGO = re.compile(rf"({_NUMERO})\s*(?:-|a|hasta|–)\s*({_NUMERO})", re.IGNORECASE)
_SUELTO = re.compile(rf"({_NUMERO})")


def _a_float(texto: str) -> float | None:
    """'1.200,50' y '1,200.50' significan lo mismo.

    Regla: un separador seguido de 1-2 dígitos al final es el decimal;
    cualquier otro separador es de miles.
    """
    if not texto:
        return None
    t = texto.strip()
    m = re.search(r"[.,](\d{1,2})$", t)
    if m:
        entero = re.sub(r"[.,]", "", t[: m.start()]) or "0"
        decimal = m.group(1)
    else:
        entero = re.sub(r"[.,]", "", t) or "0"
        decimal = "0"
    try:
        return float(f"{entero}.{decimal}")
    except ValueError:
        return None


def parsear_salario(texto: str) -> tuple[float | None, float | None, str | None]:
    """Devuelve (min, max, moneda). Ecuador usa USD, así que es el default
    cuando aparece '$' sin más contexto."""
    if not texto:
        return None, None, None

    t = quitar_acentos(texto).lower()
    if re.search(r"\b(a\s+convenir|negociable|no\s+especificado|confidencial)\b", t):
        return None, None, None

    moneda = "USD" if ("$" in t or "usd" in t or "dolar" in t) else None

    m = _RANGO.search(t)
    if m:
        return _a_float(m.group(1)), _a_float(m.group(2)), moneda or "USD"

    m = _SUELTO.search(t)
    if m:
        valor = _a_float(m.group(1))
        # Un número de 1-2 dígitos casi nunca es un sueldo mensual; suele ser
        # "40 horas" o "2 años de experiencia" colado en el mismo texto.
        if valor is not None and valor >= 100:
            return valor, None, moneda or "USD"

    return None, None, None


_MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}

_ABSOLUTA = re.compile(
    r"\b(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?", re.IGNORECASE
)


def parsear_fecha_absoluta(texto: str, hoy: date | None = None) -> date | None:
    """'7 de agosto' -> 2026-08-07. Computrabajo deja de usar fechas relativas
    pasada una semana y cambia a este formato, casi siempre sin año."""
    if not texto:
        return None
    hoy = hoy or date.today()
    m = _ABSOLUTA.search(quitar_acentos(texto).lower())
    if not m:
        return None

    dia = int(m.group(1))
    mes = _MESES.get(m.group(2))
    if not mes:
        return None

    anio = int(m.group(3)) if m.group(3) else hoy.year
    try:
        fecha = date(anio, mes, dia)
    except ValueError:
        return None

    # Sin año explícito, una fecha futura significa que es del año pasado:
    # en enero, "20 de diciembre" es del diciembre anterior.
    if not m.group(3) and fecha > hoy:
        try:
            fecha = date(anio - 1, mes, dia)
        except ValueError:
            return None
    return fecha


_NUMERICA = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b")


def parsear_fecha_numerica(texto: str) -> date | None:
    """'24/08/2026' -> 2026-08-24.

    Se interpreta como día/mes/año, que es el orden que usa Ecuador. Con
    día ≤ 12 el dato es ambiguo y no hay forma de resolverlo desde el texto;
    se asume el orden local, que es el correcto para todas estas fuentes.
    """
    if not texto:
        return None
    m = _NUMERICA.search(texto)
    if not m:
        return None
    dia, mes, anio = (int(g) for g in m.groups())
    try:
        return date(anio, mes, dia)
    except ValueError:
        return None


def parsear_fecha(texto: str, hoy: date | None = None) -> date | None:
    """Punto de entrada único: los portales mezclan los tres formatos, a veces
    dentro de la misma lista de resultados según la antigüedad del aviso."""
    return (
        parsear_fecha_relativa(texto, hoy)
        or parsear_fecha_absoluta(texto, hoy)
        or parsear_fecha_numerica(texto)
    )
