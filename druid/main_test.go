package main

import (
	"context"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Kerala-Blockchain-Academy/aetherguild/druid/faucet"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/log"
)

var ctx = context.Background()

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

	flag := false
	stack := makeDruid(&flag, &flag)
	defer stack.Close()

	if err := stack.Start(); err != nil {
		t.Fatalf("Error starting protocol stack: %v", err)
	}

	rpcClient := stack.Attach()
	ethClient := ethclient.NewClient(rpcClient)
	c := faucet.NewFaucet(ethClient, privateKey, "", 0)

	addr := common.Address{0x64}
	if err := c.CreditTETH(addr.Hex()); err != nil {
		t.Fatalf("Failed to credit ETH: %v", err)
	}

	var result hexutil.Big
	if err := ethClient.Client().CallContext(ctx, &result, "eth_getBalance", addr, "latest"); err != nil {
		t.Fatalf("Failed to fetch balance: %v", err)
	}

	bal := (*big.Int)(&result)
	drop := new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)
	if bal.Cmp(drop) != 0 {
		t.Fatalf("Incorrect balance: %v, expected: %v", bal, drop)
	}
}
