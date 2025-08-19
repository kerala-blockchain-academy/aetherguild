package main

import (
	"math/big"
	"os"
	"os/user"
	"path/filepath"
	"runtime"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/accounts/keystore"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/eth/ethconfig"
	"github.com/ethereum/go-ethereum/log"
	"github.com/ethereum/go-ethereum/node"
)

func DefaultNodeConfig(expose, persist bool) node.Config {
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
	cfg.HTTPHost = node.DefaultHTTPHost
	cfg.HTTPCors = []string{"*"}
	cfg.HTTPModules = []string{"eth", "web3", "net"}
	cfg.WSHost = node.DefaultWSHost

	if expose {
		cfg.HTTPHost = "0.0.0.0"
		cfg.WSHost = "0.0.0.0"
	}
	if persist {
		cfg.DataDir = filepath.Join(DefaultDataDir(), "druid")
	}

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

// DefaultDataDir is the default data directory to use for the databases and other
// persistence requirements.
func DefaultDataDir() string {
	// Try to place the data folder in the user's home dir
	home := homeDir()
	if home != "" {
		switch runtime.GOOS {
		case "darwin":
			return filepath.Join(home, "Library", "AetherGuild")
		case "windows":
			// We used to put everything in %HOME%\AppData\Roaming, but this caused
			// problems with non-typical setups. If this fallback location exists and
			// is non-empty, use it, otherwise DTRT and check %LOCALAPPDATA%.
			fallback := filepath.Join(home, "AppData", "Roaming", "AetherGuild")
			appdata := windowsAppData()
			if appdata == "" || isNonEmptyDir(fallback) {
				return fallback
			}
			return filepath.Join(appdata, "AetherGuild")
		default:
			return filepath.Join(home, ".aetherguild")
		}
	}
	// As we cannot guess a stable location, return empty and handle later
	return ""
}

func windowsAppData() string {
	v := os.Getenv("LOCALAPPDATA")
	if v == "" {
		// Windows XP and below don't have LocalAppData. Crash here because
		// we don't support Windows XP and undefining the variable will cause
		// other issues.
		panic("environment variable LocalAppData is undefined")
	}
	return v
}

func isNonEmptyDir(dir string) bool {
	f, err := os.Open(dir)
	if err != nil {
		return false
	}
	names, _ := f.Readdir(1)
	f.Close()
	return len(names) > 0
}

func homeDir() string {
	if home := os.Getenv("HOME"); home != "" {
		return home
	}
	if usr, err := user.Current(); err == nil {
		return usr.HomeDir
	}
	return ""
}
