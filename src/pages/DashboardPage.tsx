import React, { useEffect, useState } from "react";
import {
  TrendingUp,
  Layers,
  Upload,
  Truck,
  Package,
  BarChart3,
  Tag
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  CartesianGrid,
  Legend
} from "recharts";

interface DashboardPageProps {
  documents?: any[];
  activeDocumentId?: number;
  onSelectDocument?: (docId: number) => void;
  uploadedOnly?: boolean;
  hasUploadedDocs?: boolean;
  onToggleUploadedOnly?: (val: boolean) => void;
  onNavigateToDataSources?: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  documents = [],
  activeDocumentId = 201,
  onSelectDocument,
  uploadedOnly = false,
  hasUploadedDocs = false,
  onToggleUploadedOnly,
  onNavigateToDataSources
}) => {
  const [analytics, setAnalytics] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetch(`/api/dashboard/analytics?document_id=${activeDocumentId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setAnalytics(data);
        }
      })
      .catch((err) => console.error("Failed to fetch document analytics:", err))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDocumentId]);

  const kpis: any[] = analytics?.kpis || [];
  const charts = analytics?.charts || {};
  const docMeta = analytics?.document;
  const regionalPnl: any[] = charts.regional_pnl || [];
  const vendorPerf: any[] = charts.vendor_performance || [];
  const inventoryStatus: any[] = charts.inventory_status || [];
  const csvMetrics = charts.csv_metrics || null;
  const sectionDist: any[] = charts.section_distribution || [];
  const entityBreakdown: any[] = charts.entity_breakdown || [];
  const pageDensity: any[] = charts.page_density || [];
  const confirmedSuppliers: any[] = analytics?.confirmed_suppliers || [];

  const pnlCurrency = regionalPnl[0]?.currency || "INR";

  const chartTooltipStyle = {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: "8px",
    color: "#0F172A",
    fontSize: "12px",
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.08)"
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Toolbar: Document Scope & Upload */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs sm:text-sm text-slate-500">
          Metrics and charts scoped strictly to{" "}
          <span className="font-semibold text-slate-800 font-mono">
            {docMeta?.title || `Doc #${activeDocumentId}`}
          </span>
          {docMeta && (
            <span className="text-slate-400 ml-2 font-mono text-xs">
              · {docMeta.pages_count} page(s) · {docMeta.sections_count} section(s)
              {isLoading ? " · Syncing..." : ""}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {documents.length > 0 && onSelectDocument && (
            <select
              value={activeDocumentId}
              onChange={(e) => onSelectDocument(Number(e.target.value))}
              className="bg-white border border-slate-200 text-slate-800 text-xs rounded-lg px-3 py-2 font-mono max-w-[260px] focus:outline-none focus:border-[#1D63ED]"
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
              className={`text-xs font-medium px-3 py-2 rounded-lg border transition-colors whitespace-nowrap ${
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
              className="bg-[#1D63ED] hover:bg-[#1554D1] text-white text-xs font-semibold px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload PDF</span>
            </button>
          )}
        </div>
      </div>

      {/* Dynamic 4-Card KPI Grid */}
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
              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span
                  className={`font-semibold inline-flex items-center gap-1 ${
                    isDown ? "text-rose-600" : "text-emerald-600"
                  }`}
                >
                  <span>{isDown ? "▼" : "▲"}</span>
                  <span>{kpi.change}</span>
                </span>
                <span className="text-[11px] text-slate-400 font-mono truncate">{kpi.target}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Primary Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {regionalPnl.length > 0 && (
          <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#1D63ED]" />
                <span>Regional Financial P&L (Doc #{activeDocumentId})</span>
              </h3>
              <span className="text-[11px] font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                {pnlCurrency}
              </span>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={regionalPnl}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="region" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="#64748B"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    formatter={(val: any) => [`${pnlCurrency} ${Number(val).toLocaleString()}`, ""]}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="gross_revenue" name="Gross Revenue" fill="#1D63ED" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="operating_expenses" name="Operating Expenses" fill="#94A3B8" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="operating_profit" name="Operating Profit" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {vendorPerf.length > 0 && (
          <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Truck className="w-4 h-4 text-[#1D63ED]" />
                <span>Vendor / Carrier On-Time Performance</span>
              </h3>
              <span className="text-[11px] font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                {vendorPerf.length} Audited
              </span>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={vendorPerf}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="carrier" stroke="#64748B" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="#64748B"
                    fontSize={11}
                    domain={[0, 100]}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(val: any) => [`${val}%`, ""]} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="on_time_pct" name="On-Time Delivery %" fill="#1D63ED" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="target_pct" name="Target SLA %" fill="#CBD5E1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {inventoryStatus.length > 0 && (
          <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-[#1D63ED]" />
                <span>Inventory Stock vs Reorder Point</span>
              </h3>
              <span className="text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded">
                {inventoryStatus.filter((r) => r.status === "BELOW REORDER POINT").length} Below Reorder
              </span>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={inventoryStatus}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="sku" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="current_stock" name="Current Stock" fill="#E11D48" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="reorder_point" name="Reorder Point" fill="#1D63ED" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {csvMetrics && csvMetrics.rows?.length > 0 && (
          <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#1D63ED]" />
                <span>CSV Tabular Metrics ({csvMetrics.rows.length} Rows)</span>
              </h3>
              <span className="text-[11px] font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                Uploaded CSV
              </span>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={csvMetrics.rows.slice(0, 12)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis
                    dataKey={csvMetrics.labelKey}
                    stroke="#64748B"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  {csvMetrics.valueKeys.map((vk: string, idx: number) => (
                    <Bar
                      key={vk}
                      dataKey={vk}
                      fill={["#1D63ED", "#10B981", "#64748B"][idx % 3]}
                      radius={[4, 4, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {sectionDist.length > 0 && (
          <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#1D63ED]" />
                <span>Section Content Density ({sectionDist.length} Sections)</span>
              </h3>
              <span className="text-[11px] text-slate-500 font-mono">Words per Section</span>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sectionDist} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                  <XAxis type="number" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis
                    dataKey="section"
                    type="category"
                    stroke="#64748B"
                    fontSize={10}
                    width={145}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Bar dataKey="words" name="Words Extracted" fill="#1D63ED" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {entityBreakdown.length > 0 && (
          <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Tag className="w-4 h-4 text-[#1D63ED]" />
                <span>NER Entity Classification Breakdown</span>
              </h3>
              <span className="text-[11px] font-mono text-slate-500">
                {entityBreakdown.length} Categories
              </span>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={entityBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="category" stroke="#64748B" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748B" fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Bar dataKey="count" name="Extracted Spans" fill="#1D63ED" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Row: Page Density Area Chart & Confirmed Suppliers Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {pageDensity.length > 0 && (
          <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#1D63ED]" />
                <span>Page-Level Extraction & Vector Density</span>
              </h3>
              <span className="text-[11px] font-mono text-slate-500">{pageDensity.length} Page(s)</span>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={pageDensity}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="page" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Area
                    type="monotone"
                    dataKey="chars"
                    name="Characters Extracted"
                    stroke="#1D63ED"
                    strokeWidth={2}
                    fill="#1D63ED"
                    fillOpacity={0.08}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Confirmed Suppliers & Carriers (Doc #{activeDocumentId})
            </h3>
            <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md tabular-nums">
              {confirmedSuppliers.length} Confirmed
            </span>
          </div>
          {confirmedSuppliers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 pr-3 font-medium">Organization</th>
                    <th className="py-2.5 px-3 font-medium">Class</th>
                    <th className="py-2.5 px-3 font-medium">Page</th>
                    <th className="py-2.5 pl-3 font-medium text-right">Status / OTD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {confirmedSuppliers.map((sup, i) => (
                    <tr key={`${sup.name}-${i}`}>
                      <td className="py-3 pr-3 font-semibold text-slate-900">{sup.name}</td>
                      <td className="py-3 px-3 text-slate-600">{sup.category}</td>
                      <td className="py-3 px-3 font-mono text-slate-600">p.{sup.page_number}</td>
                      <td className="py-3 pl-3 text-right">
                        {sup.on_time_rate ? (
                          <span className="inline-block bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md font-medium tabular-nums">
                            OTD {sup.on_time_rate}
                          </span>
                        ) : (
                          <span className="inline-block bg-blue-50 text-[#1D63ED] px-2 py-0.5 rounded-md font-medium">
                            Verified
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-slate-500 py-8 text-center">
              No supplier or carrier organizations detected in Doc #{activeDocumentId}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
