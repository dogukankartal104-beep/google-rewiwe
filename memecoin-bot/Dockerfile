FROM python:3.11-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    MBOT_DB_PATH=/data/mbot.db \
    MBOT_MODEL_DIR=/data/models \
    MBOT_HUBS_FILE=/data/hubs.txt

COPY pyproject.toml ./
COPY mbot ./mbot
RUN pip install --no-cache-dir '.[ml]'

# MBOT_MODE: paper (veri topla + skorla + paper işlem, varsayılan) veya collect (sadece veri)
CMD python -m mbot ${MBOT_MODE:-paper}
