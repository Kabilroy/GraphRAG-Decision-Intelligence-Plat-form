import React, { useState, useMemo } from "react";
import { CheckCircle2, FileText, ChevronDown, ChevronUp, Copy, Check } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from "recharts";
import { Decision, EvidencePackage, ValidationResult, InvestigationDiagnostics } from "../../types";

export interface InvestigationResultProps {
  decision: Decision;
  evidencePackage?: EvidencePackage;
  validationResult?: ValidationResult;
  diagnostics?: InvestigationDiagnostics;
  activeDocumentName: string;
  activeDocumentId: number;
}

export const InvestigationResult: React.FC<InvestigationResultProps> = ({
  decision,
  evidencePackage,
  validationResult,
  diagnostics,
  activeDocumentName,
  activeDocumentId
}) => {
  const [copied, setCopied] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showExtractionDiag, setShowExtractionDiag] = useState(false);
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({});

  const handleCopy = () => {
    const textToCopy = decision.direct_answer || decision.conclusion || decision.root_cause || "";
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleEvidence = (id: string) => {
    setExpandedEvidence((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const queryCategory = decision.query_category || evidencePackage?.query_category;
  const headersLower = (decision.table_data?.headers || []).map((h) => h.toLowerCase());
  const qaResult = decision.qa_result || evidencePackage?.qa_result;
  const isInsufficientEvidence =
    decision.answer_type === "insufficient_evidence" || qaResult?.status === "insufficient_evidence";
  const isVendorMetricComparison =
    !isInsufficientEvidence && Boolean(qaResult && qaResult.status === "answered");

  const isEntityExtraction =
    !isInsufficientEvidence &&
    !isVendorMetricComparison &&
    (queryCategory === "A_ENTITY_EXTRACTION" ||
      (decision.answer_type === "table" &&
        headersLower.some((h) => h === "supplier / carrier" || h === "carrier" || h === "supplier")));

  const isFinancialAnalysis =
    !isInsufficientEvidence &&
    !isVendorMetricComparison &&
    !isEntityExtraction &&
    (queryCategory === "FINANCIAL_COMPARATIVE_ANALYSIS" ||
      queryCategory === "D_FINANCIAL_TABLE_CALCULATION" ||
      (decision.answer_type === "comparison" &&
        headersLower.some((h) => h.includes("operating profit") || h.includes("profit margin"))) ||
      headersLower.some((h) => h.includes("operating profit") || h.includes("profit margin")));

  const isActionItems =
    !isInsufficientEvidence &&
    !isVendorMetricComparison &&
    !isEntityExtraction &&
    !isFinancialAnalysis &&
    (queryCategory === "C_ACTION_ITEM_EXTRACTION" ||
      (headersLower.includes("owner") && headersLower.includes("deadline")));

  const isInventory =
    !isInsufficientEvidence &&
    !isVendorMetricComparison &&
    !isEntityExtraction &&
    !isFinancialAnalysis &&
    !isActionItems &&
    (queryCategory === "E_INVENTORY_THRESHOLD_CHECK" ||
      Boolean(decision.inventory_analysis) ||
      (headersLower.includes("reorder point") && headersLower.includes("current stock")));

  const validatedInventory = useMemo(() => {
    if (!isInventory) return null;
    const backendInv = decision.inventory_analysis;
    // Document ID isolation check before rendering
    if (
      backendInv?.source_document_id !== undefined &&
      Number(backendInv.source_document_id) !== Number(activeDocumentId)
    ) {
      return {
        isValid: false,
        mismatchReason: `Document isolation check failed: inventory payload belongs to Document #${backendInv.source_document_id}, not active Document #${activeDocumentId}.`,
        records: [],
        queryMode: "below_reorder" as const,
        totalBelow: 0,
        totalAbove: 0,
        totalReplenishment: 0,
        largestShortage: null,
        calculationDetails: "",
        sourcePages: [] as number[],
        isExplicitZeroMatch: false
      };
    }

    const isCleanStr = (v: any) => {
      const s = String(v ?? "").trim();
      return Boolean(s) && !/^(?:undefined|null|nan)$/i.test(s);
    };

    const parseSafeNum = (v: any): number | null => {
      if (v === null || v === undefined || v === "") return null;
      if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
      const cleaned = String(v).replace(/[^0-9.-]/g, "");
      if (!cleaned) return null;
      const n = Number(cleaned);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };

    const rawList: Array<{
      sku: any;
      item_description: any;
      current_stock: any;
      reorder_point: any;
      deficit: any;
      status: any;
      source_page?: any;
    }> = [];

    if (backendInv?.inventory_records && Array.isArray(backendInv.inventory_records)) {
      rawList.push(...backendInv.inventory_records);
    } else if (decision.table_data?.rows?.length) {
      const hdrs = (decision.table_data.headers || []).map((h) => h.toLowerCase());
      const skuIdx = hdrs.findIndex((h) => h.includes("sku"));
      const descIdx = hdrs.findIndex((h) => h.includes("description") || h.includes("item"));
      const stockIdx = hdrs.findIndex((h) => h.includes("current stock") || h.includes("stock"));
      const ropIdx = hdrs.findIndex((h) => h.includes("reorder"));
      const statusIdx = hdrs.findIndex((h) => h.includes("status"));
      const pageIdx = hdrs.findIndex((h) => h.includes("page"));
      if (skuIdx >= 0 && stockIdx >= 0 && ropIdx >= 0) {
        for (const row of decision.table_data.rows) {
          rawList.push({
            sku: row[skuIdx],
            item_description: descIdx >= 0 ? row[descIdx] : row[skuIdx],
            current_stock: row[stockIdx],
            reorder_point: row[ropIdx],
            deficit: 0,
            status: statusIdx >= 0 ? row[statusIdx] : "",
            source_page: pageIdx >= 0 ? parseSafeNum(row[pageIdx]) : decision.source_page
          });
        }
      }
    }

    const dedup = new Map<
      string,
      {
        sku: string;
        item_description: string;
        current_stock: number;
        reorder_point: number;
        deficit: number;
        status: string;
        source_page: number;
      }
    >();

    for (const item of rawList) {
      if (!isCleanStr(item.sku)) continue;
      const sku = String(item.sku).trim().toUpperCase();
      const stock = parseSafeNum(item.current_stock);
      const rop = parseSafeNum(item.reorder_point);
      if (stock === null || rop === null) continue;
      const desc = isCleanStr(item.item_description) ? String(item.item_description).trim() : sku;
      const isBelow = stock < rop;
      const deficit = isBelow ? Number((rop - stock).toFixed(2)) : 0;
      const status = isBelow ? "BELOW REORDER POINT" : "Above Reorder Point";
      const pg = parseSafeNum(item.source_page) ?? parseSafeNum(decision.source_page) ?? 1;

      if (!dedup.has(sku)) {
        dedup.set(sku, {
          sku,
          item_description: desc,
          current_stock: stock,
          reorder_point: rop,
          deficit,
          status,
          source_page: pg
        });
      }
    }

    const records = Array.from(dedup.values());
    const belowRecords = records.filter((r) => r.current_stock < r.reorder_point);
    const computedReplenishment =
      backendInv?.total_replenishment_units !== undefined && Number.isFinite(backendInv.total_replenishment_units)
        ? backendInv.total_replenishment_units
        : belowRecords.reduce((acc, r) => acc + r.deficit, 0);

    const maxDeficit = belowRecords.length > 0 ? Math.max(...belowRecords.map((r) => r.deficit)) : 0;
    const derivedLargest =
      belowRecords.length > 0 ? belowRecords.find((r) => r.deficit === maxDeficit) || null : null;
    const rawLargest = backendInv?.largest_shortage_sku;
    const lsStock = rawLargest ? parseSafeNum(rawLargest.current_stock) : null;
    const lsRop = rawLargest ? parseSafeNum(rawLargest.reorder_point) : null;
    const largestShortage =
      rawLargest &&
      isCleanStr(rawLargest.sku) &&
      isCleanStr(rawLargest.item_description) &&
      lsStock !== null &&
      lsRop !== null
        ? {
            sku: String(rawLargest.sku).trim().toUpperCase(),
            item_description: String(rawLargest.item_description).trim(),
            current_stock: lsStock,
            reorder_point: lsRop,
            deficit: lsStock < lsRop ? Number((lsRop - lsStock).toFixed(2)) : 0,
            status: rawLargest.status || "BELOW REORDER POINT",
            source_page: parseSafeNum(rawLargest.source_page) ?? 1
          }
        : derivedLargest;

    const sourcePages =
      backendInv?.source_pages && backendInv.source_pages.length > 0
        ? backendInv.source_pages.filter((p) => Number.isFinite(p) && p > 0)
        : Array.from(new Set(records.map((r) => r.source_page))).sort((a, b) => a - b);

    const isExplicitZeroMatch =
      Boolean(backendInv) &&
      records.length === 0 &&
      ((backendInv?.total_below_reorder || 0) > 0 || (backendInv?.total_above_reorder || 0) > 0);

    return {
      isValid: records.length > 0 || isExplicitZeroMatch,
      mismatchReason:
        records.length === 0 && !isExplicitZeroMatch
          ? "No complete, validated inventory records (SKU, Item Description, Current Stock, Reorder Point) were found in the selected document."
          : "",
      records,
      queryMode: backendInv?.query_mode || "below_reorder",
      totalBelow: backendInv?.total_below_reorder ?? belowRecords.length,
      totalAbove: backendInv?.total_above_reorder ?? records.length - belowRecords.length,
      totalReplenishment: computedReplenishment,
      largestShortage,
      calculationDetails: backendInv?.calculation_details || "",
      sourcePages,
      isExplicitZeroMatch
    };
  }, [isInventory, decision, activeDocumentId]);

  const inventoryHasInvalidState = isInventory && validatedInventory && !validatedInventory.isValid;

  const sanitizeSafeText = (text?: string) => {
    if (!text) return "";
    if (/\bundefined\b|\bNaN\b|,\s*,/i.test(text)) {
      if (validatedInventory && !validatedInventory.isValid) {
        return validatedInventory.mismatchReason;
      }
      if (validatedInventory && validatedInventory.records.length > 0) {
        return `Validated ${validatedInventory.records.length} inventory record(s) from Document #${activeDocumentId}.`;
      }
    }
    return text;
  };

  const financialChartData = useMemo(() => {
    if (!isFinancialAnalysis || !decision.table_data?.rows?.length) return [];
    const headers = decision.table_data.headers || [];
    const revIdx = headers.findIndex((h) => h.toLowerCase().includes("revenue"));
    const profIdx = headers.findIndex((h) => h.toLowerCase().includes("profit") && !h.toLowerCase().includes("margin"));
    if (revIdx === -1 && profIdx === -1) return [];

    const parseNum = (val: string) => {
      const cleaned = String(val || "").replace(/[^0-9.-]/g, "");
      const num = parseFloat(cleaned);
      return Number.isFinite(num) ? num : 0;
    };

    return decision.table_data.rows.slice(0, 10).map((row) => ({
      name: String(row[0] || "Item"),
      ...(revIdx >= 0 ? { Revenue: parseNum(row[revIdx]) } : {}),
      ...(profIdx >= 0 ? { "Operating Profit": parseNum(row[profIdx]) } : {})
    }));
  }, [isFinancialAnalysis, decision.table_data]);

  return (
    <div className="space-y-5 text-slate-900">
      {/* 1. Result Header & Document Context */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1.5">
            <span className="bg-blue-50 text-[#1D63ED] border border-blue-200 text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md">
              Doc #{activeDocumentId}
            </span>
            <span className="font-mono truncate max-w-[320px] sm:max-w-[460px] text-slate-600">
              {activeDocumentName}
            </span>
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
            {decision.title || "AI Investigation Results"}
          </h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3.5 py-2 rounded-lg border border-slate-200 transition-colors flex items-center gap-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
            <span>{copied ? "Copied" : "Copy Answer"}</span>
          </button>
        </div>
      </div>

      {/* 2. Concise Direct Answer */}
      {decision.direct_answer && !isInsufficientEvidence && !inventoryHasInvalidState && (
        <div className="bg-white border border-blue-200/90 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#1D63ED] block mb-1.5">
            Executive Summary & Direct Answer
          </span>
          <p className="text-[15px] text-slate-900 font-medium leading-relaxed">
            {sanitizeSafeText(decision.direct_answer)}
          </p>
        </div>
      )}

      {/* 3. Query-Aware Dynamic Presentation */}
      {isInsufficientEvidence || inventoryHasInvalidState ? (
        <div className="bg-white border border-slate-200/80 rounded-xl p-10 text-center shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 mx-auto mb-3">
            <FileText className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1">
            Insufficient evidence in the uploaded document to determine the answer.
          </h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            {inventoryHasInvalidState
              ? validatedInventory?.mismatchReason
              : decision.insufficient_evidence_reason || "The selected document does not contain verified evidence for this query."}
          </p>
          {qaResult && qaResult.unparsed_pages && qaResult.unparsed_pages.length > 0 && (
            <p className="text-xs font-mono text-amber-700 mt-3">
              Unparsed pages without readable text: Page(s) {qaResult.unparsed_pages.join(", ")}
            </p>
          )}
        </div>
      ) : isVendorMetricComparison && qaResult ? (
        /* V. Strict Document-Grounded Metric Comparison Panel (Rule 7 exact order) */
        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Vendor Comparison &amp; Metric Analysis
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                {qaResult.records_compared} vendors compared · Page(s) {qaResult.supporting_pages.join(", ")} · {qaResult.metric}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {qaResult.ties.length > 1 && (
                <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-md">
                  Tie Detected ({qaResult.ties.length} vendors)
                </span>
              )}
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md">
                Verification Gate Passed
              </span>
            </div>
          </div>

          {/* 1. Vendor Comparison Table (ALL verified records sorted by value) */}
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 font-semibold">Vendor</th>
                  <th className="px-4 py-3 font-semibold">On-Time Delivery %</th>
                  <th className="px-4 py-3 font-semibold">Source Value</th>
                  <th className="px-4 py-3 font-semibold">Page</th>
                  <th className="px-4 py-3 font-semibold">Confidence Label</th>
                  <th className="px-4 py-3 font-semibold">Verbatim Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {qaResult.records.map((rec, idx) => (
                  <tr key={`${rec.vendor}-${rec.page}-${idx}`} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-semibold text-slate-900">{rec.vendor}</td>
                    <td className="px-4 py-3 font-mono font-bold tabular-nums text-slate-900">
                      {rec.value.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-600">{rec.raw_value}</td>
                    <td className="px-4 py-3 font-mono text-[#1D63ED]">Page {rec.page}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${
                          rec.confidence_label === "ocr-low-confidence"
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : rec.confidence_label === "verified-table"
                              ? "bg-blue-50 text-[#1D63ED] border-blue-200"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}
                      >
                        {rec.confidence_label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-700 max-w-md">{rec.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 2. Numerical Values, Method & Supporting Pages */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
            <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4">
              <span className="font-semibold text-slate-500 uppercase tracking-wider text-[11px] block mb-1">
                Calculation Method
              </span>
              <p className="text-slate-800 font-medium leading-relaxed">{qaResult.method}</p>
            </div>
            <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4">
              <span className="font-semibold text-slate-500 uppercase tracking-wider text-[11px] block mb-1">
                Supporting PDF Page(s)
              </span>
              <p className="text-slate-900 font-mono font-semibold">
                Page {qaResult.supporting_pages.join(", ")} (of {qaResult.page_count} pages in Doc #{qaResult.document_id})
              </p>
              {qaResult.unparsed_pages.length > 0 && (
                <p className="text-amber-700 font-mono text-[11px] mt-1">
                  Unparsed pages (no text layer): Page(s) {qaResult.unparsed_pages.join(", ")}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : isEntityExtraction ? (
        /* A. Entity Extraction / Suppliers Presentation */
        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Confirmed Suppliers</h3>
              <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                {decision.table_data?.rows?.length || 0} confirmed supplier(s) identified in document
              </p>
            </div>
            <span className="text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-md">
              NER Verified
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {decision.table_data?.rows?.map((row, idx) => {
              const name = row[0];
              const category = row[6] || "Supplier";
              const sourcePage = row[5] || "Page 1";
              const supportingText = row[7] || row[4] || decision.bullet_points?.[idx] || "";
              const cardId = `sup-${idx}`;
              const isExpanded = expandedEvidence[cardId];

              return (
                <div
                  key={idx}
                  className="bg-slate-50/70 border border-slate-200 rounded-xl p-4 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2.5">
                      <h4 className="text-base font-bold text-slate-900">{name}</h4>
                      <span className="text-[11px] font-medium bg-blue-50 text-[#1D63ED] border border-blue-200 px-2 py-0.5 rounded-md shrink-0">
                        {category}
                      </span>
                    </div>

                    <div className="space-y-1 text-xs text-slate-600 mb-3">
                      <div>
                        <span className="font-semibold text-slate-700">Source:</span>{" "}
                        <span className="font-mono text-slate-700">{activeDocumentName}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-700">Evidence:</span>{" "}
                        <span className="font-mono text-slate-700">{sourcePage}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => toggleEvidence(cardId)}
                      className="text-xs text-[#1D63ED] hover:text-[#1554D1] font-semibold flex items-center pt-2.5 border-t border-slate-200 w-full justify-between"
                    >
                      <span>View Supporting Evidence</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    {isExpanded && (
                      <div className="mt-2.5 p-3 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-700 leading-relaxed">
                        &ldquo;{supportingText}&rdquo;
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : isFinancialAnalysis ? (
        /* B. Numerical & Financial Analysis */
        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Financial & Operating Profit Analysis
            </h3>
            <span className="text-[11px] font-semibold text-[#1D63ED] bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-md">
              Deterministic Calculation
            </span>
          </div>

          {evidencePackage?.calculated_values && evidencePackage.calculated_values.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {evidencePackage.calculated_values.map((calc, idx) => (
                <div key={idx} className="bg-slate-50/80 border border-slate-200 rounded-xl p-4">
                  <span className="text-xs font-medium text-slate-500 block mb-1">{calc.metric}</span>
                  <div className="text-xl font-bold text-slate-900 font-mono tabular-nums">{calc.result}</div>
                  <span className="text-[11px] font-mono text-slate-500 block mt-1">
                    Formula: {calc.formula}
                  </span>
                </div>
              ))}
            </div>
          )}

          {financialChartData.length > 1 && (
            <div className="border border-slate-200 rounded-xl p-4 bg-white">
              <div className="text-xs font-semibold text-slate-600 mb-3">Visual Comparison</div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={financialChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="name" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#FFFFFF",
                        borderColor: "#E2E8F0",
                        borderRadius: "8px",
                        color: "#0F172A",
                        fontSize: "12px"
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    {financialChartData[0]?.Revenue !== undefined && (
                      <Bar dataKey="Revenue" fill="#1D63ED" radius={[4, 4, 0, 0]} />
                    )}
                    {financialChartData[0]?.["Operating Profit"] !== undefined && (
                      <Bar dataKey="Operating Profit" fill="#10B981" radius={[4, 4, 0, 0]} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {decision.table_data && decision.table_data.rows.length > 0 && (
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    {decision.table_data.headers.map((h, i) => (
                      <th key={i} className="px-4 py-3 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {decision.table_data.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-50/70">
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          className={`px-4 py-3 text-slate-800 ${cIdx === 0 ? "font-semibold text-slate-900" : "font-mono tabular-nums"}`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {decision.conclusion && (
            <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs">
              <strong className="text-emerald-800 uppercase block mb-1 tracking-wider">Conclusion</strong>
              <p className="text-slate-700 leading-relaxed">{decision.conclusion}</p>
            </div>
          )}
        </div>
      ) : isInventory && validatedInventory ? (
        /* E. Deterministic Inventory Reorder & Shortage Analysis */
        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                {validatedInventory.queryMode === "largest_shortage"
                  ? "Largest Inventory Shortage Analysis"
                  : validatedInventory.queryMode === "total_replenishment"
                    ? "Total Replenishment Quantity Analysis"
                    : validatedInventory.queryMode === "above_reorder"
                      ? "SKUs Above Reorder Point"
                      : "Inventory Reorder Status"}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                Doc #{activeDocumentId} · {validatedInventory.sourcePages.length > 0 ? `Page ${validatedInventory.sourcePages.join(", ")}` : "Verified Source"}
              </p>
            </div>
            <span className="text-[11px] font-semibold text-[#1D63ED] bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-md tabular-nums">
              {validatedInventory.records.length} Verified Record(s)
            </span>
          </div>

          {validatedInventory.queryMode === "largest_shortage" && validatedInventory.largestShortage && (
            <div className="bg-rose-50/60 border border-rose-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-6 gap-3">
              <div>
                <span className="text-[11px] font-medium text-rose-700 block">Largest Shortage SKU</span>
                <span className="text-base font-bold text-slate-900 font-mono">{validatedInventory.largestShortage.sku}</span>
              </div>
              <div className="col-span-2">
                <span className="text-[11px] font-medium text-slate-500 block">Item Description</span>
                <span className="text-sm font-semibold text-slate-900">{validatedInventory.largestShortage.item_description}</span>
              </div>
              <div>
                <span className="text-[11px] font-medium text-slate-500 block">Current Stock</span>
                <span className="text-sm font-bold text-slate-900 font-mono tabular-nums">{validatedInventory.largestShortage.current_stock} units</span>
              </div>
              <div>
                <span className="text-[11px] font-medium text-slate-500 block">Reorder Point</span>
                <span className="text-sm font-bold text-slate-900 font-mono tabular-nums">{validatedInventory.largestShortage.reorder_point} units</span>
              </div>
              <div>
                <span className="text-[11px] font-medium text-rose-700 block">Shortage Deficit</span>
                <span className="text-base font-bold text-rose-700 font-mono tabular-nums">
                  {validatedInventory.largestShortage.deficit} units (Page {validatedInventory.largestShortage.source_page})
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4">
              <span className="text-xs font-medium text-slate-500 block mb-1">Total Replenishment Required</span>
              <div className="text-xl font-bold text-slate-900 font-mono tabular-nums">
                {validatedInventory.totalReplenishment} units
              </div>
              <span className="text-[11px] font-mono text-slate-500 block mt-1">
                Sum of positive deficits (Reorder Point - Current Stock)
              </span>
            </div>
            <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4">
              <span className="text-xs font-medium text-slate-500 block mb-1">Below Reorder Point</span>
              <div className="text-xl font-bold text-rose-700 font-mono tabular-nums">
                {validatedInventory.totalBelow} SKU(s)
              </div>
              <span className="text-[11px] font-mono text-slate-500 block mt-1">
                Current Stock &lt; Reorder Point
              </span>
            </div>
            <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4">
              <span className="text-xs font-medium text-slate-500 block mb-1">Above Reorder Point</span>
              <div className="text-xl font-bold text-emerald-700 font-mono tabular-nums">
                {validatedInventory.totalAbove} SKU(s)
              </div>
              <span className="text-[11px] font-mono text-slate-500 block mt-1">
                Healthy threshold buffer
              </span>
            </div>
          </div>

          {validatedInventory.records.length > 0 ? (
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 font-semibold">SKU</th>
                    <th className="px-4 py-3 font-semibold">Item Description</th>
                    <th className="px-4 py-3 font-semibold">Current Stock</th>
                    <th className="px-4 py-3 font-semibold">Reorder Point</th>
                    <th className="px-4 py-3 font-semibold">Deficit</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Source Page</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {validatedInventory.records.map((rec) => (
                    <tr key={rec.sku} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900">{rec.sku}</td>
                      <td className="px-4 py-3 text-slate-800">{rec.item_description}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-800">{rec.current_stock} units</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-800">{rec.reorder_point} units</td>
                      <td className="px-4 py-3 font-mono tabular-nums font-semibold text-slate-900">
                        {rec.deficit} units
                      </td>
                      <td className="px-4 py-3">
                        {rec.current_stock < rec.reorder_point ? (
                          <span className="bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-md font-semibold text-[11px]">
                            BELOW REORDER POINT
                          </span>
                        ) : (
                          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md font-semibold text-[11px]">
                            Above Reorder Point
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600">Page {rec.source_page}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
              {validatedInventory.calculationDetails || decision.conclusion}
            </div>
          )}

          {decision.conclusion && (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 leading-relaxed">
              {sanitizeSafeText(decision.conclusion)}
            </div>
          )}
        </div>
      ) : isActionItems ? (
        /* C. Meeting Action Items */
        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Meeting Action Items</h3>
            <span className="text-[11px] font-semibold text-[#1D63ED] bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-md tabular-nums">
              {decision.table_data?.rows?.length || 0} Records
            </span>
          </div>

          {decision.table_data && decision.table_data.rows.length > 0 && (
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    {decision.table_data.headers.map((h, i) => (
                      <th key={i} className="px-4 py-3 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {decision.table_data.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-50/70">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-4 py-3 text-slate-800">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {decision.conclusion && (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
              {decision.conclusion}
            </div>
          )}
        </div>
      ) : (
        /* D. Root Cause Analysis / Section Listing / Tabular & General Findings */
        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              {queryCategory === "B_SECTION_HEADING_LISTING"
                ? "Document Sections & Structure"
                : decision.table_data && decision.table_data.rows.length > 0
                  ? "Structured Findings & Data Table"
                  : "Structured Findings & Root Causes"}
            </h3>
            <span className="text-[11px] font-semibold text-[#1D63ED] bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-md">
              Verified Facts
            </span>
          </div>

          {decision.table_data && decision.table_data.rows.length > 0 && (
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    {decision.table_data.headers.map((h, i) => (
                      <th key={i} className="px-4 py-3 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {decision.table_data.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-50/70">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-4 py-3 text-slate-800">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {decision.bullet_points && decision.bullet_points.length > 0 ? (
            <div className="space-y-2.5">
              {decision.bullet_points.map((pt, idx) => (
                <div
                  key={idx}
                  className="bg-slate-50/70 border border-slate-200 rounded-xl p-3.5 flex items-start gap-3"
                >
                  <span className="w-6 h-6 rounded-lg bg-blue-50 text-[#1D63ED] border border-blue-200 flex items-center justify-center text-xs font-mono font-bold shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <p className="text-slate-800 text-xs sm:text-[13px] leading-relaxed">{pt}</p>
                </div>
              ))}
            </div>
          ) : !decision.table_data?.rows?.length ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs sm:text-[13px] text-slate-700 leading-relaxed">
              {decision.root_cause}
            </div>
          ) : null}
        </div>
      )}

      {/* 4. Supporting Evidence */}
      {(() => {
        const verifiedCitations = (evidencePackage?.source_citations || [])
          .map((cite) => {
            const matchedFact = evidencePackage?.directly_extracted_facts?.find((f) => f.chunk_id === cite.chunk_id);
            const excerpt = (cite.source_excerpt || matchedFact?.statement || "").trim();
            return { cite, excerpt };
          })
          .filter((item) => item.excerpt.length > 0);

        return (
          <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Supporting Evidence & Source References</span>
              </h3>
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md tabular-nums">
                {verifiedCitations.length} Citation(s)
              </span>
            </div>

            {verifiedCitations.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                No directly supporting passages found in the selected document for this query.
              </p>
            ) : (
              <div className="space-y-2.5">
                {verifiedCitations.map(({ cite, excerpt }, idx) => {
                  const chunkKey = `cite-${cite.chunk_id}-${idx}`;
                  const isExp = expandedEvidence[chunkKey];

                  return (
                    <div key={`${cite.chunk_id}-${idx}`} className="bg-slate-50/70 border border-slate-200 rounded-xl p-3.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 truncate">
                          <FileText className="w-3.5 h-3.5 text-[#1D63ED] shrink-0" />
                          <span className="text-slate-900 font-semibold font-mono truncate">{cite.document_name}</span>
                          <span className="text-[#1D63ED] font-mono font-medium shrink-0">Page {cite.page_number}</span>
                          <span className="text-slate-500 truncate">({cite.section_title})</span>
                          {cite.support_role && (
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border shrink-0 ${
                                cite.support_role === "Primary Identification"
                                  ? "bg-blue-50 text-[#1D63ED] border-blue-200"
                                  : "bg-slate-100 text-slate-600 border-slate-200"
                              }`}
                            >
                              {cite.support_role}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleEvidence(chunkKey)}
                          className="text-xs text-[#1D63ED] hover:text-[#1554D1] font-semibold shrink-0 flex items-center gap-1"
                        >
                          <span>{isExp ? "Hide Excerpt" : "View Excerpt"}</span>
                          {isExp ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </div>

                      {isExp && (
                        <div className="mt-2.5 p-3 bg-white border border-slate-200 rounded-lg text-slate-700 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                          {excerpt}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* 5. Recommended Actions */}
      {decision.recommendation && decision.recommendation.trim().length > 0 && (
        <div className="bg-white border border-emerald-200 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <h3 className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-2 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Recommended Actions</span>
          </h3>
          <p className="text-slate-700 text-xs sm:text-[13px] leading-relaxed">{decision.recommendation}</p>
        </div>
      )}

      {/* 6. Technical Agent Diagnostics & Unverified Entities */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Technical Verification Diagnostics
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Inspect Critic verification checks and filtered extraction candidates.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowExtractionDiag(!showExtractionDiag)}
              className="text-xs bg-slate-50 hover:bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors font-medium"
            >
              {showExtractionDiag ? "Hide Extraction Diagnostics" : "Extraction Diagnostics"}
            </button>
            <button
              type="button"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="text-xs bg-blue-50 hover:bg-blue-100 text-[#1D63ED] px-3 py-1.5 rounded-lg border border-blue-200 transition-colors font-medium"
            >
              {showDiagnostics ? "Hide 12-Pt Critic Audit" : "12-Pt Critic Audit"}
            </button>
          </div>
        </div>

        {showExtractionDiag && diagnostics?.entity_classification && (
          <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 font-mono text-xs">
            <h4 className="font-bold text-amber-700 uppercase tracking-wider">
              Rejected & Unverified Extraction Candidates (
              {diagnostics.entity_classification.excluded_entities.length +
                diagnostics.entity_classification.unverified_entities.length}
              )
            </h4>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {diagnostics.entity_classification.excluded_entities.map((ex, i) => (
                <div
                  key={`ex-${i}`}
                  className="p-2.5 bg-white rounded-lg border border-slate-200 flex items-center justify-between text-[11px]"
                >
                  <div>
                    <strong className="text-slate-900">{ex.name}</strong>{" "}
                    <span className="text-slate-500">({ex.category})</span>
                  </div>
                  <span className="text-rose-700 font-medium">Excluded: {ex.reason}</span>
                </div>
              ))}
              {diagnostics.entity_classification.unverified_entities.map((uv, i) => (
                <div
                  key={`uv-${i}`}
                  className="p-2.5 bg-white rounded-lg border border-slate-200 flex items-center justify-between text-[11px]"
                >
                  <div>
                    <strong className="text-slate-900">{uv.name}</strong>{" "}
                    <span className="text-slate-500">({uv.category})</span>
                  </div>
                  <span className="text-amber-700 font-medium">Unverified: {uv.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {showDiagnostics && validationResult?.checklist && (
          <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 font-mono text-[11px]">
            <h4 className="font-bold text-slate-900 uppercase tracking-wider">12-Point Critic Verification Checklist</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {validationResult.checklist.map((item) => (
                <div
                  key={item.check_number}
                  className={`p-2.5 rounded-lg border flex items-start gap-2 bg-white ${
                    item.passed ? "border-emerald-200 text-slate-700" : "border-rose-200 text-rose-800"
                  }`}
                >
                  <span className={item.passed ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>
                    {item.passed ? "✓" : "✗"} #{item.check_number}
                  </span>
                  <div>
                    <div className="font-bold text-slate-900">{item.name}</div>
                    <div className="text-slate-500 text-[10px]">{item.detail}</div>
                  </div>
                </div>
              ))}
            </div>

            {diagnostics?.audit_source_citations && diagnostics.audit_source_citations.length > 0 && (
              <div className="pt-2 border-t border-slate-200">
                <div className="font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Preserved Internal Audit References ({diagnostics.audit_source_citations.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {diagnostics.audit_source_citations.map((ac, i) => (
                    <span
                      key={`${ac.chunk_id}-${i}`}
                      className="px-2 py-1 rounded bg-white border border-slate-200 text-slate-600 text-[10px]"
                    >
                      Page {ac.page_number} · {ac.section_title} ({ac.chunk_id})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
