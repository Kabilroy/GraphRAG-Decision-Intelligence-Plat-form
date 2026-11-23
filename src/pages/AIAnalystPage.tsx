import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  Sparkles,
  FileText,
  RefreshCw,
  FolderOpen,
  FileCheck,
  ShieldAlert,
  ListOrdered,
  Table as TableIcon,
  AlertTriangle,
  Upload
} from "lucide-react";
import { AgentState } from "../types";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { InvestigationResult } from "../components/investigation/InvestigationResult";

interface AIAnalystPageProps {
  documents?: any[];
  allDocuments?: any[];
  activeDocumentId?: number;
  onSelectDocument?: (docId: number) => void;
  uploadedOnly?: boolean;
  hasUploadedDocs?: boolean;
  onToggleUploadedOnly?: (val: boolean) => void;
  onNavigateToDataSources?: () => void;
}

export const AIAnalystPage: React.FC<AIAnalystPageProps> = ({
  documents,
  activeDocumentId,
  onSelectDocument,
  uploadedOnly = false,
  hasUploadedDocs = false,
  onToggleUploadedOnly,
  onNavigateToDataSources
}) => {
  const [localDocs, setLocalDocs] = useState<any[]>([]);
  const [localDocId, setLocalDocId] = useState<number>(() => {
    const saved = localStorage.getItem("active_target_document_id");
    return saved && !Number.isNaN(Number(saved)) ? Number(saved) : 201;
  });

  const availableDocs = documents && documents.length > 0 ? documents : localDocs;
  const selectedDocId = activeDocumentId !== undefined ? activeDocumentId : localDocId;
  const activeDoc = availableDocs.find((d) => d.id === selectedDocId);

  const [question, setQuestion] = useState<string>("List all suppliers mentioned in the uploaded PDF.");
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionStep, setExecutionStep] = useState<string | null>(null);
  const [state, setState] = useState<AgentState | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const activeInvestigationIdRef = useRef<string | null>(null);
  const prevDocIdRef = useRef<number | null>(null);

  const abortActiveStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    activeInvestigationIdRef.current = null;
  };

  useEffect(() => {
    if (!documents) {
      fetch("/api/documents")
        .then((res) => res.json())
        .then((data) => {
          const docs = data.documents || [];
          setLocalDocs(docs);
          const storedRaw = localStorage.getItem("active_target_document_id");
          const storedId = storedRaw ? parseInt(storedRaw, 10) : NaN;
          if (!Number.isNaN(storedId) && docs.some((d: any) => d.id === storedId)) {
            setLocalDocId(storedId);
          } else if (docs.length > 0) {
            const uploaded = docs.find((d: any) => d.is_uploaded);
            const fallback = uploaded || docs.find((d: any) => d.id === 201) || docs[0];
            setLocalDocId(fallback.id);
          }
        })
        .catch((e) => console.error("Error loading documents:", e));
    }
    return () => abortActiveStream();
  }, [documents]);

  useEffect(() => {
    if (prevDocIdRef.current !== selectedDocId) {
      abortActiveStream();
      setIsExecuting(false);
      setExecutionStep(null);
      setErrorBanner(null);
      setState(null);
      prevDocIdRef.current = selectedDocId;
    }
    if (activeDoc?.suggested_prompts?.length > 0) {
      const firstQ = activeDoc.suggested_prompts[0].q;
      setQuestion((curr) => {
        if (!curr || activeDoc.suggested_prompts.every((p: any) => p.q !== curr)) {
          return firstQ;
        }
        return curr;
      });
    }
  }, [selectedDocId, activeDoc?.id]);

  const handleSelectDocument = (docId: number) => {
    abortActiveStream();
    setIsExecuting(false);
    setExecutionStep(null);
    setErrorBanner(null);
    setState(null);
    if (onSelectDocument) {
      onSelectDocument(docId);
    } else {
      setLocalDocId(docId);
      localStorage.setItem("active_target_document_id", String(docId));
    }
    const nextDoc = availableDocs.find((d) => d.id === docId);
    if (nextDoc?.suggested_prompts?.[0]?.q) {
      setQuestion(nextDoc.suggested_prompts[0].q);
    }
  };

  const handleStartInvestigation = async (queryText?: string, docIdOverride?: number) => {
    const qToRun = (queryText || question).trim();
    const docIdToUse = docIdOverride !== undefined ? docIdOverride : selectedDocId;
    if (!qToRun) return;

    abortActiveStream();
    setErrorBanner(null);
    setState(null);
    setIsExecuting(true);
    setExecutionStep(`Locking Active Target Doc #${docIdToUse} and initiating investigation...`);

    try {
      const res = await fetch("/api/ai/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: qToRun,
          target_document_id: docIdToUse,
          active_document_id: docIdToUse
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || "Failed to initialize investigation.");
        setIsExecuting(false);
        setExecutionStep(null);
        return;
      }

      const sessionId = data.session_id;
      const expectedInvestigationId = data.investigation_id;
      activeInvestigationIdRef.current = expectedInvestigationId;

      const eventSource = new EventSource(`/api/ai/query/${sessionId}/stream`);
      eventSourceRef.current = eventSource;

      eventSource.addEventListener("step", (e: any) => {
        const stepData = JSON.parse(e.data);
        if (activeInvestigationIdRef.current !== expectedInvestigationId) return;
        setExecutionStep(`${stepData.node}: ${stepData.message}`);
      });

      eventSource.addEventListener("complete", (e: any) => {
        const completeData = JSON.parse(e.data);
        if (
          activeInvestigationIdRef.current !== expectedInvestigationId ||
          (completeData.state?.active_document_id !== undefined &&
            completeData.state.active_document_id !== docIdToUse)
        ) {
          eventSource.close();
          return;
        }
        setState(completeData.state);
        setIsExecuting(false);
        setExecutionStep(null);
        eventSource.close();
        eventSourceRef.current = null;
      });

      eventSource.addEventListener("error", (e: any) => {
        console.error("SSE Error:", e);
        if (activeInvestigationIdRef.current === expectedInvestigationId) {
          setIsExecuting(false);
          setExecutionStep(null);
        }
        eventSource.close();
        eventSourceRef.current = null;
      });
    } catch (err: any) {
      console.error(err);
      setErrorBanner(err?.message || "Network error during investigation");
      setIsExecuting(false);
      setExecutionStep(null);
    }
  };

  const valResult = state?.validation_result;
  const dynamicPrompts: any[] = activeDoc?.suggested_prompts || [
    {
      label: "Executive Summary",
      q: "Summarize the key findings and facts in this document.",
      category: "H_AGGREGATION_SUMMARY"
    },
    {
      label: "Main Sections",
      q: "What are the main sections covered in this PDF?",
      category: "B_SECTION_HEADING_LISTING"
    }
  ];

  const getPromptIcon = (category: string) => {
    if (category.includes("MISSING")) return ShieldAlert;
    if (
      category.includes("SECTION") ||
      category.includes("ROOT_CAUSE") ||
      category.includes("SUMMARY") ||
      category.includes("RECOMMENDATION")
    ) {
      return ListOrdered;
    }
    return TableIcon;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header Row with Confidence Summary */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">
            Ask evidence-grounded questions scoped strictly to the selected document across vector, SQL, and graph layers.
          </p>
        </div>

        {state && valResult && (
          <div className="shrink-0">
            <ConfidenceBadge
              score={valResult.confidence_score}
              breakdown={valResult.score_breakdown}
              isValid={valResult.is_valid}
              validationStatus={valResult.validation_status}
            />
          </div>
        )}
      </div>

      {/* Active Target Document Selector Card */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#1D63ED] flex items-center justify-center shrink-0">
              <FolderOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Active Target Document{" "}
                <span className="text-xs font-medium text-slate-500 ml-1">
                  ({availableDocs.length} {uploadedOnly && hasUploadedDocs ? "Uploaded" : "Indexed"})
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Document-level isolation enforced across vector chunks, structured SQL tables, and graph nodes.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedDocId}
              onChange={(e) => handleSelectDocument(Number(e.target.value))}
              className="bg-white border border-slate-200 text-slate-800 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[#1D63ED] font-mono max-w-[300px] sm:max-w-[340px] truncate"
            >
              {availableDocs.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.is_uploaded ? "[UPLOADED] " : "[SAMPLE] "}[DOC #{doc.id}] {doc.title}
                </option>
              ))}
            </select>

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

        {/* Document Quick Switcher */}
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-[11px] font-medium text-slate-500 mr-1">Target:</span>
          {availableDocs.map((doc) => {
            const isSelected = selectedDocId === doc.id;
            return (
              <button
                key={doc.id}
                type="button"
                onClick={() => handleSelectDocument(doc.id)}
                className={`text-xs px-2.5 py-1 rounded-lg border flex items-center gap-1.5 transition-colors ${
                  isSelected
                    ? "bg-[#1D63ED] border-[#1D63ED] text-white font-semibold"
                    : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                <FileText className={`w-3 h-3 ${isSelected ? "text-white" : "text-slate-500"}`} />
                <span className="truncate max-w-[200px]">{doc.title}</span>
                <span className={`text-[10px] font-mono ${isSelected ? "text-blue-100" : "text-slate-400"}`}>
                  #{doc.id}
                </span>
              </button>
            );
          })}
        </div>

        {/* Active Metadata Strip */}
        {activeDoc && (
          <div className="mt-3.5 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <div className="flex items-center gap-2 min-w-0">
              <FileCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="truncate">
                Grounded Lock: <strong className="text-slate-900 font-mono">{activeDoc.title}</strong>{" "}
                <span className="text-slate-500 font-mono">
                  · ID #{activeDoc.id} · {activeDoc.pages_count || 1} page(s) · {activeDoc.sections_count || 1}{" "}
                  section(s) · {activeDoc.graph_nodes_count || 0} graph nodes
                </span>
              </span>
            </div>
            <span className="text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md shrink-0">
              Isolated Context
            </span>
          </div>
        )}
      </div>

      {/* Investigation Query Box */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="relative">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isExecuting) {
                handleStartInvestigation(question, selectedDocId);
              }
            }}
            placeholder={`Ask any question grounded strictly in "${activeDoc?.title || `Doc #${selectedDocId}`}"...`}
            className="w-full bg-slate-50/70 border border-slate-200 rounded-xl py-3.5 pl-11 pr-36 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#1D63ED] focus:ring-2 focus:ring-blue-500/15 transition-all"
          />
          <Search className="w-4.5 h-4.5 text-slate-400 absolute left-3.5 top-4" />
          <button
            type="button"
            onClick={() => handleStartInvestigation(question, selectedDocId)}
            disabled={isExecuting}
            className="absolute right-2 top-2 bg-[#1D63ED] hover:bg-[#1554D1] text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {isExecuting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                <span>Investigating...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-white" />
                <span>Investigate</span>
              </>
            )}
          </button>
        </div>

        {/* Dynamic Quick Grounded Prompts */}
        <div className="mt-3.5 pt-3.5 border-t border-slate-100">
          <div className="text-[11px] font-semibold text-slate-500 mb-2">
            Suggested Investigations for Doc #{selectedDocId} ({activeDoc?.title || "Active Document"})
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {dynamicPrompts.map((item) => {
              const Icon = getPromptIcon(item.category || "");
              return (
                <button
                  key={`${item.label}-${item.q}`}
                  type="button"
                  onClick={() => {
                    setQuestion(item.q);
                    handleStartInvestigation(item.q, selectedDocId);
                  }}
                  className="text-xs bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-[#1D63ED] border border-slate-200 hover:border-blue-200 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 font-medium"
                >
                  <Icon className="w-3.5 h-3.5 text-slate-400" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {errorBanner && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2.5 text-xs text-rose-800">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorBanner}</span>
        </div>
      )}

      {/* Live Execution Progress */}
      {isExecuting && (
        <div className="bg-white border border-blue-200 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-3 mb-3.5">
            <RefreshCw className="w-5 h-5 text-[#1D63ED] animate-spin shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Executing Evidence-First Investigation (Doc #{selectedDocId})
              </h3>
              <p className="text-xs text-[#1D63ED] font-mono mt-0.5">
                {executionStep || "Processing investigation session..."}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-[11px] font-mono">
            {[
              "1. Doc Lock",
              "2. Classify (A-K)",
              "3. Hybrid Vector",
              "4. SQL (RO)",
              "5. Graph Link",
              "6. 12-Pt Critic"
            ].map((step) => (
              <div
                key={step}
                className="bg-slate-50 px-2.5 py-2 rounded-lg border border-slate-200 text-slate-700 text-center font-medium"
              >
                {step}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Results */}
      {state && state.decision && (
        <InvestigationResult
          decision={state.decision}
          evidencePackage={state.evidence_package}
          validationResult={state.validation_result}
          diagnostics={state.diagnostics}
          activeDocumentName={state.active_document_name || activeDoc?.title || "Active Document"}
          activeDocumentId={state.active_document_id || selectedDocId}
        />
      )}
    </div>
  );
};
