FROM rust:1.75 AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock* ./
COPY src/ ./src/

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*

RUN groupadd -r executor && useradd -r -g executor -d /nonexistent -s /usr/sbin/nologin executor

COPY --from=builder /app/target/release/executor /usr/local/bin/executor

USER executor

EXPOSE 7003

CMD ["executor"]
