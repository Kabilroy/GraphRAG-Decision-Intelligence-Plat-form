import React, { useState, useMemo, useEffect } from "react";
import { Network, Search, RotateCcw, List, Share2, Layers, ZoomIn, ZoomOut } from "lucide-react";

export interface GraphNodeItem {
  id: string;
  label: string;
  name?: string;
  description?: string;
  severity?: string;
  reliability?: number;
  status?: string;
  document_id?: number;
  source_page?: number;
  source_chunk_id?: string;
  properties?: Record<string, any>;
}

export interface GraphPathItem {
  source: string;
  relation: string;
  target: string;
  document_id?: number;
  source_page?: number;
  source_chunk_id?: string;
}

interface GraphViewerProps {
  nodes?: GraphNodeItem[];
  paths?: GraphPathItem[];
  interactive?: boolean;
  documentId?: number;
  documentName?: string;
  activeNode?: GraphNodeItem | null;
  onSelectNode?: (node: GraphNodeItem | null) => void;
}

function getNodeColor(label: string, status?: string, severity?: string): { fill: string; stroke: string } {
  const sev = (severity || "").toUpperCase();
  if (
    status === "BOTTLENECK" ||
    status === "HIGH" ||
    status === "CRITICAL" ||
    status === "BELOW REORDER POINT" ||
    sev === "HIGH" ||
    sev === "CRITICAL" ||
    label === "Problem" ||
    label === "Incident" ||
    label === "RootCause" ||
    label === "ThresholdAlert"
  ) {
    return { fill: "#DC2626", stroke: "#991B1B" };
  }
  if (label === "Risk" || label === "RiskLevel") {
    return { fill: "#E11D48", stroke: "#9F1239" };
  }
  if (label === "Product" || label === "InventorySKU" || label === "InventoryStatus") {
    return { fill: "#2563EB", stroke: "#1D4ED8" };
  }
  if (label === "Supplier" || label === "Carrier" || label === "Vendor") {
    return { fill: "#16A34A", stroke: "#15803D" };
  }
  if (label === "Region" || label === "Location" || label === "DeliveryLane") {
    return { fill: "#7C3AED", stroke: "#6D28D9" };
  }
  if (label === "Facility" || label === "Warehouse" || label === "Department" || label === "Customer" || label === "Shipment") {
    return { fill: "#D97706", stroke: "#B45309" };
  }
  if (
    label === "Section" ||
    label === "Document" ||
    label === "FinancialMetric" ||
    label === "PerformanceMetric" ||
    label === "ActionItem" ||
    label === "DatasetRecord"
  ) {
    return { fill: "#0891B2", stroke: "#0E7490" };
  }
  return { fill: "#475569", stroke: "#334155" };
}

function wrapNodeLabel(text: string, maxCharsPerLine = 13): string[] {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxCharsPerLine) return [clean];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (let idx = 0; idx < words.length; idx++) {
    const w = words[idx];
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
        current = "";
      }
      if (lines.length === 1) {
        // Remaining text on line 2
        const rest = words.slice(idx).join(" ");
        lines.push(rest.length > maxCharsPerLine ? `${rest.slice(0, maxCharsPerLine - 1)}…` : rest);
        return lines;
      }
      current = w.length > maxCharsPerLine ? `${w.slice(0, maxCharsPerLine - 1)}…` : w;
    }
  }
  if (current && lines.length < 2) lines.push(current);
  if (lines.length === 0) return [clean.slice(0, maxCharsPerLine)];
  return lines.slice(0, 2);
}

export const GraphViewer: React.FC<GraphViewerProps> = ({
  nodes = [],
  paths = [],
  interactive = true,
  documentId,
  documentName,
  activeNode,
  onSelectNode
}) => {
  const [selectedNode, setSelectedNode] = useState<GraphNodeItem | null>(null);
  const [labelFilter, setLabelFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [viewMode, setViewMode] = useState<"diagram" | "list">("diagram");
  const [viewLayer, setViewLayer] = useState<"domain" | "all">("domain");
  const [showAllNodes, setShowAllNodes] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1);

  useEffect(() => {
    setSelectedNode(null);
    setLabelFilter("ALL");
    setSearchQuery("");
    setShowAllNodes(false);
    setViewLayer("domain");
    setZoom(1);
  }, [documentId]);

  const currentSelected = activeNode !== undefined ? activeNode : selectedNode;

  const handleNodePick = (node: GraphNodeItem | null) => {
    if (!interactive) return;
    setSelectedNode(node);
    onSelectNode?.(node);
  };

  const hasStructuralLayer = useMemo(
    () => nodes.some((n) => n.properties?.layer === "structural"),
    [nodes]
  );

  // Scope out noisy HAS_SECTION / Document spine when rich domain entities exist unless user explicitly enables All Structure
  const { scopedNodes, scopedPaths } = useMemo(() => {
    const domainNodes = nodes.filter((n) => n.properties?.layer !== "structural");
    if (viewLayer === "domain" && hasStructuralLayer && domainNodes.length >= 2) {
      const domainKeys = new Set<string>();
      for (const n of domainNodes) {
        if (n.id) domainKeys.add(n.id);
        if (n.name) domainKeys.add(n.name);
      }
      const domainEdges = paths.filter((p) => domainKeys.has(p.source) && domainKeys.has(p.target));
      if (domainEdges.length > 0) {
        return { scopedNodes: domainNodes, scopedPaths: domainEdges };
      }
    }
    return { scopedNodes: nodes, scopedPaths: paths };
  }, [nodes, paths, viewLayer, hasStructuralLayer]);

  const availableLabels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of scopedNodes) {
      const lbl = n.label || "Entity";
      counts.set(lbl, (counts.get(lbl) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [scopedNodes]);

  const filteredNodes = useMemo(() => {
    let base =
      labelFilter === "ALL"
        ? scopedNodes
        : scopedNodes.filter((n) => (n.label || "Entity") === labelFilter);
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      base = base.filter(
        (n) =>
          (n.name || "").toLowerCase().includes(q) ||
          (n.id || "").toLowerCase().includes(q) ||
          (n.label || "").toLowerCase().includes(q)
      );
    }
    return base;
  }, [scopedNodes, labelFilter, searchQuery]);

  const filteredNodeIds = useMemo(() => {
    const keys = new Set<string>();
    for (const n of filteredNodes) {
      if (n.id) keys.add(n.id);
      if (n.name) keys.add(n.name);
    }
    return keys;
  }, [filteredNodes]);

  const filteredPaths = useMemo(() => {
    if (labelFilter === "ALL" && !searchQuery.trim()) return scopedPaths;
    return scopedPaths.filter((p) => filteredNodeIds.has(p.source) || filteredNodeIds.has(p.target));
  }, [scopedPaths, labelFilter, searchQuery, filteredNodeIds]);

  // Compute readable bounded SVG subgraph & deterministic force-relaxed positions
  const diagramData = useMemo(() => {
    const degree = new Map<string, number>();
    for (const p of scopedPaths) {
      degree.set(p.source, (degree.get(p.source) || 0) + 1);
      degree.set(p.target, (degree.get(p.target) || 0) + 1);
    }

    const isFocusedSubgraph = labelFilter !== "ALL" || Boolean(searchQuery.trim());

    // Expand filtered seed nodes to include 1-hop connected neighbors so edges never disappear under label/search filtering
    let candidateNodes: GraphNodeItem[] = filteredNodes;
    if (isFocusedSubgraph && filteredNodes.length > 0) {
      const expandedKeys = new Set<string>(filteredNodeIds);
      for (const p of filteredPaths) {
        expandedKeys.add(p.source);
        expandedKeys.add(p.target);
      }
      candidateNodes = scopedNodes.filter(
        (n) => expandedKeys.has(n.id) || (n.name && expandedKeys.has(n.name))
      );
    }

    const sortedNodes = [...candidateNodes].sort((a, b) => {
      const aSeed = filteredNodeIds.has(a.id) || (a.name ? filteredNodeIds.has(a.name) : false) ? 1 : 0;
      const bSeed = filteredNodeIds.has(b.id) || (b.name ? filteredNodeIds.has(b.name) : false) ? 1 : 0;
      if (isFocusedSubgraph && aSeed !== bSeed) return bSeed - aSeed;
      const da = degree.get(a.name || a.id) || degree.get(a.id) || 0;
      const db = degree.get(b.name || b.id) || degree.get(b.id) || 0;
      return db - da;
    });

    const maxRender = showAllNodes || isFocusedSubgraph ? 38 : 22;
    const renderNodes = sortedNodes.slice(0, maxRender);
    const renderKeys = new Set<string>();
    for (const n of renderNodes) {
      if (n.id) renderKeys.add(n.id);
      if (n.name) renderKeys.add(n.name);
    }

    const renderEdges = filteredPaths.filter(
      (e) => renderKeys.has(e.source) && renderKeys.has(e.target) && e.source !== e.target
    );

    const W = 840;
    const H = 480;
    const cx = W / 2;
    const cy = H / 2;

    const pos = renderNodes.map((node, i) => {
      if (i === 0 && renderNodes.length > 4) {
        return { node, x: cx, y: cy };
      }
      const angle = ((i - 1) / Math.max(1, renderNodes.length - 1)) * Math.PI * 2 - Math.PI / 4;
      const radiusX = renderNodes.length <= 6 ? 190 : i % 2 === 0 ? 290 : 175;
      const radiusY = renderNodes.length <= 6 ? 135 : i % 2 === 0 ? 175 : 115;
      return {
        node,
        x: cx + Math.cos(angle) * radiusX,
        y: cy + Math.sin(angle) * radiusY
      };
    });

    const findPosIdx = (key: string) =>
      pos.findIndex((p) => p.node.id === key || p.node.name === key);

    const edgeIdxPairs = renderEdges
      .map((e) => ({ s: findPosIdx(e.source), t: findPosIdx(e.target), edge: e }))
      .filter((pair) => pair.s >= 0 && pair.t >= 0 && pair.s !== pair.t);

    // Light deterministic force simulation (140 iterations) for clean separation & minimal crossing
    for (let iter = 0; iter < 140; iter++) {
      for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
          const dx = pos[j].x - pos[i].x;
          const dy = pos[j].y - pos[i].y;
          const dist = Math.hypot(dx, dy) || 1;
          const minSep = 136;
          if (dist < minSep) {
            const force = ((minSep - dist) / dist) * 0.24;
            const fx = dx * force;
            const fy = dy * force;
            pos[i].x -= fx;
            pos[i].y -= fy;
            pos[j].x += fx;
            pos[j].y += fy;
          }
        }
      }
      for (const pair of edgeIdxPairs) {
        const a = pos[pair.s];
        const b = pos[pair.t];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1;
        const ideal = 175;
        const pull = ((dist - ideal) / dist) * 0.045;
        a.x += dx * pull;
        a.y += dy * pull;
        b.x -= dx * pull;
        b.y -= dy * pull;
      }
      for (const p of pos) {
        p.x += (cx - p.x) * 0.012;
        p.y += (cy - p.y) * 0.012;
        p.x = Math.max(60, Math.min(W - 60, p.x));
        p.y = Math.max(52, Math.min(H - 52, p.y));
      }
    }

    // Track multi-edges between same node pair for curved arc offsets
    const pairCounts = new Map<string, number>();
    const pairSeen = new Map<string, number>();
    for (const p of edgeIdxPairs) {
      const k = p.s < p.t ? `${p.s}:${p.t}` : `${p.t}:${p.s}`;
      pairCounts.set(k, (pairCounts.get(k) || 0) + 1);
    }

    const curvedEdges = edgeIdxPairs.map((pair) => {
      const k = pair.s < pair.t ? `${pair.s}:${pair.t}` : `${pair.t}:${pair.s}`;
      const total = pairCounts.get(k) || 1;
      const idx = pairSeen.get(k) || 0;
      pairSeen.set(k, idx + 1);
      const curveOffset = total === 1 ? 0 : (idx - (total - 1) / 2) * 34;
      return { ...pair, curveOffset };
    });

    return {
      W,
      H,
      positioned: pos,
      edges: curvedEdges,
      totalCandidateNodes: candidateNodes.length,
      isFocusedSubgraph
    };
  }, [filteredNodes, filteredNodeIds, filteredPaths, scopedNodes, scopedPaths, labelFilter, searchQuery, showAllNodes]);

  const selectedConnectedKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!currentSelected) return keys;
    if (currentSelected.id) keys.add(currentSelected.id);
    if (currentSelected.name) keys.add(currentSelected.name);
    for (const p of scopedPaths) {
      if (keys.has(p.source)) keys.add(p.target);
      if (keys.has(p.target)) keys.add(p.source);
    }
    return keys;
  }, [currentSelected, scopedPaths]);

  if (nodes.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <Network className="w-8 h-8 text-slate-400 mx-auto mb-2.5" />
        <p className="text-sm font-semibold text-slate-900">
          No verified graph entities extracted for this document yet.
        </p>
        <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
          Only provenance-stamped entities present inside the active uploaded document are rendered.
        </p>
      </div>
    );
  }

  const vbWidth = diagramData.W / zoom;
  const vbHeight = diagramData.H / zoom;
  const vbX = (diagramData.W - vbWidth) / 2;
  const vbY = (diagramData.H - vbHeight) / 2;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 text-slate-900 space-y-4">
      {/* Search Entity + Controls Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search entity (carrier, SKU, region, lane, risk)..."
            aria-label="Search entity"
            className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-8 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#1D63ED]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-700"
              aria-label="Clear entity search"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-[11px] font-mono text-slate-500 tabular-nums">
            {filteredNodes.length} nodes · {filteredPaths.length} edges
            {documentId ? ` · Doc #${documentId}` : ""}
          </span>

          {hasStructuralLayer && (
            <button
              type="button"
              onClick={() => {
                setViewLayer((v) => (v === "domain" ? "all" : "domain"));
                setLabelFilter("ALL");
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                viewLayer === "all"
                  ? "bg-slate-900 border-slate-900 text-white"
                  : "bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900"
              }`}
              title="Toggle structural document sections layer"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{viewLayer === "all" ? "With Sections" : "Domain Entities"}</span>
            </button>
          )}

          <div className="inline-flex border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
            <button
              type="button"
              onClick={() => setViewMode("diagram")}
              className={`px-2.5 py-1 text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                viewMode === "diagram" ? "bg-white text-slate-900 font-semibold" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Graph</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`px-2.5 py-1 text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                viewMode === "list" ? "bg-white text-slate-900 font-semibold" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Table</span>
            </button>
          </div>
        </div>
      </div>

      {/* Entity Label Filters */}
      {availableLabels.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setLabelFilter("ALL")}
            className={`text-xs font-medium px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap shrink-0 ${
              labelFilter === "ALL"
                ? "bg-[#1D63ED] border-[#1D63ED] text-white font-semibold"
                : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            All ({scopedNodes.length})
          </button>
          {availableLabels.map(([lbl, count]) => (
            <button
              key={lbl}
              type="button"
              onClick={() => setLabelFilter(lbl)}
              className={`text-xs font-medium px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                labelFilter === lbl
                  ? "bg-[#1D63ED] border-[#1D63ED] text-white font-semibold"
                  : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {lbl} ({count})
            </button>
          ))}
        </div>
      )}

      {/* Interactive SVG Node-Link Topology Diagram */}
      {viewMode === "diagram" ? (
        <div className="border border-slate-100 rounded-xl bg-slate-50/40 overflow-hidden relative">
          {diagramData.positioned.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-500">
              No entities match &ldquo;{searchQuery}&rdquo; in {documentName || "the active document"}.
            </div>
          ) : (
            <>
              <div className="absolute top-3 right-3 z-10 inline-flex items-center border border-slate-200 bg-white/95 rounded-lg overflow-hidden shadow-xs">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.15).toFixed(2))))}
                  className="p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  aria-label="Zoom out graph"
                  title="Zoom out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="px-2 text-[10px] font-mono text-slate-600 tabular-nums border-x border-slate-200">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(1.6, Number((z + 0.15).toFixed(2))))}
                  className="p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  aria-label="Zoom in graph"
                  title="Zoom in"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>

              <svg
                viewBox={`${vbX} ${vbY} ${vbWidth} ${vbHeight}`}
                className="w-full h-[400px] sm:h-[460px] select-none"
                role="img"
                aria-label="Document Knowledge Graph Diagram"
              >
                <defs>
                  <marker
                    id="graph-arrow"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#94A3B8" />
                  </marker>
                  <marker
                    id="graph-arrow-active"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#1D63ED" />
                  </marker>
                </defs>

                {/* Edges with curved arc separation & centered relation labels */}
                {diagramData.edges.map((pair, idx) => {
                  const a = diagramData.positioned[pair.s];
                  const b = diagramData.positioned[pair.t];
                  const dx = b.x - a.x;
                  const dy = b.y - a.y;
                  const dist = Math.hypot(dx, dy) || 1;
                  const ux = dx / dist;
                  const uy = dy / dist;
                  const nx = -uy;
                  const ny = ux;
                  const nodeRadius = 35;
                  const x1 = a.x + ux * nodeRadius;
                  const y1 = a.y + uy * nodeRadius;
                  const x2 = b.x - ux * (nodeRadius + 5);
                  const y2 = b.y - uy * (nodeRadius + 5);

                  const qx = (a.x + b.x) / 2 + nx * pair.curveOffset;
                  const qy = (a.y + b.y) / 2 + ny * pair.curveOffset;
                  const labelX = (a.x + b.x) / 2 + nx * (pair.curveOffset * 0.55);
                  const labelY = (a.y + b.y) / 2 + ny * (pair.curveOffset * 0.55);

                  const isConnectedToSelected =
                    currentSelected &&
                    (a.node.id === currentSelected.id ||
                      b.node.id === currentSelected.id ||
                      a.node.name === currentSelected.name ||
                      b.node.name === currentSelected.name);
                  const edgeOpacity = currentSelected ? (isConnectedToSelected ? 1 : 0.25) : 0.9;

                  return (
                    <g key={`edge-${idx}`} opacity={edgeOpacity}>
                      {pair.curveOffset === 0 ? (
                        <line
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          stroke={isConnectedToSelected ? "#1D63ED" : "#CBD5E1"}
                          strokeWidth={isConnectedToSelected ? 2.2 : 1.5}
                          markerEnd={isConnectedToSelected ? "url(#graph-arrow-active)" : "url(#graph-arrow)"}
                        />
                      ) : (
                        <path
                          d={`M ${x1} ${y1} Q ${qx} ${qy} ${x2} ${y2}`}
                          fill="none"
                          stroke={isConnectedToSelected ? "#1D63ED" : "#CBD5E1"}
                          strokeWidth={isConnectedToSelected ? 2.2 : 1.5}
                          markerEnd={isConnectedToSelected ? "url(#graph-arrow-active)" : "url(#graph-arrow)"}
                        />
                      )}
                      <text
                        x={labelX}
                        y={labelY - 3}
                        textAnchor="middle"
                        fontSize="8.5"
                        fontWeight="600"
                        fontFamily="JetBrains Mono, monospace"
                        fill={isConnectedToSelected ? "#1D63ED" : "#475569"}
                        stroke="#F8FAFC"
                        strokeWidth="4"
                        paintOrder="stroke"
                      >
                        {pair.edge.relation}
                      </text>
                    </g>
                  );
                })}

                {/* Colored Circular Nodes */}
                {diagramData.positioned.map((item, idx) => {
                  const isSelected =
                    currentSelected &&
                    (currentSelected.id === item.node.id ||
                      (currentSelected.name &&
                        currentSelected.name === item.node.name &&
                        currentSelected.label === item.node.label));
                  const isNeighbor =
                    currentSelected &&
                    (selectedConnectedKeys.has(item.node.id) ||
                      (item.node.name ? selectedConnectedKeys.has(item.node.name) : false));
                  const isSeedMatch =
                    !diagramData.isFocusedSubgraph ||
                    filteredNodeIds.has(item.node.id) ||
                    (item.node.name ? filteredNodeIds.has(item.node.name) : false);

                  const colors = getNodeColor(item.node.label, item.node.status, item.node.severity);
                  const displayLabel = item.node.name || item.node.id;
                  const lines = wrapNodeLabel(displayLabel, 13);
                  const opacity = currentSelected
                    ? isSelected || isNeighbor
                      ? 1
                      : 0.35
                    : isSeedMatch
                      ? 1
                      : 0.72;

                  return (
                    <g
                      key={`node-${item.node.id}-${idx}`}
                      transform={`translate(${item.x}, ${item.y})`}
                      onClick={() => handleNodePick(item.node)}
                      opacity={opacity}
                      className="cursor-pointer group"
                    >
                      <title>{`${displayLabel} (${item.node.label}) · Page ${item.node.source_page || 1}`}</title>
                      {isSelected && (
                        <circle r={39} fill="none" stroke="#1D63ED" strokeWidth={2.5} strokeDasharray="4 2" />
                      )}
                      <circle
                        r={33}
                        fill={colors.fill}
                        stroke={isSelected ? "#0F172A" : isSeedMatch ? colors.stroke : "#CBD5E1"}
                        strokeWidth={isSelected ? 2.5 : 1.5}
                        className="transition-transform group-hover:scale-105"
                      />
                      {lines.length === 1 ? (
                        <text x={0} y={3} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#FFFFFF">
                          {lines[0]}
                        </text>
                      ) : (
                        <text textAnchor="middle" fontSize="9" fontWeight="700" fill="#FFFFFF">
                          <tspan x={0} y={-2}>
                            {lines[0]}
                          </tspan>
                          <tspan x={0} y={10}>
                            {lines[1]}
                          </tspan>
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </>
          )}

          <div className="px-4 py-2 border-t border-slate-100 bg-white flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>Click any node to inspect connected entities, attributes, and page provenance.</span>
            {diagramData.totalCandidateNodes > 22 && !diagramData.isFocusedSubgraph && (
              <button
                type="button"
                onClick={() => setShowAllNodes((v) => !v)}
                className="text-[#1D63ED] font-semibold hover:underline"
              >
                {showAllNodes
                  ? "Focus top 22 entities"
                  : `Show all ${Math.min(38, diagramData.totalCandidateNodes)} entities`}
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Structured Edge Table Mode */
        <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-[450px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 sticky top-0">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Source Entity</th>
                <th className="px-4 py-2.5 font-semibold">Relationship</th>
                <th className="px-4 py-2.5 font-semibold">Target Entity</th>
                <th className="px-4 py-2.5 font-semibold text-right">Page</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredPaths.map((edge, idx) => (
                <tr
                  key={idx}
                  onClick={() => {
                    const matched = nodes.find((n) => n.name === edge.source || n.id === edge.source);
                    if (matched) handleNodePick(matched);
                  }}
                  className="hover:bg-slate-50 cursor-pointer"
                >
                  <td className="px-4 py-2.5 font-medium text-slate-900">{edge.source}</td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-[#1D63ED] font-semibold">{edge.relation}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{edge.target}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-500 tabular-nums">
                    p.{edge.source_page || 1}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
