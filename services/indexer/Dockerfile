# syntax=docker/dockerfile:1.6

FROM rust:1.77-slim-bullseye AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN addgroup --system indexer && adduser --system --ingroup indexer --home /app indexer \
    && apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
USER indexer:indexer
WORKDIR /app
COPY --from=build /app/target/release/ossaat-indexer /usr/local/bin/indexer
EXPOSE 7070
ENV RUST_LOG=info
ENTRYPOINT ["/usr/local/bin/indexer"]
