# Stage to build faucet UI
FROM node:24-slim AS faucet

WORKDIR /faucet
COPY ./faucet/web/package.json ./
RUN npm i -g pnpm && pnpm i
COPY ./faucet/web ./

RUN pnpm run build

# Stage to build druid
FROM golang:1.25-alpine AS builder

ENV GO_BUILDFLAGS="-trimpath -ldflags=-s -ldflags=-w"
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=faucet /dist ./faucet/

RUN go build $GO_BUILDFLAGS -o druid

# Final stage
FROM alpine AS runner

COPY --from=builder /build/druid /druid
EXPOSE 8545 8546 8580

ENTRYPOINT ["/druid", "--expose", "--persist"]
