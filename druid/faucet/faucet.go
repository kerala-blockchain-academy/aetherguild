package faucet

import (
	"context"
	"crypto/ecdsa"
	"embed"
	"encoding/json"
	"math/big"
	"net/http"
	"strconv"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/log"
	"github.com/ethereum/go-ethereum/rpc"
)

//go:embed all:dist
var assets embed.FS

type (
	UI  struct{}
	API struct {
		key     *ecdsa.PrivateKey
		rpc     *rpc.Client
		miner   *common.Address
		chainID *big.Int
	}
)

func NewAPI(key *ecdsa.PrivateKey, rpc *rpc.Client, miner *common.Address, chainID *big.Int) *API {
	return &API{
		key:     key,
		rpc:     rpc,
		miner:   miner,
		chainID: chainID,
	}
}

func respOk(w http.ResponseWriter, body []byte, ctype string) {
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write(body)
}

func respErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	errMsg, _ := json.Marshal(struct {
		Error string
	}{Error: msg})
	w.Write(errMsg)
}

func (i UI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respErr(w, "only GET allowed", http.StatusMethodNotAllowed)
		return
	}

	switch r.URL.Path {
	case "/faucet/ui/index.css":
		data, err := assets.ReadFile("dist/faucet/ui/index.css")
		if err != nil {
			log.Warn("Error loading Faucet UI asset", "err", err)
			respErr(w, "internal error", http.StatusInternalServerError)
			return
		}
		respOk(w, data, "text/css")
	case "/faucet/ui/index.js":
		data, err := assets.ReadFile("dist/faucet/ui/index.js")
		if err != nil {
			log.Warn("Error loading Faucet UI asset", "err", err)
			respErr(w, "internal error", http.StatusInternalServerError)
			return
		}
		respOk(w, data, "application/javascript; charset=utf-8")
	default:
		data, err := assets.ReadFile("dist/index.html")
		if err != nil {
			log.Warn("Error loading Faucet UI asset", "err", err)
			respErr(w, "internal error", http.StatusInternalServerError)
			return
		}
		respOk(w, data, "text/html")
	}
}

func (i API) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var err error
		if err = r.ParseMultipartForm(10 << 20); err != nil {
			respErr(w, err.Error(), http.StatusBadRequest)
			return
		}

		amount := r.FormValue("amount")
		val, err := strconv.ParseInt(amount, 10, 0)
		if err != nil {
			respErr(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		var nonce hexutil.Uint64
		if err = i.rpc.CallContext(ctx, &nonce, "eth_getTransactionCount", i.miner, "pending"); err != nil {
			log.Error("Error fetching nonce", "err", err)
			respErr(w, "internal error", http.StatusInternalServerError)
			return
		}

		var gasFee hexutil.Big
		if err = i.rpc.CallContext(ctx, &gasFee, "eth_gasPrice"); err != nil {
			log.Error("Error fetching gas price", "err", err)
			respErr(w, "internal error", http.StatusInternalServerError)
			return
		}

		var gasTip hexutil.Big
		if err = i.rpc.CallContext(ctx, &gasTip, "eth_maxPriorityFeePerGas"); err != nil {
			log.Error("Error fetching priority fee", "err", err)
			respErr(w, "internal error", http.StatusInternalServerError)
			return
		}

		to := common.HexToAddress(r.FormValue("address"))

		tx, err := types.SignNewTx(i.key, types.LatestSignerForChainID(i.chainID), &types.DynamicFeeTx{
			Nonce:     uint64(nonce),
			To:        &to,
			GasFeeCap: (*big.Int)(&gasFee),
			GasTipCap: (*big.Int)(&gasTip),
			Gas:       22000,
			Value:     new(big.Int).Mul(big.NewInt(val), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)),
			Data:      nil,
		})
		if err != nil {
			log.Error("Error signing transaction", "err", err)
			respErr(w, "internal error", http.StatusInternalServerError)
			return
		}

		data, err := tx.MarshalBinary()
		if err != nil {
			log.Error("Error marshalling transaction", "err", err)
			respErr(w, "internal error", http.StatusInternalServerError)
			return
		}

		if err = i.rpc.CallContext(ctx, nil, "eth_sendRawTransaction", hexutil.Encode(data)); err != nil {
			log.Error("Error sending transaction", "err", err)
			respErr(w, "internal error", http.StatusInternalServerError)
			return
		}

		var receipt *types.Receipt
		for {
			time.Sleep(time.Second)
			err = i.rpc.CallContext(ctx, &receipt, "eth_getTransactionReceipt", tx.Hash())

			switch {
			case err == nil && r == nil:
				continue
			case err != nil:
				log.Error("Error fetching receipt", "err", err)
				respErr(w, "internal error", http.StatusInternalServerError)
				return
			case receipt.Status == types.ReceiptStatusSuccessful:
				respOk(w, nil, "application/json")
				return
			}
		}
	}
	respErr(w, "only POST allowed", http.StatusMethodNotAllowed)
}
