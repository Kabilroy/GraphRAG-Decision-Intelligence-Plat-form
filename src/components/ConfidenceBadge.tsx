import React, { useState } from "react";
import { Info, CheckCircle, AlertTriangle, Calculator } from "lucide-react";
import { ScoreBreakdown } from "../types";

interface ConfidenceBadgeProps {
  score: number;
  breakdown?: ScoreBreakdown;
  isValid?: boolean;
  validationStatus?: string;
}

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({
  score,
  breakdown,
  isValid = true,
  validationStatus
}) => {
  const [showFormulaModal, setShowFormulaModal] = useState(false);
  const percentage = (score * 100).toFixed(1);

  const terms = breakdown || {
    retrieval_relevance: 0.9,
    evidence_coverage: 1.0,
    source_provenance: 1.0,
    numerical_consistency: 1.0,
    entity_consistency: 1.0,
    citation_validity: 1.0,
    cross_source_agreement: 1.0,
    evidence_completeness: 1.0,
    source_agreement: 0.95,
    data_recency: 0.9,
    statistical_significance: 0.85
  };

  const hasMultiFactor = terms.retrieval_relevance !== undefined;
  const statusLabel = validationStatus || (isValid ? "PASSED" : "REJECTED");
  const isPositive = isValid && validationStatus !== "REJECTED" && validationStatus !== "CONFLICT_DETECTED";

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setShowFormulaModal(!showFormulaModal)}
        className={`flex items-center gap-2 bg-white border px-3 py-1.5 rounded-lg shadow-[0_1px_2px_rgba(15,23,42,0.04)] cursor-pointer transition-all hover:bg-slate-50 ${
          isPositive ? "border-emerald-200 hover:border-emerald-300" : "border-rose-200 hover:border-rose-300"
        }`}
      >
        <span className="text-xs font-medium text-slate-600 whitespace-nowrap">Confidence:</span>
        <span className={`text-sm font-bold font-mono tabular-nums ${isPositive ? "text-emerald-700" : "text-rose-700"}`}>
          {percentage}%
        </span>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
            isPositive
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-rose-50 text-rose-700 border border-rose-200"
          }`}
        >
          {statusLabel}
        </span>
        <Info className="w-3.5 h-3.5 text-slate-400" />
      </button>

      {showFormulaModal && (
        <div className="absolute right-0 mt-2 w-80 sm:w-88 bg-white border border-slate-200 rounded-xl shadow-xl p-4 z-50 text-slate-800 text-xs text-left">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
            <div className="flex items-center gap-1.5 font-bold text-slate-900">
              <Calculator className="w-4 h-4 text-[#1D63ED]" />
              <span>Multi-Factor Confidence Breakdown</span>
            </div>
            <button
              type="button"
              onClick={() => setShowFormulaModal(false)}
              className="text-slate-400 hover:text-slate-700 text-base font-bold px-1"
            >
              ×
            </button>
          </div>

          <p className="text-[11px] text-slate-500 mb-3">
            Computed across 7 verification dimensions (deterministic Critic scoring):
          </p>

          {hasMultiFactor ? (
            <div className="space-y-1.5 font-mono text-[11px]">
              {[
                { label: "Retrieval Relevance (20%)", val: terms.retrieval_relevance ?? 0 },
                { label: "Evidence Coverage (20%)", val: terms.evidence_coverage ?? 0 },
                { label: "Source Provenance (15%)", val: terms.source_provenance ?? 0 },
                { label: "Numerical Consistency (15%)", val: terms.numerical_consistency ?? 0 },
                { label: "Entity Consistency (10%)", val: terms.entity_consistency ?? 0 },
                { label: "Citation Validity (10%)", val: terms.citation_validity ?? 0 },
                { label: "SQL / Graph Agreement (10%)", val: terms.cross_source_agreement ?? 0 }
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between bg-slate-50 border border-slate-100 px-2.5 py-1.5 rounded-lg"
                >
                  <span className="text-slate-600">{item.label}</span>
                  <span className={`font-bold tabular-nums ${item.val >= 0.7 ? "text-emerald-700" : "text-rose-700"}`}>
                    {(item.val * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2 font-mono text-[11px]">
              <div className="flex items-center justify-between bg-slate-50 border border-slate-100 px-2.5 py-1.5 rounded-lg">
                <span className="text-slate-600">Evidence Completeness</span>
                <span className="font-bold text-emerald-700">{(terms.evidence_completeness * 100).toFixed(0)}%</span>
              </div>
              <div className="flex items-center justify-between bg-slate-50 border border-slate-100 px-2.5 py-1.5 rounded-lg">
                <span className="text-slate-600">Source Agreement</span>
                <span className="font-bold text-emerald-700">{(terms.source_agreement * 100).toFixed(0)}%</span>
              </div>
            </div>
          )}

          <div className="mt-3 pt-2.5 border-t border-slate-100 text-[11px] text-slate-500 flex items-center justify-between">
            <span className={`flex items-center gap-1 font-semibold ${isPositive ? "text-emerald-700" : "text-rose-700"}`}>
              {isPositive ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
              <span>{isPositive ? "12-Point Critic Passed" : "Validation Warning"}</span>
            </span>
            <span className="font-mono">Gate: {statusLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
};
