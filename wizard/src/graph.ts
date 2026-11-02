import * as d3 from "d3";
import type { TxLink } from "./api";

type Role = "from" | "to" | "both";

export type GraphNode = d3.SimulationNodeDatum & { id: string; group: Role; isContract: boolean };
export type GraphLink = d3.SimulationLinkDatum<GraphNode> & {
  tx: TxLink;
  /** Gas price in wei as a number, parsed once (0 when unknown). */
  gas: number;
};

const ROLE_COLOR: Record<Role, string> = { from: "blue", to: "green", both: "purple" };
const symbolCircle = d3.symbol().type(d3.symbolCircle).size(150)()!;
const symbolSquare = d3.symbol().type(d3.symbolSquare).size(150)()!;

function parseGas(hex?: string): number {
  if (!hex) return 0;
  try {
    return Number(BigInt(hex));
  } catch {
    return 0;
  }
}

/**
 * Incremental d3 force graph of transactions. Links can be appended in
 * batches: existing nodes keep their positions and only new elements are
 * added to the DOM, so large block ranges render progressively.
 */
export class TxGraph {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private root: d3.Selection<SVGGElement, unknown, null, undefined>;
  private linkLayer: d3.Selection<SVGGElement, unknown, null, undefined>;
  private nodeLayer: d3.Selection<SVGGElement, unknown, null, undefined>;
  private message: d3.Selection<SVGTextElement, unknown, null, undefined>;
  private linkSel!: d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown>;
  private nodeSel!: d3.Selection<SVGPathElement, GraphNode, SVGGElement, unknown>;
  private simulation: d3.Simulation<GraphNode, GraphLink>;

  private nodes = new Map<string, GraphNode>();
  private links: GraphLink[] = [];
  private minGas = Infinity;
  private maxGas = 0;
  private width = 1;
  private height = 1;

  /** Every link loaded so far, in load order (for the details panel). */
  readonly txs: TxLink[] = [];

  constructor(
    el: SVGSVGElement,
    private onSelectNode: (id: string) => void,
    private onSelectLink: (tx: TxLink) => void,
  ) {
    this.svg = d3.select(el);
    this.svg.selectAll("*").remove();
    this.root = this.svg.append("g");
    this.linkLayer = this.root.append("g").attr("stroke-opacity", 0.7);
    this.nodeLayer = this.root.append("g").attr("stroke-width", 1.5);
    this.message = this.svg.append("text").attr("text-anchor", "middle").style("pointer-events", "none");

    this.svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.05, 10])
        .on("zoom", (event) => this.root.attr("transform", event.transform)),
    );

    this.simulation = d3
      .forceSimulation<GraphNode, GraphLink>()
      .force("link", d3.forceLink<GraphNode, GraphLink>().id((d) => d.id))
      // distanceMax keeps the n-body force local, which matters with thousands of nodes.
      .force("charge", d3.forceManyBody<GraphNode>().distanceMax(300))
      .force("x", d3.forceX<GraphNode>().strength(0.1))
      .force("y", d3.forceY<GraphNode>().strength(0.1))
      .on("tick", () => this.tick());

    this.join();
  }

  get nodeCount() {
    return this.nodes.size;
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.svg.attr("width", width).attr("height", height);
    this.message.attr("x", width / 2).attr("y", height / 2);
    (this.simulation.force("x") as d3.ForceX<GraphNode>).x(width / 2);
    (this.simulation.force("y") as d3.ForceY<GraphNode>).y(height / 2);
    if (this.nodes.size) this.simulation.alpha(0.3).restart();
  }

  /** Show a centered status message (or clear it with null). */
  setMessage(text: string | null, color = "#888") {
    this.message.text(text ?? "").style("fill", color).style("font-size", "16px");
  }

  clear() {
    this.simulation.stop();
    this.nodes.clear();
    this.links = [];
    this.txs.length = 0;
    this.minGas = Infinity;
    this.maxGas = 0;
    this.join();
  }

  add(batch: TxLink[]) {
    if (!batch.length) return;
    const cx = this.width / 2;
    const cy = this.height / 2;

    const upsert = (id: string, role: Role, isContract: boolean, near?: GraphNode) => {
      const existing = this.nodes.get(id);
      if (existing) {
        if (existing.group !== role) existing.group = "both";
        return existing;
      }
      // Spawn next to a known neighbour (or the centre) so new batches don't
      // fly in from the origin and shake the whole layout.
      const n: GraphNode = {
        id,
        group: role,
        isContract,
        x: (near?.x ?? cx) + (Math.random() - 0.5) * 40,
        y: (near?.y ?? cy) + (Math.random() - 0.5) * 40,
      };
      this.nodes.set(id, n);
      return n;
    };

    for (const tx of batch) {
      const source = upsert(tx.from, "from", tx.fromIsContract ?? false, this.nodes.get(tx.to));
      const target = upsert(tx.to, "to", tx.toIsContract ?? false, source);
      const gas = parseGas(tx.gasPrice);
      if (gas > 0) {
        this.minGas = Math.min(this.minGas, gas);
        this.maxGas = Math.max(this.maxGas, gas);
      }
      this.links.push({ source, target, tx, gas });
      this.txs.push(tx);
    }

    this.join();
    this.simulation.alpha(Math.max(this.simulation.alpha(), 0.5)).restart();
  }

  destroy() {
    this.simulation.stop();
    this.svg.on(".zoom", null);
    this.svg.selectAll("*").remove();
  }

  private join() {
    const nodes = Array.from(this.nodes.values());
    this.simulation.nodes(nodes);
    (this.simulation.force("link") as d3.ForceLink<GraphNode, GraphLink>).links(this.links);

    const hasGas = this.maxGas > 0;
    const min = hasGas ? this.minGas : 0;
    const max = hasGas ? this.maxGas : 1;
    // Reversed domain so high gas = red, low = green; thickness 1 → 5.
    const color = d3.scaleSequential(d3.interpolateRdYlGn).domain([max, min]);
    const width = d3.scaleLinear().domain([min, max]).range([1, 5]);

    this.linkSel = this.linkLayer
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(this.links)
      .join((enter) =>
        enter
          .append("line")
          .style("cursor", "pointer")
          .on("click", (_, d) => this.onSelectLink(d.tx)),
      )
      // The gas range can widen with each batch, so restyle every link.
      .attr("stroke", (d) => (hasGas ? color(d.gas || min) : "#999"))
      .attr("stroke-width", (d) => (hasGas ? width(d.gas || min) : 1));

    const drag = d3
      .drag<SVGPathElement, GraphNode>()
      .on("start", (event, d) => {
        if (!event.active) this.simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) this.simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    this.nodeSel = this.nodeLayer
      .selectAll<SVGPathElement, GraphNode>("path")
      .data(nodes, (d) => d.id)
      .join((enter) =>
        enter
          .append("path")
          .attr("d", (d) => (d.isContract ? symbolSquare : symbolCircle))
          .style("cursor", "pointer")
          .on("click", (_, d) => this.onSelectNode(d.id))
          .call(drag),
      )
      // A node's role can become "both" when a later batch arrives.
      .attr("fill", (d) => ROLE_COLOR[d.group]);
  }

  private tick() {
    this.linkSel
      .attr("x1", (d) => (d.source as GraphNode).x!)
      .attr("y1", (d) => (d.source as GraphNode).y!)
      .attr("x2", (d) => (d.target as GraphNode).x!)
      .attr("y2", (d) => (d.target as GraphNode).y!);
    this.nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
  }
}
