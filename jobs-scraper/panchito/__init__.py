"""Scrapers de bolsas de empleo ecuatorianas.

Portado desde el proyecto Panchito GPT (worker propio del usuario), que ya
tenia resueltos los scrapers de Bolsa EPN, Multitrabajos y Computrabajo —
las tres fuentes que de verdad publican pasantias para estudiantes de la
EPN y que ninguna API publica cubre.

Que cambia respecto del original: alla el worker era autonomo (SQLite
propio, scoring contra el CV, aviso por WhatsApp, CLI). Aca es solo la capa
de RECOLECCION: expone las fuentes por HTTP y el backend de NestJS se
encarga del resto (puntuar, deduplicar, guardar, servir). Por eso no se
portaron db.py, score.py, perfil.py, notify.py ni cli.py — esas
responsabilidades ya viven en backend/src/jobs/.
"""
