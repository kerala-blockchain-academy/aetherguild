package faucet

import (
	"context"
	"crypto/ecdsa"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

type Config struct {
	Eth        *ethclient.Client
	PrivateKey *ecdsa.PrivateKey
	Faucet     common.Address
}

func NewFaucet(e *ethclient.Client, p *ecdsa.PrivateKey) *Config {
	return &Config{
		Eth:        e,
		PrivateKey: p,
		Faucet:     crypto.PubkeyToAddress(p.PublicKey),
	}
}

func (c *Config) CreditTETH(addressHex string) error {
	nonce, err := c.Eth.PendingNonceAt(context.Background(), c.Faucet)
	if err != nil {
		return err
	}

	to := common.HexToAddress(addressHex)
	gasFee, _ := c.Eth.SuggestGasPrice(context.Background())
	gasTip, _ := c.Eth.SuggestGasTipCap(context.Background())

	signedTx, _ := types.SignNewTx(c.PrivateKey, types.LatestSignerForChainID(big.NewInt(1337)), &types.DynamicFeeTx{
		Nonce:     nonce,
		To:        &to,
		GasFeeCap: gasFee,
		GasTipCap: gasTip,
		Gas:       22000,
		Value:     new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil), // 1 ETH
		Data:      nil,
	})

	err = c.Eth.SendTransaction(context.Background(), signedTx)
	if err != nil {
		return err
	}

	for {
		time.Sleep(time.Second)
		trxReceipt, err := c.Eth.TransactionReceipt(context.Background(), signedTx.Hash())
		if err == ethereum.NotFound {
			continue
		}

		if trxReceipt.Status == 1 {
			break
		}

		return err
	}

	return nil
}
