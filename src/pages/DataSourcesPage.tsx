import React, { useState, useEffect, useRef } from "react";
import {
  Upload,
  FileText,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  FileUp,
  X,
  Loader2,
  AlertTriangle,
  Search
} from "lucide-react";
import { User } from "../types";

interface DataSourcesPageProps {
  user: User | null;
  activeDocumentId?: number;
  uploadedOnly?: boolean;
  hasUploadedDocs?: boolean;
  onToggleUploadedOnly?: (val: boolean) => void;
  onSelectDocument?: (docId: number) => void;
  onDocumentUploaded?: (docId: number) => Promise<void> | void;
  onNavigateToAnalyst?: () => void;
  onNavigateToDashboard?: () => void;
  onNavigateToGraph?: () => void;
  onNavigateToReports?: () => void;
}

export const DataSourcesPage: React.FC<DataSourcesPageProps> = ({
  user,
  activeDocumentId = 201,
  uploadedOnly = false,
  hasUploadedDocs = false,
  onToggleUploadedOnly,
  onSelectDocument,
  onDocumentUploaded,
  onNavigateToAnalyst,
  onNavigateToDashboard,
  onNavigateToGraph
}) => {
  const [documents, setDocuments] = useState<any[]>([]);
  const [inspectedDocId, setInspectedDocId] = useState<number | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [modalTab, setModalTab] = useState<"file" | "text">("file");

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [base64Pdf, setBase64Pdf] = useState<string>("");
  const [uploadName, setUploadName] = useState("");
  const [uploadType, setUploadType] = useState("PDF");
  const [uploadContent, setUploadContent] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isExtractingPdf, setIsExtractingPdf] = useState(false);
  const [pdfExtractStatus, setPdfExtractStatus] = useState<string>("");
  const [pdfExtractError, setPdfExtractError] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [fileSizeFormatted, setFileSizeFormatted] = useState("");
  const [justUploadedDocName, setJustUploadedDocName] = useState<string | null>(null);
  const [justUploadedDocId, setJustUploadedDocId] = useState<number | null>(null);

  // Interactive Retrieval Test State (Strictly scoped to activeDocumentId)
  const [retrievalQuery, setRetrievalQuery] = useState("");
  const [isTestingRetrieval, setIsTestingRetrieval] = useState(false);
  const [retrievalResults, setRetrievalResults] = useState<any[] | null>(null);
  const [retrievalError, setRetrievalError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const companyName = user?.company || "Enterprise Workspace";

  const loadData = () => {
    fetch("/api/documents")
      .then((res) => res.json())
      .then((data) => setDocuments(data.documents || []))
      .catch(() => {});
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    setRetrievalResults(null);
    setRetrievalError(null);
  }, [activeDocumentId]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleProcessFile = (file: File) => {
    setSelectedFile(file);
    setUploadName(file.name);
    setFileSizeFormatted(formatFileSize(file.size));
    setPdfExtractError("");
    setPdfExtractStatus("");
    setUploadContent("");
    setBase64Pdf("");

    const extension = file.name.split(".").pop()?.toUpperCase() || "PDF";
    if (["PDF", "CSV", "XLSX", "DOCX", "TXT"].includes(extension)) {
      setUploadType(extension);
    } else {
      setUploadType("PDF");
    }

    const reader = new FileReader();

    if (file.type.includes("text") || file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (!text || text.trim().length < 5) {
          setPdfExtractError(`File "${file.name}" appears empty.`);
          return;
        }
        setUploadContent(text);
        setPdfExtractStatus(`Text file loaded: ${file.name} (${text.length} chars)`);
      };
      reader.readAsText(file);
    } else {
      setIsExtractingPdf(true);
      const isExcelFile = /\.(?:xlsx|xls)$/i.test(file.name);
      setPdfExtractStatus(
        isExcelFile
          ? "Extracting worksheets and tabular rows via Excel parser..."
          : "Extracting pages and text from PDF via backend parser..."
      );

      reader.onload = async (e) => {
        try {
          const dataUrl = e.target?.result as string;
          const base64Data = dataUrl.split(",")[1];
          setBase64Pdf(base64Data);

          const res = await fetch(isExcelFile ? "/api/data/parse-excel" : "/api/data/parse-pdf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base64: base64Data, filename: file.name })
          });

          const data = await res.json();
          if (res.ok && data.success && data.text && data.text.trim().length > 0) {
            setUploadContent(data.text);
            setPdfExtractStatus(
              `Extracted ${data.char_count} characters across ${data.pages_count} page(s) from ${file.name}${data.ocrUsed ? " (via OCR)" : ""}.`
            );
          } else {
            setUploadContent("");
            setPdfExtractStatus("");
            setPdfExtractError(
              data.error ||
                `Unable to extract readable text from "${file.name}". If this is a scanned/image-only PDF, paste extracted text manually.`
            );
          }
        } catch (err: any) {
          setUploadContent("");
          setPdfExtractStatus("");
          setPdfExtractError(`PDF extraction failed: ${err?.message || "Network or server error"}`);
        } finally {
          setIsExtractingPdf(false);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleProcessFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handlePreFillSample = (type: string) => {
    setSelectedFile(null);
    setModalTab("text");
    if (type === "supply_chain") {
      setUploadName(`${companyName.replace(/\s+/g, "_")}_Supply_Chain_Risk_Audit.pdf`);
      setUploadType("PDF");
      setUploadContent(
        `EXECUTIVE AUDIT REPORT FOR ${companyName.toUpperCase()}:\nDuring the recent quarter, primary component deliveries from key vendors experienced sustained distribution delays. Fulfillment turnaround times expanded from normal 3-5 days to 24-28 business days due to shipping port gridlock. Production output declined by 32%, resulting in order backlog and stockouts in key enterprise customer regions. Recommended action: Onboard secondary logistics partners and reallocate 35% of procurement volume.`
      );
    } else if (type === "financial") {
      setUploadName(`${companyName.replace(/\s+/g, "_")}_Q3_Financial_Review.csv`);
      setUploadType("CSV");
      setUploadContent(
        `Quarter,Product_Line,Region,Gross_Revenue,Target_Revenue,Margin_Pct\nQ1,Enterprise Sensors,North,1380000,1350000,34.2\nQ2,Enterprise Sensors,North,1420000,1400000,35.0\nQ3,Enterprise Sensors,North,923000,1450000,28.4\nQ3,Enterprise Sensors,West,1820000,1800000,36.1\nQ3,Enterprise Sensors,South,1410200,1380000,34.8`
      );
    }
  };

  const handleUploadDocument = async () => {
    if (!uploadName || !uploadContent) return;
    setIsUploading(true);
    setPdfExtractError("");

    try {
      const res = await fetch("/api/data/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: uploadName,
          type: uploadType,
          content: uploadContent,
          base64: base64Pdf,
          user_id: user?.id || "usr-01"
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (data.document_id) {
          localStorage.setItem("active_target_document_id", String(data.document_id));
          setJustUploadedDocId(data.document_id);
          await onDocumentUploaded?.(data.document_id);
        }
        setJustUploadedDocName(uploadName);
        setShowUploadModal(false);
        setUploadName("");
        setUploadContent("");
        setSelectedFile(null);
        setBase64Pdf("");
        setPdfExtractStatus("");
        setPdfExtractError("");
        loadData();
      } else {
        setPdfExtractError(data.error || "Upload failed during extraction or indexing.");
      }
    } catch (err: any) {
      setPdfExtractError(err?.message || "Network error during document upload.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleToggleDocStatus = async (doc: any) => {
    try {
      const res = await fetch(`/api/documents/${doc.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: doc.is_active === false, user_id: user?.id || "usr-01" })
      });
      if (res.ok) {
        loadData();
      }
    } catch (err) {
      console.error("Failed to toggle status:", err);
    }
  };

  const handleDeleteDoc = async (doc: any) => {
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user?.id || "usr-01" })
      });
      if (res.ok) {
        if (inspectedDocId === doc.id) setInspectedDocId(null);
        loadData();
      }
    } catch (err) {
      console.error("Failed to delete document:", err);
    }
  };

  const handleRunRetrievalTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!retrievalQuery.trim()) return;
    setIsTestingRetrieval(true);
    setRetrievalError(null);
    setRetrievalResults(null);
    try {
      const res = await fetch("/api/data/retrieval-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: activeDocumentId, query: retrievalQuery.trim(), top_k: 4 })
      });
      const data = await res.json();
      if (!res.ok) {
        setRetrievalError(data.error || "Retrieval test failed");
      } else {
        setRetrievalResults(data.results || []);
      }
    } catch (err: any) {
      setRetrievalError(err?.message || "Failed to execute retrieval test");
    } finally {
      setIsTestingRetrieval(false);
    }
  };

  const visibleDocs = uploadedOnly && hasUploadedDocs ? documents.filter((d) => d.is_uploaded) : documents;
  const totalCount = visibleDocs.length;
  const processedCount = visibleDocs.filter((d) => d.extraction_status === "INDEXED" && d.is_active !== false).length;
  const failedCount = visibleDocs.filter((d) => d.extraction_status !== "INDEXED").length;
  const totalChunks = visibleDocs.reduce((acc, d) => acc + (d.chunks_count ?? d.chunks?.length ?? 0), 0);
  const embeddingStatus = totalCount === 0 ? "Empty" : failedCount > 0 && processedCount === 0 ? "Failed" : "Indexed";
  const inspectedDoc = visibleDocs.find((d) => d.id === inspectedDocId) || null;
  const activeDocTitle = visibleDocs.find((d) => d.id === activeDocumentId)?.title || `Doc #${activeDocumentId}`;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Top 5 Summary KPI Cards Matching Fig A.6 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">Total documents</div>
          <div className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">{totalCount}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">Processed</div>
          <div className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">{processedCount}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">Failed</div>
          <div className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">{failedCount}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">Total chunks</div>
          <div className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">
            {totalChunks.toLocaleString()}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 col-span-2 sm:col-span-1">
          <div className="text-xs font-medium text-slate-500">Embedding status</div>
          <div className="text-2xl font-bold text-slate-900 mt-1.5">{embeddingStatus}</div>
        </div>
      </div>

      {/* Upload Confirmation Banner */}
      {justUploadedDocName && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-emerald-900">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <p className="font-bold text-slate-900 text-sm">
                &ldquo;{justUploadedDocName}&rdquo; {justUploadedDocId ? `(Doc #${justUploadedDocId})` : ""} indexed cleanly.
              </p>
              <p className="text-emerald-800 mt-0.5">
                All pages, tables, sections, and provenance records are locked as the active investigation target.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onNavigateToGraph && (
              <button
                type="button"
                onClick={() => {
                  if (justUploadedDocId) onSelectDocument?.(justUploadedDocId);
                  onNavigateToGraph();
                }}
                className="bg-white hover:bg-slate-50 border border-emerald-300 text-emerald-800 font-semibold text-xs px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                View Knowledge Graph
              </button>
            )}
            {onNavigateToDashboard && (
              <button
                type="button"
                onClick={() => {
                  if (justUploadedDocId) onSelectDocument?.(justUploadedDocId);
                  onNavigateToDashboard();
                }}
                className="bg-white hover:bg-slate-50 border border-emerald-300 text-emerald-800 font-semibold text-xs px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                View Analytics
              </button>
            )}
            {onNavigateToAnalyst && (
              <button
                type="button"
                onClick={() => {
                  if (justUploadedDocId) {
                    localStorage.setItem("active_target_document_id", String(justUploadedDocId));
                    onSelectDocument?.(justUploadedDocId);
                  }
                  onNavigateToAnalyst();
                }}
                className="bg-[#1D63ED] hover:bg-[#1554D1] text-white font-semibold text-xs px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Investigate with AI</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Documents Card Matching Fig A.6 */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-slate-900">Documents</h2>
            {hasUploadedDocs && onToggleUploadedOnly && (
              <button
                type="button"
                onClick={() => onToggleUploadedOnly(!uploadedOnly)}
                className={`text-xs font-medium px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  uploadedOnly
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700 font-semibold"
                    : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {uploadedOnly ? "Uploaded PDFs Only" : "All Docs"}
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setShowUploadModal(true);
              setModalTab("file");
            }}
            className="bg-[#1D63ED] hover:bg-[#1554D1] text-white font-semibold text-xs px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload document</span>
          </button>
        </div>

        {/* High-Density Documents Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-3 pr-4 font-semibold">Title</th>
                <th className="py-3 px-4 font-semibold">Type</th>
                <th className="py-3 px-4 font-semibold text-right">Chunks</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 pl-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleDocs.length > 0 ? (
                visibleDocs.map((doc) => {
                  const isActiveTarget = doc.id === activeDocumentId;
                  const isDocEnabled = doc.is_active !== false;
                  const isFailed = doc.extraction_status !== "INDEXED";
                  const chunksCount = doc.chunks_count ?? doc.chunks?.length ?? 0;

                  return (
                    <tr
                      key={doc.id}
                      onClick={() => onSelectDocument?.(doc.id)}
                      className={`cursor-pointer transition-colors ${
                        isActiveTarget ? "bg-blue-50/40" : "hover:bg-slate-50/80"
                      }`}
                    >
                      <td className="py-3.5 pr-4 font-medium text-slate-900">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate max-w-[320px]">{doc.title}</span>
                          {isActiveTarget && (
                            <span className="text-[10px] font-semibold text-[#1D63ED] bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded shrink-0">
                              Active
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700 uppercase">
                        {doc.doc_type || "PDF"}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700 text-right tabular-nums">
                        {isFailed ? "—" : chunksCount}
                      </td>
                      <td className="py-3.5 px-4">
                        {isFailed ? (
                          <span className="inline-block bg-rose-50 text-rose-700 text-[11px] font-semibold px-2 py-0.5 rounded">
                            Failed
                          </span>
                        ) : !isDocEnabled ? (
                          <span className="inline-block bg-slate-100 text-slate-600 text-[11px] font-semibold px-2 py-0.5 rounded">
                            Inactive
                          </span>
                        ) : (
                          <span className="inline-block bg-emerald-50 text-emerald-700 text-[11px] font-semibold px-2 py-0.5 rounded">
                            Indexed
                          </span>
                        )}
                      </td>
                      <td
                        className="py-3.5 pl-4 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                          <button
                            type="button"
                            onClick={() => setInspectedDocId(inspectedDocId === doc.id ? null : doc.id)}
                            className="hover:text-[#1D63ED] transition-colors"
                          >
                            {inspectedDocId === doc.id ? "Hide" : "View"}
                          </button>
                          <span className="text-slate-300">·</span>
                          <button
                            type="button"
                            onClick={() => handleToggleDocStatus(doc)}
                            className="hover:text-slate-900 transition-colors"
                          >
                            {isDocEnabled ? "Deactivate" : "Activate"}
                          </button>
                          {onNavigateToGraph && (
                            <>
                              <span className="text-slate-300">·</span>
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectDocument?.(doc.id);
                                  onNavigateToGraph();
                                }}
                                className="text-[#1D63ED] hover:underline"
                              >
                                Graph
                              </button>
                            </>
                          )}
                          {onNavigateToAnalyst && (
                            <>
                              <span className="text-slate-300">·</span>
                              <button
                                type="button"
                                onClick={() => {
                                  localStorage.setItem("active_target_document_id", String(doc.id));
                                  onSelectDocument?.(doc.id);
                                  onNavigateToAnalyst();
                                }}
                                className="text-[#1D63ED] hover:underline"
                              >
                                Investigate
                              </button>
                            </>
                          )}
                          {doc.is_uploaded && (
                            <>
                              <span className="text-slate-300">·</span>
                              <button
                                type="button"
                                onClick={() => handleDeleteDoc(doc)}
                                className="text-rose-600 hover:underline"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-500">
                    No documents indexed yet. Click &ldquo;Upload document&rdquo; to ingest a PDF, CSV, or XLSX file.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Retrieval Test Bar Matching Fig A.6 */}
        <form
          onSubmit={handleRunRetrievalTest}
          className="border border-slate-200 rounded-lg px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2.5 bg-slate-50/40"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-xs font-medium text-slate-500 whitespace-nowrap shrink-0">
              Retrieval test:
            </span>
            <input
              type="text"
              value={retrievalQuery}
              onChange={(e) => setRetrievalQuery(e.target.value)}
              placeholder={`Test chunk retrieval on "${activeDocTitle}" (e.g. delivery delay, reorder point)...`}
              className="flex-1 bg-transparent text-xs text-slate-900 placeholder-slate-400 focus:outline-none min-w-0"
            />
          </div>
          <button
            type="submit"
            disabled={isTestingRetrieval || !retrievalQuery.trim()}
            className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold text-xs px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {isTestingRetrieval ? "Searching..." : "Test Retrieval"}
          </button>
        </form>

        {retrievalError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
            {retrievalError}
          </div>
        )}

        {retrievalResults && (
          <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-900">
                Top {retrievalResults.length} Provenance Chunks in Doc #{activeDocumentId}
              </span>
              <button
                type="button"
                onClick={() => setRetrievalResults(null)}
                className="text-slate-500 hover:text-slate-800 text-[11px]"
              >
                Clear
              </button>
            </div>
            {retrievalResults.map((chunk, idx) => (
              <div key={idx} className="bg-white border border-slate-200 rounded-lg p-3 text-xs space-y-1">
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-[#1D63ED] font-semibold">
                    Page {chunk.page_number} · {chunk.section_title}
                  </span>
                  <span className="text-slate-500 tabular-nums">
                    Score {(chunk.score * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-slate-700 leading-relaxed font-mono text-[11px]">{chunk.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Expandable Vector Chunks Inspector when clicking "View" on any Document */}
      {inspectedDoc && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Indexed Chunks · {inspectedDoc.title} (Doc #{inspectedDoc.id})
              </h3>
              <p className="text-[11px] font-mono text-slate-500 mt-0.5 tabular-nums">
                {inspectedDoc.pages_count || 1} page(s) · {inspectedDoc.sections_count || 1} section(s) · 1024-dim BGE-M3
              </p>
            </div>
            <button
              type="button"
              onClick={() => setInspectedDocId(null)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 px-2.5 py-1 border border-slate-200 rounded-md"
            >
              Close Inspector
            </button>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {(inspectedDoc.chunks || []).map((chunk: any, idx: number) => (
              <div
                key={idx}
                className="bg-slate-50 p-3 rounded-lg border border-slate-200 font-mono text-[11px] text-slate-700"
              >
                <span className="text-[#1D63ED] font-semibold mr-2">
                  [Page {chunk.page_number || 1} · {chunk.section_title || `Chunk ${chunk.chunk_index}`}]:
                </span>
                {chunk.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 mb-4">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Upload className="w-4.5 h-4.5 text-[#1D63ED]" />
                <span>Ingest Company Document or Dataset</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-1.5 mb-4 p-1 bg-slate-100 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setModalTab("file")}
                className={`flex-1 py-1.5 rounded-md font-semibold flex items-center justify-center gap-2 transition-all ${
                  modalTab === "file" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <FileUp className="w-3.5 h-3.5" />
                <span>Upload PDF / Device File</span>
              </button>
              <button
                type="button"
                onClick={() => setModalTab("text")}
                className={`flex-1 py-1.5 rounded-md font-semibold flex items-center justify-center gap-2 transition-all ${
                  modalTab === "text" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Paste Text / Templates</span>
              </button>
            </div>

            {modalTab === "file" && (
              <div className="space-y-4">
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".pdf,.csv,.xlsx,.txt,.docx"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                    isDragging
                      ? "border-[#1D63ED] bg-blue-50"
                      : "border-slate-300 hover:border-[#1D63ED] bg-slate-50/70 hover:bg-slate-50"
                  }`}
                >
                  <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-200 text-[#1D63ED] flex items-center justify-center mx-auto mb-3">
                    <FileUp className="w-5 h-5" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Click to browse or drag & drop PDF here
                  </h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Supports PDF, CSV, Excel (XLSX), or TXT reports
                  </p>
                  <span className="inline-block mt-3 bg-blue-50 text-[#1D63ED] border border-blue-200 text-xs font-semibold px-3 py-1 rounded-lg">
                    Select Document
                  </span>
                </div>

                {isExtractingPdf && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2 text-xs text-[#1D63ED]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Extracting pages and text via backend PDF parser...</span>
                  </div>
                )}

                {pdfExtractStatus && !isExtractingPdf && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{pdfExtractStatus}</span>
                  </div>
                )}

                {pdfExtractError && !isExtractingPdf && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-xs text-rose-800">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Extraction Warning</p>
                      <p className="mt-0.5 leading-relaxed">{pdfExtractError}</p>
                    </div>
                  </div>
                )}

                {selectedFile && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 text-[#1D63ED] flex items-center justify-center font-mono font-bold text-xs shrink-0">
                        {uploadType}
                      </div>
                      <div className="overflow-hidden">
                        <p className="text-xs font-bold text-slate-900 truncate">{selectedFile.name}</p>
                        <p className="text-[11px] text-slate-500 font-mono">
                          Size: {fileSizeFormatted} · Ready to Index
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                        setUploadName("");
                        setUploadContent("");
                        setPdfExtractStatus("");
                      }}
                      className="text-slate-400 hover:text-rose-600 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {uploadContent && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-mono text-slate-600 font-semibold">
                        Extracted Content Preview
                      </label>
                      <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                        {uploadContent.length} chars
                      </span>
                    </div>
                    <textarea
                      value={uploadContent}
                      onChange={(e) => setUploadContent(e.target.value)}
                      rows={5}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 font-mono leading-relaxed focus:outline-none focus:bg-white focus:border-[#1D63ED]"
                    />
                  </div>
                )}
              </div>
            )}

            {modalTab === "text" && (
              <div className="space-y-4 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-600 block mb-2">
                    Quick Template Pre-fills for {companyName}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handlePreFillSample("supply_chain")}
                      className="text-xs font-medium px-2.5 py-1 rounded-md bg-white border border-slate-200 text-[#1D63ED] hover:bg-blue-50"
                    >
                      Supply Chain Audit Template
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePreFillSample("financial")}
                      className="text-xs font-medium px-2.5 py-1 rounded-md bg-white border border-slate-200 text-emerald-700 hover:bg-emerald-50"
                    >
                      Regional Sales CSV Template
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">File Name</label>
                    <input
                      type="text"
                      value={uploadName}
                      onChange={(e) => setUploadName(e.target.value)}
                      placeholder="e.g. Q3_Supply_Chain_Audit.pdf"
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 font-mono text-xs focus:outline-none focus:bg-white focus:border-[#1D63ED]"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Format</label>
                    <select
                      value={uploadType}
                      onChange={(e) => setUploadType(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 font-mono text-xs focus:outline-none focus:bg-white focus:border-[#1D63ED]"
                    >
                      <option value="PDF">PDF Report</option>
                      <option value="CSV">CSV Dataset</option>
                      <option value="XLSX">Excel Spreadsheet</option>
                      <option value="DOCX">Word Document</option>
                      <option value="TXT">Plain Text</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Document Content</label>
                  <textarea
                    value={uploadContent}
                    onChange={(e) => setUploadContent(e.target.value)}
                    rows={5}
                    placeholder="Paste document text or CSV rows here..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:bg-white focus:border-[#1D63ED] font-mono text-xs leading-relaxed"
                  />
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2.5 pt-3.5 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setShowUploadModal(false);
                  setSelectedFile(null);
                  setPdfExtractStatus("");
                }}
                className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold px-4 py-2 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUploadDocument}
                disabled={isUploading || isExtractingPdf || !uploadName || !uploadContent}
                className="bg-[#1D63ED] hover:bg-[#1554D1] text-white font-semibold text-xs px-5 py-2 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Chunking & Indexing...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5" />
                    <span>Ingest & Index Document</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
