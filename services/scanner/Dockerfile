FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --no-cache-dir .

COPY scanner/ ./scanner/

EXPOSE 7001

CMD ["uvicorn", "scanner.main:app", "--host", "0.0.0.0", "--port", "7001"]
