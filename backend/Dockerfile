FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY algo/ ./algo/
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/

RUN chmod +x backend/docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["backend/docker-entrypoint.sh"]
