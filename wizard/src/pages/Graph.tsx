import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { streamBlocksRange, useExplorer, type TxLink } from "../api";
import { TxGraph } from "../graph";

/** Max rows shown per direction in the address panel. */
const PANEL_ROWS = 50;

function shortHexLabel(value: string | undefined, kind: "tx" | "addr") {
  if (!value) return `N/A (${kind})`;
  const core = value.startsWith("0x") ? value.slice(2) : value;
  return `0x${core.slice(0, 4)}... (${kind})`;
}

function formatGasPrice(hexValue?: string): string {
  if (!hexValue) return "N/A";
  try {
    const wei = BigInt(hexValue);
    const gwei = Number(wei) / 1e9;
    return gwei >= 1 ? `${gwei.toFixed(2)} Gwei` : `${wei} Wei`;
  } catch {
    return "N/A";
  }
}

export default function Page() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<TxGraph | null>(null);
  /** Id of the fetch whose batches are currently applied; older ones are ignored. */
  const fetchIdRef = useRef(0);
  const cancelRef = useRef<() => void>(() => {});

  const [blockNumber, setBlockNumber] = useState<number | null>(null);
  const [label, setLabel] = useState("Block Number: N/A");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  // Bumped per batch so the details panel re-reads graph data.
  const [stats, setStats] = useState({ txs: 0, nodes: 0 });
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<TxLink | null>(null);
  const explorer = useExplorer();

  // Create the graph once and keep it sized to its container.
  useEffect(() => {
    const graph = new TxGraph(
      svgRef.current!,
      (id) => {
        setSelectedLink(null);
        setSelectedAddress(id);
      },
      (tx) => {
        setSelectedAddress(null);
        setSelectedLink(tx);
      },
    );
    graphRef.current = graph;

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      graph.resize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
    });
    ro.observe(containerRef.current!);

    graph.setMessage("Enter a block number or range to load.");

    return () => {
      ro.disconnect();
      fetchIdRef.current++;
      cancelRef.current();
      graph.destroy();
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { outgoing, incoming } = useMemo(() => {
    const txs = graphRef.current?.txs ?? [];
    if (!selectedAddress) return { outgoing: [], incoming: [] };
    const outgoing: TxLink[] = [];
    const incoming: TxLink[] = [];
    for (const l of txs) {
      if (l.from === selectedAddress && outgoing.length < PANEL_ROWS) outgoing.push(l);
      if (l.to === selectedAddress && incoming.length < PANEL_ROWS) incoming.push(l);
      if (outgoing.length >= PANEL_ROWS && incoming.length >= PANEL_ROWS) break;
    }
    return { outgoing, incoming };
  }, [selectedAddress, stats.txs]);

  /** Clear the graph and stream [start, end] into it batch by batch. */
  async function loadRange(start: number, end: number) {
    const graph = graphRef.current;
    if (!graph) return;
    const id = ++fetchIdRef.current;
    const what = start === end ? `block ${start}` : `blocks ${start}-${end}`;

    graph.clear();
    graph.setMessage(`Loading ${what}...`);
    setSelectedAddress(null);
    setSelectedLink(null);
    setStats({ txs: 0, nodes: 0 });
    setProgress({ loaded: 0, total: end - start + 1 });

    try {
      const stream = streamBlocksRange(start, end, (batch) => {
        if (id !== fetchIdRef.current) return;
        graph.add(batch.links);
        if (graph.nodeCount) graph.setMessage(null);
        setStats({ txs: graph.txs.length, nodes: graph.nodeCount });
        setProgress({ loaded: batch.loaded, total: batch.total });
      });
      cancelRef.current = stream.cancel;
      const finished = await stream.done;
      if (id !== fetchIdRef.current) return;
      if (finished && !graph.nodeCount) graph.setMessage("No transactions found for selection.");
    } catch (error: any) {
      if (id !== fetchIdRef.current) return;
      const msg = error?.message ?? String(error);
      console.error(`Error fetching ${what}:`, error);
      // Keep whatever already loaded; only blank the graph if nothing did.
      if (!graph.nodeCount) graph.setMessage(`Error: ${msg}`, "#ff6b6b");
      alert(`Error loading ${what}: ${msg}`);
    } finally {
      if (id === fetchIdRef.current) setProgress(null);
    }
  }

  function stopLoading() {
    fetchIdRef.current++;
    setProgress(null);
    cancelRef.current();
  }

  function fetchSingleBlock(value: number) {
    if (!Number.isInteger(value) || value < 0) {
      alert("Block number must be a non-negative integer.");
      return;
    }
    setBlockNumber(value);
    setLabel(`Block Number: ${value}`);
    loadRange(value, value);
  }

  function fetchRangeBlocks(start: string, end: string) {
    const startBlock = Number(start);
    const endBlock = Number(end);

    if (!Number.isInteger(startBlock) || !Number.isInteger(endBlock)) {
      alert("Both range fields must be valid block numbers.");
      return;
    }
    if (startBlock < 0 || endBlock < 0) {
      alert("Block range must be non-negative.");
      return;
    }
    if (startBlock > endBlock) {
      alert("From block must be less than or equal to To block.");
      return;
    }

    setBlockNumber(startBlock);
    setLabel(`Block Range: ${startBlock} - ${endBlock}`);
    loadRange(startBlock, endBlock);
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <header className="shrink-0 flex flex-wrap justify-between items-center gap-2 p-2 sm:p-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 z-50 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="bg-blue-600 text-white px-3 py-1.5 text-sm rounded-md hover:bg-blue-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={blockNumber === null}
            onClick={() => blockNumber !== null && fetchSingleBlock(blockNumber - 1)}
          >
            ← Previous
          </button>
          <button
            type="button"
            className="bg-blue-600 text-white px-3 py-1.5 text-sm rounded-md hover:bg-blue-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={blockNumber === null}
            onClick={() => blockNumber !== null && fetchSingleBlock(blockNumber + 1)}
          >
            Next →
          </button>
          <Link
            to="/whiteboard"
            className="bg-gray-800 text-white px-3 py-1.5 text-sm rounded-md hover:bg-gray-700 shadow-sm text-sm font-medium flex items-center gap-1"
          >
            🔍 Whiteboard
          </Link>
        </div>
        <div id="block-info" className="text-base lg:text-lg font-bold text-gray-800 dark:text-gray-100 order-last w-full text-center lg:order-none lg:w-auto">
          <span id="current-block" className="text-blue-600 dark:text-blue-400">
            {label}
          </span>
          <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400 tabular-nums">
            {stats.txs.toLocaleString()} txs · {stats.nodes.toLocaleString()} addresses
          </span>
          {progress && progress.total > 1 && (
            <span className="ml-2 inline-flex items-center gap-2 text-xs font-normal align-middle">
              <span className="inline-block w-24 h-1.5 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <span
                  className="block h-full bg-blue-600 transition-[width]"
                  style={{ width: `${(100 * progress.loaded) / progress.total}%` }}
                />
              </span>
              <span className="tabular-nums text-gray-500 dark:text-gray-400">
                {progress.loaded}/{progress.total}
              </span>
              <button
                type="button"
                onClick={stopLoading}
                className="px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Stop
              </button>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            placeholder="Search Block Number"
            className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-md w-28 xl:w-40 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const parsed = Number(searchValue);
                if (Number.isNaN(parsed)) {
                  alert("Please enter a valid block number.");
                  return;
                }
                fetchSingleBlock(parsed);
              }
            }}
            id="block-search"
          />
          <button
            type="button"
            className="bg-green-600 text-white px-3 py-1.5 text-sm rounded-md hover:bg-green-700 shadow-sm"
            onClick={() => {
              const parsed = Number(searchValue);
              if (Number.isNaN(parsed)) {
                alert("Please enter a valid block number.");
                return;
              }
              fetchSingleBlock(parsed);
            }}
            id="search-btn"
          >
            Search
          </button>
          <input
            type="number"
            placeholder="From Block"
            className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-md w-28 xl:w-40 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
            id="range-start"
          />
          <input
            type="number"
            placeholder="To Block"
            className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-md w-28 xl:w-40 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
            value={rangeEnd}
            onChange={(e) => setRangeEnd(e.target.value)}
            id="range-end"
          />
          <button
            type="button"
            className="bg-blue-600 text-white px-3 py-1.5 text-sm rounded-md hover:bg-blue-700 shadow-sm"
            onClick={() => fetchRangeBlocks(rangeStart, rangeEnd)}
            id="range-fetch-btn"
          >
            Fetch Range
          </button>
        </div>
      </header>

      <div className="relative flex-1 min-h-0">
      {/* Overlay: address + transactions */}
      <div className="absolute top-3 left-3 z-[1000] w-[min(400px,calc(100%-1.5rem))] max-h-[55%] overflow-hidden">
        <div className="rounded-xl border border-blue-300 bg-blue-600/25 backdrop-blur-md shadow-lg">
          <div className="px-4 py-3 border-b border-blue-200/40 flex items-center justify-between">
            <div>
              {!selectedAddress && !selectedLink && (
                <>
                  <div className="text-sm font-semibold text-blue-900 dark:text-blue-100">Selection</div>
                  <div className="text-[11px] text-blue-900/80">Click a node or link to update</div>
                </>
              )}
            </div>
            {/* Copy button removed */}
          </div>
          <div className="p-4 overflow-auto" style={{ maxHeight: "40vh" }}>
            {selectedLink ? (
              <div>
                <div className="text-xs text-gray-800 dark:text-gray-100 font-bold mb-2">Transaction Link</div>
                
                <div className="text-xs text-gray-700 dark:text-gray-300 mb-1">From</div>
                <div className="text-xs font-mono text-gray-900 dark:text-gray-100 mb-2">
                  <a
                    href={`${explorer}/address/${selectedLink.from}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-1 rounded-md bg-white/70 dark:bg-gray-800/70 border border-blue-200 dark:border-blue-800 hover:bg-white/90 dark:hover:bg-gray-700 hover:underline"
                    title={selectedLink.from}
                  >
                    {shortHexLabel(selectedLink.from, "addr")}
                  </a>
                </div>
                
                <div className="text-xs text-gray-700 dark:text-gray-300 mb-1">To</div>
                <div className="text-xs font-mono text-gray-900 dark:text-gray-100 mb-2">
                  <a
                    href={`${explorer}/address/${selectedLink.to}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-1 rounded-md bg-white/70 dark:bg-gray-800/70 border border-blue-200 dark:border-blue-800 hover:bg-white/90 dark:hover:bg-gray-700 hover:underline"
                    title={selectedLink.to}
                  >
                    {shortHexLabel(selectedLink.to, "addr")}
                  </a>
                </div>
                
                {selectedLink.hash && (
                  <>
                    <div className="text-xs text-gray-700 dark:text-gray-300 mb-1">Transaction Hash</div>
                    <div className="text-xs font-mono text-gray-900 dark:text-gray-100 mb-2">
                      <a
                        href={`${explorer}/tx/${selectedLink.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1 rounded-md bg-white/70 dark:bg-gray-800/70 border border-blue-200 dark:border-blue-800 hover:bg-white/90 dark:hover:bg-gray-700 hover:underline"
                        title={selectedLink.hash}
                      >
                        {shortHexLabel(selectedLink.hash, "tx")}
                      </a>
                    </div>
                  </>
                )}
                
                <div className="text-xs text-gray-700 dark:text-gray-300 mb-1">Gas Price</div>
                <div className="text-xs font-mono text-gray-900 dark:text-gray-100">
                  <span className="px-2 py-1 rounded-md bg-yellow-100 dark:bg-yellow-900/40 border border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200" title={selectedLink.gasPrice || undefined}>
                    ⛽ {formatGasPrice(selectedLink.gasPrice)}
                  </span>
                </div>
              </div>
            ) : selectedAddress ? (
              <div>
                <div className="text-xs text-gray-800 dark:text-gray-100 font-bold mb-1">Address</div>
                <div className="text-xs font-mono text-gray-900 dark:text-gray-100 mb-3 inline-flex items-center gap-2">
                  <a
                    href={`${explorer}/address/${selectedAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-1 rounded-md bg-white/70 dark:bg-gray-800/70 border border-blue-200 dark:border-blue-800 hover:bg-white/90 dark:hover:bg-gray-700 hover:underline"
                    title={selectedAddress || undefined}
                  >
                    {shortHexLabel(selectedAddress, "addr")}
                  </a>
                </div>

                <div className="text-xs text-gray-800 dark:text-gray-100 font-bold mb-1">Outgoing (from)</div>
                <ul className="space-y-1">
                  {outgoing.map((l, i) => (
                      <li
                        key={`out-${i}`}
                        className="text-[11px] flex items-center gap-2 text-gray-900 dark:text-gray-100"
                      >
                        {l.hash ? (
                          <a
                            href={`${explorer}/tx/${l.hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-0.5 rounded bg-white/70 dark:bg-gray-800/70 border border-blue-200 dark:border-blue-800 hover:bg-white/90 dark:hover:bg-gray-700 hover:underline"
                            title={l.hash}
                          >
                            {shortHexLabel(l.hash, "tx")}
                          </a>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-white/70 dark:bg-gray-800/70 border border-blue-200 dark:border-blue-800">{shortHexLabel(undefined, "tx")}</span>
                        )}
                        <span className="text-gray-700 dark:text-gray-300">→</span>
                        {l.to ? (
                          <a
                            href={`${explorer}/address/${l.to}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-0.5 rounded bg-white/70 dark:bg-gray-800/70 border border-blue-200 dark:border-blue-800 hover:bg-white/90 dark:hover:bg-gray-700 hover:underline"
                            title={l.to}
                          >
                            {shortHexLabel(l.to, "addr")}
                          </a>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-white/70 dark:bg-gray-800/70 border border-blue-200 dark:border-blue-800">{shortHexLabel(undefined, "addr")}</span>
                        )}
                        <span className="px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/40 border border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 text-[10px]" title={l.gasPrice || undefined}>
                          ⛽ {formatGasPrice(l.gasPrice)}
                        </span>
                      </li>
                    ))}
                </ul>

                <div className="text-xs text-gray-800 dark:text-gray-100 font-bold mt-3 mb-1">Incoming (to)</div>
                <ul className="space-y-1">
                  {incoming.map((l, i) => (
                      <li
                        key={`in-${i}`}
                        className="text-[11px] flex items-center gap-2 text-gray-900 dark:text-gray-100"
                      >
                        {l.hash ? (
                          <a
                            href={`${explorer}/tx/${l.hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-0.5 rounded bg-white/70 dark:bg-gray-800/70 border border-blue-200 dark:border-blue-800 hover:bg-white/90 dark:hover:bg-gray-700 hover:underline"
                            title={l.hash}
                          >
                            {shortHexLabel(l.hash, "tx")}
                          </a>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-white/70 dark:bg-gray-800/70 border border-blue-200 dark:border-blue-800">{shortHexLabel(undefined, "tx")}</span>
                        )}
                        <span className="text-gray-700 dark:text-gray-300">←</span>
                        {l.from ? (
                          <a
                            href={`${explorer}/address/${l.from}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-0.5 rounded bg-white/70 dark:bg-gray-800/70 border border-blue-200 dark:border-blue-800 hover:bg-white/90 dark:hover:bg-gray-700 hover:underline"
                            title={l.from}
                          >
                            {shortHexLabel(l.from, "addr")}
                          </a>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-white/70 dark:bg-gray-800/70 border border-blue-200 dark:border-blue-800">{shortHexLabel(undefined, "addr")}</span>
                        )}
                        <span className="px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/40 border border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 text-[10px]" title={l.gasPrice || undefined}>
                          ⛽ {formatGasPrice(l.gasPrice)}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ) : (
              <div className="text-xs text-gray-700 dark:text-gray-300">Click a node or link to view details.</div>
            )}
          </div>
        </div>
      </div>

      {/* Graph Container */}
      <div id="graph-container" ref={containerRef} className="absolute inset-0 overflow-hidden bg-white dark:bg-gray-950">
        <svg
          ref={svgRef}
          id="graph"
          className="block"
          style={{ overflow: "hidden" }}
        />
      </div>

      {/* Legend */}
      <div id="legend" className="hidden md:block absolute bottom-3 left-3 bg-white/95 dark:bg-gray-900/95 backdrop-blur border border-gray-200 dark:border-gray-700 p-3 rounded-md shadow-sm">
        <div className="text-xs text-gray-600 dark:text-gray-400 mb-2 font-semibold">Node Type</div>
        <div className="flex items-center mb-1">
          <svg className="w-5 h-5 mr-2" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="5" fill="#666" />
          </svg>
          <span className="whitespace-nowrap text-xs">EOA (Wallet)</span>
        </div>
        <div className="flex items-center mb-3">
          <svg className="w-5 h-5 mr-2" viewBox="0 0 20 20">
            <rect x="5" y="5" width="10" height="10" fill="#666" />
          </svg>
          <span className="whitespace-nowrap text-xs">Contract</span>
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-400 mb-2 font-semibold">Address Role</div>
        <div className="flex items-center mb-1">
          <svg className="w-5 h-5 mr-2" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="5" fill="blue" />
          </svg>
          <span className="whitespace-nowrap text-xs">From Address</span>
        </div>
        <div className="flex items-center mb-1">
          <svg className="w-5 h-5 mr-2" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="5" fill="green" />
          </svg>
          <span className="whitespace-nowrap text-xs">To Address</span>
        </div>
        <div className="flex items-center mb-3">
          <svg className="w-5 h-5 mr-2" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="5" fill="purple" />
          </svg>
          <span className="whitespace-nowrap text-xs">Both (From & To)</span>
        </div>
        <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
          <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Gas Price</div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500 dark:text-gray-400">Low</span>
            <div className="w-20 h-3 rounded" style={{ background: "linear-gradient(to right, #1a9850, #fee08b, #d73027)" }}></div>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">High</span>
          </div>
          <div className="text-[10px] text-gray-400 mt-1">Thicker = Higher gas</div>
        </div>
      </div>
      </div>
    </div>
  );
}