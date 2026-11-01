use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use futures::stream::{self, StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

// ── Tuning ────────────────────────────────────────────────────────────────
/// Blocks per progress update sent to the UI during a range fetch.
const CHUNK_BLOCKS: u64 = 20;
/// Blocks per JSON-RPC batch request (full-tx blocks are large).
const BLOCKS_PER_REQUEST: usize = 5;
/// Addresses per eth_getCode batch request.
const CODES_PER_REQUEST: usize = 100;
/// Batch requests in flight at once.
const CONCURRENCY: usize = 4;

// ── Settings ──────────────────────────────────────────────────────────────
// Replaces the ALCHEMY_API_KEY env var and hardcoded polygon URL of the
// original Next.js API. `rpc_url` is any node RPC endpoint, provider API key
// included (e.g. https://polygon-mainnet.g.alchemy.com/v2/<key>).

#[derive(Clone, Serialize, Deserialize)]
struct Settings {
    #[serde(alias = "api_key")]
    rpc_url: String,
    #[serde(default = "default_explorer")]
    explorer_url: String,
}

fn default_explorer() -> String {
    "https://polygonscan.com".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self { rpc_url: String::new(), explorer_url: default_explorer() }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Settings {
    load_settings(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let url = settings.rpc_url.trim();
    if !url.is_empty() && !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("RPC URL must start with http:// or https://".into());
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(&app)?, json).map_err(|e| e.to_string())
}

// ── Shared state ──────────────────────────────────────────────────────────

struct Rpc {
    /// One pooled client for the app's lifetime (keep-alive, TLS reuse).
    client: reqwest::Client,
    /// rpc url → chain id
    chain_ids: Mutex<HashMap<String, String>>,
    /// (chain id, address) → is contract. Contract status is effectively
    /// permanent, so it is never re-queried within a session.
    contracts: Mutex<HashMap<(String, String), bool>>,
    /// Id of the range fetch allowed to run (0 = none). A new fetch replaces
    /// it and `cancel_fetch` clears it; a running fetch stops at its next
    /// chunk once it is no longer the active one.
    active_fetch: AtomicU64,
}

impl Rpc {
    fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .pool_max_idle_per_host(CONCURRENCY * 2)
            .build()
            .expect("http client");
        Self {
            client,
            chain_ids: Default::default(),
            contracts: Default::default(),
            active_fetch: AtomicU64::new(0),
        }
    }
}

/// Per-call context: the resolved endpoint and the chain it serves.
struct Ctx<'a> {
    app: &'a AppHandle,
    rpc: &'a Rpc,
    url: String,
    chain: String,
}

impl<'a> Ctx<'a> {
    async fn new(app: &'a AppHandle, rpc: &'a Rpc) -> Result<Ctx<'a>, String> {
        let url = load_settings(app).rpc_url.trim().to_string();
        if url.is_empty() {
            return Err("Node RPC URL is not set. Open Settings and add one.".into());
        }
        let cached = rpc.chain_ids.lock().unwrap().get(&url).cloned();
        let chain = match cached {
            Some(c) => c,
            None => {
                let v = call(&rpc.client, &url, "eth_chainId", json!([])).await?;
                let c = v.as_str().ok_or("Node did not return a chain id")?.to_string();
                rpc.chain_ids.lock().unwrap().insert(url.clone(), c.clone());
                c
            }
        };
        Ok(Ctx { app, rpc, url, chain })
    }
}

// ── JSON-RPC ──────────────────────────────────────────────────────────────

fn rpc_result(mut v: Value) -> Result<Value, String> {
    if let Some(err) = v.get("error") {
        let msg = err.get("message").and_then(Value::as_str).unwrap_or("Unknown error");
        return Err(format!("Ethereum API error: {msg}"));
    }
    Ok(v.get_mut("result").map(Value::take).unwrap_or(Value::Null))
}

async fn post(client: &reqwest::Client, url: &str, body: &Value) -> Result<Value, String> {
    let res = client.post(url).json(body).send().await.map_err(|e| format!("Network error: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Network error: {}", res.status()));
    }
    res.json::<Value>().await.map_err(|e| format!("Network error: {e}"))
}

async fn call(client: &reqwest::Client, url: &str, method: &'static str, params: Value) -> Result<Value, String> {
    let body = json!({ "jsonrpc": "2.0", "method": method, "params": params, "id": 1 });
    rpc_result(post(client, url, &body).await?)
}

/// Send several calls as one JSON-RPC batch, returning results in request
/// order. Falls back to individual requests for nodes that reject batches.
async fn call_batch(client: &reqwest::Client, url: &str, calls: Vec<(&'static str, Value)>) -> Result<Vec<Result<Value, String>>, String> {
    if calls.len() == 1 {
        let (m, p) = calls.into_iter().next().unwrap();
        return Ok(vec![call(client, url, m, p).await]);
    }
    let body: Vec<Value> = calls
        .iter()
        .enumerate()
        .map(|(i, (m, p))| json!({ "jsonrpc": "2.0", "method": m, "params": p, "id": i }))
        .collect();

    if let Ok(Value::Array(items)) = post(client, url, &Value::Array(body)).await {
        let mut out: Vec<Result<Value, String>> = vec![Err("Missing batch response".into()); calls.len()];
        for item in items {
            if let Some(i) = item.get("id").and_then(Value::as_u64).map(|i| i as usize).filter(|&i| i < out.len()) {
                out[i] = rpc_result(item);
            }
        }
        return Ok(out);
    }

    // Build the futures up front: a closure over borrowed items here trips
    // rustc's higher-ranked lifetime check for Send command futures.
    let futures: Vec<_> = calls.into_iter().map(|(m, p)| call(client, url, m, p)).collect();
    Ok(stream::iter(futures)
        .buffered(CONCURRENCY)
        .collect()
        .await)
}

// ── Blocks ────────────────────────────────────────────────────────────────
// Only the four fields the graph uses are kept and cached, which makes the
// on-disk cache ~50x smaller than raw blocks and much faster to re-read.

#[derive(Clone, Serialize, Deserialize)]
struct SlimTx {
    from: String,
    to: String,
    hash: Option<String>,
    gas_price: Option<String>,
}

fn slim_block(block: &Value) -> Vec<SlimTx> {
    let txs = block.get("transactions").and_then(Value::as_array);
    txs.into_iter()
        .flatten()
        .filter_map(|tx| {
            let s = |k: &str| tx.get(k).and_then(Value::as_str).map(String::from);
            Some(SlimTx {
                from: s("from")?,
                to: s("to")?, // contract creations have no `to`
                hash: s("hash").or_else(|| s("transactionHash")),
                gas_price: s("gasPrice"),
            })
        })
        .collect()
}

fn cache_file(ctx: &Ctx, n: u64) -> Option<PathBuf> {
    let dir = ctx.app.path().app_cache_dir().ok()?.join("txs").join(&ctx.chain);
    Some(dir.join(format!("{n}.json")))
}

async fn read_cached(ctx: &Ctx<'_>, n: u64) -> Option<Vec<SlimTx>> {
    let text = tokio::fs::read(cache_file(ctx, n)?).await.ok()?;
    serde_json::from_slice(&text).ok()
}

async fn write_cached(ctx: &Ctx<'_>, n: u64, txs: &[SlimTx]) {
    // Cache write failures are non-fatal.
    let Some(f) = cache_file(ctx, n) else { return };
    if let Some(dir) = f.parent() {
        let _ = tokio::fs::create_dir_all(dir).await;
    }
    if let Ok(bytes) = serde_json::to_vec(txs) {
        let _ = tokio::fs::write(f, bytes).await;
    }
}

/// Load blocks cache-first; misses are fetched in batched, concurrent RPC
/// requests. Returns transactions in block order.
async fn load_blocks(ctx: &Ctx<'_>, numbers: &[u64]) -> Result<Vec<SlimTx>, String> {
    let cached: Vec<Option<Vec<SlimTx>>> =
        stream::iter(numbers.to_vec()).map(|n| read_cached(ctx, n)).buffered(16).collect().await;

    let missing: Vec<u64> = numbers.iter().zip(&cached).filter(|(_, c)| c.is_none()).map(|(&n, _)| n).collect();

    let fetched: Vec<(u64, Vec<SlimTx>)> = stream::iter(missing.chunks(BLOCKS_PER_REQUEST).map(<[u64]>::to_vec).collect::<Vec<_>>())
        .map(|chunk| async move {
            let calls = chunk.iter().map(|n| ("eth_getBlockByNumber", json!([format!("0x{n:x}"), true]))).collect();
            let results = call_batch(&ctx.rpc.client, &ctx.url, calls).await?;
            let mut out = Vec::with_capacity(chunk.len());
            for (n, r) in chunk.into_iter().zip(results) {
                let block = r?;
                if block.is_null() {
                    return Err(format!("Block {n} not found. Block may not exist yet or is invalid."));
                }
                let txs = slim_block(&block);
                write_cached(ctx, n, &txs).await;
                out.push((n, txs));
            }
            Ok::<_, String>(out)
        })
        .buffered(CONCURRENCY)
        .try_collect::<Vec<_>>()
        .await?
        .into_iter()
        .flatten()
        .collect();

    let mut fetched: HashMap<u64, Vec<SlimTx>> = fetched.into_iter().collect();
    Ok(numbers
        .iter()
        .zip(cached)
        .flat_map(|(n, c)| c.or_else(|| fetched.remove(n)).unwrap_or_default())
        .collect())
}

// ── Contract detection ────────────────────────────────────────────────────

async fn contract_flags(ctx: &Ctx<'_>, addrs: HashSet<String>) -> HashMap<String, bool> {
    let mut known = HashMap::new();
    let mut unknown = Vec::new();
    {
        let cache = ctx.rpc.contracts.lock().unwrap();
        for a in addrs {
            match cache.get(&(ctx.chain.clone(), a.clone())) {
                Some(&c) => { known.insert(a, c); }
                None => unknown.push(a),
            }
        }
    }

    let looked_up: Vec<(String, bool)> = stream::iter(unknown.chunks(CODES_PER_REQUEST).map(<[String]>::to_vec).collect::<Vec<_>>())
        .map(|chunk| async move {
            let calls = chunk.iter().map(|a| ("eth_getCode", json!([a, "latest"]))).collect();
            let results = call_batch(&ctx.rpc.client, &ctx.url, calls).await.unwrap_or_default();
            chunk
                .iter()
                .enumerate()
                .map(|(i, a)| {
                    let code = results.get(i).and_then(|r| r.as_ref().ok()).and_then(Value::as_str);
                    // Lookup failures count as EOAs, as in the original API, but aren't cached.
                    (a.clone(), code.map(|c| c != "0x" && c.len() > 2))
                })
                .collect::<Vec<_>>()
        })
        .buffered(CONCURRENCY)
        .flat_map(stream::iter)
        .filter_map(|(a, c)| async move { c.map(|c| (a, c)) })
        .collect()
        .await;

    let mut cache = ctx.rpc.contracts.lock().unwrap();
    for (a, c) in looked_up {
        cache.insert((ctx.chain.clone(), a.clone()), c);
        known.insert(a, c);
    }
    known
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TxLink {
    from: String,
    to: String,
    hash: Option<String>,
    gas_price: Option<String>,
    from_is_contract: bool,
    to_is_contract: bool,
}

/// Port of filterTransactions / filterTransactionsRange.
async fn build_links(ctx: &Ctx<'_>, txs: Vec<SlimTx>) -> Vec<TxLink> {
    let flags = contract_flags(ctx, txs.iter().flat_map(|t| [t.from.clone(), t.to.clone()]).collect()).await;
    let is_c = |a: &str| flags.get(a).copied().unwrap_or(false);
    txs.into_iter()
        .map(|t| TxLink {
            from_is_contract: is_c(&t.from),
            to_is_contract: is_c(&t.to),
            from: t.from,
            to: t.to,
            hash: t.hash,
            gas_price: t.gas_price,
        })
        .collect()
}

// ── Commands ──────────────────────────────────────────────────────────────

#[tauri::command]
async fn get_block(app: AppHandle, rpc: State<'_, Rpc>, block_number: u64) -> Result<Vec<TxLink>, String> {
    let ctx = Ctx::new(&app, &rpc).await?;
    let txs = load_blocks(&ctx, &[block_number]).await?;
    Ok(build_links(&ctx, txs).await)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum RangeEvent {
    /// Links for the next chunk of blocks, in order.
    Batch { links: Vec<TxLink>, loaded: u64, total: u64 },
}

/// Stream a block range to the UI chunk by chunk so the graph can grow while
/// later blocks are still loading. `fetch_id` is chosen by the caller (non-zero,
/// unique); starting a new range or `cancel_fetch(fetch_id)` stops this one.
#[tauri::command]
async fn stream_blocks_range(
    app: AppHandle,
    rpc: State<'_, Rpc>,
    fetch_id: u64,
    start_block: u64,
    end_block: u64,
    on_event: Channel<RangeEvent>,
) -> Result<bool, String> {
    if start_block > end_block {
        return Err("start_block must be less than or equal to end_block".into());
    }
    rpc.active_fetch.store(fetch_id, Ordering::SeqCst);
    let active = || rpc.active_fetch.load(Ordering::SeqCst) == fetch_id;
    let ctx = Ctx::new(&app, &rpc).await?;
    let total = end_block - start_block + 1;

    let mut next = start_block;
    while next <= end_block {
        if !active() {
            return Ok(false); // cancelled
        }
        let last = (next + CHUNK_BLOCKS - 1).min(end_block);
        let numbers: Vec<u64> = (next..=last).collect();
        let txs = load_blocks(&ctx, &numbers).await?;
        let links = build_links(&ctx, txs).await;
        if !active() {
            return Ok(false);
        }
        on_event
            .send(RangeEvent::Batch { links, loaded: last - start_block + 1, total })
            .map_err(|e| e.to_string())?;
        next = last + 1;
    }
    Ok(true)
}

#[tauri::command]
fn cancel_fetch(rpc: State<'_, Rpc>, fetch_id: u64) {
    // Only cancel if it is still the active fetch, so a late cancel can't
    // stop a newer one.
    let _ = rpc.active_fetch.compare_exchange(fetch_id, 0, Ordering::SeqCst, Ordering::SeqCst);
}

// ── Investigation import / export ─────────────────────────────────────────

#[tauri::command]
async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    tokio::fs::write(path, contents).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(path).await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Rpc::new())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_block,
            stream_blocks_range,
            cancel_fetch,
            write_text_file,
            read_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
