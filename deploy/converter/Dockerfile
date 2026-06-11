FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice \
        poppler-utils \
        fonts-dejavu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY deploy/converter/server.py /app/server.py

EXPOSE 8000
CMD ["python", "/app/server.py"]
