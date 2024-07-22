package main

import (
	"github.com/ethereum/go-ethereum/eth/ethconfig"
	"github.com/ethereum/go-ethereum/metrics"
	"github.com/ethereum/go-ethereum/node"
)

type (
	ethstatsConfig struct {
		URL string `toml:",omitempty"`
	}

	DruidConfig struct {
		Eth      ethconfig.Config
		Node     node.Config
		Ethstats ethstatsConfig
		Metrics  metrics.Config
	}
)
