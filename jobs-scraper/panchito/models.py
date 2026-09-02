"""Esquema unificado de vacantes.

Toda vacante, venga de JobSpy o de un scraper propio, termina como un `Job`.
Los scrapers devuelven `Job`s ya normalizados; la base de datos guarda exactamente
estos campos.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from datetime import date, datetime
from typing import Any


# Estados del seguimiento de postulación.
STATUS_NUEVO = "nuevo"
STATUS_APLICADO = "aplicado"
STATUS_DESCARTADO = "descartado"
STATUS_ENTREVISTA = "entrevista"

STATUSES = (STATUS_NUEVO, STATUS_APLICADO, STATUS_DESCARTADO, STATUS_ENTREVISTA)


@dataclass(slots=True)
class Job:
    # --- identidad ---
    dedupe_key: str = ""          # hash titulo+empresa, se calcula en normalize
    source: str = ""              # indeed | linkedin | multitrabajos | computrabajo
    source_id: str = ""           # id nativo del sitio, si lo expone
    url: str = ""
    # URL del logo de la empresa. JobSpy lo trae en `company_logo`;
    # Multitrabajos y Computrabajo lo llevan en el <img> de la tarjeta.
    company_logo: str = ""

    # --- contenido ---
    title: str = ""
    company: str = ""
    location: str = ""
    is_remote: bool = False
    is_internship: bool = False
    description: str = ""

    # --- salario ---
    salary_min: float | None = None
    salary_max: float | None = None
    salary_currency: str | None = None
    salary_raw: str | None = None

    # --- fechas ---
    posted_at: date | None = None      # lo que reporta el sitio
    scraped_at: datetime | None = None # cuando lo trajimos

    # --- seguimiento (lo maneja el dashboard, el scraper nunca lo pisa) ---
    status: str = STATUS_NUEVO
    score: float = 0.0
    notes: str = ""
    tags: list[str] = field(default_factory=list)

    def to_row(self) -> dict[str, Any]:
        """Aplana el Job a un dict listo para SQLite."""
        row = asdict(self)
        row["tags"] = json.dumps(self.tags, ensure_ascii=False)
        row["is_remote"] = int(self.is_remote)
        row["is_internship"] = int(self.is_internship)
        row["posted_at"] = self.posted_at.isoformat() if self.posted_at else None
        row["scraped_at"] = self.scraped_at.isoformat() if self.scraped_at else None
        return row
