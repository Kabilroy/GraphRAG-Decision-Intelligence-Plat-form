import React, { useState, useEffect, useMemo } from "react";
import { Play, ShieldAlert, CheckCircle, Terminal, RefreshCw, ArrowRight, ArrowLeft } from "lucide-react";
import { GraphViewer, GraphNodeItem, GraphPathItem } from "../components/GraphViewer";

interface GraphExplorerPageProps {
  documents?: any[];
  activeDocumentId?: number;
  onSelectDocument?: (docId: number) => void;
  uploadedOnly?: boolean;
  hasUploadedDocs?: boolean;
  onToggleUploadedOnly?: (val: boolean) => void;
}

const PROPERTY_LABELS: Record<string, string> = {
  item_name: "Item Description",
  current_stock: "Current Stock",
  reorder_point: "Reorder Point",
  deficit: "Deficit",
  status: "Status",
  on_time_rate: "On-Time Rate",
  target_sla: "Target SLA",
  transit_variance: "Transit Variance",
  damage_rate: "Damage Rate",
  risk_rating: "Risk Rating",
  delay_duration: "Delay Duration",
  cost_impact: "Cost Impact",
  location: "Location",
  gross_revenue: "Gross Revenue",
  operating_expenses: "Operating Expenses",
  operating_profit: "Operating Profit",
  margin: "Margin",
  likelihood: "Likelihood",
  impact: "Impact",
  score: "Risk Score",
  severity: "Severity",
  actual_days: "Actual Days",
  sla_days: "SLA Days",
  due: "Due Date",
  units_sold: "Units Sold",
  sales_inr: "Sales (INR)",
  target_achievement_pct: "Target Achievement %",
  customer_rating: "Customer Rating"
};

function formatPropertyValue(val: unknown): string {
  if (val === null || val === undefined) return "N/A";
  if (typeof val === "number") return val.toLocaleString();
  return String(val);
}

export const GraphExplorerPage: React.FC<GraphExplorerPageProps> = ({
  documents,
  activeDocumentId,
  onSelectDocument,
  uploadedOnly = false,
  hasUploadedDocs = false,
  onToggleUploadedOnly
}) => {
  const [localDocs, setLocalDocs] = useState<any[]>([]);
  const [localDocId, setLocalDocId] = useState<number>(() => {
    const saved = localStorage.getItem("active_target_document_id");
    return saved && !Number.isNaN(Number(saved)) ? Number(saved) : 201;
  });

  const docs = documents && documents.length > 0 ? documents : localDocs;
  const selectedDocId = activeDocumentId !== undefined ? activeDocumentId : localDocId;

  const handleSelectDoc = (docId: number) => {
    if (onSelectDocument) {
      onSelectDocument(docId);
    } else {
      setLocalDocId(docId);
      localStorage.setItem("active_target_document_id", String(docId));
    }
  };

  const [entities, setEntities] = useState<{
    nodes: GraphNodeItem[];
    edges: GraphPathItem[];
    document_name: string;
  }>({ nodes: [], edges: [], document_name: "" });

  const [activeNode, setActiveNode] = useState<GraphNodeItem | null>(null);
  const [cypher, setCypher] = useState(
    `MATCH (n {document_id: ${selectedDocId}})-[r]->(m)\nRETURN n.name, type(r), m.name LIMIT 100;`
  );
  const [queryResult, setQueryResult] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);

  useEffect(() => {
    if (!documents) {
      fetch("/api/documents")
        .then((res) => res.json())
        .then((data) => setLocalDocs(data.documents || []))
        .catch(() => {});
    }
  }, [documents]);

  const applyFetchedGraph = (data: any) => {
    const fetchedNodes: GraphNodeItem[] = data.nodes || [];
    const fetchedEdges: GraphPathItem[] = data.edges || [];
    setEntities({
      nodes: fetchedNodes,
      edges: fetchedEdges,
      document_name: data.document_name || ""
    });
    if (fetchedNodes.length > 0) {
      const degree = new Map<string, number>();
      for (const e of fetchedEdges) {
        degree.set(e.source, (degree.get(e.source) || 0) + 1);
        degree.set(e.target, (degree.get(e.target) || 0) + 1);
      }
      const domainNodes = fetchedNodes.filter((n) => n.properties?.layer !== "structural");
      const candidatePool = domainNodes.length > 0 ? domainNodes : fetchedNodes;
      const topNode = [...candidatePool].sort(
        (a, b) => (degree.get(b.name || b.id) || 0) - (degree.get(a.name || a.id) || 0)
      )[0];
      setActiveNode(topNode || fetchedNodes[0]);
    } else {
      setActiveNode(null);
    }
  };

  useEffect(() => {
    setCypher(`MATCH (n {document_id: ${selectedDocId}})-[r]->(m)\nRETURN n.name, type(r), m.name LIMIT 100;`);
    setQueryResult(null);
    setError(null);
    setActiveNode(null);

    fetch(`/api/graph/entities?document_id=${selectedDocId}`)
      .then((res) => res.json())
      .then((data) => applyFetchedGraph(data))
      .catch(() => setEntities({ nodes: [], edges: [], document_name: "" }));
  }, [selectedDocId]);

  const handleRebuildGraph = async () => {
    setIsRebuilding(true);
    setError(null);
    try {
      const res = await fetch("/api/graph/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: selectedDocId })
      });
      const data = await res.json();
      if (res.ok) {
        applyFetchedGraph(data);
        setQueryResult(null);
      } else {
        setError(data.error || "Failed to rebuild graph index");
      }
    } catch (err: any) {
      setError(err.message || "Failed to rebuild graph index");
    } finally {
      setIsRebuilding(false);
    }
  };

  const activeNodeDetails = useMemo(() => {
    if (!activeNode) return null;
    const nodeKeys = new Set([activeNode.id, activeNode.name].filter(Boolean));
    const outgoing = (entities.edges || []).filter((e) => nodeKeys.has(e.source));
    const incoming = (entities.edges || []).filter((e) => nodeKeys.has(e.target));
    const connectedEdges = [...outgoing, ...incoming];
    const relationTypes = Array.from(new Set(connectedEdges.map((e) => e.relation)));
    const neighborNames = Array.from(
      new Set([
        ...outgoing.map((e) => e.target),
        ...incoming.map((e) => e.source)
      ])
    );

    const visibleProps = Object.entries(activeNode.properties || {}).filter(
      ([k, v]) => !["layer", "page", "document_id", "page_number"].includes(k) && v !== undefined && v !== null && v !== ""
    );

    return {
      node: activeNode,
      outgoing,
      incoming,
      relationTypes,
      neighborNames,
      visibleProps,
      edgeCount: connectedEdges.length
    };
  }, [activeNode, entities.edges]);

  const dynamicPresets = useMemo(() => {
    const labels = new Set<string>(
      (entities.nodes || [])
        .filter((n) => n.properties?.layer !== "structural")
        .map((n) => n.label)
        .filter(Boolean)
    );
    const presets: Array<{ label: string; query: string }> = [
      {
        label: "All Edges",
        query: `MATCH (n {document_id: ${selectedDocId}})-[r]->(m)\nRETURN n.name, type(r), m.name LIMIT 100;`
      }
    ];
    for (const lbl of ["Incident", "Carrier", "InventorySKU", "DeliveryLane", "Risk", "Region", "Vendor", "Supplier"]) {
      if (labels.has(lbl)) {
        presets.push({
          label: lbl,
          query: `MATCH (n:${lbl} {document_id: ${selectedDocId}})-[r]-(m)\nRETURN n.name, type(r), m.name LIMIT 50;`
        });
      }
    }
    return presets.slice(0, 5);
  }, [entities.nodes, selectedDocId]);

  const handleExecuteCypher = async (queryOverride?: string) => {
    const queryToRun = queryOverride || cypher;
    setError(null);
    setQueryResult(null);
    setIsExecuting(true);

    try {
      const res = await fetch("/api/graph/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cypher: queryToRun, document_id: selectedDocId })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Cypher execution failed");
      } else {
        setQueryResult(data.result || []);
      }
    } catch (err: any) {
      setError(err.message || "Failed to execute Cypher");
    } finally {
      setIsExecuting(false);
    }
  };

  const activeDoc = docs.find((d) => d.id === selectedDocId);

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Top Document Context Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-xs sm:text-sm text-slate-600">
          Interactive Knowledge Graph & Read-Only Cypher Explorer scoped to{" "}
          <strong className="text-slate-900 font-semibold">
            {entities.document_name || activeDoc?.title || `Doc #${selectedDocId}`}
          </strong>
          .
        </p>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            value={selectedDocId}
            onChange={(e) => handleSelectDoc(Number(e.target.value))}
            aria-label="Select graph document"
            className="bg-white border border-slate-200 text-slate-800 text-xs rounded-lg px-3 py-2 font-mono max-w-[260px] focus:outline-none focus:border-[#1D63ED]"
          >
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.is_uploaded ? "[UPLOADED] " : "[SAMPLE] "}[DOC #{d.id}] {d.title}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={isRebuilding}
            onClick={handleRebuildGraph}
            className="text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
            title="Re-extract entities and relationships from active document"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRebuilding ? "animate-spin" : ""}`} />
            <span>{isRebuilding ? "Rebuilding..." : "Refresh Graph"}</span>
          </button>

          {hasUploadedDocs && onToggleUploadedOnly && (
            <button
              type="button"
              onClick={() => onToggleUploadedOnly(!uploadedOnly)}
              className={`text-xs font-medium px-3 py-2 rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                uploadedOnly
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700 font-semibold"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {uploadedOnly ? "Uploaded Only" : "All Docs"}
            </button>
          )}
        </div>
      </div>

      {/* Main Layout Matching Reference Fig A.5: Graph Diagram Left (2/3) + Stacked Node Details & Cypher Right (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2">
          <GraphViewer
            nodes={entities.nodes}
            paths={entities.edges}
            documentId={selectedDocId}
            documentName={entities.document_name || activeDoc?.title}
            activeNode={activeNode}
            onSelectNode={setActiveNode}
          />
        </div>

        <div className="space-y-5">
          {/* Card 1: Node Details */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Node details</h3>
            {activeNodeDetails ? (
              <div className="space-y-3 text-xs">
                <div className="font-semibold text-slate-900 text-sm leading-snug">
                  {activeNodeDetails.node.name || activeNodeDetails.node.id}{" "}
                  <span className="font-normal text-slate-500">({activeNodeDetails.node.label})</span>
                </div>

                {activeNodeDetails.visibleProps.length > 0 && (
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5 space-y-1">
                    {activeNodeDetails.visibleProps.map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-500">{PROPERTY_LABELS[k] || k.replace(/_/g, " ")}</span>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums text-right truncate max-w-[170px]">
                          {formatPropertyValue(v)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {activeNodeDetails.node.description && (
                  <p className="text-slate-600 text-xs leading-relaxed">
                    {activeNodeDetails.node.description}
                  </p>
                )}

                {(activeNodeDetails.outgoing.length > 0 || activeNodeDetails.incoming.length > 0) && (
                  <div className="pt-2 border-t border-slate-100 space-y-1.5">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                      Relationships ({activeNodeDetails.edgeCount})
                    </span>
                    <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                      {activeNodeDetails.outgoing.slice(0, 6).map((e, i) => (
                        <button
                          key={`out-${i}`}
                          type="button"
                          onClick={() => {
                            const matched = entities.nodes.find((n) => n.name === e.target || n.id === e.target);
                            if (matched) setActiveNode(matched);
                          }}
                          className="w-full text-left flex items-center gap-1.5 text-[11px] px-2 py-1 rounded hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors"
                        >
                          <ArrowRight className="w-3 h-3 text-[#1D63ED] shrink-0" />
                          <span className="font-mono text-[#1D63ED] font-semibold shrink-0">{e.relation}</span>
                          <span className="text-slate-800 truncate">{e.target}</span>
                        </button>
                      ))}
                      {activeNodeDetails.incoming.slice(0, 6).map((e, i) => (
                        <button
                          key={`in-${i}`}
                          type="button"
                          onClick={() => {
                            const matched = entities.nodes.find((n) => n.name === e.source || n.id === e.source);
                            if (matched) setActiveNode(matched);
                          }}
                          className="w-full text-left flex items-center gap-1.5 text-[11px] px-2 py-1 rounded hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors"
                        >
                          <ArrowLeft className="w-3 h-3 text-slate-500 shrink-0" />
                          <span className="text-slate-800 truncate">{e.source}</span>
                          <span className="font-mono text-slate-600 font-semibold shrink-0">{e.relation}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono text-slate-500 tabular-nums">
                  <span>Page {activeNodeDetails.node.source_page || 1}</span>
                  <span>Doc #{selectedDocId}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Select any entity node in the graph to inspect details.</p>
            )}
          </div>

          {/* Card 2: Read-only Cypher Console */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-[#1D63ED]" />
                <span>Read-only Cypher console</span>
              </h3>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {dynamicPresets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setCypher(preset.query);
                    handleExecuteCypher(preset.query);
                  }}
                  className="text-[11px] font-medium px-2 py-1 rounded border border-slate-200 bg-slate-50 hover:border-[#1D63ED] hover:text-[#1D63ED] text-slate-700 transition-colors whitespace-nowrap shrink-0"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <textarea
              value={cypher}
              onChange={(e) => setCypher(e.target.value)}
              rows={4}
              aria-label="Read-only Cypher console"
              className="w-full bg-[#0F172A] border border-slate-800 rounded-lg p-3.5 font-mono text-xs text-slate-100 leading-relaxed focus:outline-none focus:border-[#1D63ED]"
            />

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[11px] px-2 py-0.5 rounded">
                  read-only
                </span>
                <span>Write queries are rejected.</span>
              </div>

              <button
                type="button"
                disabled={isExecuting}
                onClick={() => handleExecuteCypher()}
                className="bg-[#1D63ED] hover:bg-[#1554D1] text-white font-semibold text-xs px-3.5 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{isExecuting ? "Running..." : "Run Query"}</span>
              </button>
            </div>

            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">Query Rejected</span>
                  <p className="text-[11px] text-rose-700 mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {queryResult && (
              <div className="p-3 bg-slate-50 border border-emerald-200 rounded-lg text-xs text-slate-800 overflow-x-auto max-h-60 overflow-y-auto space-y-2">
                <div className="flex items-center gap-1.5 text-emerald-700 font-bold">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span className="tabular-nums">Returned {queryResult.length} record(s)</span>
                </div>
                {queryResult.length === 0 ? (
                  <p className="text-[11px] text-slate-500">
                    No matching triples found in Doc #{selectedDocId} for this Cypher pattern.
                  </p>
                ) : queryResult[0]?.Source !== undefined ? (
                  <div className="space-y-1 font-mono text-[11px]">
                    {queryResult.map((row, idx) => (
                      <div key={idx} className="bg-white border border-slate-200 rounded px-2.5 py-1.5 flex flex-wrap items-center gap-1">
                        <span className="font-semibold text-slate-900">{row.Source}</span>
                        <span className="text-[#1D63ED] font-semibold">-[{row.Relation}]-&gt;</span>
                        <span className="font-semibold text-slate-900">{row.Target}</span>
                        <span className="ml-auto text-slate-400 tabular-nums">p.{row.Source_Page || 1}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="text-[11px] font-mono text-slate-700">{JSON.stringify(queryResult, null, 2)}</pre>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
