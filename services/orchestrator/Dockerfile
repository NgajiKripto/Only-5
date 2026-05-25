FROM golang:1.21 AS builder

WORKDIR /app

COPY go.mod ./
COPY cmd/ ./cmd/
COPY internal/ ./internal/

RUN CGO_ENABLED=0 go build -o orchestrator ./cmd/server/

FROM gcr.io/distroless/static-debian12

COPY --from=builder /app/orchestrator /usr/local/bin/orchestrator

EXPOSE 7002

CMD ["orchestrator"]
