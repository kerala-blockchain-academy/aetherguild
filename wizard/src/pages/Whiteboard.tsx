

import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { Link } from "react-router-dom";
import { getBlock, saveTextFile, openTextFile } from "../api";
import { useTheme } from "../theme";
import {
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  type NodeProps,
  type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// ─── Theme context ─────────────────────────────────────────────────────────────

const ThemeCtx = React.createContext(false);

// ─── Canvas context (tx data + spawn action shared to nodes) ──────────────────

type Counterparty = { addr: string; isContract: boolean; txs: TxLink[] };
type LinkIndex = Map<string, { sent: Map<string, Counterparty>; received: Map<string, Counterparty> }>;

type CanvasActions = {
  linkIndex: LinkIndex; // address → counterparties in the loaded block data
  addrToNodeId: Map<string, string>; // address → existing nodeId on canvas
  spawnLinked: (
    sourceId: string,
    connAddr: string,
    tx: TxLink,
    direction: "to" | "from"
  ) => void;
};

// TxLink must be declared before this — forward-ref solved by hoisting below
const CanvasCtx = React.createContext<CanvasActions>({
  linkIndex: new Map(),
  addrToNodeId: new Map(),
  spawnLinked: () => {},
});

// ─── Types ─────────────────────────────────────────────────────────────────────

type WalletNodeData = { label: string; address: string; notes: string };

type NoteNodeData = { title: string; body: string };

type TxEdgeData = {
  hash: string;
  value: string;
  gasPrice: string;
  timestamp: string;
  notes: string;
};

type TxLink = {
  from: string;
  to: string;
  hash?: string;
  gasPrice?: string;
  fromIsContract?: boolean;
  toIsContract?: boolean;
};

// Payload carried in dataTransfer when dragging from the sidebar
type DragPayload =
  | { nodeType: "walletNode"; address: string; label: string }
  | { nodeType: "noteNode" };

// ─── Helpers ───────────────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortHash(h: string): string {
  if (!h || h.length < 10) return h;
  const core = h.startsWith("0x") ? h.slice(2) : h;
  return `0x${core.slice(0, 4)}…${core.slice(-4)}`;
}

function hexToGwei(hex?: string): string {
  if (!hex) return "";
  try {
    const gwei = Number(BigInt(hex)) / 1e9;
    return gwei.toFixed(2);
  } catch {
    return "";
  }
}

// ─── Wallet Node ───────────────────────────────────────────────────────────────

function WalletNode({ id, data, selected }: NodeProps & { data: WalletNodeData }) {
  const { updateNodeData } = useReactFlow();
  const dark = useContext(ThemeCtx);
  const { linkIndex, addrToNodeId, spawnLinked } = useContext(CanvasCtx);
  const [showLinked, setShowLinked] = useState(false);

  const ring = dark
    ? selected ? "border-blue-400 shadow-blue-900/40 shadow-lg" : "border-gray-600"
    : selected ? "border-blue-500 shadow-blue-100 shadow-lg" : "border-gray-300";

  const inp = (extra = "") =>
    [
      "nodrag w-full text-xs rounded-lg px-2.5 py-2 border",
      "focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent",
      dark
        ? "bg-gray-900 border-gray-600 text-gray-100 placeholder-gray-600"
        : "bg-gray-50 border-gray-300 text-gray-800 placeholder-gray-400",
      extra,
    ].join(" ");

  const lbl = `block text-[10px] font-bold uppercase tracking-wider mb-1 ${dark ? "text-gray-400" : "text-gray-500"}`;
  const handle = "!w-3.5 !h-3.5 !bg-blue-500 !border-2 !border-white";
  const handleStyle = { boxShadow: "0 0 0 1.5px #3b82f6" };

  // ── Compute addresses linked to this wallet in the loaded block data ─────────
  const linked = useMemo(() => {
    const entry = data.address ? linkIndex.get(data.address) : undefined;
    return {
      sent: entry ? Array.from(entry.sent.values()) : [],
      received: entry ? Array.from(entry.received.values()) : [],
    };
  }, [linkIndex, data.address]);

  const totalLinked = linked.sent.length + linked.received.length;

  // ── Popover row ──────────────────────────────────────────────────────────────
  function LinkedRow({
    addr,
    isContract,
    txs,
    direction,
  }: {
    addr: string;
    isContract: boolean;
    txs: TxLink[];
    direction: "to" | "from";
  }) {
    const alreadyOnCanvas = addrToNodeId.has(addr) && addrToNodeId.get(addr) !== id;
    return (
      <div
        className={[
          "flex items-center gap-1.5 px-3 py-1.5 transition-colors",
          dark ? "hover:bg-gray-700" : "hover:bg-gray-50",
        ].join(" ")}
      >
        <span className="text-xs shrink-0">{isContract ? "📜" : "👛"}</span>
        <span
          className={`font-mono text-[11px] flex-1 min-w-0 truncate ${dark ? "text-gray-200" : "text-gray-700"}`}
          title={addr}
        >
          {shortAddr(addr)}
        </span>
        <span className={`text-[10px] tabular-nums shrink-0 ${dark ? "text-gray-500" : "text-gray-400"}`}>
          {txs.length}tx
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            spawnLinked(id, addr, txs[0], direction);
          }}
          disabled={alreadyOnCanvas}
          title={alreadyOnCanvas ? "Already on canvas" : `Add ${shortAddr(addr)}`}
          className={[
            "shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold transition-colors",
            alreadyOnCanvas
              ? dark ? "text-green-400 cursor-default" : "text-green-600 cursor-default"
              : dark
              ? "bg-blue-600 text-white hover:bg-blue-500"
              : "bg-blue-600 text-white hover:bg-blue-700",
          ].join(" ")}
        >
          {alreadyOnCanvas ? "✓" : "+"}
        </button>
      </div>
    );
  }

  return (
    <div className={`border-2 rounded-xl p-3 w-64 shadow-md transition-all ${dark ? "bg-gray-800" : "bg-white"} ${ring}`}>
      <Handle type="target" position={Position.Left}   id="left"   className={handle} style={handleStyle} />
      <Handle type="target" position={Position.Top}    id="top"    className={handle} style={handleStyle} />

      {/* Label */}
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-lg leading-none select-none">👛</span>
        <input
          value={data.label}
          onChange={(e) => updateNodeData(id, { label: e.target.value })}
          placeholder="Wallet label"
          className={[
            "nodrag flex-1 min-w-0 text-sm font-semibold bg-transparent",
            "focus:outline-none border-b border-transparent focus:border-current",
            dark ? "text-gray-100 placeholder-gray-500" : "text-gray-800 placeholder-gray-400",
          ].join(" ")}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Address */}
      <label className={lbl}>Address</label>
      <input
        value={data.address}
        onChange={(e) => updateNodeData(id, { address: e.target.value })}
        placeholder="0x0000…0000"
        className={inp(`font-mono mb-2.5 ${dark ? "!text-emerald-400" : "!text-blue-700"}`)}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Notes */}
      <label className={lbl}>Notes</label>
      <textarea
        value={data.notes}
        onChange={(e) => updateNodeData(id, { notes: e.target.value })}
        placeholder="Describe this wallet…"
        rows={2}
        className={[
          "nodrag w-full text-xs rounded-lg px-2.5 py-2 border resize-none",
          "focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-transparent",
          dark
            ? "bg-gray-900 border-gray-600 text-gray-200 placeholder-gray-600"
            : "bg-gray-50 border-gray-300 text-gray-700 placeholder-gray-400",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      />

      {/* ── Linked addresses footer ── */}
      {totalLinked > 0 && data.address && (
        <div className={`mt-2.5 pt-2 border-t ${dark ? "border-gray-700" : "border-gray-100"} relative`}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowLinked((v) => !v); }}
            className={[
              "nodrag nopan w-full flex items-center justify-between text-[11px] font-semibold rounded-lg px-2 py-1.5 transition-colors",
              dark
                ? "text-blue-400 hover:bg-gray-700"
                : "text-blue-600 hover:bg-blue-50",
            ].join(" ")}
          >
            <span>🔗 {totalLinked} linked address{totalLinked !== 1 ? "es" : ""}</span>
            <span className="text-[10px]">{showLinked ? "▲" : "▼"}</span>
          </button>

          {/* Floating popover — rendered to the right of the node */}
          {showLinked && (
            <div
              className={[
                "absolute left-[calc(100%+10px)] top-0 z-[9999]",
                "w-72 max-h-72 flex flex-col rounded-xl border shadow-2xl overflow-hidden",
                dark
                  ? "bg-gray-800 border-gray-600 shadow-black/60"
                  : "bg-white border-gray-200 shadow-gray-300/50",
              ].join(" ")}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Popover header */}
              <div className={`flex items-center justify-between px-3 py-2 border-b shrink-0 ${dark ? "border-gray-700" : "border-gray-100"}`}>
                <span className={`text-xs font-bold ${dark ? "text-gray-100" : "text-gray-800"}`}>
                  Linked Addresses
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowLinked(false); }}
                  className={`text-xs w-5 h-5 flex items-center justify-center rounded-full ${dark ? "text-gray-400 hover:bg-gray-700 hover:text-gray-200" : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"}`}
                >✕</button>
              </div>

              {/* Scrollable list */}
              <div className="overflow-y-auto flex-1">
                {/* Sent section */}
                {linked.sent.length > 0 && (
                  <div>
                    <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider sticky top-0 ${dark ? "bg-gray-800 text-blue-400 border-b border-gray-700" : "bg-gray-50 text-blue-600 border-b border-gray-100"}`}>
                      → Sent to ({linked.sent.length})
                    </div>
                    {linked.sent.map(({ addr, isContract, txs }) => (
                      <LinkedRow key={addr} addr={addr} isContract={isContract} txs={txs} direction="to" />
                    ))}
                  </div>
                )}

                {/* Received section */}
                {linked.received.length > 0 && (
                  <div>
                    <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider sticky top-0 ${dark ? "bg-gray-800 text-green-400 border-b border-gray-700" : "bg-gray-50 text-green-600 border-b border-gray-100"}`}>
                      ← Received from ({linked.received.length})
                    </div>
                    {linked.received.map(({ addr, isContract, txs }) => (
                      <LinkedRow key={addr} addr={addr} isContract={isContract} txs={txs} direction="from" />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right}  id="right"  className={handle} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} id="bottom" className={handle} style={handleStyle} />
    </div>
  );
}

// ─── Note Node (empty freeform block) ─────────────────────────────────────────

function NoteNode({ id, data, selected }: NodeProps & { data: NoteNodeData }) {
  const { updateNodeData } = useReactFlow();
  const dark = useContext(ThemeCtx);

  const ring = dark
    ? selected ? "border-amber-400 shadow-amber-900/30 shadow-lg" : "border-gray-600"
    : selected ? "border-amber-400 shadow-amber-100 shadow-lg" : "border-amber-200";

  const handle = "!w-3.5 !h-3.5 !bg-amber-400 !border-2 !border-white";
  const handleStyle = { boxShadow: "0 0 0 1.5px #f59e0b" };

  return (
    <div
      className={[
        "border-2 rounded-xl p-3 w-56 shadow-md transition-all",
        dark ? "bg-gray-800" : "bg-amber-50",
        ring,
      ].join(" ")}
    >
      <Handle type="target" position={Position.Left}   id="left"   className={handle} style={handleStyle} />
      <Handle type="target" position={Position.Top}    id="top"    className={handle} style={handleStyle} />

      {/* Title */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-base leading-none select-none">📝</span>
        <input
          value={data.title}
          onChange={(e) => updateNodeData(id, { title: e.target.value })}
          placeholder="Title…"
          className={[
            "nodrag flex-1 min-w-0 text-sm font-semibold bg-transparent",
            "focus:outline-none border-b border-transparent focus:border-current",
            dark ? "text-gray-100 placeholder-gray-500" : "text-gray-800 placeholder-gray-400",
          ].join(" ")}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Body */}
      <textarea
        value={data.body}
        onChange={(e) => updateNodeData(id, { body: e.target.value })}
        placeholder="Write anything here…"
        rows={4}
        className={[
          "nodrag w-full text-xs rounded-lg px-2.5 py-2 border resize-none",
          "focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-transparent",
          dark
            ? "bg-gray-900 border-gray-600 text-gray-200 placeholder-gray-600"
            : "bg-white border-amber-200 text-gray-700 placeholder-gray-400",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      />

      <Handle type="source" position={Position.Right}  id="right"  className={handle} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} id="bottom" className={handle} style={handleStyle} />
    </div>
  );
}

// ─── Transaction Edge ──────────────────────────────────────────────────────────

function TxEdge({
  id,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data, selected, markerEnd,
}: EdgeProps & { data: TxEdgeData }) {
  const { updateEdgeData } = useReactFlow();
  const dark = useContext(ThemeCtx);
  const [open, setOpen] = useState(false);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const hasTx = !!data.hash;
  const edgeColor = selected ? "#3b82f6" : dark ? "#6b7280" : "#64748b";

  const fieldCls = [
    "nodrag w-full text-xs rounded-lg px-2.5 py-2 border",
    "focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent",
    dark
      ? "bg-gray-900 border-gray-600 text-gray-100 placeholder-gray-600"
      : "bg-gray-50 border-gray-300 text-gray-800 placeholder-gray-400",
  ].join(" ");

  const labelCls = `block text-[10px] font-bold uppercase tracking-wider mb-1 ${dark ? "text-gray-400" : "text-gray-500"}`;

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{ stroke: edgeColor, strokeWidth: selected ? 2.5 : 1.5 }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
            position: "absolute",
          }}
          className="nodrag nopan"
        >
          {/* ── Badge pill ── */}
          <button
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
            className={[
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-mono",
              "border shadow-sm transition-all leading-none whitespace-nowrap",
              hasTx
                ? dark
                  ? "bg-gray-800 border-blue-500 text-blue-300 hover:bg-gray-700"
                  : "bg-white border-blue-400 text-blue-700 font-semibold hover:bg-blue-50 shadow-blue-100/60"
                : dark
                ? "bg-gray-800 border-gray-600 text-gray-400 hover:border-blue-500 hover:text-blue-400"
                : "bg-white border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600",
            ].join(" ")}
          >
            {hasTx ? (
              <>
                <span className={dark ? "text-gray-500" : "text-gray-400"}>tx</span>
                <span>{shortHash(data.hash)}</span>
                {data.gasPrice && (
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold ${
                    dark ? "bg-amber-900/70 text-amber-300" : "bg-amber-50 text-amber-700 border border-amber-200"
                  }`}>
                    ⛽{data.gasPrice}
                  </span>
                )}
                {data.value && (
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold ${
                    dark ? "bg-blue-900/70 text-blue-300" : "bg-blue-50 text-blue-700 border border-blue-200"
                  }`}>
                    Ξ{data.value}
                  </span>
                )}
              </>
            ) : (
              <span>+ add tx</span>
            )}
          </button>

          {/* ── Edit panel ── */}
          {open && (
            <div
              className={[
                "absolute top-8 left-1/2 -translate-x-1/2 border rounded-2xl shadow-2xl p-4 w-[min(20rem,90vw)] z-50",
                dark
                  ? "bg-gray-800 border-gray-600 shadow-black/60"
                  : "bg-white border-gray-200 shadow-gray-300/40",
              ].join(" ")}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className={`text-sm font-bold ${dark ? "text-gray-100" : "text-gray-800"}`}>Transaction</p>
                  <p className={`text-[10px] ${dark ? "text-gray-500" : "text-gray-400"}`}>
                    From Polygonscan or auto-filled
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setOpen(false); }}
                  className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${
                    dark ? "text-gray-400 hover:bg-gray-700 hover:text-gray-200" : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  }`}
                >✕</button>
              </div>

              <div className="space-y-2.5">
                {/* Tx hash */}
                <div>
                  <label className={labelCls}>Tx Hash</label>
                  <input
                    value={data.hash}
                    onChange={(e) => updateEdgeData(id, { hash: e.target.value })}
                    placeholder="0x…"
                    className={`${fieldCls} font-mono ${dark ? "!text-emerald-400" : "!text-blue-700"}`}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>

                {/* Value + Gas */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Value (ETH)</label>
                    <input
                      value={data.value}
                      onChange={(e) => updateEdgeData(id, { value: e.target.value })}
                      placeholder="0.0"
                      className={`${fieldCls} font-mono`}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Gas (Gwei)</label>
                    <input
                      value={data.gasPrice}
                      onChange={(e) => updateEdgeData(id, { gasPrice: e.target.value })}
                      placeholder="21"
                      className={`${fieldCls} font-mono`}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>

                {/* Timestamp */}
                <div>
                  <label className={labelCls}>Timestamp</label>
                  <input
                    value={data.timestamp}
                    onChange={(e) => updateEdgeData(id, { timestamp: e.target.value })}
                    placeholder="2024-01-01 00:00 UTC"
                    className={fieldCls}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className={labelCls}>Notes</label>
                  <textarea
                    value={data.notes}
                    onChange={(e) => updateEdgeData(id, { notes: e.target.value })}
                    placeholder="Suspicious transfer…"
                    rows={2}
                    className={`${fieldCls} resize-none`}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>

              {/* Summary chips */}
              {(data.value || data.gasPrice || data.timestamp) && (
                <div className="flex gap-1.5 flex-wrap mt-3 pt-3 border-t border-dashed border-gray-200 dark:border-gray-700">
                  {data.value && (
                    <span className={`px-2 py-1 text-[10px] rounded-full font-mono font-semibold ${
                      dark ? "bg-blue-900/60 border border-blue-700 text-blue-300" : "bg-blue-50 border border-blue-200 text-blue-700"
                    }`}>Ξ {data.value}</span>
                  )}
                  {data.gasPrice && (
                    <span className={`px-2 py-1 text-[10px] rounded-full font-mono ${
                      dark ? "bg-amber-900/60 border border-amber-700 text-amber-300" : "bg-amber-50 border border-amber-300 text-amber-700"
                    }`}>⛽ {data.gasPrice} Gwei</span>
                  )}
                  {data.timestamp && (
                    <span className={`px-2 py-1 text-[10px] rounded-full ${
                      dark ? "bg-gray-700 border border-gray-600 text-gray-300" : "bg-gray-100 border border-gray-300 text-gray-600"
                    }`}>🕐 {data.timestamp}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

// ─── Stable registries ─────────────────────────────────────────────────────────

const NODE_TYPES: NodeTypes = { walletNode: WalletNode, noteNode: NoteNode };
const EDGE_TYPES: EdgeTypes = { txEdge: TxEdge };

let counter = 1;
function nextId() { return `node_${counter++}`; }

// ─── Canvas ────────────────────────────────────────────────────────────────────

function Canvas({ dark }: { dark: boolean }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, getNode } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // ── Block / tx state ───────────────────────────────────────────────────────
  const [txLinks, setTxLinks] = useState<TxLink[]>([]);
  const [loadedBlocks, setLoadedBlocks] = useState<number[]>([]);
  const [blockInput, setBlockInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [addrFilter, setAddrFilter] = useState("");
  // Sidebar is inline on wide windows and an overlay on narrow ones; start collapsed when narrow.
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 900);

  // Ref so onConnect always sees fresh txLinks without re-creating itself
  const txLinksRef = useRef<TxLink[]>([]);
  txLinksRef.current = txLinks;

  // Ref so fetchBlock always sees fresh loadedBlocks
  const loadedBlocksRef = useRef<number[]>([]);
  loadedBlocksRef.current = loadedBlocks;

  // ── Fetch a block's transactions ───────────────────────────────────────────
  const fetchBlock = useCallback(
    async (bn: number) => {
      if (loadedBlocksRef.current.includes(bn)) return;
      setLoading(true);
      try {
        const links: TxLink[] = await getBlock(bn);
        setTxLinks((prev) => {
          // Deduplicate by hash; if no hash use from+to
          const seen = new Set(prev.map((l) => l.hash ?? `${l.from}>${l.to}`));
          const fresh = links.filter((l) => !seen.has(l.hash ?? `${l.from}>${l.to}`));
          return [...prev, ...fresh];
        });
        setLoadedBlocks((prev) => [...prev, bn]);
      } catch (err: any) {
        alert(`Failed to load block ${bn}: ${err?.message ?? String(err)}`);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // ── Derived address list ───────────────────────────────────────────────────
  const addresses = useMemo(() => {
    const map = new Map<
      string,
      { isContract: boolean; asSender: number; asReceiver: number }
    >();
    for (const l of txLinks) {
      if (l.from) {
        const e = map.get(l.from) ?? {
          isContract: l.fromIsContract ?? false,
          asSender: 0,
          asReceiver: 0,
        };
        map.set(l.from, { ...e, asSender: e.asSender + 1 });
      }
      if (l.to) {
        const e = map.get(l.to) ?? {
          isContract: l.toIsContract ?? false,
          asSender: 0,
          asReceiver: 0,
        };
        map.set(l.to, { ...e, asReceiver: e.asReceiver + 1 });
      }
    }
    return Array.from(map.entries())
      .map(([addr, m]) => ({ addr, ...m }))
      .sort((a, b) => b.asSender + b.asReceiver - (a.asSender + a.asReceiver));
  }, [txLinks]);

  const filteredAddresses = useMemo(() => {
    if (!addrFilter.trim()) return addresses;
    const q = addrFilter.toLowerCase();
    return addresses.filter((a) => a.addr.toLowerCase().includes(q));
  }, [addresses, addrFilter]);

  // ── Address → nodeId map (for dedup in WalletNode popover) ──────────────────

  // `nodes` changes on every drag frame; key the map on the address/id pairs
  // only, so dragging doesn't hand every node a new context value.
  const addrKey = nodes
    .filter((n) => n.type === "walletNode" && (n.data as WalletNodeData).address)
    .map((n) => `${n.id}=${(n.data as WalletNodeData).address}`)
    .join("|");
  const addrToNodeId = useMemo(() => {
    const map = new Map<string, string>();
    for (const pair of addrKey ? addrKey.split("|") : []) {
      const i = pair.indexOf("=");
      map.set(pair.slice(i + 1), pair.slice(0, i));
    }
    return map;
  }, [addrKey]);

  // ── Address → counterparties, built once per data load (not per node) ─────
  const linkIndex = useMemo(() => {
    const index: LinkIndex = new Map();
    const side = (addr: string) => {
      let e = index.get(addr);
      if (!e) index.set(addr, (e = { sent: new Map(), received: new Map() }));
      return e;
    };
    const add = (m: Map<string, Counterparty>, addr: string, isContract: boolean, tx: TxLink) => {
      const c = m.get(addr);
      if (c) c.txs.push(tx);
      else m.set(addr, { addr, isContract, txs: [tx] });
    };
    for (const l of txLinks) {
      if (!l.from || !l.to) continue;
      add(side(l.from).sent, l.to, l.toIsContract ?? false, l);
      add(side(l.to).received, l.from, l.fromIsContract ?? false, l);
    }
    return index;
  }, [txLinks]);

  const addrToNodeIdRef = useRef<Map<string, string>>(addrToNodeId);
  addrToNodeIdRef.current = addrToNodeId;

  // ── Spawn a linked wallet node (+ edge) from a node's linked-addresses panel ─

  const spawnLinked = useCallback(
    (sourceId: string, connAddr: string, tx: TxLink, direction: "to" | "from") => {
      const sourceNode = getNode(sourceId);
      const sourcePos = sourceNode?.position ?? { x: 400, y: 300 };

      const txData: TxEdgeData = {
        hash: tx.hash ?? "",
        value: "",
        gasPrice: hexToGwei(tx.gasPrice),
        timestamp: "",
        notes: "Auto-filled from block data",
      };

      const arrow = { type: "arrowclosed" as any, color: dark ? "#6b7280" : "#94a3b8" };

      // If address already on canvas, just wire an edge
      const existingId = addrToNodeIdRef.current.get(connAddr);
      if (existingId) {
        const edgeId = `e-spawn-${sourceId}-${existingId}-${Date.now()}`;
        setEdges((eds) => [
          ...eds,
          {
            id: edgeId,
            source: direction === "to" ? sourceId : existingId,
            target: direction === "to" ? existingId : sourceId,
            type: "txEdge",
            markerEnd: arrow,
            data: txData,
          },
        ]);
        return;
      }

      // Otherwise create a new node offset from the source
      const offsetX = direction === "to" ? 340 : -340;
      // Stack vertically by how many nodes already live in that column
      const sameCol = Array.from(addrToNodeIdRef.current.values()).filter(
        (nid) => {
          const n = getNode(nid);
          if (!n) return false;
          return direction === "to"
            ? n.position.x > sourcePos.x
            : n.position.x < sourcePos.x;
        }
      ).length;
      const offsetY = sameCol * 160 - 80;

      const newId = nextId();
      setNodes((nds) => [
        ...nds,
        {
          id: newId,
          type: "walletNode",
          position: { x: sourcePos.x + offsetX, y: sourcePos.y + offsetY },
          data: {
            label: shortAddr(connAddr),
            address: connAddr,
            notes: "",
          } satisfies WalletNodeData,
        },
      ]);
      setEdges((eds) => [
        ...eds,
        {
          id: `e-spawn-${sourceId}-${newId}`,
          source: direction === "to" ? sourceId : newId,
          target: direction === "to" ? newId : sourceId,
          type: "txEdge",
          markerEnd: arrow,
          data: txData,
        },
      ]);
    },
    [getNode, setNodes, setEdges, dark]
  );

  // ── React Flow handlers ────────────────────────────────────────────────────

  const onConnect = useCallback(
    (params: Connection) => {
      // Look up addresses from node data
      const src = params.source ? getNode(params.source) : null;
      const tgt = params.target ? getNode(params.target) : null;
      const srcAddr = ((src?.data) as WalletNodeData | undefined)?.address ?? "";
      const tgtAddr = ((tgt?.data) as WalletNodeData | undefined)?.address ?? "";

      // Find a matching tx in loaded data (directional or reverse)
      const match =
        srcAddr && tgtAddr
          ? txLinksRef.current.find(
              (l) =>
                (l.from === srcAddr && l.to === tgtAddr) ||
                (l.from === tgtAddr && l.to === srcAddr)
            )
          : undefined;

      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "txEdge",
            markerEnd: {
              type: "arrowclosed" as any,
              color: dark ? "#6b7280" : "#94a3b8",
            },
            data: {
              hash: match?.hash ?? "",
              value: "",
              gasPrice: hexToGwei(match?.gasPrice),
              timestamp: "",
              notes: match ? "Auto-filled from block data" : "",
            } satisfies TxEdgeData,
          },
          eds
        )
      );
    },
    [getNode, setEdges, dark]
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/reactflow");
      if (!raw) return;
      const payload = JSON.parse(raw) as DragPayload;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

      if (payload.nodeType === "noteNode") {
        setNodes((nds) => [
          ...nds,
          {
            id: nextId(),
            type: "noteNode",
            position,
            data: { title: "", body: "" } satisfies NoteNodeData,
          },
        ]);
      } else {
        setNodes((nds) => [
          ...nds,
          {
            id: nextId(),
            type: "walletNode",
            position,
            data: {
              label: payload.label || "Wallet",
              address: payload.address || "",
              notes: "",
            } satisfies WalletNodeData,
          },
        ]);
      }
    },
    [screenToFlowPosition, setNodes]
  );

  // ── Import / Export ────────────────────────────────────────────────────────

  async function exportJSON() {
    const payload = {
      nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
      edges: edges.map(({ id, source, target, sourceHandle, targetHandle, type, data }) => ({
        id, source, target, sourceHandle, targetHandle, type, data,
      })),
      meta: { loadedBlocks },
    };
    try {
      await saveTextFile(`investigation-${Date.now()}.json`, JSON.stringify(payload, null, 2));
    } catch (err: any) {
      alert(`Export failed: ${err?.message ?? String(err)}`);
    }
  }

  async function importJSON() {
    try {
      const text = await openTextFile();
      if (text == null) return;
      const parsed = JSON.parse(text);
      setNodes(parsed.nodes ?? []);
      setEdges(parsed.edges ?? []);
    } catch {
      alert("Invalid JSON file.");
    }
  }

  // ── Theme helpers ──────────────────────────────────────────────────────────

  const d = dark;
  const panel = d ? "bg-gray-900 border-gray-700" : "bg-white border-gray-200";
  const muted = d ? "text-gray-400" : "text-gray-500";
  const dimmed = d ? "text-gray-600" : "text-gray-400";
  const sectionLabel = `text-[10px] font-bold uppercase tracking-wider ${muted}`;
  const divider = `border-t ${d ? "border-gray-800" : "border-gray-100"}`;

  function inpCls(extra = "") {
    return [
      "w-full text-xs rounded-lg px-2.5 py-1.5 border",
      "focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent",
      d
        ? "bg-gray-800 border-gray-600 text-gray-100 placeholder-gray-600"
        : "bg-gray-50 border-gray-300 text-gray-800 placeholder-gray-400",
      extra,
    ].join(" ");
  }

  function btnCls(variant: "ghost" | "primary" | "danger") {
    const base = "px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all";
    if (variant === "primary") return `${base} bg-blue-600 hover:bg-blue-700 text-white border-transparent shadow-sm`;
    if (variant === "danger")
      return `${base} ${d ? "bg-red-900/50 border-red-800 text-red-300 hover:bg-red-900" : "bg-red-50 border-red-200 text-red-600 hover:bg-red-100"}`;
    return `${base} ${d ? "bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`;
  }

  const canvasCtx = useMemo(() => ({ linkIndex, addrToNodeId, spawnLinked }), [linkIndex, addrToNodeId, spawnLinked]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <CanvasCtx.Provider value={canvasCtx}>
    <ThemeCtx.Provider value={dark}>
      <div className={`relative flex h-full w-full overflow-hidden ${d ? "bg-gray-950" : "bg-slate-100"}`}>

        {/* ═══ SIDEBAR ═══ */}
        <aside className={`${sidebarOpen ? "flex" : "hidden"} max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:shadow-2xl w-56 shrink-0 flex-col border-r shadow-sm ${panel}`}>

          {/* Back link */}
          <div className={`px-3 pt-3 pb-2.5 ${divider}`}>
            <Link
              to="/"
              className={`text-[11px] transition-colors ${d ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-700"}`}
            >
              ← Back to Graph
            </Link>
          </div>

          {/* ── Node templates ── */}
          <div className={`px-3 py-2.5 ${divider}`}>
            <p className={`${sectionLabel} mb-2`}>Drag to Canvas</p>
            <div className="flex flex-col gap-1.5">
              {/* Wallet */}
              <div
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData(
                    "application/reactflow",
                    JSON.stringify({ nodeType: "walletNode", address: "", label: "Wallet" } satisfies DragPayload)
                  )
                }
                className={[
                  "flex items-center gap-2 border-2 rounded-xl px-3 py-2",
                  "cursor-grab active:cursor-grabbing select-none transition-all",
                  d
                    ? "bg-gray-800 border-gray-600 hover:border-blue-500 hover:shadow-md hover:shadow-blue-900/20"
                    : "bg-white border-gray-300 hover:border-blue-400 hover:shadow-sm shadow-sm",
                ].join(" ")}
              >
                <span className="text-base">👛</span>
                <span className={`text-xs font-semibold ${d ? "text-gray-200" : "text-gray-700"}`}>Wallet</span>
              </div>

              {/* Empty / Note */}
              <div
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData(
                    "application/reactflow",
                    JSON.stringify({ nodeType: "noteNode" } satisfies DragPayload)
                  )
                }
                className={[
                  "flex items-center gap-2 border-2 rounded-xl px-3 py-2",
                  "cursor-grab active:cursor-grabbing select-none transition-all",
                  d
                    ? "bg-gray-800 border-gray-600 hover:border-amber-500 hover:shadow-md hover:shadow-amber-900/20"
                    : "bg-amber-50 border-amber-200 hover:border-amber-400 hover:shadow-sm shadow-sm",
                ].join(" ")}
              >
                <span className="text-base">📝</span>
                <span className={`text-xs font-semibold ${d ? "text-gray-200" : "text-gray-700"}`}>Note</span>
              </div>
            </div>
          </div>

          {/* ── Block loader ── */}
          <div className={`px-3 py-2.5 ${divider}`}>
            <p className={`${sectionLabel} mb-2`}>Block Data</p>

            <div className="flex gap-1.5">
              <input
                type="number"
                value={blockInput}
                onChange={(e) => setBlockInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const n = Number(blockInput);
                  if (!Number.isNaN(n) && n >= 0) fetchBlock(n);
                }}
                placeholder="Block #"
                className={inpCls("font-mono flex-1 min-w-0")}
              />
              <button
                onClick={() => {
                  const n = Number(blockInput);
                  if (!Number.isNaN(n) && n >= 0) fetchBlock(n);
                }}
                disabled={loading}
                className="px-2.5 py-1.5 text-[11px] font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg transition-colors shrink-0"
              >
                {loading ? "…" : "Load"}
              </button>
            </div>

            {/* Loaded block chips */}
            {loadedBlocks.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {loadedBlocks.map((bn) => (
                  <span
                    key={bn}
                    className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                      d
                        ? "bg-gray-700 text-gray-300"
                        : "bg-blue-50 text-blue-700 border border-blue-200"
                    }`}
                  >
                    #{bn}
                  </span>
                ))}
              </div>
            )}

            {/* Stats */}
            {txLinks.length > 0 && (
              <p className={`text-[10px] mt-1.5 ${dimmed}`}>
                {txLinks.length} transactions · {addresses.length} addresses
              </p>
            )}
          </div>

          {/* ── Address list ── */}
          <div className="flex-1 flex flex-col min-h-0 px-3 py-2.5">
            <div className="flex items-center gap-2 mb-2">
              <p className={sectionLabel}>Addresses</p>
              {addresses.length > 0 && (
                <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${d ? "bg-gray-700 text-gray-400" : "bg-gray-100 text-gray-500"}`}>
                  {addresses.length}
                </span>
              )}
            </div>

            {/* Filter */}
            {addresses.length > 6 && (
              <input
                value={addrFilter}
                onChange={(e) => setAddrFilter(e.target.value)}
                placeholder="Filter…"
                className={`${inpCls()} mb-2`}
              />
            )}

            {/* Role legend */}
            {addresses.length > 0 && (
              <div className={`flex items-center gap-2.5 text-[10px] mb-2 ${dimmed}`}>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />Sender</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Receiver</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />Both</span>
              </div>
            )}

            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
              {loading && addresses.length === 0 && (
                <div className={`text-[11px] text-center py-6 ${dimmed}`}>
                  <div className="animate-pulse">Fetching block data…</div>
                </div>
              )}
              {!loading && addresses.length === 0 && (
                <div className={`text-[11px] text-center py-6 ${dimmed}`}>
                  No data loaded yet
                </div>
              )}

              {filteredAddresses.map(({ addr, isContract, asSender, asReceiver }) => {
                const role =
                  asSender > 0 && asReceiver > 0
                    ? "both"
                    : asSender > 0
                    ? "from"
                    : "to";
                const dotColor =
                  role === "both"
                    ? "bg-purple-500"
                    : role === "from"
                    ? "bg-blue-500"
                    : "bg-green-500";
                const txCount = asSender + asReceiver;

                return (
                  <div
                    key={addr}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData(
                        "application/reactflow",
                        JSON.stringify({
                          nodeType: "walletNode",
                          address: addr,
                          label: shortAddr(addr),
                        } satisfies DragPayload)
                      )
                    }
                    title={`${addr}\n${asSender} sent · ${asReceiver} received`}
                    className={[
                      "flex items-center gap-2 rounded-lg px-2 py-1.5",
                      "cursor-grab active:cursor-grabbing select-none transition-colors",
                      d
                        ? "hover:bg-gray-800 text-gray-300"
                        : "hover:bg-gray-50 text-gray-700 border border-transparent hover:border-gray-200",
                    ].join(" ")}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                    <span className="text-sm shrink-0">{isContract ? "📜" : "👛"}</span>
                    <span className={`font-mono text-[11px] flex-1 min-w-0 truncate ${d ? "text-gray-200" : "text-gray-700"}`}>
                      {shortAddr(addr)}
                    </span>
                    <span className={`text-[10px] shrink-0 tabular-nums ${dimmed}`}>{txCount}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tips */}
          <div className={`px-3 py-2.5 ${divider} text-[10px] space-y-1 leading-relaxed ${dimmed}`}>
            <p>Drag address → canvas to add node</p>
            <p>Connect nodes → tx auto-fills</p>
            <p>Click edge badge to view/edit tx</p>
          </div>
        </aside>

        {/* ═══ MAIN ═══ */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Toolbar */}
          <header className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5 shrink-0 border-b shadow-sm ${panel}`}>
            <button onClick={() => setSidebarOpen((v) => !v)} className={btnCls("ghost")} title="Toggle sidebar">
              ☰
            </button>
            <span className={`text-sm font-bold ${d ? "text-white" : "text-gray-800"}`}>
              🔍 Investigator
            </span>
            <span className={`text-xs ${dimmed}`}>
              {nodes.length} wallet{nodes.length !== 1 ? "s" : ""}
              {" · "}
              {edges.length} link{edges.length !== 1 ? "s" : ""}
            </span>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button onClick={importJSON} className={btnCls("ghost")}>Import</button>
              <button onClick={exportJSON} className={btnCls("primary")}>Export JSON</button>
              <button
                onClick={() => { setNodes([]); setEdges([]); }}
                className={btnCls("danger")}
              >
                Clear
              </button>
            </div>
          </header>

          {/* Canvas */}
          <div ref={wrapperRef} className="flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onDrop={onDrop}
              onDragOver={onDragOver}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              colorMode={d ? "dark" : "light"}
              fitView
              deleteKeyCode={["Backspace", "Delete"]}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1.5}
                color={d ? "#374151" : "#cbd5e1"}
              />
              <MiniMap
                nodeColor={d ? "#3b82f6" : "#2563eb"}
                maskColor={d ? "rgba(3,7,18,0.80)" : "rgba(241,245,249,0.80)"}
                className={[
                  "!hidden md:!block !rounded-xl !shadow-md !border",
                  d ? "!bg-gray-900 !border-gray-700" : "!bg-white !border-gray-200",
                ].join(" ")}
              />
              <Controls
                className={[
                  "!rounded-xl !shadow-sm !border",
                  "[&>button]:!border-b [&>button:last-child]:!border-b-0",
                  d
                    ? "!border-gray-700 [&>button]:!bg-gray-800 [&>button]:!border-gray-700 [&>button]:!text-gray-300 [&>button:hover]:!bg-gray-700"
                    : "!border-gray-200 [&>button]:!bg-white [&>button]:!border-gray-200 [&>button]:!text-gray-600 [&>button:hover]:!bg-gray-50",
                ].join(" ")}
              />
            </ReactFlow>
          </div>
        </div>
      </div>
    </ThemeCtx.Provider>
    </CanvasCtx.Provider>
  );
}

// ─── Page export ───────────────────────────────────────────────────────────────

export default function WhiteboardPage() {
  const { dark } = useTheme();
  return (
    <ReactFlowProvider>
      <Canvas dark={dark} />
    </ReactFlowProvider>
  );
}
