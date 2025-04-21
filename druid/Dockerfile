# Stage to build faucet UI
FROM node:22.14.0-slim AS faucet

WORKDIR /faucet
COPY ./faucet/web/package.json ./
RUN npm i -g pnpm@10.8.1 && pnpm i
COPY ./faucet/web ./

RUN pnpm run build

# Stage to build druid
FROM golang:1.24.2-alpine AS builder

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=faucet /dist ./faucet/

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o druid

# Final stage
FROM alpine:3.21.3 AS runner

COPY --from=builder /build/druid /druid
EXPOSE 8545 8580

ENTRYPOINT ["/druid", "--expose", "--persist"]
