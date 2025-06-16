package main

import (
	"flag"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/Kerala-Blockchain-Academy/aetherguild/druid/faucet"
	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/accounts/keystore"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/eth"
	"github.com/ethereum/go-ethereum/eth/catalyst"
	"github.com/ethereum/go-ethereum/eth/ethconfig"
	"github.com/ethereum/go-ethereum/eth/filters"
	"github.com/ethereum/go-ethereum/eth/tracers"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/graphql"
	"github.com/ethereum/go-ethereum/log"
	"github.com/ethereum/go-ethereum/node"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/mattn/go-colorable"
	"github.com/mattn/go-isatty"
)

var privateKey, _ = crypto.HexToECDSA("b71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291")

func init() {
	terminalOutput := io.Writer(os.Stderr)
	useColor := (isatty.IsTerminal(os.Stderr.Fd()) || isatty.IsCygwinTerminal(os.Stderr.Fd())) && os.Getenv("TERM") != "dumb"
	if useColor {
		terminalOutput = colorable.NewColorableStderr()
	}

	glogger := log.NewGlogHandler(log.NewTerminalHandler(terminalOutput, useColor))
	// glogger.Verbosity(log.FromLegacyLevel(0))
	log.SetDefault(log.NewLogger(glogger))
}

func makeDruid(expose, persist *bool) *node.Node {
	cfg := DruidConfig{
		Eth:  ethconfig.Defaults,
		Node: DefaultNodeConfig(*expose, *persist),
	}

	stack, err := node.New(&cfg.Node)
	if err != nil {
		log.Error("Failed to create the protocol stack: %v", err)
	}

	b := keystore.NewKeyStore(stack.KeyStoreDir(), keystore.LightScryptN, keystore.LightScryptP)
	b.ImportECDSA(privateKey, "")
	stack.AccountManager().AddBackend(b)

	SetEthConfig(stack, &cfg.Eth)

	backend, err := eth.New(stack, &cfg.Eth)
	if err != nil {
		log.Error("Failed to register the Ethereum service: %v", err)
	}
	stack.RegisterAPIs(tracers.APIs(backend.APIBackend))

	filterSystem := filters.NewFilterSystem(backend.APIBackend, filters.Config{
		LogCacheSize: cfg.Eth.FilterLogCacheSize,
	})

	stack.RegisterAPIs([]rpc.API{{
		Namespace: "eth",
		Service:   filters.NewFilterAPI(filterSystem),
	}})

	// Configure GraphQL
	if err := graphql.New(stack, backend.APIBackend, filterSystem, []string{"*"}, cfg.Node.GraphQLVirtualHosts); err != nil {
		log.Error("Failed to register the GraphQL service: %v", err)
	}

	simBeacon, err := catalyst.NewSimulatedBeacon(0, common.Address{0x0}, backend)
	if err != nil {
		log.Error("Failed to register dev mode catalyst service: %v", err)
	}
	catalyst.RegisterSimulatedBeaconAPIs(stack, simBeacon)
	stack.RegisterLifecycle(simBeacon)

	return stack
}

func main() {
	expose := flag.Bool("expose", false, "Expose the chain across the host")
	persist := flag.Bool("persist", false, "Persist the chain data")

	flag.Parse()

	stack := makeDruid(expose, persist)
	defer stack.Close()

	if err := stack.Start(); err != nil {
		log.Error("Error starting protocol stack: %v", err)
	}

	go func() {
		sigc := make(chan os.Signal, 1)
		signal.Notify(sigc, syscall.SIGINT, syscall.SIGTERM)
		defer signal.Stop(sigc)

		shutdown := func() {
			log.Warn("Got interrupt, shutting down...")
			go stack.Close()
			for i := 10; i > 0; i-- {
				<-sigc
				if i > 1 {
					log.Warn("Already shutting down, interrupt more to panic.", "times", i-1)
				}
			}
		}

		<-sigc
		shutdown()
	}()

	events := make(chan accounts.WalletEvent, 16)
	stack.AccountManager().Subscribe(events)

	// Create a client to interact with local node.
	rpcClient := stack.Attach()
	ethClient := ethclient.NewClient(rpcClient)

	c := faucet.NewFaucet(ethClient, privateKey, stack.Config().HTTPHost, 8580)

	go func() {
		// Open any wallets already attached
		for _, w := range stack.AccountManager().Wallets() {
			if err := w.Open(""); err != nil {
				log.Error("Failed to open wallet", "url", w.URL(), "err", err)
			}
		}

		// Listen for wallet event till termination
		for event := range events {
			switch event.Kind {
			case accounts.WalletArrived:
				if err := event.Wallet.Open(""); err != nil {
					log.Info("New wallet appeared, failed to open", "url", event.Wallet.URL(), "err", err)
				}
			case accounts.WalletOpened:
				status, _ := event.Wallet.Status()
				log.Info("New wallet appeared", "url", event.Wallet.URL(), "status", status)

				var derivationPaths []accounts.DerivationPath
				if event.Wallet.URL().Scheme == "ledger" {
					derivationPaths = append(derivationPaths, accounts.LegacyLedgerBaseDerivationPath)
				}
				derivationPaths = append(derivationPaths, accounts.DefaultBaseDerivationPath)

				event.Wallet.SelfDerive(derivationPaths, ethClient)

			case accounts.WalletDropped:
				log.Info("Old wallet dropped", "url", event.Wallet.URL())
				event.Wallet.Close()
			}
		}
	}()

	go func() {
		faucet.ServeFaucet(c)
	}()

	stack.Wait()
}
