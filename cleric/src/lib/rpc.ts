const RPC_URL = "http://localhost:8545";

let _id = 1;

async function call(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: _id++ }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

export async function getBlockNumber(): Promise<number> {
  const hex = await call("eth_blockNumber") as string;
  return parseInt(hex, 16);
}

export async function getBlockByNumber(n: number, fullTx = false) {
  return call("eth_getBlockByNumber", ["0x" + n.toString(16), fullTx]);
}

export async function getTransactionByHash(hash: string) {
  return call("eth_getTransactionByHash", [hash]);
}

// Formatting helpers
export function hexToNum(hex: string): number {
  return parseInt(hex, 16);
}

export function formatGas(hex: string): string {
  return hexToNum(hex).toLocaleString();
}

export function formatAge(hexTimestamp: string): string {
  const diff = Math.floor(Date.now() / 1000) - hexToNum(hexTimestamp);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatTimestamp(hexTimestamp: string): string {
  return new Date(hexToNum(hexTimestamp) * 1000).toLocaleString();
}

export function formatEth(hexWei: string): string {
  const wei = BigInt(hexWei);
  const eth = Number(wei) / 1e18;
  return eth === 0 ? "0 ETH" : `${eth.toFixed(6)} ETH`;
}
