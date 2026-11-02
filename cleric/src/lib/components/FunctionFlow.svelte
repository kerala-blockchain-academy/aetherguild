<script lang="ts">
  import {
    SvelteFlow,
    Background,
    Controls,
    useSvelteFlow,
    addEdge,
    type Node,
    type Edge,
    type Connection,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import { setContext, tick } from "svelte";
  import {
    createPublicClient,
    createWalletClient,
    http,
    defineChain,
  } from "viem";
  import { privateKeyToAccount } from "viem/accounts";
  import { theme } from "$lib/stores/theme.svelte";
  import FunctionNode from "$lib/components/nodes/FunctionNode.svelte";
  import OutputNode from "$lib/components/nodes/OutputNode.svelte";

  // Note: "result" (not "output") — "output" is a built-in Svelte Flow type and
  // would drag in its default node chrome (border/background) on top of ours.
  const nodeTypes = { function: FunctionNode, result: OutputNode };

  let nodes = $state.raw<Node[]>([]);
  let edges = $state.raw<Edge[]>([]);

  const sf = useSvelteFlow();

  // ── Druid chain + default dev account (same as the Contracts tab) ──────────
  const druidChain = defineChain({
    id: 1337,
    name: "Druid",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["http://localhost:8545"] } },
  });
  const account = privateKeyToAccount(
    "0xb71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291",
  );
  const walletClient = createWalletClient({
    account,
    transport: http("http://localhost:8545"),
    chain: druidChain,
  });
  const publicClient = createPublicClient({
    transport: http("http://localhost:8545"),
    chain: druidChain,
  });

  // ── Arg parsing / result formatting ────────────────────────────────────────
  function parseArg(raw: string, solType: string): unknown {
    const t = (solType ?? "").trim().toLowerCase();
    const v = (raw ?? "").trim();
    if (t === "bool") return v === "true" || v === "1";
    if (t.startsWith("uint") || t.startsWith("int")) {
      try { return BigInt(v || "0"); } catch { return 0n; }
    }
    return v;
  }
  function fmt(r: unknown): string {
    if (typeof r === "bigint") return r.toString();
    if (r === null || r === undefined) return "";
    if (typeof r === "object") {
      return JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    }
    return String(r);
  }

  // Update a node's data via the flow's internal store. Crucially this does NOT
  // reassign the bound `nodes`/`edges` arrays, so updating data while running a
  // node never triggers an edge reconciliation that would drop existing edges.
  function setData(nodeId: string, partial: Record<string, unknown>) {
    sf.updateNodeData(nodeId, partial);
  }

  // ── Run a function node, routing its result into a connected Output card ───
  // After it succeeds, cascade to any functions wired to its "next" handle, so
  // running one node runs the whole downstream chain in order. `visited` guards
  // against cycles.
  async function run(id: string, visited: Set<string> = new Set()) {
    if (visited.has(id)) return;
    visited.add(id);

    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const d: any = node.data;

    setData(id, { running: true, error: undefined });
    let ok = false;
    try {
      const inputs = d.inputs ?? [];
      const args = inputs.map((inp: any, i: number) =>
        parseArg(d.values?.[inp.name || `arg${i}`] ?? "", inp.type),
      );
      const isRead = d.stateMutability === "view" || d.stateMutability === "pure";

      let result: unknown;
      if (isRead) {
        result = await publicClient.readContract({
          address: d.address,
          abi: [d.abiItem],
          functionName: d.name,
          args: args.length ? (args as any) : undefined,
        });
      } else {
        const hash = await walletClient.writeContract({
          address: d.address,
          abi: [d.abiItem],
          functionName: d.name,
          args: args.length ? (args as any) : undefined,
        });
        await publicClient.waitForTransactionReceipt({ hash });
        result = `tx ${hash}`;
      }

      setData(id, { running: false });
      setOutput(id, fmt(result), "ok");
      ok = true;
    } catch (e: any) {
      setData(id, { running: false, error: String(e) });
      setOutput(id, String(e), "error");
    }

    // Continue the flow: run the functions connected to this node's "next" handle.
    if (ok) {
      const followers = edges
        .filter((e) => e.source === id && e.sourceHandle === "next")
        .map((e) => e.target);
      for (const nextId of followers) {
        const nextNode = nodes.find((n) => n.id === nextId);
        if (nextNode?.type === "function") await run(nextId, visited);
      }
    }
  }

  // Push a result into the output card wired to a function node.
  function setOutput(funcId: string, value: string, status: "ok" | "error") {
    const edge = edges.find((e) => e.source === funcId && e.sourceHandle === "out");
    if (edge?.target) setData(edge.target, { result: value, status });
  }

  // Wire an edge once the target node has been measured (so its handle exists),
  // then add it once via the library helper. Because node-data updates go through
  // updateNodeData (not array reassignment), this edge won't be churned later.
  async function connect(source: string, sourceHandle: string, target: string) {
    for (let i = 0; i < 60; i++) {
      if (sf.getNode(target)?.measured?.width) break;
      await tick();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    edges = addEdge({ id: `e-${source}-${target}`, source, sourceHandle, target }, edges);
  }

  // Custom nodes call run() through context (FunctionFlow owns the clients).
  setContext("cleric-flow", { run });

  // ── Drag-and-drop from the sidebar ─────────────────────────────────────────
  function onDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault();
    const raw = event.dataTransfer?.getData("application/cleric-fn");
    if (!raw) return;

    let fn: any;
    try { fn = JSON.parse(raw); } catch { return; }

    const position = sf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const fnId = `${fn.name}-${crypto.randomUUID().slice(0, 8)}`;
    const outId = `out-${crypto.randomUUID().slice(0, 8)}`;
    const inputs = fn.inputs ?? [];
    const values: Record<string, string> = {};
    inputs.forEach((inp: any, i: number) => (values[inp.name || `arg${i}`] = ""));

    // Drop the function card together with its (initially empty) output card.
    nodes = [
      ...nodes,
      {
        id: fnId,
        type: "function",
        position,
        data: {
          contract: fn.contract,
          address: fn.address,
          name: fn.name,
          stateMutability: fn.stateMutability,
          inputs,
          abiItem: fn.abiItem,
          values,
          running: false,
        },
      },
      {
        id: outId,
        type: "result",
        position: { x: position.x + 16, y: position.y + 250 },
        data: { label: `${fn.name} → result`, result: "", status: "idle" },
      },
    ];
    await connect(fnId, "out", outId);
  }

  function onConnect(connection: Connection) {
    edges = addEdge(connection, edges);
  }
</script>

<div class="h-full w-full" role="application" ondrop={onDrop} ondragover={onDragOver}>
  <SvelteFlow bind:nodes bind:edges {nodeTypes} onconnect={onConnect} colorMode={theme.resolved}>
    <Background />
    <Controls />
  </SvelteFlow>
</div>
