FROM rust:1.75 AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock* ./
COPY src/ ./src/

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/executor /usr/local/bin/executor

EXPOSE 7003

CMD ["executor"]
