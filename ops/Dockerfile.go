# Image for apps/settlement (the `settlement` service in
# ops/docker-compose.yml, run as `./settlement daemon`). Build context is the
# repo root (`context: ..` in compose).
#
# GO_VERSION must stay at or above the `go` line in apps/settlement/go.mod.
# Upgrading pgx to 5.9.x (docs/cyper/15) needs 1.25.
ARG GO_VERSION=1.24

FROM golang:${GO_VERSION}-bookworm AS build
WORKDIR /src
COPY apps/settlement/go.mod apps/settlement/go.sum ./
RUN go mod download
COPY apps/settlement/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/settlement ./cmd/settlement

# A static binary needs no OS: distroless, no shell, runs as uid 65532.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/settlement ./settlement
USER nonroot:nonroot
EXPOSE 8091
CMD ["./settlement", "daemon"]
