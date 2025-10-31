# syntax=docker/dockerfile:1.6
ARG GO_VERSION=1.22.5
FROM golang:${GO_VERSION}-bookworm AS builder

WORKDIR /src

ENV CGO_ENABLED=0 \
    GOOS=linux \
    GOARCH=amd64

COPY go.work go.work.sum ./
COPY apps/gateway-api/go.mod apps/gateway-api/go.sum apps/gateway-api/
RUN go mod download

COPY apps/gateway-api ./apps/gateway-api
RUN go build -trimpath -ldflags="-s -w" -o /out/gateway-api ./apps/gateway-api

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /out/gateway-api /gateway-api

EXPOSE 8080
ENV PORT=8080

ENTRYPOINT ["/gateway-api"]
