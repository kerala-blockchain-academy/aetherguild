package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/log"
)

func TestDruid(t *testing.T) {
	// revert logger setup in testing
	log.SetDefault(log.NewLogger(log.DiscardHandler()))

	flag := false
	stack := makeDruid(&flag, &flag)
	defer stack.Close()

	if err := stack.Start(); err != nil {
		t.Fatalf("Error starting protocol stack: %v", err)
	}

	rpcClient := stack.Attach()
	ethClient := ethclient.NewClient(rpcClient)

	var version string
	if err := ethClient.Client().CallContext(context.Background(), &version, "web3_clientVersion"); err != nil {
		t.Fatalf("Failed to fetch client version: %v", err)
	}

	vw := fmt.Sprintf("%s/%s-%s/%s", strings.TrimSuffix(filepath.Base(os.Args[0]), ".test"), runtime.GOOS, runtime.GOARCH, runtime.Version())
	if version != vw {
		t.Fatalf("Wrong client version: %s, expected: %s", version, vw)
	}
}
