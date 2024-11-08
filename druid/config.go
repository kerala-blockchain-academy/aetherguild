package main

import (
	"math/big"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/accounts/keystore"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/eth/ethconfig"
	"github.com/ethereum/go-ethereum/log"
	"github.com/ethereum/go-ethereum/node"
)

func DefaultNodeConfig() node.Config {
	cfg := node.DefaultConfig
	cfg.Name = "druid"
	cfg.DataDir = ""
	cfg.HTTPModules = append(cfg.HTTPModules, "eth")
	cfg.WSModules = append(cfg.WSModules, "eth")
	cfg.IPCPath = "druid.ipc"
	cfg.P2P.MaxPeers = 0
	cfg.P2P.ListenAddr = ""
	cfg.P2P.NoDial = true
	cfg.P2P.NoDiscovery = true
	cfg.P2P.DiscoveryV5 = false
	cfg.UseLightweightKDF = true
	cfg.HTTPHost = "127.0.0.1"
	cfg.HTTPCors = []string{"*"}
	cfg.HTTPModules = []string{"eth", "web3", "net"}
	cfg.WSHost = "127.0.0.1"

	return cfg
}

func SetEthConfig(stack *node.Node, cfg *ethconfig.Config) {
	cfg.NetworkId = 1337

	// Create new developer account or reuse existing one
	var (
		developer  accounts.Account
		passphrase string
		err        error
	)

	// Unlock the developer account by local keystore.
	var ks *keystore.KeyStore
	if keystores := stack.AccountManager().Backends(keystore.KeyStoreType); len(keystores) > 0 {
		ks = keystores[0].(*keystore.KeyStore)
	}
	if ks == nil {
		log.Error("Keystore is not available")
	}

	// Figure out the dev account address.
	// setEtherbase has been called above, configuring the miner address from command line flags.
	if cfg.Miner.PendingFeeRecipient != (common.Address{}) {
		developer = accounts.Account{Address: cfg.Miner.PendingFeeRecipient}
	} else if accs := ks.Accounts(); len(accs) > 0 {
		developer = ks.Accounts()[0]
	} else {
		developer, err = ks.NewAccount(passphrase)
		if err != nil {
			log.Error("Failed to create developer account: %v", err)
		}
	}
	// Make sure the address is configured as fee recipient, otherwise
	// the miner will fail to start.
	cfg.Miner.PendingFeeRecipient = developer.Address

	if err := ks.Unlock(developer, passphrase); err != nil {
		log.Error("Failed to unlock developer account: %v", err)
	}
	log.Info("Using developer account", "address", developer.Address)

	// Create a new developer genesis block or reuse existing one
	cfg.Genesis = core.DeveloperGenesisBlock(ethconfig.Defaults.Miner.GasCeil, &developer.Address)

	cfg.Miner.GasPrice = big.NewInt(1)
}
