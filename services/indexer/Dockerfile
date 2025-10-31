# syntax=docker/dockerfile:1.6
FROM rust:1.78-bullseye AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
RUN cargo fetch

COPY src ./src
RUN cargo build --release

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=builder /app/target/release/indexer /bin/indexer
ENV RUST_LOG=info

ENTRYPOINT ["/bin/indexer"]
