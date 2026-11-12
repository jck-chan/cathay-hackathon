FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt \
    && useradd --system --user-group relay

COPY . .
RUN chown relay:relay /app/data

USER relay
EXPOSE 8766

CMD ["python", "-m", "uvicorn", "fusion_app:app", "--host", "0.0.0.0", "--port", "8766", "--workers", "1"]
