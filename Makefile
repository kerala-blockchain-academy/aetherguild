.PHONY: druid fmt

druid:
	@go run ./druid

fmt:
	@gofmt -s -w $(shell find . -name "*.go")
