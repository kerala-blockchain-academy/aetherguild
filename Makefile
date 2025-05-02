.PHONY: druid druid-forever druid-docker druid-linux-amd64 druid-darwin-amd64 druid-windows-amd64 faucet test lint vet fmt

druid: faucet
	@go run ./druid

druid-forever: faucet
	@go run ./druid --expose --persist

druid-docker:
	@cd druid/ && docker build -t aetherguild-druid .
	@sleep 1
	@docker run -p 8545:8545 -p 8580:8580 aetherguild-druid

druid-linux-amd64: faucet
	@CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o tmp/druid-linux-amd64 ./druid

druid-darwin-amd64: faucet
	@CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -o tmp/druid-darwin-amd64 ./druid

druid-windows-amd64: faucet
	@CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o tmp/druid-windows-amd64 ./druid

build-druid: druid-linux-amd64 druid-darwin-amd64 druid-windows-amd64

faucet:
	@if [ ! -d "druid/faucet/dist" ]; then \
		echo "dist not found, running install & build..."; \
		cd druid/faucet/web; \
		npm install && npm run build; \
	fi

test:
	@go test -v ./druid

lint:
	@if [ ! -f "./bin/golangci-lint" ]; then \
		echo "Installing golangci-lint..."; \
		curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/HEAD/install.sh | sh -s latest; \
	fi
	@./bin/golangci-lint run ./druid --config .golangci.yml

vet:
	@go vet -v ./druid

fmt:
	@gofmt -s -w $(shell find . -name "*.go")
