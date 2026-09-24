# Базовый образ зафиксирован по digest: Debian 13 (trixie), Python 3.12.
FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea

# Конвертеру нужен только перевод PPT/PPTX/ODP в PDF (Impress без GUI) и poppler
# для PDF -> PNG и текста. Метапакет libreoffice тянул Writer, Calc, Base и GUI:
# 207 пакетов, 145 МБ; этот набор — 147 пакетов, 100 МБ.
# Версии зафиксированы до ветки: точная фиксация ломает сборку, как только Debian
# выпускает обновление безопасности и старый пакет пропадает из зеркала.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        "libreoffice-impress-nogui=4:25.2.*" \
        "poppler-utils=25.03.*" \
        "fonts-dejavu-core=2.37-*" \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY deploy/converter/server.py /app/server.py

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"
CMD ["python", "/app/server.py"]
