import React, { useEffect, useState } from "react";
import {
  Sparkles,
  LayoutDashboard,
  Network,
  Database,
  FileText,
  ArrowRight,
  Upload,
  CheckCircle2,
  History
} from "lucide-react";

interface OverviewPageProps {
  documents: any[];
  activeDocumentId: number;
  onSelectDocument: (docId: number) => void;
  onNavigate: (tab: string) => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  documents,
  activeDocumentId,
  onSelectDocument,
  onNavigate
}) => {
  const [analytics, setAnalytics] = useState<any>(null);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dashboard/analytics?document_id=${activeDocumentId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setAnalytics(data);
      })
      .catch(() => {});

    fetch("/api/audit-logs")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setRecentLogs((data.logs || []).slice(0, 5));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeDocumentId]);

  const activeDoc = documents.find((d) => d.id === activeDocumentId);
  const kpis: any[] = analytics?.kpis || [];

  const quickActions = [
    {
      id: "ai-analyst",
      title: "AI Analyst Studio",
      desc: "Run document-isolated investigations with 12-point verification.",
      icon: Sparkles,
      cta: "Ask Question"
    },
    {
      id: "dashboard",
      title: "Executive Dashboard",
      desc: "Inspect grounded KPIs, regional financials, and entity distributions.",
      icon: LayoutDashboard,
      cta: "View Metrics"
    },
    {
      id: "graph-explorer",
      title: "Knowledge Graph Explorer",
      desc: "Inspect provenance-linked entities and execute read-only Cypher.",
      icon: Network,
      cta: "Explore Graph"
    },
    {
      id: "data-sources",
      title: "Data Sources & RAG",
      desc: "Upload PDFs or CSVs to chunk, index, and lock investigation scope.",
      icon: Database,
      cta: "Manage Docs"
    }
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Active Workspace Summary Strip */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500">Active Target Document</div>
          <h2 className="text-lg font-bold text-slate-900 truncate mt-0.5">
            {activeDoc?.title || `Document #${activeDocumentId}`}
          </h2>
          <p className="text-xs text-slate-500 font-mono mt-1">
            ID #{activeDocumentId} · {activeDoc?.pages_count || 1} page(s) · {activeDoc?.sections_count || 1} section(s) ·{" "}
            {documents.length} indexed source(s)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate("data-sources")}
            className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload PDF</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("ai-analyst")}
            className="bg-[#1D63ED] hover:bg-[#1554D1] text-white text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Open AI Analyst</span>
          </button>
        </div>
      </div>

      {/* Live Document KPIs */}
      {kpis.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((kpi) => {
            const isDown = kpi.trend === "down";
            return (
              <div
                key={kpi.id}
                className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
              >
                <span className="text-xs font-medium text-slate-500 block">{kpi.title}</span>
                <div className="mt-2 text-2xl font-bold text-slate-900 tracking-tight tabular-nums truncate">
                  {kpi.value}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className={`font-semibold ${isDown ? "text-rose-600" : "text-emerald-600"}`}>
                    {isDown ? "▼" : "▲"} {kpi.change}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono truncate">{kpi.target}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Navigation Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {quickActions.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className="text-left bg-white border border-slate-200/80 hover:border-blue-300 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition-all group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-50 text-[#1D63ED] flex items-center justify-center shrink-0">
                  <Icon className="w-4.5 h-4.5" />
                </div>
                <span className="text-xs font-semibold text-[#1D63ED] inline-flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                  <span>{item.cta}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-3">{item.title}</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{item.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Bottom Split: Indexed Documents + Recent Audit Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#1D63ED]" />
              <span>Indexed Document Pool ({documents.length})</span>
            </h3>
            <button
              type="button"
              onClick={() => onNavigate("reports")}
              className="text-xs font-semibold text-[#1D63ED] hover:underline"
            >
              View Briefing
            </button>
          </div>
          <div className="space-y-2">
            {documents.slice(0, 6).map((doc) => {
              const isActive = doc.id === activeDocumentId;
              return (
                <div
                  key={doc.id}
                  onClick={() => onSelectDocument(doc.id)}
                  className={`flex items-center justify-between gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    isActive
                      ? "bg-blue-50/60 border-blue-200"
                      : "bg-slate-50/60 border-slate-200/70 hover:bg-slate-100/70"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">{doc.title}</div>
                    <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                      Doc #{doc.id} · {doc.pages_count || 1} pages · {doc.chunks?.length || 0} chunks
                    </div>
                  </div>
                  {isActive && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1D63ED] shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Active</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <History className="w-4 h-4 text-[#1D63ED]" />
              <span>Recent Audit Activity</span>
            </h3>
            <button
              type="button"
              onClick={() => onNavigate("history")}
              className="text-xs font-semibold text-[#1D63ED] hover:underline"
            >
              Full Trail
            </button>
          </div>
          {recentLogs.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {recentLogs.map((log) => (
                <div key={log.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 font-mono truncate">{log.action}</div>
                    <div className="text-[11px] text-slate-500 font-mono truncate">
                      {log.user_id} · {log.entity_id}
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 shrink-0">{log.created_at}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 py-8 text-center">No recent audit activity recorded.</p>
          )}
        </div>
      </div>
    </div>
  );
};
