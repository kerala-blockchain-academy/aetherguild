package main

import (
	"bytes"
	"context"
	"fmt"
	"math/big"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/log"
)

var ctx = context.Background()

func TestDruid(t *testing.T) {
	// revert logger setup in testing
	log.SetDefault(log.NewLogger(log.DiscardHandler()))

	flag := false
	stack, ethClient := makeDruid(&flag, &flag)
	defer stack.Close()

	if err := stack.Start(); err != nil {
		t.Fatalf("Error starting protocol stack: %v", err)
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	var version string
	if err := ethClient.Client().CallContext(ctx, &version, "web3_clientVersion"); err != nil {
		t.Fatalf("Failed to fetch client version: %v", err)
	}

	vw := fmt.Sprintf("%s/%s-%s/%s", strings.TrimSuffix(filepath.Base(os.Args[0]), ".test"), runtime.GOOS, runtime.GOARCH, runtime.Version())
	if version != vw {
		t.Fatalf("Wrong client version: %s, expected: %s", version, vw)
	}
}

func TestFaucet(t *testing.T) {
	// revert logger setup in testing
	log.SetDefault(log.NewLogger(log.DiscardHandler()))
	var err error

	addr := common.Address{0x64}
	flag := false
	stack, eth := makeDruid(&flag, &flag)
	defer stack.Close()

	if err := stack.Start(); err != nil {
		t.Fatalf("Error starting protocol stack: %v", err)
	}

	buf := &bytes.Buffer{}
	writer := multipart.NewWriter(buf)

	if err = writer.WriteField("address", addr.Hex()); err != nil {
		t.Fatalf("Error writing form data: %v", err)
	}

	if err = writer.WriteField("amount", "1"); err != nil {
		t.Fatalf("Error writing form data: %v", err)
	}

	if err := writer.Close(); err != nil {
		t.Fatalf("Failed to close multipart writer: %v", err)
	}

	contentType := writer.FormDataContentType()

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/faucet/api", stack.HTTPEndpoint()), buf)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	req.Header.Set("Content-Type", contentType)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Request failed with status %d", resp.StatusCode)
	}

	var result hexutil.Big
	if err := eth.Client().CallContext(ctx, &result, "eth_getBalance", addr, "latest"); err != nil {
		t.Fatalf("Failed to fetch balance: %v", err)
	}

	bal := (*big.Int)(&result)
	drop := new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)
	if bal.Cmp(drop) != 0 {
		t.Fatalf("Incorrect balance: %v, expected: %v", bal, drop)
	}
}
