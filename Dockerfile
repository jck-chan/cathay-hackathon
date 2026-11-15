FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
RUN useradd --system --user-group relay
COPY --chown=relay:relay v13/ ./v13/

USER relay
EXPOSE 8766

CMD ["python", "v13/server.py", "--host", "0.0.0.0", "--port", "8766"]
