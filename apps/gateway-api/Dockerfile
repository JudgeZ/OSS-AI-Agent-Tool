# syntax=docker/dockerfile:1.6

FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/gateway ./...

FROM alpine:3.19
RUN adduser -D -H appuser
USER appuser
WORKDIR /app
COPY --from=build /out/gateway /usr/local/bin/gateway-api
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/gateway-api"]
