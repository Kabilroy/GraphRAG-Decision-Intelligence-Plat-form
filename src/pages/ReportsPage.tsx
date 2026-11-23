import React, { useState, useEffect } from "react";
import {
  Printer,
  Database,
  Sparkles,
  ShieldCheck,
  Table as TableIcon,
  CheckCircle2
} from "lucide-react";
import { User } from "../types";

interface ReportsPageProps {
  user: User | null;
  documents?: any[];
  activeDocumentId?: number;
  onSelectDocument?: (docId: number) => void;
  uploadedOnly?: boolean;
  hasUploadedDocs?: boolean;
  onToggleUploadedOnly?: (val: boolean) => void;
  onNavigateToDataSources?: () => void;
  onNavigateToAnalyst?: () => void;
}

export const ReportsPage: React.FC<ReportsPageProps> = ({
  user,
  documents = [],
  activeDocumentId = 201,
  onSelectDocument,
  uploadedOnly = false,
  hasUploadedDocs = false,
  onToggleUploadedOnly,
  onNavigateToDataSources,
  onNavigateToAnalyst
}) => {
  const [briefing, setBriefing] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetch(`/api/reports/briefing?document_id=${activeDocumentId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setBriefing(data);
      })
      .catch((err) => console.error("Failed to fetch briefing:", err))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDocumentId]);

  const companyName = user?.company || "Enterprise Partner Organization";
  const departmentName = user?.department || "Executive Operations & Intelligence";
  const authorName = user?.name || "Authorized Corporate Analyst";
  const userId = user?.id || "usr-01";
  const currentDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  const metricTextColor: Record<string, string> = {
    emerald: "text-emerald-700",
    rose: "text-rose-700",
    amber: "text-amber-700",
    cyan: "text-[#1D63ED]"
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Toolbar */}
      <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <p className="text-xs sm:text-sm text-slate-500">
          Executive briefing compiled strictly from{" "}
          <strong className="text-slate-900 font-mono">
            {briefing?.document_title || `Doc #${activeDocumentId}`}
          </strong>
          .
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {documents.length > 0 && onSelectDocument && (
            <select
              value={activeDocumentId}
              onChange={(e) => onSelectDocument(Number(e.target.value))}
              className="bg-white border border-slate-200 text-slate-800 text-xs rounded-lg px-3 py-2 font-mono max-w-[260px]"
            >
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.is_uploaded ? "[UPLOADED] " : "[SAMPLE] "}[DOC #{d.id}] {d.title}
                </option>
              ))}
            </select>
          )}

          {hasUploadedDocs && onToggleUploadedOnly && (
            <button
              type="button"
              onClick={() => onToggleUploadedOnly(!uploadedOnly)}
              className={`text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
                uploadedOnly
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700 font-semibold"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {uploadedOnly ? "Uploaded PDFs Only" : "All Docs"}
            </button>
          )}

          {onNavigateToDataSources && (
            <button
              type="button"
              onClick={onNavigateToDataSources}
              className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Database className="w-3.5 h-3.5 text-slate-500" />
              <span>Upload PDF</span>
            </button>
          )}

          {onNavigateToAnalyst && (
            <button
              type="button"
              onClick={onNavigateToAnalyst}
              className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-[#1D63ED] text-xs font-semibold px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Ask AI Analyst</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => window.print()}
            className="bg-[#1D63ED] hover:bg-[#1554D1] text-white font-semibold text-xs px-4 py-2 rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Export / Print PDF</span>
          </button>
        </div>
      </div>

      {/* Main Executive Report Document Sheet */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-6 sm:p-8 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        {/* Document Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between border-b border-slate-200 pb-6 mb-6 gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2.5">
              <span className="bg-blue-50 text-[#1D63ED] border border-blue-200 text-[10px] font-bold px-2 py-0.5 rounded uppercase font-mono">
                DOCUMENT BRIEFING · DOC #{briefing?.document_id || activeDocumentId}
              </span>
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-mono font-semibold px-2 py-0.5 rounded flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                <span>{briefing?.validation_status || "STRICT ISOLATION"}</span>
              </span>
              {isLoading && <span className="text-[11px] font-mono text-[#1D63ED]">Refreshing...</span>}
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              {companyName}: {briefing?.document_title || `Document #${activeDocumentId} Briefing`}
            </h2>
            <p className="text-xs text-slate-500 font-mono mt-1">
              Source Version: {briefing?.source_version || "v1"} · Pages: {briefing?.pages_count || 1} · Sections:{" "}
              {briefing?.sections_count || 0} · Confidence:{" "}
              <strong className="text-emerald-700">{briefing?.verified_confidence_pct || "100.0"}%</strong>
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs font-mono space-y-1.5 shrink-0 min-w-[235px]">
            <div className="flex justify-between text-slate-500 text-[11px]">
              <span>Organization:</span>
              <span className="text-slate-900 font-semibold truncate max-w-[130px]">{companyName}</span>
            </div>
            <div className="flex justify-between text-slate-500 text-[11px]">
              <span>Department:</span>
              <span className="text-slate-700 truncate max-w-[130px]">{departmentName}</span>
            </div>
            <div className="flex justify-between text-slate-500 text-[11px]">
              <span>Prepared By:</span>
              <span className="text-[#1D63ED] font-semibold truncate max-w-[130px]">
                {authorName} ({userId})
              </span>
            </div>
            <div className="flex justify-between text-slate-500 text-[11px]">
              <span>Date:</span>
              <span className="text-slate-700">{currentDate}</span>
            </div>
          </div>
        </div>

        <div className="space-y-6 text-xs text-slate-700">
          {briefing?.latest_investigation && (
            <section className="bg-blue-50/60 border border-blue-200 rounded-xl p-5">
              <div className="flex items-center gap-2 text-[#1D63ED] font-bold uppercase tracking-wider mb-2">
                <Sparkles className="w-4 h-4" />
                <span>Latest Verified AI Investigation ({briefing.latest_investigation.investigation_id})</span>
              </div>
              <p className="text-slate-500 font-mono text-[11px] mb-1">
                Question: &ldquo;{briefing.latest_investigation.question}&rdquo;
              </p>
              <p className="text-sm font-bold text-slate-900 mb-1">{briefing.latest_investigation.title}</p>
              <p className="leading-relaxed text-slate-700">
                {briefing.latest_investigation.direct_answer || briefing.latest_investigation.conclusion}
              </p>
            </section>
          )}

          {briefing?.key_metrics?.length > 0 && (
            <section>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3">
                1. Grounded Quantitative Metrics (Doc #{briefing.document_id})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {briefing.key_metrics.map((km: any, idx: number) => (
                  <div key={idx} className="bg-slate-50/70 p-4 rounded-xl border border-slate-200">
                    <span className="text-slate-500 text-xs font-medium block">{km.label}</span>
                    <p className={`text-xl font-bold mt-1 font-mono tabular-nums ${metricTextColor[km.accent] || "text-slate-900"}`}>
                      {km.value}
                    </p>
                    <span className="text-[11px] text-slate-500">{km.note}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="bg-slate-50/60 p-5 rounded-xl border border-slate-200">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3">
              2. Extracted Document Sections ({briefing?.section_summaries?.length || 0})
            </h3>
            {briefing?.section_summaries?.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {briefing.section_summaries.map((sec: any, idx: number) => (
                  <div key={idx} className="bg-white border border-slate-200 rounded-lg p-3.5">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-bold text-[#1D63ED] font-mono">
                        {sec.section_number}. {sec.section_title}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500 shrink-0">Page {sec.page_number}</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{sec.excerpt || "Section indexed."}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500">No structured sections extracted for this document.</p>
            )}
          </section>

          {briefing?.confirmed_suppliers?.length > 0 && (
            <section className="bg-slate-50/60 p-5 rounded-xl border border-slate-200">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3">
                3. Verified Suppliers & Carriers ({briefing.confirmed_suppliers.length})
              </h3>
              <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="p-3 font-semibold">Organization</th>
                      <th className="p-3 font-semibold">NER Class</th>
                      <th className="p-3 font-semibold">Page</th>
                      <th className="p-3 font-semibold">Metrics / Evidence Context</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {briefing.confirmed_suppliers.map((sup: any, i: number) => (
                      <tr key={i}>
                        <td className="p-3 font-semibold text-slate-900">{sup.name}</td>
                        <td className="p-3 text-amber-700 font-medium">{sup.category}</td>
                        <td className="p-3 text-slate-500 font-mono">p.{sup.page_number}</td>
                        <td className="p-3 text-slate-600">
                          {sup.on_time_rate
                            ? `OTD: ${sup.on_time_rate} (${sup.transit_variance || "verified"})`
                            : sup.supporting_sentence?.slice(0, 110)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {briefing?.structured_tables?.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <TableIcon className="w-4 h-4 text-[#1D63ED]" />
                <span>4. Structured Tables Extracted ({briefing.structured_tables.length})</span>
              </h3>
              {briefing.structured_tables.map((tbl: any) => (
                <div key={tbl.table_name} className="bg-white border border-slate-200 rounded-xl p-4 overflow-x-auto">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="font-mono font-bold text-[#1D63ED]">{tbl.table_name}</span>
                    <span className="text-[11px] font-mono text-slate-500">{tbl.rows.length} rows</span>
                  </div>
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                      <tr>
                        {tbl.columns.map((col: string) => (
                          <th key={col} className="p-2.5 uppercase font-semibold">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {tbl.rows.slice(0, 12).map((r: any, rIdx: number) => (
                        <tr key={rIdx}>
                          {tbl.columns.map((col: string) => (
                            <td key={col} className="p-2.5 text-slate-800 tabular-nums">
                              {r[col] !== undefined && r[col] !== null ? String(r[col]) : "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </section>
          )}

          <section className="bg-slate-50/60 p-5 rounded-xl border border-slate-200">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3">
              5. Documented Recommendations
            </h3>
            {briefing?.recommendations?.length > 0 ? (
              <ol className="list-decimal list-inside space-y-2 text-slate-700 leading-relaxed">
                {briefing.recommendations.map((rec: string, i: number) => (
                  <li key={i}>{rec}</li>
                ))}
              </ol>
            ) : (
              <p className="text-slate-500 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-slate-400" />
                <span>No explicit action recommendations section detected inside Doc #{activeDocumentId}.</span>
              </p>
            )}
          </section>

          {briefing?.citations?.length > 0 && (
            <section className="pt-4 border-t border-slate-200 text-[11px] font-mono text-slate-500 space-y-1.5">
              <p className="font-bold text-slate-700 uppercase">
                Evidence Traceability Citations (Doc #{briefing.document_id})
              </p>
              {briefing.citations.map((cit: any, idx: number) => (
                <p key={idx}>
                  • [Ref: {cit.ref_id} · {cit.type}] <code className="text-[#1D63ED]">{cit.detail}</code>
                </p>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
