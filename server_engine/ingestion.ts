import crypto from "crypto";
import * as XLSX from "xlsx";
import { extractAndClassifyEntities } from "./ner";
import {
  AtomicTableRow,
  DemoDocument,
  DocumentChunk,
  DocumentGraphEntity,
  DocumentGraphRelationship,
  DocumentSQLRecord,
  DocumentSection,
  EntityCategory,
  EntityExtractionSummary,
  PageExtractionRecord
} from "./types";

const VECTOR_DIM = 1024;
const indexCache = new Map<string, DemoDocument>();

export function computeContentHash(content: string): string {
  const hash = crypto.createHash("sha256").update(content || "", "utf8").digest("hex");
  return `v-${hash.slice(0, 16)}`;
}

/**
 * Strips instruction-like prompt-injection payloads inside uploaded documents
 * before chunking and vector embedding, preserving legitimate operational facts.
 */
export function sanitizePromptInjection(text: string): string {
  if (!text) return "";
  const injectionPatterns = [
    /^(?:ignore|disregard|forget|override|bypass|reset|do\s+not\s+follow)\s+[^\n]*(?:instructions?|rules?|prompts?|constraints?|above|checks?).*$/gim,
    /^(?:###\s*)?(?:system\s+prompt|system\s+override|system|instruction|new\s+instructions?|developer\s+mode|jailbreak)\s*[:\-].*$/gim,
    /^(?:act\s+as\s+a|pretend\s+to\s+be|you\s+are\s+now)\b.*$/gim,
    /<\|(?:im_start|im_end|system|assistant|user)\|>/gi,
    /\[\/?(?:INST|SYS|SYSTEM)\]/gi
  ];
  let sanitized = text;
  for (const pat of injectionPatterns) {
    sanitized = sanitized.replace(pat, "");
  }
  return sanitized.replace(/\n{3,}/g, "\n\n").trim();
}

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * Computes a deterministic 1024-dimensional BGE-M3 style dense embedding vector
 * combining word tokens, bigrams, and character trigrams, L2-normalized.
 */
export function computeDenseVector(text: string): number[] {
  const vec = new Float64Array(VECTOR_DIM);
  const clean = (text || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  const words = clean.split(/\s+/).filter((w) => /[a-z0-9]/.test(w) && w.length >= 2);

  const hashInto = (gram: string, weight: number) => {
    let h1 = 2166136261;
    let h2 = 16777619;
    for (let i = 0; i < gram.length; i++) {
      const c = gram.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 ^ (c * 31), 2166136261);
    }
    const idx1 = Math.abs(h1) % VECTOR_DIM;
    const idx2 = Math.abs(h2) % VECTOR_DIM;
    vec[idx1] += weight;
    vec[idx2] += weight * 0.5 * ((h1 & 1) === 0 ? 1 : -1);
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    hashInto(`w:${w}`, 2.0);
    if (i + 1 < words.length) {
      hashInto(`b:${w}_${words[i + 1]}`, 2.5);
    }
    if (w.length >= 3) {
      for (let j = 0; j <= w.length - 3; j++) {
        hashInto(`c:${w.slice(j, j + 3)}`, 0.7);
      }
    }
  }

  let norm = 0;
  for (let i = 0; i < VECTOR_DIM; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm) || 1;
  const result = new Array<number>(VECTOR_DIM);
  for (let i = 0; i < VECTOR_DIM; i++) {
    result[i] = parseFloat((vec[i] / norm).toFixed(5));
  }
  return result;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? Math.max(0, Math.min(1, dot / denom)) : 0;
}

/**
 * Reconstructs wrapped lines from pdf-parse page text without corrupting
 * list items, pipe-delimited tables, or section headings.
 */
export function normalizePdfPageText(raw: string): string {
  const cleaned = (raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\t+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "")
    .trim();

  const lines = cleaned.split("\n").map((l) => l.trimRight());
  const logicalLines: string[] = [];

  const isNewLogicalLineStart = (line: string): boolean => {
    const t = line.trim();
    if (!t) return true;
    if (/^(-|\*|•|\d+\.)\s+/.test(t)) return true;
    if (/^(Page\s+\d+|Section\s+\d+|SECTION\s+\d+|#{1,4}\s+)/i.test(t)) return true;
    if (/^[A-Z][A-Z0-9\s,&/()-]{4,}:?$/.test(t)) return true;
    if (/^(Date|Audit|Reporting|Incident|Meeting\s+Attendees|Discussion\s+Notes|Note|CONCLUSION|OVERALL|Region|Recommended|Owner)\b[^:]*:/i.test(t)) return true;
    if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}:\s*$/.test(t)) return true;
    if (/^\|?[^|\n]+(?:\|[^|\n]+){2,}/.test(t)) return true;
    if (/^(?:Region|(?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-\d+|(?:[A-Z]{2,6}-)+\d{2,6}|(?:RSK|REC)-\d+)\b/i.test(t)) return true;
    if (/^(?:SKU(?:\s+Code)?|Item\s+Code|Delivery\s+ID|Risk\s+ID|Rec\s+ID|Month\s+Revenue|Owner\s+Action\s+Item)\b/i.test(t)) return true;
    if (/^[-•*]?\s*[A-Za-z][A-Za-z\s-]{1,28}\s+(?:(?:INR|USD|EUR|GBP|[$€£₹])\s*[-+]?[\d,]+|[-+]?[\d,]+(?:\.\d+)?(?:\s+(?:INR|USD|EUR|GBP|[$€£₹])?\s*[-+]?[\d,]+(?:\.\d+)?){1,}|[-+]?[\d.]+%$)/i.test(t)) return true;
    if (/^[A-Za-z0-9&.,'\-\s]{2,45}\s+(?:\d+(?:\.\d+)?\s*%|0\.\d{2,4})(?:\s|$)/.test(t)) return true;
    if (/^(?:Vendor|Supplier|Carrier|Partner|Name)\b.*\b(?:On[-\s]?Time|OTD|Delivery|SLA|Rate|Performance)\b/i.test(t)) return true;
    return false;
  };

  const isFinancialOrTableRow = (line: string): boolean => {
    const t = line.trim();
    if (!t) return false;
    if (/%$/.test(t)) return true;
    if (/\bRegion\b.*\b(?:Revenue|Expenses?|Profit|Margin)\b/i.test(t)) return true;
    if (/\b(?:SKU|Item\s+Code)\b.*\b(?:Current\s+Stock|On\s+Hand|Reorder\s+(?:Point|Level|Threshold)|Status|Deficit|Shortage)\b/i.test(t)) return true;
    if (/\b(?:Vendor|Supplier|Carrier|Partner|Name)\b.*\b(?:On[-\s]?Time|OTD|Delivery|Rate|Performance|SLA)\b/i.test(t)) return true;
    if (/^(?:Delivery\s+ID|Risk\s+ID|Rec\s+ID|Owner\s+Action\s+Item|Month\s+Revenue)\b/i.test(t)) return true;
    if (/^(?:(?:[A-Z]{2,6}-)+\d{2,6}|(?:RSK|REC)-\d+)\b/i.test(t)) return true;
    if ((t.match(/\|/g) || []).length >= 1) return true;
    if (/\d+(?:\.\d+)?\s*%|\b0\.\d{2,4}\b/.test(t) && t.length < 130) return true;
    if (/\b(?:BELOW\s+REORDER\s+POINT|Above\s+Reorder\s+Point|Immediate\s+Reorder(?:\s+Required)?|Routine\s+Reconciliation|Routine\s+Monitoring|Healthy\s+buffer)\b$/i.test(t)) return true;
    if (/\b(?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-\d+\b/i.test(t) && (t.match(/\d+/g) || []).length >= 2) return true;
    if (/^[-•*]?\s*[A-Za-z][A-Za-z\s-]{1,28}\s+(?:(?:INR|USD|EUR|GBP|[$€£₹])\s*[-+]?[\d,]+|[-+]?[\d,]+(?:\.\d+)?\s+[-+]?[\d,]+)/i.test(t)) return true;
    return false;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      logicalLines.push("");
      continue;
    }
    const prev = logicalLines.length > 0 ? logicalLines[logicalLines.length - 1] : "";
    const prevEndsWithPipe = prev.trim().endsWith("|");
    const prevIsNumberedSectionHeading = /^\d+\.\s+[A-Z][^|]{3,90};?$/.test(prev.trim()) && !prev.includes("|") && /;$/.test(prev.trim());
    const prevIsListOrBullet = /^(-|\*|•|\d+\.)\s+/.test(prev.trim()) && !prevIsNumberedSectionHeading;
    // An action-item pipe row with 3 segments (2 pipes) is already complete
    const prevIsCompletePipeRow = (prev.match(/\|/g) || []).length >= 2 && /\b\d{4}\b/.test(prev);
    const prevIsTableLike = isFinancialOrTableRow(prev);

    if (
      prev &&
      prev.length > 0 &&
      !prevIsCompletePipeRow &&
      !prevIsTableLike &&
      !prevIsNumberedSectionHeading &&
      !isNewLogicalLineStart(trimmed) &&
      (prevEndsWithPipe || (prev.includes("|") && !/%$/.test(prev.trim())) || (prevIsListOrBullet && !prev.trim().endsWith(".")))
    ) {
      logicalLines[logicalLines.length - 1] = `${prev.trim()} ${trimmed}`;
    } else if (
      prev &&
      prev.length > 0 &&
      !prevIsCompletePipeRow &&
      !prevIsTableLike &&
      !isNewLogicalLineStart(trimmed) &&
      !/[:.!?%]$/.test(prev.trim()) &&
      prev.length > 55 &&
      !/^Page\s+\d+\s+of\s+\d+/i.test(prev)
    ) {
      // Wrapped prose line
      logicalLines[logicalLines.length - 1] = `${prev.trim()} ${trimmed}`;
    } else {
      logicalLines.push(trimmed);
    }
  }

  return logicalLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export interface PdfPageInput {
  page_num: number;
  text: string;
  raw_text?: string;
  extraction?: "text" | "ocr" | "unparsed";
  ocr_used?: boolean;
  parse_error?: string;
  tables?: string[][][];
}

export interface PdfExtractionOutput {
  success: boolean;
  filename: string;
  text: string;
  char_count: number;
  pages_count: number;
  pages: PdfPageInput[];
  unparsed_pages: number[];
  isScanned: boolean;
  ocrUsed: boolean;
  extractionStatus: "INDEXED" | "SCANNED_PDF_OCR_UNAVAILABLE" | "EXTRACTION_FAILED";
  error?: string;
}

export async function extractPdfBuffer(buffer: Buffer, filename: string): Promise<PdfExtractionOutput> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const info = await parser.getInfo().catch(() => ({ total: 1 }));
    const textResult = await parser.getText();
    const tableResult = await parser.getTable().catch(() => null);

    const tablePagesMap = new Map<number, string[][][]>();
    if (tableResult && Array.isArray((tableResult as any).pages)) {
      for (const tp of (tableResult as any).pages) {
        if (tp && typeof tp.num === "number" && Array.isArray(tp.tables) && tp.tables.length > 0) {
          tablePagesMap.set(tp.num, tp.tables);
        }
      }
    }

    const rawPages: PdfPageInput[] = (textResult.pages || []).map((p: any, idx: number) => {
      const pageNum = p.num || idx + 1;
      const verbatimRaw = (p.text || "").replace(/\r\n/g, "\n").replace(/\u00A0/g, " ").trim();
      const normText = normalizePdfPageText(p.text || "");
      const alphaCount = (normText.match(/[a-zA-Z0-9]/g) || []).length;
      const hasText = alphaCount >= 15;
      return {
        page_num: pageNum,
        text: normText,
        raw_text: verbatimRaw,
        extraction: hasText ? "text" : "unparsed",
        ocr_used: false,
        parse_error: hasText ? undefined : "No text layer detected on this page.",
        tables: tablePagesMap.get(pageNum)
      };
    });

    const pageCount = rawPages.length > 0 ? rawPages.length : (info?.total || 1);
    const nonEmptyPages = rawPages.filter((p) => (p.text.match(/[a-zA-Z0-9]/g) || []).length >= 15);
    let combinedText = rawPages.map((p) => p.text).filter(Boolean).join("\n\n").trim();
    if (!combinedText && textResult.text) {
      combinedText = normalizePdfPageText(textResult.text);
    }

    const alphaNumCount = (combinedText.match(/[a-zA-Z0-9]/g) || []).length;
    const isFullyScanned = alphaNumCount < 25 || nonEmptyPages.length === 0;
    const unparsedPageNums = rawPages.filter((p) => p.extraction === "unparsed").map((p) => p.page_num);

    if (!isFullyScanned && unparsedPageNums.length === 0) {
      return {
        success: true,
        filename,
        text: combinedText,
        char_count: combinedText.length,
        pages_count: pageCount,
        pages: rawPages.length > 0 ? rawPages : [{ page_num: 1, text: combinedText, raw_text: textResult.text || combinedText, extraction: "text", ocr_used: false }],
        unparsed_pages: [],
        isScanned: false,
        ocrUsed: false,
        extractionStatus: "INDEXED"
      };
    }

    // Attempt Gemini multimodal OCR for fully scanned PDF OR mixed PDF with image-only pages if API key is present
    if (process.env.GEMINI_API_KEY) {
      try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
          httpOptions: { timeout: 8000, headers: { "User-Agent": "aistudio-build" } }
        });
        let ocrTimer: ReturnType<typeof setTimeout> | undefined;
        const targetPrompt = isFullyScanned
          ? "Extract ALL visible text, headings, tables, numbers, and page markers verbatim from this PDF document. Preserve page breaks with '--- PAGE N ---'. If a page is blank, output '--- PAGE N ---\nNO_TEXT'."
          : `Extract ALL visible text and tables verbatim specifically for scanned/image-only page(s) [${unparsedPageNums.join(", ")}] of this PDF. Output each page prefixed with '--- PAGE N ---'. If a page is genuinely blank, write NO_TEXT.`;
        const ocrResp = await Promise.race([
          ai.models.generateContent({
            model: "gemini-4-hydrogen",
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: "application/pdf",
                    data: buffer.toString("base64")
                  }
                },
                { text: targetPrompt }
              ]
            }
          }),
          new Promise<never>((_, reject) => {
            ocrTimer = setTimeout(() => reject(new Error("OCR request timed out")), 8000);
          })
        ]).finally(() => {
          if (ocrTimer) clearTimeout(ocrTimer);
        });

        const ocrRaw = (ocrResp.text || "").trim();
        if (ocrRaw && ocrRaw !== "NO_TEXT") {
          const pageBlocks = new Map<number, string>();
          const markerRegex = /---\s*PAGE\s+(\d+)\s*---/gi;
          const matches = Array.from(ocrRaw.matchAll(markerRegex));
          if (matches.length > 0) {
            for (let i = 0; i < matches.length; i++) {
              const pNum = Number(matches[i][1]);
              const start = (matches[i].index ?? 0) + matches[i][0].length;
              const end = i + 1 < matches.length ? (matches[i + 1].index ?? ocrRaw.length) : ocrRaw.length;
              const seg = ocrRaw.slice(start, end).trim();
              if (seg && !/^NO_TEXT$/i.test(seg)) {
                pageBlocks.set(pNum, seg);
              }
            }
          } else if (isFullyScanned && (ocrRaw.match(/[a-zA-Z0-9]/g) || []).length >= 25) {
            pageBlocks.set(1, ocrRaw);
          }

          if (isFullyScanned && pageBlocks.size > 0) {
            const pagesOut: PdfPageInput[] = [];
            const stillUnparsed: number[] = [];
            for (let p = 1; p <= Math.max(pageCount, pageBlocks.size); p++) {
              const block = pageBlocks.get(p);
              if (block && (block.match(/[a-zA-Z0-9]/g) || []).length >= 15) {
                pagesOut.push({
                  page_num: p,
                  text: normalizePdfPageText(block),
                  raw_text: block,
                  extraction: "ocr",
                  ocr_used: true
                });
              } else {
                stillUnparsed.push(p);
                pagesOut.push({
                  page_num: p,
                  text: "",
                  raw_text: "",
                  extraction: "unparsed",
                  ocr_used: false,
                  parse_error: "No readable text found after OCR."
                });
              }
            }
            const joinedOcr = pagesOut.map((p) => p.text).filter(Boolean).join("\n\n");
            return {
              success: true,
              filename,
              text: joinedOcr,
              char_count: joinedOcr.length,
              pages_count: pagesOut.length,
              pages: pagesOut,
              unparsed_pages: stillUnparsed,
              isScanned: true,
              ocrUsed: true,
              extractionStatus: "INDEXED"
            };
          } else if (!isFullyScanned && pageBlocks.size > 0) {
            // Patch only the empty pages with OCR output
            const patchedPages = rawPages.map((p) => {
              if (p.extraction !== "unparsed") return p;
              const block = pageBlocks.get(p.page_num);
              if (block && (block.match(/[a-zA-Z0-9]/g) || []).length >= 15) {
                return {
                  ...p,
                  text: normalizePdfPageText(block),
                  raw_text: block,
                  extraction: "ocr" as const,
                  ocr_used: true,
                  parse_error: undefined
                };
              }
              return p;
            });
            const joined = patchedPages.map((p) => p.text).filter(Boolean).join("\n\n");
            const remainingUnparsed = patchedPages.filter((p) => p.extraction === "unparsed").map((p) => p.page_num);
            return {
              success: true,
              filename,
              text: joined,
              char_count: joined.length,
              pages_count: pageCount,
              pages: patchedPages,
              unparsed_pages: remainingUnparsed,
              isScanned: remainingUnparsed.length > 0,
              ocrUsed: patchedPages.some((p) => p.ocr_used),
              extractionStatus: "INDEXED"
            };
          }
        }
      } catch (ocrErr: any) {
        if (isFullyScanned) {
          return {
            success: false,
            filename,
            text: "",
            char_count: 0,
            pages_count: pageCount,
            pages: [],
            unparsed_pages: rawPages.map((p) => p.page_num),
            isScanned: true,
            ocrUsed: false,
            extractionStatus: "SCANNED_PDF_OCR_UNAVAILABLE",
            error: `Scanned or image-only PDF detected in "${filename}". Multimodal OCR failed: ${ocrErr?.message || "OCR error"}. Please upload a text-searchable PDF or CSV.`
          };
        }
      }
    }

    // Partial mixed PDF (some text pages + some unparsed image/blank pages): still index readable pages & record unparsed_pages!
    if (!isFullyScanned) {
      return {
        success: true,
        filename,
        text: combinedText,
        char_count: combinedText.length,
        pages_count: pageCount,
        pages: rawPages,
        unparsed_pages: unparsedPageNums,
        isScanned: unparsedPageNums.length > 0,
        ocrUsed: false,
        extractionStatus: "INDEXED"
      };
    }

    return {
      success: false,
      filename,
      text: "",
      char_count: 0,
      pages_count: pageCount,
      pages: [],
      unparsed_pages: Array.from({ length: pageCount }, (_, i) => i + 1),
      isScanned: true,
      ocrUsed: false,
      extractionStatus: "SCANNED_PDF_OCR_UNAVAILABLE",
      error: `Scanned or image-only PDF detected in "${filename}" (${pageCount} page(s), ${alphaNumCount} extractable characters). Local OCR (Tesseract/Poppler) is not available in this runtime. Please upload a text-based PDF, CSV, or paste extracted text.`
    };
  } catch (err: any) {
    return {
      success: false,
      filename,
      text: "",
      char_count: 0,
      pages_count: 0,
      pages: [],
      unparsed_pages: [],
      isScanned: false,
      ocrUsed: false,
      extractionStatus: "EXTRACTION_FAILED",
      error: `Failed to parse PDF "${filename}": ${err?.message || "Corrupted or invalid PDF"}`
    };
  }
}

export function extractExcelBuffer(buffer: Buffer, filename: string): PdfExtractionOutput {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const pages: PdfPageInput[] = [];
    let combinedBlocks: string[] = [];

    workbook.SheetNames.forEach((sheetName, idx) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false }) || [];
      const nonEmptyRows = rows.filter((r) => Array.isArray(r) && r.some((cell) => String(cell ?? "").trim() !== ""));
      if (nonEmptyRows.length === 0) {
        pages.push({
          page_num: idx + 1,
          text: "",
          raw_text: "",
          extraction: "unparsed",
          ocr_used: false,
          parse_error: `Worksheet "${sheetName}" is empty.`
        });
        return;
      }
      const pipeLines = nonEmptyRows.map((r) => r.map((c) => String(c ?? "").trim()).join(" | "));
      const sheetText = `SHEET ${idx + 1}: ${sheetName}\n${pipeLines.join("\n")}`;
      combinedBlocks.push(sheetText);
      pages.push({
        page_num: idx + 1,
        text: sheetText,
        raw_text: sheetText,
        extraction: "text",
        ocr_used: false,
        tables: [nonEmptyRows.map((r) => r.map((c) => String(c ?? "").trim()))]
      });
    });

    const combinedText = combinedBlocks.join("\n\n").trim();
    if (!combinedText) {
      return {
        success: false,
        filename,
        text: "",
        char_count: 0,
        pages_count: workbook.SheetNames.length,
        pages: [],
        unparsed_pages: workbook.SheetNames.map((_, i) => i + 1),
        isScanned: false,
        ocrUsed: false,
        extractionStatus: "EXTRACTION_FAILED",
        error: `Spreadsheet "${filename}" contains no readable rows.`
      };
    }

    return {
      success: true,
      filename,
      text: combinedText,
      char_count: combinedText.length,
      pages_count: pages.length,
      pages,
      unparsed_pages: pages.filter((p) => p.extraction === "unparsed").map((p) => p.page_num),
      isScanned: false,
      ocrUsed: false,
      extractionStatus: "INDEXED"
    };
  } catch (err: any) {
    return {
      success: false,
      filename,
      text: "",
      char_count: 0,
      pages_count: 0,
      pages: [],
      unparsed_pages: [],
      isScanned: false,
      ocrUsed: false,
      extractionStatus: "EXTRACTION_FAILED",
      error: `Failed to parse Excel spreadsheet "${filename}": ${err?.message || "Invalid spreadsheet"}`
    };
  }
}

/**
 * Extracts atomic table row records across ALL pages, carrying table headers forward
 * when a table continues across page boundaries (Rule 2).
 */
export function extractAtomicTablesFromPages(
  docId: number,
  pages: PageExtractionRecord[],
  structuredTablesByPage?: Map<number, string[][][]>
): AtomicTableRow[] {
  const rowsOut: AtomicTableRow[] = [];

  const isHeaderCandidate = (cells: string[]): boolean => {
    if (cells.length < 2) return false;
    const joined = cells.join(" ").toLowerCase();
    const hasHeaderKw =
      /\b(vendor|supplier|carrier|partner|name|provider|on[-\s]?time|otd|delivery|sla|rate|performance|variance|region|revenue|expenses?|opex|cogs|logistics|profit|margin|sku|stock|reorder|deficit|shortage|status|owner|action|deadline|due|item|description|month|period|sales|units|city|hub|rating|achievement|target|delay|actual|damage|risk|severity|likelihood|mitigation|priority|recommendation|timeline|impact|route|warehouse|category)\b/i.test(
        joined
      ) || /\b(?:risk|rec|delivery)\s*id\b/i.test(joined);
    // Avoid misclassifying data rows containing concrete percentages, ratios, money, or IDs as headers
    const hasDataPct = cells.some((c) => /^\s*[-+]?\d+(?:\.\d+)?\s*%\s*$/.test(c));
    const hasDataDecimal = cells.some((c) => /^\s*0\.\d{2,4}\s*$/.test(c));
    const hasDataMoney = cells.some((c) => /^\s*(?:INR|USD|EUR|GBP|[$€£₹])\s*[-+]?[\d,]+(?:\.\d+)?\s*$/i.test(c) || /^\s*[-+]?[\d,]{4,}(?:\.\d+)?\s*$/.test(c));
    const hasDataId = cells.some((c) => /^\s*(?:[A-Z]{2,6}-)+\d{2,6}\s*$|^\s*(?:SKU|RSK|REC)-\d+\s*$/i.test(c));
    return hasHeaderKw && !hasDataPct && !hasDataDecimal && !hasDataMoney && !hasDataId;
  };

  const looksLikeDataRow = (cells: string[]): boolean => {
    return cells.some(
      (c) =>
        /^\s*[-+]?\d+(?:\.\d+)?\s*%\s*$/.test(c) ||
        /^\s*0\.\d{2,4}\s*$/.test(c) ||
        /^\s*(?:INR|USD|EUR|GBP|[$€£₹])\s*[-+]?[\d,]+(?:\.\d+)?\s*$/i.test(c) ||
        /^\s*[-+]?[\d,]+(?:\.\d+)?\s*$/.test(c) ||
        /^\s*(?:[A-Z]{2,6}-)+\d{2,6}\s*$/i.test(c) ||
        /^\s*(?:SKU|RSK|REC|ITEM|PART|MAT)-\d+\s*$/i.test(c) ||
        /^\s*\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\s*$/.test(c)
    );
  };

  const splitRawLineToCells = (line: string, expectedCols?: number): string[] => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    if (trimmed.includes("|")) {
      return trimmed
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim())
        .filter((c, i, arr) => !(c === "" && (i === 0 || i === arr.length - 1)));
    }
    if (/\t|[ ]{2,}/.test(trimmed)) {
      return trimmed
        .split(/\t|[ ]{2,}/)
        .map((c) => c.trim())
        .filter(Boolean);
    }
    // Single-space table line recovery (common in pdf-parse text flattening):
    // e.g. "Acme Freight Express 92.0 % 95% On Track" or "Delta Carriers 0.87 Good"
    if (expectedCols && expectedCols >= 2) {
      const metricMatches = Array.from(
        trimmed.matchAll(/(?:(?:INR|USD|EUR|GBP|[$€£₹])\s*[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?\s*%|0\.\d{2,4}|Tier\s+\d+|High|Medium|Low|Active|Delayed|Good|Critical|BELOW REORDER POINT|Above Reorder Point|[-+]?\d[\d,]*(?:\.\d+)?(?:\s*days?)?)/gi)
      );
      if (metricMatches.length >= 1) {
        const firstIdx = metricMatches[0].index ?? -1;
        if (firstIdx > 1) {
          const leftLabel = trimmed.slice(0, firstIdx).trim();
          const restSlice = trimmed.slice(firstIdx).trim();
          const rightTokens = metricMatches.map((m) => m[0].trim());
          if (rightTokens.length >= 1 && expectedCols === 2) {
            return [leftLabel, rightTokens[0]];
          }
          if (rightTokens.length + 1 === expectedCols) {
            return [leftLabel, ...rightTokens];
          }
          if (restSlice && rightTokens.length > 0 && expectedCols >= 3) {
            const cells = [leftLabel, ...rightTokens];
            return cells.slice(0, expectedCols);
          }
        }
      }
    }
    return [trimmed];
  };

  let activeHeader: string[] | null = null;
  let activeTableId: string | null = null;
  let activeTableOriginPage = 0;
  let tableSeq = 0;

  const sortedPages = [...pages].sort((a, b) => a.page_num - b.page_num);

  for (const page of sortedPages) {
    if (page.extraction === "unparsed" || !page.raw_text.trim()) {
      continue;
    }

    const rowExtraction: "text" | "table" | "ocr" = page.extraction === "ocr" ? "ocr" : "table";

    // 1. Capture native pdf-parse / XLSX structured tables if present
    const pageStructTables = structuredTablesByPage?.get(page.page_num) || [];
    const structRowTextSignatures: string[] = [];

    for (const grid of pageStructTables) {
      if (!Array.isArray(grid) || grid.length === 0) continue;
      const cleanGrid = grid
        .map((r) => r.map((c) => String(c ?? "").replace(/\s+/g, " ").trim()))
        .filter((r) => r.some(Boolean));
      if (cleanGrid.length === 0) continue;

      for (const r of cleanGrid) {
        structRowTextSignatures.push(r.join(" ").replace(/\s+/g, " ").trim().toLowerCase());
      }

      const firstRow = cleanGrid[0];
      const isContinuationGrid =
        !isHeaderCandidate(firstRow) &&
        looksLikeDataRow(firstRow) &&
        activeHeader !== null &&
        activeHeader.length === firstRow.length;

      if (!isContinuationGrid && cleanGrid.length < 2) continue;

      let hdr = firstRow;
      let startRow = 1;
      if (isContinuationGrid && activeHeader) {
        hdr = activeHeader;
        startRow = 0;
      } else {
        tableSeq++;
        activeTableId = `doc-${docId}-t${tableSeq}`;
        activeTableOriginPage = page.page_num;
        activeHeader = hdr;
      }

      for (let rIdx = startRow; rIdx < cleanGrid.length; rIdx++) {
        const cells = cleanGrid[rIdx];
        if (cells.length === hdr.length && cells.every((c, i) => c.toLowerCase() === hdr[i].toLowerCase())) {
          continue; // skip repeated header
        }
        rowsOut.push({
          doc_id: docId,
          page: page.page_num,
          table_id: activeTableId || `doc-${docId}-t${++tableSeq}`,
          header: hdr,
          cells,
          raw_row_text: cells.join(" | "),
          extraction: rowExtraction,
          ...(startRow === 0 && page.page_num > activeTableOriginPage ? { continued_from_page: activeTableOriginPage } : {})
        });
      }
      if (isContinuationGrid) {
        activeTableOriginPage = page.page_num;
      }
    }

    // 2. Layout / delimiter line scan with cross-page header carry-forward
    // Skip lines already covered cleanly by structured bordered grids on the same page
    const sourceText = page.raw_text || page.text;
    const rawLines = sourceText.split("\n");
    let sawNonTableProseAfterTop = false;
    let linesAtPageTop = true;

    for (let li = 0; li < rawLines.length; li++) {
      const rawLine = rawLines[li];
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      if (/^(?:Page\s+\d+(?:\s+of\s+\d+)?|--\s*\d+\s+of\s+\d+\s*--|\(continued\)|continued(?:\s+from\s+page\s+\d+)?)$/i.test(trimmed)) {
        continue;
      }
      if (/FICTIONAL\s+(?:SAMPLE|TEST)\s+DATA/i.test(trimmed)) {
        activeHeader = null;
        activeTableId = null;
        continue;
      }
      // Separator rules like ---|---|---
      if (/^[-|+=\s]{3,}$/.test(trimmed)) continue;

      if (structRowTextSignatures.length > 0) {
        const normTrimmed = trimmed.replace(/\t+|\s+/g, " ").trim().toLowerCase();
        if (
          structRowTextSignatures.some(
            (sig) => sig === normTrimmed || (normTrimmed.length >= 12 && (sig.includes(normTrimmed) || normTrimmed.includes(sig)))
          )
        ) {
          linesAtPageTop = false;
          continue;
        }
      }

      const isContinuationHint = activeHeader !== null && (linesAtPageTop || !sawNonTableProseAfterTop) && page.page_num === activeTableOriginPage + 1;
      const cells = splitRawLineToCells(rawLine, activeHeader ? activeHeader.length : undefined);

      // Single-space header detection (e.g. "Vendor On-Time Delivery Target SLA")
      if (cells.length === 1 && !trimmed.includes(":") && !/[.!?]$/.test(trimmed)) {
        const hdrMatch = trimmed.match(
          /^(Vendor(?:\s+Name)?|Supplier(?:\s+Name)?|Carrier(?:\s+Name)?|Partner(?:\s+Name)?)\s+(On[-\s]?Time\s*(?:Delivery(?:\s*Rate)?|Rate|Performance|%)|OTD(?:\s*%)?|Delivery\s*(?:Performance|Rate))(?:\s+(Target\s*SLA|Status|Tier|Region|Notes?))?$/i
        );
        if (hdrMatch) {
          const parsedHeader = [hdrMatch[1].trim(), hdrMatch[2].trim(), ...(hdrMatch[3] ? [hdrMatch[3].trim()] : [])];
          tableSeq++;
          activeHeader = parsedHeader;
          activeTableId = `doc-${docId}-t${tableSeq}`;
          activeTableOriginPage = page.page_num;
          linesAtPageTop = false;
          sawNonTableProseAfterTop = false;
          continue;
        }
      }

      if (cells.length >= 2) {
        if (isHeaderCandidate(cells)) {
          const sameAsActive =
            activeHeader !== null &&
            activeHeader.length === cells.length &&
            activeHeader.every((h, idx) => h.toLowerCase() === cells[idx].toLowerCase());
          if (!sameAsActive) {
            tableSeq++;
            activeHeader = cells;
            activeTableId = `doc-${docId}-t${tableSeq}`;
            activeTableOriginPage = page.page_num;
          }
          linesAtPageTop = false;
          sawNonTableProseAfterTop = false;
          continue;
        }

        // Data row: match either current page header or carried-forward previous page header
        if (activeHeader && (page.page_num === activeTableOriginPage || isContinuationHint)) {
          const isContinued = page.page_num > activeTableOriginPage;
          rowsOut.push({
            doc_id: docId,
            page: page.page_num,
            table_id: activeTableId || `doc-${docId}-t${tableSeq}`,
            header: activeHeader,
            cells,
            raw_row_text: trimmed,
            extraction: rowExtraction,
            ...(isContinued ? { continued_from_page: activeTableOriginPage } : {})
          });
          if (isContinued) {
            activeTableOriginPage = page.page_num;
          }
          linesAtPageTop = false;
          continue;
        }
      } else {
        // Non-table line encountered: check if it's a section boundary or prose sentence
        if (
          /^(?:SECTION\s+\d+|Section\s+\d+|\d+\.\s+[A-Z]|EXECUTIVE|SUMMARY|APPENDIX|CONCLUSION)/i.test(trimmed) ||
          (trimmed.length > 45 && /[.!?]$/.test(trimmed))
        ) {
          activeHeader = null;
          activeTableId = null;
          sawNonTableProseAfterTop = true;
        }
        linesAtPageTop = false;
      }
    }
  }

  return rowsOut;
}

/**
 * Extracts logical sections while preserving exact headings across all pages.
 */
export function extractDocumentSections(
  pages: Array<{ page_num: number; text: string }>
): Array<{ section_number: number; section_title: string; page_number: number; raw_text: string }> {
  const sections: Array<{ section_number: number; section_title: string; page_number: number; raw_text: string }> = [];

  const normalizeRepeatingKey = (line: string): string =>
    line
      .replace(/Page\s+\d+(?:\s+of\s+\d+)?/gi, "")
      .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  // Identify repeating page headers/footers across pages (>= 50% of pages when multi-page)
  const linePageCounts = new Map<string, number>();
  if (pages.length >= 2) {
    for (const p of pages) {
      const seenOnPage = new Set<string>();
      for (const rawLine of p.text.split("\n")) {
        const t = rawLine.trim();
        if (!t) continue;
        const key = normalizeRepeatingKey(t);
        if (!key) continue;
        if (!seenOnPage.has(key)) {
          seenOnPage.add(key);
          linePageCounts.set(key, (linePageCounts.get(key) || 0) + 1);
        }
      }
    }
  }
  const repeatingThreshold = Math.max(2, Math.ceil(pages.length * 0.5));

  const isRepeatingHeaderOrFooter = (line: string): boolean => {
    const t = line.trim();
    if (!t) return true;
    if (/FICTIONAL\s+(?:SAMPLE|TEST)\s+DATA/i.test(t)) return true;
    if (/^(?:Page\s+\d+(?:\s+of\s+\d+)?|--\s*\d+\s+of\s+\d+\s*--)$/i.test(t)) return true;
    if (pages.length >= 2) {
      const key = normalizeRepeatingKey(t);
      if (key && (linePageCounts.get(key) || 0) >= repeatingThreshold) return true;
    }
    return false;
  };

  const isSectionHeading = (line: string): string | null => {
    const t = line.trim().replace(/P&L;/gi, "P&L");
    if (!t || t.length > 130) return null;
    if (isRepeatingHeaderOrFooter(t)) return null;
    if (/^(Date|Audit Period|Audit Scope|Audit As-Of Date|Reporting Currency|Currency|Incident|Meeting Attendees|Protocol|Primary Endpoint|Adverse Events|Trial Recommendation):/i.test(t)) return null;

    // Numbered section heading e.g. "SECTION 1: Executive Summary", "1. EXECUTIVE SUMMARY", "7. Supply Chain Risk Assessment Illustrative quarterly review | Q4 2026"
    const secMatch = t.match(/^(?:SECTION\s+\d+\s*[:.-]\s*|Section\s+\d+\s*[:.-]\s*|#{1,3}\s+|\d+\.\s+)(.+)$/);
    if (secMatch) {
      const rawCand = secMatch[1].trim();
      const subtitleSplit = rawCand.split(/\s+(?:Illustrative\s+quarterly|Meeting\s+date\s*:|Incident\s+review\s*\||Audit\s+period\s*\||Monthly\s+revenue,)/i)[0];
      const candidate = subtitleSplit.replace(/[;:]+$/, "").trim();
      // Distinguish top-level numbered section titles from sub-bullet items (action items/root causes)
      if (
        !candidate.includes("|") &&
        candidate.length >= 4 &&
        candidate.length <= 95 &&
        !/^(Cross-dock|Missing|Unclear|Systemic|Recurring|Elevated)/i.test(candidate)
      ) {
        const isExplicitSecPrefix = /^(?:SECTION|Section|#)/.test(t);
        const endsWithSentencePeriod = /\.\s*$/.test(rawCand) && rawCand === subtitleSplit;
        const words = candidate.split(/\s+/);
        const titleCasedOrCode =
          words.length <= 12 &&
          words.every(
            (w) =>
              /^[A-Z0-9&/(]/.test(w) ||
              /^(?:and|of|for|the|in|on|to|by|with|vs\.?|or|at|from|&|-|—|–)$/i.test(w)
          );
        const hasLowerColonBody = /:\s+[a-z]/.test(candidate);
        const hasFiniteVerb = /\b(?:is|was|are|were|has|have|had|experienced|delayed|failed|reached|must|will)\b/i.test(
          candidate
        );

        if (
          isExplicitSecPrefix ||
          candidate === candidate.toUpperCase() ||
          (titleCasedOrCode && !endsWithSentencePeriod && !hasLowerColonBody && !hasFiniteVerb)
        ) {
          return candidate;
        }
      }
    }

    // All-caps major title line (not a label like "ACTION ITEMS:" when inside a page unless standalone section)
    if (
      /^[A-Z][A-Z0-9\s&/()-]{5,85}$/.test(t) &&
      !t.endsWith(":") &&
      !/^BELOW REORDER POINT/i.test(t) &&
      !/^EXECUTIVE ACTION ITEMS/i.test(t)
    ) {
      return t;
    }

    // Standard document title with colon/date suffix e.g. "FINANCIAL P&L STATEMENT (SEPTEMBER 2026)"
    if (/^[A-Z][A-Z0-9\s&/()-]{4,60}\s*\([^)]+\)$/.test(t)) {
      return t;
    }

    return null;
  };

  for (const page of pages) {
    const lines = page.text.split("\n").filter((l) => !isRepeatingHeaderOrFooter(l));
    let currentTitle = "";
    let currentLines: string[] = [];

    for (const line of lines) {
      const heading = isSectionHeading(line);
      if (heading) {
        if (currentTitle && currentLines.join("\n").trim().length > 0) {
          // Avoid duplicate consecutive identical heading on same page
          const existing = sections.find(
            (s) => s.page_number === page.page_num && s.section_title.toLowerCase() === currentTitle.toLowerCase()
          );
          if (!existing) {
            sections.push({
              section_number: sections.length + 1,
              section_title: currentTitle,
              page_number: page.page_num,
              raw_text: currentLines.join("\n").trim()
            });
          } else {
            existing.raw_text = `${existing.raw_text}\n${currentLines.join("\n").trim()}`.trim();
          }
          currentLines = [];
        }
        currentTitle = heading;
        currentLines.push(line);
      } else {
        currentLines.push(line);
      }
    }

    const bodyText = currentLines.join("\n").trim();
    if (bodyText.length > 0) {
      const resolvedTitle =
        currentTitle ||
        lines.find((l) => l.trim().length > 3 && !isRepeatingHeaderOrFooter(l))?.trim().slice(0, 80) ||
        `Page ${page.page_num}`;

      const existing = sections.find(
        (s) => s.page_number === page.page_num && s.section_title.toLowerCase() === resolvedTitle.toLowerCase()
      );
      if (existing) {
        if (!existing.raw_text.includes(bodyText)) {
          existing.raw_text = `${existing.raw_text}\n${bodyText}`.trim();
        }
      } else {
        sections.push({
          section_number: sections.length + 1,
          section_title: resolvedTitle,
          page_number: page.page_num,
          raw_text: bodyText
        });
      }
    }
  }

  return sections;
}

export interface ExtractedSupplierMention {
  name: string;
  category: EntityCategory;
  confidence: number;
  supporting_sentence: string;
  chunk_id: string;
  on_time_rate?: string;
  target_sla?: string;
  transit_variance?: string;
  issues?: string;
  raw_line: string;
  page_number: number;
  occurrences?: Array<{ page_number: number; chunk_id: string; section_title: string; source_text: string }>;
}

/**
 * Runs full 11-class NER + Entity Classification across the document,
 * returning confirmed suppliers/vendors/carriers, unverified entities, and excluded entities.
 */
export function extractEntitySummaryFromText(
  text: string,
  chunks?: DocumentChunk[],
  atomicTableRows?: AtomicTableRow[],
  docId?: number
): EntityExtractionSummary {
  return extractAndClassifyEntities(text, chunks, atomicTableRows, docId);
}

/**
 * Extracts ONLY contextually verified Supplier, Vendor, or Carrier entities
 * with traceable supporting source text and page number, deduplicated across pages.
 */
export function extractSuppliersFromText(
  text: string,
  chunks?: DocumentChunk[],
  atomicTableRows?: AtomicTableRow[],
  docId?: number
): ExtractedSupplierMention[] {
  const summary = extractAndClassifyEntities(text, chunks, atomicTableRows, docId);
  return summary.confirmed_suppliers.map((e) => ({
    name: e.name,
    category: e.category,
    confidence: e.confidence,
    supporting_sentence: e.supporting_sentence,
    chunk_id: e.chunk_id,
    on_time_rate: e.on_time_rate,
    target_sla: e.target_sla,
    transit_variance: e.transit_variance,
    issues: e.issues,
    raw_line: e.supporting_sentence,
    page_number: e.page_number,
    occurrences: e.occurrences
  }));
}

export interface ExtractedRegionalFinancialRow {
  document_id: number;
  region: string;
  currency: string;
  gross_revenue: number | null;
  operating_expenses: number | null;
  operating_profit: number | null;
  margin_pct: string | null;
  reporting_period: string | null;
  source_page: number;
  source_chunk_id: string;
  is_derived_profit?: boolean;
}

const MONTH_PERIOD_REGEX =
  /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}|Q[1-4]\s+20\d{2})\b/i;

function formatReportingPeriod(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 2) return raw.trim();
  const [first, year] = parts;
  if (/^Q[1-4]$/i.test(first)) return `${first.toUpperCase()} ${year}`;
  return `${first.charAt(0).toUpperCase()}${first.slice(1).toLowerCase()} ${year}`;
}

function detectCurrencyToken(text: string): string | null {
  if (!text) return null;
  const explicitHeader = text.match(/Reporting\s+Currency\s*[:\-]\s*(INR|USD|EUR|GBP|[$€£₹])/i);
  if (explicitHeader) {
    const tok = explicitHeader[1].toUpperCase();
    if (tok === "$") return "USD";
    if (tok === "€") return "EUR";
    if (tok === "£") return "GBP";
    if (tok === "₹") return "INR";
    return tok;
  }
  const code = text.match(/\b(INR|USD|EUR|GBP)\b/i);
  if (code) return code[1].toUpperCase();
  if (text.includes("₹")) return "INR";
  if (text.includes("$")) return "USD";
  if (text.includes("€")) return "EUR";
  if (text.includes("£")) return "GBP";
  return null;
}

function parseMoneyToken(raw: string): { value: number | null; currency: string | null } {
  const s = (raw || "").trim();
  if (!s || /%\s*$/.test(s)) return { value: null, currency: null };
  const m = s.match(/^([-+]?)\s*(?:(INR|USD|EUR|GBP|[$€£₹])\s*)?([-+]?[\d,]+(?:\.\d+)?)$/i);
  if (!m) return { value: null, currency: null };
  const sign = m[1] === "-" ? -1 : 1;
  const num = Number(m[3].replace(/,/g, ""));
  if (!Number.isFinite(num)) return { value: null, currency: null };
  const finalVal = m[3].startsWith("-") ? num : sign * num;
  return {
    value: finalVal,
    currency: m[2] ? detectCurrencyToken(m[2]) : null
  };
}

function isMonthOrPeriodLabel(label: string): boolean {
  const t = (label || "").trim();
  return (
    /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+20\d{2})?$/i.test(
      t
    ) ||
    /^20\d{2}[-/](?:0?[1-9]|1[0-2])$/.test(t) ||
    /^Q[1-4](?:\s+20\d{2})?$/i.test(t)
  );
}

function parseValidMarginPct(raw: string, allowBareNumber: boolean = false): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const pctM = s.match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (pctM) {
    const num = Number(pctM[1]);
    if (!Number.isFinite(num) || num > 100 || num < -100) return null;
    return `${pctM[1]}%`;
  }
  if (allowBareNumber) {
    const bareM = s.match(/^(-?\d+(?:\.\d+)?)$/);
    if (bareM) {
      const num = Number(bareM[1]);
      if (!Number.isFinite(num) || num > 100 || num < -100) return null;
      return `${bareM[1]}%`;
    }
  }
  return null;
}

function isNonRegionFinancialLabel(label: string): boolean {
  const t = (label || "").trim();
  if (!t || t.length < 2 || t.length > 40) return true;
  if (/^\d+(?:[.,]\d+)?%?$/.test(t)) return true;
  if (isMonthOrPeriodLabel(t)) return true;
  if (/^(?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-\d+|^(?:[A-Z]{2,6}-)+\d{2,6}$/i.test(t)) return true;
  if (/\b(?:units|incidents|days|hours|target|sla|on-time|telemetry|damage)\b/i.test(t)) return true;
  if (/\b(?:total|subtotal|grand\s+total|all\s+regions?|combined|overall|average|avg|summary|conclusion)\b/i.test(t)) return true;
  return /^(?:region|regions?|revenue|gross\s+revenue|operating\s+expenses?|expenses?|opex|cogs|logistics|operating\s+profit|net\s+profit|profit|profit\s+margin|margin|reporting\s+currency|reporting\s+period|period|month|date|audit|notes?|page\s+\d+|owner|action|deadline|status)$/i.test(
    t
  );
}

/**
 * Dynamically extracts all regional P&L financial records from PDF atomic tables, chunks, and text:
 * 0. Structured bordered/layout atomic tables (`atomic_table_rows`) mapped strictly by header name
 * 1. Key-value inline/multi-line segments (Region: North | Gross Revenue: ... | Revenue: ...)
 * 2. Pipe-delimited Markdown/PDF tables with header column mapping
 * 3. Unstructured whitespace/tab-separated columnar PDF tables
 * 4. Multi-line wrapped PDF table cells under stacked column headers
 * 5. Shorthand regional operating profit lines ("North: INR 413,000") inside financial sections
 */
export function extractRegionalFinancialRecordsFromDoc(doc: {
  id: number;
  content: string;
  chunks?: DocumentChunk[];
  atomic_table_rows?: AtomicTableRow[];
}): ExtractedRegionalFinancialRow[] {
  const results: ExtractedRegionalFinancialRow[] = [];
  const docCurrencyDefault = detectCurrencyToken(doc.content) || "INR";

  // Build ordered page blocks preserving original chunk provenance
  const pageGroups = new Map<number, { page_number: number; chunks: DocumentChunk[] }>();
  for (const ch of doc.chunks || []) {
    if (ch.document_id !== undefined && ch.document_id !== doc.id) continue;
    const grp = pageGroups.get(ch.page_number) || { page_number: ch.page_number, chunks: [] };
    grp.chunks.push(ch);
    pageGroups.set(ch.page_number, grp);
  }

  const findChunkForPageNeedle = (pageNum: number, needle: string): string => {
    const pg = pageGroups.get(pageNum);
    if (!pg || pg.chunks.length === 0) return `doc-${doc.id}-p${pageNum}-c0`;
    const nLow = needle.toLowerCase();
    const hit = pg.chunks.find((c) => (c.content || "").toLowerCase().includes(nLow));
    return hit?.chunk_id || pg.chunks[0]?.chunk_id || `doc-${doc.id}-p${pageNum}-c0`;
  };

  const scanUnits: Array<{
    page_number: number;
    text: string;
    periodHint: string | null;
    currencyHint: string;
    findChunkIdForNeedle: (needle: string) => string;
  }> = [];

  const extractHeaderPeriodHint = (text: string, secTitles: string): string | null => {
    const headingLine = text
      .split("\n")
      .find((l) => /\b(?:period|p&l|financial|statement|quarterly|september|august|july|q[1-4])\b/i.test(l) && MONTH_PERIOD_REGEX.test(l));
    const m =
      (headingLine ? headingLine.match(MONTH_PERIOD_REGEX) : null) ||
      secTitles.match(MONTH_PERIOD_REGEX) ||
      text.match(MONTH_PERIOD_REGEX);
    return m ? formatReportingPeriod(m[1]) : null;
  };

  if (pageGroups.size > 0) {
    const sortedPages = Array.from(pageGroups.values()).sort((a, b) => a.page_number - b.page_number);
    for (const pg of sortedPages) {
      const joinedText = pg.chunks.map((c) => c.content).join("\n");
      const secTitles = pg.chunks.map((c) => c.section_title).join(" ");
      const pgCurrency = detectCurrencyToken(joinedText) || docCurrencyDefault;
      scanUnits.push({
        page_number: pg.page_number,
        text: joinedText,
        periodHint: extractHeaderPeriodHint(joinedText, secTitles),
        currencyHint: pgCurrency,
        findChunkIdForNeedle: (needle: string) => findChunkForPageNeedle(pg.page_number, needle)
      });
    }
  } else {
    const rawText = (doc.content || "").replace(/\r\n/g, "\n");
    scanUnits.push({
      page_number: 1,
      text: rawText,
      periodHint: extractHeaderPeriodHint(rawText, ""),
      currencyHint: docCurrencyDefault,
      findChunkIdForNeedle: () => `doc-${doc.id}-p1-c0`
    });
  }

  const upsertRow = (row: ExtractedRegionalFinancialRow) => {
    if (isNonRegionFinancialLabel(row.region)) return;
    if (
      row.gross_revenue === null &&
      row.operating_expenses === null &&
      row.operating_profit === null
    ) {
      return;
    }

    let finalProfit = row.operating_profit;
    let isDerived = Boolean(row.is_derived_profit);
    if (finalProfit === null && row.gross_revenue !== null && row.operating_expenses !== null) {
      finalProfit = Number((row.gross_revenue - row.operating_expenses).toFixed(2));
      isDerived = true;
    }

    let finalMargin = row.margin_pct ? parseValidMarginPct(row.margin_pct, true) : null;
    if (!finalMargin && finalProfit !== null && row.gross_revenue !== null && row.gross_revenue !== 0) {
      const pctVal = (finalProfit / row.gross_revenue) * 100;
      if (Number.isFinite(pctVal) && pctVal >= -100 && pctVal <= 100) {
        finalMargin = `${pctVal.toFixed(1)}%`;
      }
    }

    const enriched: ExtractedRegionalFinancialRow = {
      ...row,
      operating_profit: finalProfit,
      margin_pct: finalMargin,
      is_derived_profit: isDerived
    };

    const key = `${(enriched.reporting_period || "").toLowerCase()}::${enriched.region.toLowerCase()}`;
    const existingIdx = results.findIndex(
      (r) => `${(r.reporting_period || "").toLowerCase()}::${r.region.toLowerCase()}` === key
    );
    const richness = (r: ExtractedRegionalFinancialRow) =>
      [r.gross_revenue, r.operating_expenses, r.operating_profit, r.margin_pct].filter((v) => v !== null).length;

    if (existingIdx === -1) {
      results.push(enriched);
    } else if (richness(enriched) > richness(results[existingIdx])) {
      results[existingIdx] = enriched;
    }
  };

  const extractSignedMoneyLabel = (seg: string, labelPattern: string): number | null => {
    const re = new RegExp(
      `${labelPattern}\\s*[:\\-]\\s*([-+]?)\\s*(?:INR|USD|EUR|GBP|[$€£₹])?\\s*([-+]?[\\d,]+(?:\\.\\d+)?)`,
      "i"
    );
    const m = seg.match(re);
    if (!m) return null;
    const prefixSign = m[1] === "-" ? -1 : 1;
    const rawNum = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(rawNum)) return null;
    return m[2].startsWith("-") ? rawNum : prefixSign * rawNum;
  };

  type ColRole = "region" | "revenue" | "cogs" | "logistics" | "expenses" | "profit" | "margin";
  const mapColumnHeader = (hdr: string): ColRole | null => {
    const h = hdr.trim().toLowerCase();
    if (/\b(?:city|hub|units\s+sold|sales|achievement|rating)\b/.test(h)) return null;
    if (/\b(?:region|territory)\b/.test(h)) return "region";
    if (/\b(?:gross\s+|total\s+|net\s+)?revenue\b/.test(h)) return "revenue";
    if (/\bcogs\b|\bcost\s+of\s+goods\b/.test(h)) return "cogs";
    if (/\blogistics(?:\s+cost)?\b/.test(h)) return "logistics";
    if (/\b(?:operating\s+expenses?|opex)\b|^expenses?$/i.test(h)) return "expenses";
    if (/\b(?:operating\s+|net\s+)?profit\b|\bebit\b/.test(h) && !/margin/i.test(h)) return "profit";
    if (/\b(?:profit\s+)?margin\b/.test(h)) return "margin";
    return null;
  };

  const detectHeaderRolesFromLine = (line: string): ColRole[] | null => {
    const t = line.trim();
    if (!/\bregion\b/i.test(t) || /\b(?:month|city|hub|sales|achievement)\b/i.test(t)) return null;
    if (t.includes("|")) {
      const cells = t.split("|").map((c) => c.trim()).filter(Boolean);
      const roles = cells.map(mapColumnHeader).filter((r): r is ColRole => r !== null);
      const hasFinMetric = roles.includes("profit") || roles.includes("revenue") || roles.includes("expenses");
      return roles.length >= 2 && roles.includes("region") && hasFinMetric ? roles : null;
    }
    const rx =
      /\b(region|(?:gross\s+|total\s+|net\s+)?revenue|cogs|logistics(?:\s+cost)?|(?:operating\s+)?expenses?|opex|(?:[a-z]+\s+)?operating\s+profit|net\s+profit|profit\s+margin|margin)\b/gi;
    const roles: ColRole[] = [];
    let hm: RegExpExecArray | null;
    while ((hm = rx.exec(t)) !== null) {
      const role = mapColumnHeader(hm[1]);
      if (role && !roles.includes(role)) roles.push(role);
    }
    const hasFinMetric = roles.includes("profit") || roles.includes("revenue") || roles.includes("expenses");
    return roles.length >= 2 && roles.includes("region") && hasFinMetric ? roles : null;
  };

  // Strategy 0: Structured Atomic Table Rows mapped strictly by header name (never position)
  const pagesWithStructuredPnl = new Set<number>();
  if (doc.atomic_table_rows && doc.atomic_table_rows.length > 0) {
    const groupedTables = new Map<string, AtomicTableRow[]>();
    for (const r of doc.atomic_table_rows) {
      if (r.doc_id !== doc.id) continue;
      const list = groupedTables.get(r.table_id) || [];
      list.push(r);
      groupedTables.set(r.table_id, list);
    }

    for (const rows of groupedTables.values()) {
      const hdrs = rows[0]?.header || [];
      if (hdrs.length < 2) continue;
      const col0Low = hdrs[0].trim().toLowerCase();
      if (/\b(?:month|period|city|hub)\b/.test(col0Low)) continue;
      if (hdrs.some((h) => /\b(?:sales|units\s+sold|achievement|rating)\b/i.test(h))) continue;

      const mappedRoles = hdrs.map(mapColumnHeader);
      const regIdx = mappedRoles.indexOf("region");
      const revIdx = mappedRoles.indexOf("revenue");
      const expIdx = mappedRoles.indexOf("expenses");
      const profIdx = mappedRoles.indexOf("profit");
      const margIdx = mappedRoles.indexOf("margin");

      if (regIdx === -1 || (profIdx === -1 && !(revIdx >= 0 && (expIdx >= 0 || margIdx >= 0)))) {
        continue;
      }

      // Confirm rows aren't mostly months/periods
      const nonEmptyCol0 = rows.map((r) => (r.cells[regIdx] || "").trim()).filter(Boolean);
      if (nonEmptyCol0.length > 0 && nonEmptyCol0.every((v) => isMonthOrPeriodLabel(v))) {
        continue;
      }

      for (const row of rows) {
        const regName = (row.cells[regIdx] || "").replace(/^[-•*\d.)]+\s*/, "").replace(/^Region\s*[:\-]\s*/i, "").trim();
        if (isNonRegionFinancialLabel(regName)) continue;

        const revParsed = revIdx >= 0 ? parseMoneyToken(row.cells[revIdx] || "") : { value: null, currency: null };
        const expParsed = expIdx >= 0 ? parseMoneyToken(row.cells[expIdx] || "") : { value: null, currency: null };
        const profParsed = profIdx >= 0 ? parseMoneyToken(row.cells[profIdx] || "") : { value: null, currency: null };
        const marginVal = margIdx >= 0 ? parseValidMarginPct(row.cells[margIdx] || "", true) : null;

        const unit = scanUnits.find((u) => u.page_number === row.page);
        const rowCur =
          revParsed.currency ||
          profParsed.currency ||
          expParsed.currency ||
          unit?.currencyHint ||
          docCurrencyDefault;

        upsertRow({
          document_id: doc.id,
          region: regName,
          currency: rowCur,
          gross_revenue: revParsed.value,
          operating_expenses: expParsed.value,
          operating_profit: profParsed.value,
          margin_pct: marginVal,
          reporting_period: unit?.periodHint || scanUnits[0]?.periodHint || null,
          source_page: row.page,
          source_chunk_id: findChunkForPageNeedle(row.page, regName)
        });
        pagesWithStructuredPnl.add(row.page);
      }
    }
  }

  for (const unit of scanUnits) {
    if (pagesWithStructuredPnl.has(unit.page_number)) continue;

    const pageText = unit.text;
    const isFinancialContext =
      /\b(financial|p&l|profit\s+and\s+loss|operating\s+profit|gross\s+revenue|operating\s+expenses|profit\s+margin)\b/i.test(
        pageText
      );
    if (!isFinancialContext) continue;

    let currentPeriod = unit.periodHint;
    let currentCurrency = unit.currencyHint;

    // Track period and currency section by section as we scan lines
    const lines = pageText.split("\n").map((l) => l.trim()).filter(Boolean);

    // Strategy 1: Key-Value inline or multi-line segments starting with Region: <Name>
    const pnlSegments = pageText.split(/(?=(?:^|\n|\s)Region\s*[:\-]\s*[A-Za-z])/i);
    for (const seg of pnlSegments) {
      const t = seg.trim();
      const regMatch = t.match(
        /^Region\s*[:\-]\s*([A-Za-z0-9\s()-]{2,40}?)(?=\s*(?:\||\r?\n|(?:(?:Gross\s+|Total\s+|Net\s+)?Revenue|Operating\s+Expenses|Expenses|Operating\s+Profit|Profit\s+Margin|Margin)\s*[:\-])|$)/i
      );
      if (regMatch && /(?:Revenue|Operating\s+Profit|Operating\s+Expenses|Margin)/i.test(t)) {
        const regName = regMatch[1].trim();
        const rev = extractSignedMoneyLabel(t, "(?:Gross\\s+|Total\\s+|Net\\s+)?Revenue");
        const exp = extractSignedMoneyLabel(t, "(?:Operating\\s+)?Expenses?");
        const prof = extractSignedMoneyLabel(t, "(?:[A-Za-z]+\\s+)?(?:Operating|Net)\\s+Profit");
        const margM = t.match(/(?:Profit\s+)?Margin\s*[:\-]\s*(-?[\d.]+%)/i);
        const validMarg = margM ? parseValidMarginPct(margM[1]) : null;
        const segCur = detectCurrencyToken(t) || currentCurrency;
        const segPeriodM = t.match(MONTH_PERIOD_REGEX);

        upsertRow({
          document_id: doc.id,
          region: regName,
          currency: segCur,
          gross_revenue: rev,
          operating_expenses: exp,
          operating_profit: prof,
          margin_pct: validMarg,
          reporting_period: segPeriodM ? formatReportingPeriod(segPeriodM[1]) : currentPeriod,
          source_page: unit.page_number,
          source_chunk_id: unit.findChunkIdForNeedle(regName)
        });
      }
    }

    // Strategy 2, 3 & 4: Pipe-delimited, Unstructured Columnar & Multi-Line Wrapped Tables
    let activeRoles: ColRole[] | null = null;
    let inNonPnlTableBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const linePeriodM = line.match(MONTH_PERIOD_REGEX);
      if (linePeriodM && /^(?:SECTION|FINANCIAL|P&L|STATEMENT|REPORT|AUDIT|PERIOD|Q[1-4])/i.test(line)) {
        currentPeriod = formatReportingPeriod(linePeriodM[1]);
      }
      const lineCur = detectCurrencyToken(line);
      if (/Reporting\s+Currency/i.test(line) && lineCur) {
        currentCurrency = lineCur;
      }

      // Skip Monthly Totals, Regional Sales, Delivery Turnaround, Risk Register, and Inventory sub-blocks inside Strategy 2-4
      if (
        /^(?:Monthly\s+Totals?|Month\s*\||Month\s+Revenue|\d+\.\s*Regional\s+Sales|\d+\.\s*Delivery\s+Turnaround|Regional\s+Sales\b|Delivery\s+Turnaround\b)/i.test(line) ||
        /\b(?:City\s*\|\s*Units\s+Sold|Units\s+Sold|Target\s+Achievement|Customer\s+Rating|Delivery\s+ID|Dispatch\s+Date|SLA\s+Days)\b/i.test(line)
      ) {
        activeRoles = null;
        inNonPnlTableBlock = true;
        continue;
      }

      if (/^(?:\d+\.\s*)?(?:Financial\s+P&L|Profit\s+and\s+Loss|Regional\s+Financial)/i.test(line)) {
        inNonPnlTableBlock = false;
      }

      // Check inline table header
      const inlineRoles = detectHeaderRolesFromLine(line);
      if (inlineRoles) {
        activeRoles = inlineRoles;
        inNonPnlTableBlock = false;
        continue;
      }

      if (inNonPnlTableBlock) continue;

      // Check stacked multi-line table header
      if (/^Region$/i.test(line)) {
        const stackedRoles: ColRole[] = ["region"];
        let look = i + 1;
        while (look < lines.length && look <= i + 7) {
          const r = mapColumnHeader(lines[look]);
          if (r && !stackedRoles.includes(r)) {
            stackedRoles.push(r);
            look++;
          } else {
            break;
          }
        }
        if (stackedRoles.length >= 2) {
          activeRoles = stackedRoles;
          i = look - 1;
          continue;
        }
      }

      // Strategy 2: Pipe-delimited row without "Region:" label
      if (line.includes("|") && !/^[-|\s:]+$/.test(line)) {
        const cells = line
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
        if (cells.length >= 2 && !/\b(?:Region|Month)\b/i.test(cells[0])) {
          const regName = cells[0].replace(/^[-•*\d.)]+\s*/, "").replace(/^Region\s*[:\-]\s*/i, "").trim();
          if (!isNonRegionFinancialLabel(regName) && !/(?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-\d+/i.test(line)) {
            if (activeRoles && cells.length >= activeRoles.length) {
              let rev: number | null = null;
              let exp: number | null = null;
              let prof: number | null = null;
              let margin: string | null = null;
              let rowCur = currentCurrency;
              activeRoles.forEach((role, idx) => {
                if (idx === 0) return;
                const cell = cells[idx] || "";
                if (role === "margin") {
                  margin = parseValidMarginPct(cell, true);
                } else if (role === "cogs" || role === "logistics") {
                  // Tracked separately so COGS/Logistics never overwrite operating_expenses
                } else {
                  const parsed = parseMoneyToken(cell);
                  if (parsed.currency) rowCur = parsed.currency;
                  if (role === "revenue") rev = parsed.value;
                  else if (role === "expenses") exp = parsed.value;
                  else if (role === "profit") prof = parsed.value;
                }
              });
              upsertRow({
                document_id: doc.id,
                region: regName,
                currency: rowCur,
                gross_revenue: rev,
                operating_expenses: exp,
                operating_profit: prof,
                margin_pct: margin,
                reporting_period: currentPeriod,
                source_page: unit.page_number,
                source_chunk_id: unit.findChunkIdForNeedle(regName)
              });
              continue;
            } else if (cells.length === 5 && !cells.some((c) => c.includes(":"))) {
              // Unheadered canonical 5-col pipe row: Region | Revenue | Expenses | Profit | Margin
              const p1 = parseMoneyToken(cells[1]);
              const p2 = parseMoneyToken(cells[2]);
              const p3 = parseMoneyToken(cells[3]);
              const validM = parseValidMarginPct(cells[4] || "");
              if (p1.value !== null && p2.value !== null && p3.value !== null) {
                upsertRow({
                  document_id: doc.id,
                  region: regName,
                  currency: p1.currency || p3.currency || currentCurrency,
                  gross_revenue: p1.value,
                  operating_expenses: p2.value,
                  operating_profit: p3.value,
                  margin_pct: validM,
                  reporting_period: currentPeriod,
                  source_page: unit.page_number,
                  source_chunk_id: unit.findChunkIdForNeedle(regName)
                });
                continue;
              }
            }
          }
        }
      }

      // Strategy 3: Unstructured space/tab-separated columnar row (supports up to 8 numeric tokens)
      if (!line.includes("|") && !line.includes(":")) {
        const colMatch = line.match(
          /^[-•*]?\s*([A-Za-z][A-Za-z\s()-]{1,28}?)\s+((?:(?:[-+]?\s*(?:INR|USD|EUR|GBP|[$€£₹])?\s*[-+]?[\d,]+(?:\.\d+)?|-?[\d.]+%)\s*){2,8})$/i
        );
        if (colMatch) {
          const regName = colMatch[1].trim();
          const metricsBlob = colMatch[2].trim();
          if (!isNonRegionFinancialLabel(regName) && !/^(?:on|for|in|at|by|to|of|page|section|q[1-4])\b/i.test(regName)) {
            const hasExplicitCur = /\b(?:INR|USD|EUR|GBP)\b|[$€£₹]/i.test(metricsBlob);
            if (activeRoles || (hasExplicitCur && /%/.test(metricsBlob))) {
              const tokenMatches = metricsBlob.match(
                /[-+]?\s*(?:(?:INR|USD|EUR|GBP|[$€£₹])\s*[-+]?[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?%?)/gi
              ) || [];
              const rolesToUse: ColRole[] = activeRoles || ["region", "revenue", "expenses", "profit", "margin"];
              let rev: number | null = null;
              let exp: number | null = null;
              let prof: number | null = null;
              let margin: string | null = null;
              let rowCur = detectCurrencyToken(metricsBlob) || currentCurrency;

              const valueRoles = rolesToUse.filter((r) => r !== "region");
              if (tokenMatches.length >= 2) {
                if (tokenMatches.length === valueRoles.length) {
                  valueRoles.forEach((role, idx) => {
                    const tok = tokenMatches[idx].trim();
                    if (role === "margin") {
                      margin = parseValidMarginPct(tok, true);
                    } else if (role === "cogs" || role === "logistics") {
                      // Mapped explicitly away from operating_expenses
                    } else {
                      const parsed = parseMoneyToken(tok);
                      if (parsed.currency) rowCur = parsed.currency;
                      if (role === "revenue") rev = parsed.value;
                      else if (role === "expenses") exp = parsed.value;
                      else if (role === "profit") prof = parsed.value;
                    }
                  });
                } else if (activeRoles) {
                  // Strict header alignment only when roles match length or separated clearly
                  const pctTok = tokenMatches.find((t) => /%\s*$/.test(t));
                  if (pctTok) margin = parseValidMarginPct(pctTok);
                  const moneyVals = tokenMatches
                    .filter((t) => !/%\s*$/.test(t))
                    .map((t) => parseMoneyToken(t))
                    .filter((p) => p.value !== null);
                  const moneyRoles = valueRoles.filter((r) => r !== "margin");
                  if (moneyVals.length === moneyRoles.length) {
                    moneyRoles.forEach((role, idx) => {
                      if (role === "revenue") rev = moneyVals[idx].value;
                      else if (role === "expenses") exp = moneyVals[idx].value;
                      else if (role === "profit") prof = moneyVals[idx].value;
                    });
                  }
                } else {
                  const pctTok = tokenMatches.find((t) => /%\s*$/.test(t));
                  if (pctTok) margin = parseValidMarginPct(pctTok);
                  const moneyVals = tokenMatches
                    .filter((t) => !/%\s*$/.test(t))
                    .map((t) => parseMoneyToken(t))
                    .filter((p) => p.value !== null);
                  if (moneyVals.length === 3) {
                    rev = moneyVals[0].value;
                    exp = moneyVals[1].value;
                    prof = moneyVals[2].value;
                  } else if (moneyVals.length === 2) {
                    rev = moneyVals[0].value;
                    prof = moneyVals[1].value;
                  }
                }
                upsertRow({
                  document_id: doc.id,
                  region: regName,
                  currency: rowCur,
                  gross_revenue: rev,
                  operating_expenses: exp,
                  operating_profit: prof,
                  margin_pct: margin,
                  reporting_period: currentPeriod,
                  source_page: unit.page_number,
                  source_chunk_id: unit.findChunkIdForNeedle(regName)
                });
                continue;
              }
            }
          }
        }
      }

      // Strategy 4: Multi-line wrapped PDF cells when activeRoles header was seen
      if (
        activeRoles &&
        activeRoles.length >= 3 &&
        /^[A-Za-z][A-Za-z\s-]{1,25}$/.test(line) &&
        !isNonRegionFinancialLabel(line) &&
        i + 2 < lines.length
      ) {
        const expectedCells = activeRoles.length - 1;
        const candidateCells = lines.slice(i + 1, i + 1 + expectedCells);
        const allValidCells =
          candidateCells.length === expectedCells &&
          candidateCells.every((c) => /^[-+]?(?:INR|USD|EUR|GBP|[$€£₹])?\s*[-+]?[\d,]+(?:\.\d+)?%?$/i.test(c.trim()));
        if (allValidCells) {
          let rev: number | null = null;
          let exp: number | null = null;
          let prof: number | null = null;
          let margin: string | null = null;
          let rowCur = currentCurrency;
          const valueRoles = activeRoles.slice(1);
          valueRoles.forEach((role, idx) => {
            const cell = candidateCells[idx].trim();
            if (role === "margin") {
              margin = parseValidMarginPct(cell, true);
            } else if (role === "cogs" || role === "logistics") {
              // Ignored for opex/profit
            } else {
              const parsed = parseMoneyToken(cell);
              if (parsed.currency) rowCur = parsed.currency;
              if (role === "revenue") rev = parsed.value;
              else if (role === "expenses") exp = parsed.value;
              else if (role === "profit") prof = parsed.value;
            }
          });
          upsertRow({
            document_id: doc.id,
            region: line.trim(),
            currency: rowCur,
            gross_revenue: rev,
            operating_expenses: exp,
            operating_profit: prof,
            margin_pct: margin,
            reporting_period: currentPeriod,
            source_page: unit.page_number,
            source_chunk_id: unit.findChunkIdForNeedle(line.trim())
          });
          i += expectedCells;
          continue;
        }
      }
    }

    // Strategy 5: Regional shorthand lines like "North: INR 413,000" ONLY if no richer P&L rows extracted on this page yet
    if (
      results.filter((r) => r.source_page === unit.page_number).length === 0 &&
      /\boperating\s+profit\b/i.test(pageText)
    ) {
      for (const line of lines) {
        const shMatch = line.match(
          /^(?:[-•*]\s*)?(?:Region\s*[:\-]?\s*)?([A-Za-z][A-Za-z\s-]{1,25})\s*:\s*((?:INR|USD|EUR|GBP|[$€£₹])\s*[-+]?[\d,]+(?:\.\d+)?)$/i
        );
        if (shMatch) {
          const regName = shMatch[1].trim();
          const parsed = parseMoneyToken(shMatch[2]);
          if (!isNonRegionFinancialLabel(regName) && parsed.value !== null) {
            upsertRow({
              document_id: doc.id,
              region: regName,
              currency: parsed.currency || currentCurrency,
              gross_revenue: null,
              operating_expenses: null,
              operating_profit: parsed.value,
              margin_pct: null,
              reporting_period: currentPeriod,
              source_page: unit.page_number,
              source_chunk_id: unit.findChunkIdForNeedle(regName)
            });
          }
        }
      }
    }
  }

  return results;
}

export interface ExtractedInventoryRecord {
  document_id: number;
  sku: string;
  item_name: string;
  item_description: string;
  current_stock: number;
  reorder_point: number;
  deficit: number;
  status: "BELOW REORDER POINT" | "Above Reorder Point";
  source_page: number;
  source_chunk_id: string;
}

function isNonSkuInventoryLabel(label: string): boolean {
  const t = (label || "").trim();
  if (!t || t.length < 2 || t.length > 60) return true;
  if (/^\d+(?:[.,]\d+)?%?$/.test(t)) return true;
  if (/\b(?:total|subtotal|grand\s+total|summary|average|avg|conclusion|overall|notes?|page\s+\d+)\b/i.test(t)) {
    return true;
  }
  return /^(?:sku|sku\s+code|item\s+code|item\s+description|description|item|current\s+stock|on\s+hand|stock\s+level|reorder\s+(?:point|level|threshold)|rop|deficit|shortage|variance|status|action)$/i.test(
    t
  );
}

function parseInventoryQtyToken(raw: string): number | null {
  const s = (raw || "").trim();
  if (!s || /%/.test(s)) return null;
  if (/^(?:INR|USD|EUR|GBP|[$€£₹])/i.test(s)) return null;
  const m = s.match(/^(-?[\d,]+(?:\.\d+)?)\s*(?:units?|pcs?|pieces?|ea|items?)?$/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseExplicitStockAndReorder(block: string): {
  stock: number | null;
  reorderPoint: number | null;
} {
  const s = (block || "").trim();
  // Require an explicit Reorder keyword so physical stock variance / shrinkage rows are never confused with reorder checks
  const stockMatch = s.match(
    /(?:Current\s+Stock|Stock\s+(?:Level|On\s+Hand)|On[\s\-]Hand(?:\s+Stock)?|Available\s+Stock)\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*(?:units?|pcs?)?/i
  );
  const ropMatch = s.match(
    /(?:Reorder\s+(?:Point|Threshold|Level)|Min(?:imum)?\s+Reorder\s+Level|Safety\s+Reorder\s+Point)\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*(?:units?|pcs?)?/i
  );
  const stock = stockMatch ? Number(stockMatch[1].replace(/,/g, "")) : null;
  const rop = ropMatch ? Number(ropMatch[1].replace(/,/g, "")) : null;
  return {
    stock: stock !== null && Number.isFinite(stock) && stock >= 0 ? stock : null,
    reorderPoint: rop !== null && Number.isFinite(rop) && rop >= 0 ? rop : null
  };
}

const PREFIXED_SKU_PATTERN_STR =
  "(?:(?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-\\d+|(?:[A-Z]{2,6}-)+\\d{2,6})";
const PREFIXED_SKU_LINE_START_RX = new RegExp(`^(?:${PREFIXED_SKU_PATTERN_STR})\\b`, "i");
const PREFIXED_SKU_EXACT_RX = new RegExp(`\\b(${PREFIXED_SKU_PATTERN_STR})\\b`, "i");

function extractInlineSkuAndDescription(segment: string): {
  sku: string | null;
  description: string | null;
} {
  const clean = (segment || "").trim().replace(/^[-•*\d.)]+\s*/, "");
  // 1. Parenthesized description: SKU-001 (Precision Roller Bearings) or NS-SKU-101 (Servo Drive Controller)
  const parenM = clean.match(
    /\b((?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-\d+|(?:[A-Z]{2,6}-)+\d{2,6})\s*\(([^)]{2,80})\)/i
  );
  if (parenM) {
    return {
      sku: parenM[1].toUpperCase(),
      description: parenM[2].trim()
    };
  }
  // 2. Unparenthesized inline description before stock/reorder fields: "NS-SKU-101 Servo Drive: Current Stock..."
  const inlineM = clean.match(
    /\b((?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-\d+|(?:[A-Z]{2,6}-)+\d{2,6})\b\s*[:\-]?\s*([A-Za-z][A-Za-z0-9\s,&/()\-]{1,75}?)(?=\s*(?::|\||,|—|-\s*(?:Current|Stock|Reorder|On)|(?:Current\s+Stock|Stock\s+Level|Reorder\s+(?:Point|Threshold|Level)|On[\s\-]Hand)))/i
  );
  if (inlineM) {
    const candidateDesc = inlineM[2].trim().replace(/[:\-,\s]+$/, "");
    if (
      candidateDesc.length >= 2 &&
      !/^(?:Current\s+Stock|Stock\s+Level|Reorder\s+(?:Point|Threshold|Level)|On[\s\-]Hand|Status|Deficit|Shortage)$/i.test(candidateDesc)
    ) {
      return {
        sku: inlineM[1].toUpperCase(),
        description: candidateDesc
      };
    }
  }
  const bareSku = clean.match(PREFIXED_SKU_EXACT_RX);
  return {
    sku: bareSku ? bareSku[1].toUpperCase() : null,
    description: null
  };
}

/**
 * Dynamically extracts all validated inventory reorder records across PDF atomic tables, pages, and chunks:
 * 0. Native / structured atomic tables (`atomic_table_rows`) having SKU + Current Stock + Reorder Point columns
 * 1. Inline & multi-line wrapped key-value SKU blocks
 * 2. Pipe-delimited Markdown / PDF inventory tables
 * 3. Unstructured whitespace/tab columnar tables (with wrapped cell support)
 * 4. Stacked vertical column PDF tables
 * 5. Key-value multi-line record blocks (SKU: ... \n Item Description: ...)
 * Rejects physical stock variance / shrinkage / delivery tables that have no Reorder Point column.
 */
export function extractInventoryRecordsFromDoc(doc: {
  id: number;
  content: string;
  chunks?: DocumentChunk[];
  atomic_table_rows?: AtomicTableRow[];
}): ExtractedInventoryRecord[] {
  const results: ExtractedInventoryRecord[] = [];
  const bySku = new Map<string, ExtractedInventoryRecord>();

  const pageGroups = new Map<number, { page_number: number; chunks: DocumentChunk[] }>();
  for (const ch of doc.chunks || []) {
    if (ch.document_id !== undefined && ch.document_id !== doc.id) continue;
    const grp = pageGroups.get(ch.page_number) || { page_number: ch.page_number, chunks: [] };
    grp.chunks.push(ch);
    pageGroups.set(ch.page_number, grp);
  }

  const findChunkForPageNeedle = (pageNum: number, needle: string): string => {
    const pg = pageGroups.get(pageNum);
    if (!pg || pg.chunks.length === 0) return `doc-${doc.id}-p${pageNum}-c0`;
    const low = needle.toLowerCase();
    const hit = pg.chunks.find((c) => (c.content || "").toLowerCase().includes(low));
    return hit?.chunk_id || pg.chunks[0]?.chunk_id || `doc-${doc.id}-p${pageNum}-c0`;
  };

  const scanUnits: Array<{
    page_number: number;
    text: string;
    findChunkIdForNeedle: (needle: string) => string;
  }> = [];

  if (pageGroups.size > 0) {
    const sortedPages = Array.from(pageGroups.values()).sort((a, b) => a.page_number - b.page_number);
    for (const pg of sortedPages) {
      const joined = pg.chunks.map((c) => c.content).join("\n");
      scanUnits.push({
        page_number: pg.page_number,
        text: joined,
        findChunkIdForNeedle: (needle: string) => findChunkForPageNeedle(pg.page_number, needle)
      });
    }
  } else {
    scanUnits.push({
      page_number: 1,
      text: (doc.content || "").replace(/\r\n/g, "\n"),
      findChunkIdForNeedle: () => `doc-${doc.id}-p1-c0`
    });
  }

  const upsertInvRow = (paramsIn: {
    sku: string;
    description: string | null | undefined;
    currentStock: number;
    reorderPoint: number;
    page_number: number;
    chunk_id: string;
  }) => {
    const skuClean = (paramsIn.sku || "").trim().toUpperCase();
    if (!skuClean || isNonSkuInventoryLabel(skuClean)) return;
    if (!Number.isFinite(paramsIn.currentStock) || paramsIn.currentStock < 0) return;
    if (!Number.isFinite(paramsIn.reorderPoint) || paramsIn.reorderPoint < 0) return;

    const rawDesc = (paramsIn.description || "").trim().replace(/\s+/g, " ");
    const hasDistinctDesc =
      rawDesc.length >= 2 &&
      !/^(?:undefined|null|nan|n\/a|none)$/i.test(rawDesc) &&
      rawDesc.toUpperCase() !== skuClean;
    const finalDesc = hasDistinctDesc ? rawDesc : skuClean;

    const isBelow = paramsIn.currentStock < paramsIn.reorderPoint;
    const deficit = isBelow ? Number((paramsIn.reorderPoint - paramsIn.currentStock).toFixed(2)) : 0;
    const status: "BELOW REORDER POINT" | "Above Reorder Point" = isBelow ? "BELOW REORDER POINT" : "Above Reorder Point";

    const candidate: ExtractedInventoryRecord = {
      document_id: doc.id,
      sku: skuClean,
      item_name: finalDesc,
      item_description: finalDesc,
      current_stock: paramsIn.currentStock,
      reorder_point: paramsIn.reorderPoint,
      deficit,
      status,
      source_page: paramsIn.page_number,
      source_chunk_id: paramsIn.chunk_id
    };

    const existing = bySku.get(skuClean);
    if (!existing) {
      bySku.set(skuClean, candidate);
      results.push(candidate);
    } else {
      const existingHasDesc = existing.item_description.toUpperCase() !== existing.sku;
      if (!existingHasDesc && hasDistinctDesc) {
        const idx = results.indexOf(existing);
        bySku.set(skuClean, candidate);
        if (idx >= 0) results[idx] = candidate;
      }
    }
  };

  type InvColRole = "sku" | "description" | "current_stock" | "system_stock" | "reorder_point" | "deficit" | "variance" | "status" | "action";
  const mapInvHeader = (hdr: string): InvColRole | null => {
    const h = hdr.trim().toLowerCase();
    if (/\b(?:sku(?:\s+code|\s+id)?|item\s+code|part\s+no\.?|material\s+id)\b/.test(h)) return "sku";
    if (/\b(?:item\s+description|description|item\s+name|product(?:\s+name)?|material(?:\s+name)?|item)\b/.test(h)) return "description";
    if (/\b(?:physical\s+(?:quantity|qty|stock)|current\s+stock|stock\s+on\s+hand|on[\s\-]hand|stock\s+level|available\s+stock|qty\s+on\s+hand|current\s+qty)\b/.test(h)) return "current_stock";
    if (/\bsystem\s+(?:quantity|qty|stock)\b/.test(h)) return "system_stock";
    if (/\b(?:reorder\s+(?:point|level|threshold)|min(?:imum)?\s+stock|safety\s+stock|rop)\b/.test(h)) return "reorder_point";
    if (/\b(?:deficit|shortage|shortfall|replenishment(?:\s+(?:needed|required|qty))?)\b/.test(h)) return "deficit";
    if (/\b(?:variance|physical\s+(?:diff|difference|variance)|cycle\s+count\s+var(?:iance)?|shrinkage)\b/.test(h)) return "variance";
    if (/\b(?:status|review\s+status|reorder\s+status|alert)\b/.test(h)) return "status";
    if (/\b(?:action|notes?|recommended\s+action)\b/.test(h)) return "action";
    return null;
  };

  const detectInvHeaderRoles = (line: string): InvColRole[] | null => {
    const t = line.trim();
    if (t.includes("|")) {
      const cells = t.split("|").map((c) => c.trim()).filter(Boolean);
      const roles = cells.map(mapInvHeader).filter((r): r is InvColRole => r !== null);
      if (roles.includes("sku") && (roles.includes("current_stock") || roles.includes("system_stock")) && roles.includes("reorder_point")) {
        return roles;
      }
      return null;
    }
    const rx =
      /\b(sku(?:\s+code|\s+id)?|item\s+code|item\s+description|item\s+name|product\s+name|description|physical\s+(?:quantity|qty|stock)|system\s+(?:quantity|qty|stock)|current\s+stock|stock\s+on\s+hand|on[\s\-]hand|stock\s+level|reorder\s+(?:point|level|threshold)|rop|deficit|shortage|shortfall|variance|review\s+status|status|action)\b/gi;
    const roles: InvColRole[] = [];
    let hm: RegExpExecArray | null;
    while ((hm = rx.exec(t)) !== null) {
      const role = mapInvHeader(hm[1]);
      if (role && !roles.includes(role)) roles.push(role);
    }
    return roles.includes("sku") && (roles.includes("current_stock") || roles.includes("system_stock")) && roles.includes("reorder_point") ? roles : null;
  };

  // Strategy 0: Structured Atomic Table Rows with SKU + Current/Physical Stock + Reorder Point headers
  const pagesWithStructuredInv = new Set<number>();
  if (doc.atomic_table_rows && doc.atomic_table_rows.length > 0) {
    const groupedTables = new Map<string, AtomicTableRow[]>();
    for (const r of doc.atomic_table_rows) {
      if (r.doc_id !== doc.id) continue;
      const list = groupedTables.get(r.table_id) || [];
      list.push(r);
      groupedTables.set(r.table_id, list);
    }

    for (const rows of groupedTables.values()) {
      const hdrs = rows[0]?.header || [];
      if (hdrs.length < 3) continue;
      const mapped = hdrs.map(mapInvHeader);
      const skuIdx = mapped.indexOf("sku");
      const descIdx = mapped.indexOf("description");
      const physIdx = mapped.indexOf("current_stock");
      const sysIdx = mapped.indexOf("system_stock");
      const stockIdx = physIdx >= 0 ? physIdx : sysIdx;
      const ropIdx = mapped.indexOf("reorder_point");

      if (skuIdx === -1 || stockIdx === -1 || ropIdx === -1) continue;

      for (const row of rows) {
        const rawSkuCell = (row.cells[skuIdx] || "").trim();
        const sm = rawSkuCell.match(PREFIXED_SKU_EXACT_RX);
        const skuVal = sm ? sm[1].toUpperCase() : rawSkuCell.toUpperCase();
        if (!skuVal || isNonSkuInventoryLabel(skuVal)) continue;

        const stockVal = parseInventoryQtyToken(row.cells[stockIdx] || "");
        const ropVal = parseInventoryQtyToken(row.cells[ropIdx] || "");
        if (stockVal === null || ropVal === null) continue;

        upsertInvRow({
          sku: skuVal,
          description: descIdx >= 0 ? (row.cells[descIdx] || "").trim() : null,
          currentStock: stockVal,
          reorderPoint: ropVal,
          page_number: row.page,
          chunk_id: findChunkForPageNeedle(row.page, skuVal)
        });
        pagesWithStructuredInv.add(row.page);
      }
    }
  }

  const parseColumnarLineWithRoles = (
    line: string,
    roles: InvColRole[]
  ): { sku: string; description: string | null; stock: number; rop: number } | null => {
    const trimmed = line.trim().replace(/^[-•*]\s*/, "");
    if (!trimmed) return null;

    // 1. Pipe-delimited
    if (trimmed.includes("|")) {
      const cells = trimmed.split("|").map((c) => c.trim());
      if (cells[0] === "") cells.shift();
      if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
      if (cells.length >= 3) {
        let skuVal = "";
        let descVal: string | null = null;
        let stockVal: number | null = null;
        let ropVal: number | null = null;

        roles.forEach((role, idx) => {
          const val = (cells[idx] || "").trim();
          if (!val) return;
          if (role === "sku") {
            const sm = val.match(PREFIXED_SKU_EXACT_RX);
            skuVal = sm ? sm[1].toUpperCase() : val.toUpperCase();
          } else if (role === "description") {
            descVal = val;
          } else if (role === "current_stock") {
            stockVal = parseInventoryQtyToken(val);
          } else if (role === "reorder_point") {
            ropVal = parseInventoryQtyToken(val);
          }
        });

        if (skuVal && !isNonSkuInventoryLabel(skuVal) && stockVal !== null && ropVal !== null) {
          return { sku: skuVal, description: descVal, stock: stockVal, rop: ropVal };
        }
      }
    }

    // 2. Whitespace-delimited columnar row
    const skuLeadM = trimmed.match(
      /^((?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-\d+|(?:[A-Z]{2,6}-)+\d{2,6})\s+(.+)$/i
    );
    if (!skuLeadM) return null;
    const skuCode = skuLeadM[1].toUpperCase();
    if (isNonSkuInventoryLabel(skuCode)) return null;
    const rest = skuLeadM[2].trim();

    const restCleaned = rest
      .replace(/\s+(?:BELOW\s+REORDER\s+POINT|Above\s+Reorder\s+Point|Below\s+Reorder|Above\s+Reorder|At\s+Reorder\s+Point|Low\s+Stock|Adequate|Healthy(?:\s+buffer)?|Immediate\s+Reorder(?:\s+Required)?|Routine\s+Monitoring|Routine\s+Reconciliation).*$/i, "")
      .trim();

    const numStartM = restCleaned.match(/^(.+?)\s+(-?[\d,]+(?:\.\d+)?(?:\s*(?:units?|pcs?))?(?:\s+(-?[\d,]+(?:\.\d+)?(?:\s*(?:units?|pcs?))?)){1,3})$/i);
    if (!numStartM) return null;

    const descPart = numStartM[1].trim();
    const numsRaw = numStartM[2].trim();
    const numMatches = Array.from(numsRaw.matchAll(/-?[\d,]+(?:\.\d+)?/g)).map((m) => Number(m[0].replace(/,/g, "")));
    if (numMatches.length < 2) return null;

    const stockIdx = roles.indexOf("current_stock");
    const ropIdx = roles.indexOf("reorder_point");
    const firstMetricIdx = Math.min(
      stockIdx >= 0 ? stockIdx : 99,
      ropIdx >= 0 ? ropIdx : 99
    );
    const numRolesOrdered = roles.filter((r) => r === "current_stock" || r === "reorder_point" || r === "deficit" || r === "variance");
    const stockNumPos = numRolesOrdered.indexOf("current_stock");
    const ropNumPos = numRolesOrdered.indexOf("reorder_point");
    const stock = stockNumPos >= 0 && stockNumPos < numMatches.length ? numMatches[stockNumPos] : numMatches[0];
    const rop = ropNumPos >= 0 && ropNumPos < numMatches.length ? numMatches[ropNumPos] : numMatches[1];

    if (!Number.isFinite(stock) || !Number.isFinite(rop) || firstMetricIdx === 99) return null;
    return {
      sku: skuCode,
      description: descPart || null,
      stock,
      rop
    };
  };

  for (const unit of scanUnits) {
    const pageText = unit.text;
    const isReorderContext =
      /\b(?:reorder\s*(?:point|level|threshold)|(?:[a-z]{2,6}-)*(?:sku|item|part|mat)-\d+|inventory\s+(?:stock|status|reorder)|current\s+stock)\b/i.test(
        pageText
      );
    if (!isReorderContext) continue;

    const lines = pageText.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);

    // Strategy 1: Single-line AND multi-line wrapped SKU key-value lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!PREFIXED_SKU_EXACT_RX.test(line)) continue;
      if (/^\d+\.\s*[^|]+\|[^|]+\|\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}$/i.test(line)) continue;

      let candidateBlock = line;
      let parsed = parseExplicitStockAndReorder(candidateBlock);
      if (parsed.stock === null || parsed.reorderPoint === null) {
        for (let ahead = 1; ahead <= 3 && i + ahead < lines.length; ahead++) {
          const nextL = lines[i + ahead];
          if (PREFIXED_SKU_EXACT_RX.test(nextL) || /^[A-Z][A-Z0-9\s,&/()-]{5,}:$/.test(nextL)) break;
          candidateBlock = `${candidateBlock} ${nextL}`;
          parsed = parseExplicitStockAndReorder(candidateBlock);
          if (parsed.stock !== null && parsed.reorderPoint !== null) break;
        }
      }

      if (parsed.stock !== null && parsed.reorderPoint !== null) {
        const { sku, description } = extractInlineSkuAndDescription(candidateBlock);
        if (sku) {
          upsertInvRow({
            sku,
            description,
            currentStock: parsed.stock,
            reorderPoint: parsed.reorderPoint,
            page_number: unit.page_number,
            chunk_id: unit.findChunkIdForNeedle(sku)
          });
        }
      }
    }

    // Strategy 2, 3 & 4: Pipe-delimited, Columnar & Stacked PDF Tables
    let activeRoles: InvColRole[] | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const inlineRoles = detectInvHeaderRoles(line);
      if (inlineRoles) {
        activeRoles = inlineRoles;
        continue;
      }

      if (/^(?:SKU(?:\s+Code|\s+ID)?|Item\s+Code)$/i.test(line)) {
        const stackedRoles: InvColRole[] = ["sku"];
        let look = i + 1;
        while (look < lines.length && look <= i + 7) {
          const r = mapInvHeader(lines[look]);
          if (r && !stackedRoles.includes(r)) {
            stackedRoles.push(r);
            look++;
          } else {
            break;
          }
        }
        if (stackedRoles.includes("current_stock") && stackedRoles.includes("reorder_point")) {
          activeRoles = stackedRoles;
          i = look - 1;
          continue;
        }
      }

      if (!activeRoles) continue;
      if (/^[-|+=\s]{3,}$/.test(line)) continue;
      if (/^(?:REORDER\s+STATUS|FINANCIAL|VENDOR|EXECUTIVE|NOTES?|CONCLUSION|SUMMARY|AUDIT)\b/i.test(line)) {
        activeRoles = null;
        continue;
      }

      const directRow = parseColumnarLineWithRoles(line, activeRoles);
      if (directRow) {
        upsertInvRow({
          sku: directRow.sku,
          description: directRow.description,
          currentStock: directRow.stock,
          reorderPoint: directRow.rop,
          page_number: unit.page_number,
          chunk_id: unit.findChunkIdForNeedle(directRow.sku)
        });
        continue;
      }

      // Multi-line wrapped columnar row or stacked vertical tuple
      if (PREFIXED_SKU_LINE_START_RX.test(line)) {
        const stackedSlice = lines.slice(i, i + activeRoles.length);
        if (stackedSlice.length === activeRoles.length) {
          const obj: Partial<Record<InvColRole, string>> = {};
          let validTuple = true;
          for (let k = 0; k < activeRoles.length; k++) {
            const r = activeRoles[k];
            const val = stackedSlice[k];
            if (k > 0 && PREFIXED_SKU_LINE_START_RX.test(val)) {
              validTuple = false;
              break;
            }
            obj[r] = val;
          }
          if (validTuple && obj.sku && !isNonSkuInventoryLabel(obj.sku) && obj.current_stock && obj.reorder_point) {
            const stNum = parseInventoryQtyToken(obj.current_stock);
            const ropNum = parseInventoryQtyToken(obj.reorder_point);
            if (stNum !== null && ropNum !== null) {
              upsertInvRow({
                sku: obj.sku,
                description: obj.description || null,
                currentStock: stNum,
                reorderPoint: ropNum,
                page_number: unit.page_number,
                chunk_id: unit.findChunkIdForNeedle(obj.sku)
              });
              i += activeRoles.length - 1;
              continue;
            }
          }
        }

        let merged = line;
        for (let ahead = 1; ahead <= 3 && i + ahead < lines.length; ahead++) {
          const nextL = lines[i + ahead];
          if (PREFIXED_SKU_LINE_START_RX.test(nextL)) break;
          merged = `${merged} ${nextL}`;
          const wrappedRow = parseColumnarLineWithRoles(merged, activeRoles);
          if (wrappedRow) {
            upsertInvRow({
              sku: wrappedRow.sku,
              description: wrappedRow.description,
              currentStock: wrappedRow.stock,
              reorderPoint: wrappedRow.rop,
              page_number: unit.page_number,
              chunk_id: unit.findChunkIdForNeedle(wrappedRow.sku)
            });
            i += ahead;
            break;
          }
        }
      }
    }

    // Strategy 5: Vertical labeled record blocks (SKU: SKU-001 or SKU: NS-SKU-101)
    const kvBlocks = pageText.split(
      /(?=(?:^|\n)\s*SKU\s*[:\-]\s*(?:(?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-?\d+|(?:[A-Z]{2,6}-)+\d{2,6}))/i
    );
    for (const blk of kvBlocks) {
      const mSku = blk.match(/^\s*SKU\s*[:\-]\s*([A-Z0-9-]{3,28})/i);
      if (!mSku || isNonSkuInventoryLabel(mSku[1])) continue;
      const parsed = parseExplicitStockAndReorder(blk);
      if (parsed.stock !== null && parsed.reorderPoint !== null) {
        const descM = blk.match(/(?:Item\s+Description|Description|Item\s+Name|Product)\s*[:\-]\s*([^\n|]{2,80})/i);
        upsertInvRow({
          sku: mSku[1].toUpperCase(),
          description: descM ? descM[1].trim() : null,
          currentStock: parsed.stock,
          reorderPoint: parsed.reorderPoint,
          page_number: unit.page_number,
          chunk_id: unit.findChunkIdForNeedle(mSku[1])
        });
      }
    }
  }

  return results;
}

function normalizeSqlColName(header: string): string {
  const cleaned = (header || "")
    .trim()
    .toLowerCase()
    .replace(/%/g, "_pct")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "col";
}

function parseTypedSqlCellValue(raw: string, headerName: string): any {
  const s = (raw ?? "").trim();
  if (!s) return "";
  // Pure numeric with optional currency sign/code, commas, or %
  if (/^[+-]?(?:(?:INR|USD|EUR|GBP|[$€£₹])\s*)?[+-]?[\d,]+(?:\.\d+)?\s*%?$/i.test(s)) {
    const cleaned = s.replace(/(?:INR|USD|EUR|GBP|[$€£₹%,\s])/gi, "");
    const num = Number(cleaned);
    if (Number.isFinite(num)) return num;
  }
  // Numeric followed by "days" when header indicates days/delay/sla/actual/variance
  if (
    /\b(?:days?|delay|sla|actual|variance)\b/i.test(headerName) &&
    /^[+-]?\d+(?:\.\d+)?\s*days?$/i.test(s)
  ) {
    const num = Number(s.replace(/\s*days?$/i, ""));
    if (Number.isFinite(num)) return num;
  }
  return s;
}

type StructuredTableKind =
  | "regional_p_and_l"
  | "monthly_totals"
  | "regional_sales"
  | "delivery_report"
  | "inventory_status"
  | "vendor_performance"
  | "risk_register"
  | "meeting_action_items"
  | "recommendations";

function classifyAtomicTableByHeaders(headers: string[], sampleRows: AtomicTableRow[]): StructuredTableKind | null {
  const hLow = headers.map((h) => h.trim().toLowerCase());
  const has = (rx: RegExp) => hLow.some((h) => rx.test(h));

  // 1. inventory_status: SKU + Current/Physical/System Stock + Reorder Point
  if (
    has(/\b(?:sku(?:\s+code|\s+id)?|item\s+code|part\s+no\.?|material\s+id)\b/) &&
    has(/\b(?:physical\s+(?:quantity|qty|stock)|system\s+(?:quantity|qty|stock)|current\s+stock|stock\s+on\s+hand|on[\s\-]hand|stock\s+level|available\s+stock|qty\s+on\s+hand)\b/) &&
    has(/\b(?:reorder\s+(?:point|level|threshold)|min(?:imum)?\s+stock|safety\s+stock|rop)\b/)
  ) {
    return "inventory_status";
  }

  // 2. delivery_report: Delivery/Shipment/Tracking ID or Delay/SLA/Actual days
  if (
    (has(/\b(?:delivery|shipment|dispatch|tracking|consignment)\s*(?:id|no|number|#)?\b/) &&
      has(/\b(?:carrier|route|delay|sla|actual|status)\b/)) ||
    (has(/\bsla\b/) && has(/\bactual\b/) && has(/\bdelay\b/))
  ) {
    return "delivery_report";
  }

  // 3. risk_register: Risk + Severity/Likelihood/Mitigation
  if (
    has(/\brisk\b/) &&
    has(/\b(?:severity|likelihood|mitigation|impact|probability|risk\s+score)\b/)
  ) {
    return "risk_register";
  }

  // 4. meeting_action_items: Owner + Action Item + Deadline
  if (
    has(/\b(?:owner|assignee|responsible)\b/) &&
    has(/\b(?:action(?:\s+item)?|task|deliverable)\b/) &&
    has(/\b(?:deadline|due(?:\s+date)?|target\s+date)\b/)
  ) {
    return "meeting_action_items";
  }

  // 5. recommendations: Recommendation + Priority/Timeline/Impact
  if (
    has(/\b(?:recommendations?|recommended\s+actions?|initiatives?)\b/) &&
    has(/\b(?:priority|timeline|impact|category|owner|rec\s*id)\b/)
  ) {
    return "recommendations";
  }

  // 6. monthly_totals: Col 0 is Month/Period (or month names in data) + Financial cols
  const col0IsMonth =
    /\b(?:month|period)\b/.test(hLow[0] || "") ||
    (sampleRows.length > 0 && sampleRows.every((r) => isMonthOrPeriodLabel(r.cells[0] || "")));
  if (
    col0IsMonth &&
    has(/\b(?:revenue|expenses?|opex|profit|margin|cogs|logistics|sales)\b/)
  ) {
    return "monthly_totals";
  }

  // 7. regional_sales: Sales/Units/Achievement/City/Hub (without operating profit/cogs/opex)
  if (
    has(/\bsales\b|\bunits\s+sold\b|\bachievement\b/) &&
    has(/\b(?:region|city|hub|branch|store|rating|target)\b/) &&
    !has(/\boperating\s+profit\b|\bcogs\b|\boperating\s+expenses\b/)
  ) {
    return "regional_sales";
  }

  // 8. regional_p_and_l: Region + Financial P&L columns (and not month/sales)
  if (
    has(/\bregion\b|\bterritory\b/) &&
    (has(/\boperating\s+profit\b|\bnet\s+profit\b|\bebit\b/) ||
      (has(/\brevenue\b/) && (has(/\bexpenses?|opex\b/) || has(/\bmargin\b/))))
  ) {
    return "regional_p_and_l";
  }

  // 9. vendor_performance: Vendor/Supplier/Carrier + On-Time/Damage/Rating/SLA
  if (
    has(/\b(?:vendor|supplier|carrier|partner|provider)\b/) &&
    has(/\b(?:on[-\s]?time|otd|damage|rating|sla|transit\s+variance|delivery)\b/)
  ) {
    return "vendor_performance";
  }

  return null;
}

/**
 * Parses CSV or structured PDF tables dynamically into typed SQL records.
 * Structured atomic tables (`atomicTableRows`) are checked first via header classification;
 * regex/text extractors act as fallback only when no structured table matches.
 */
export function extractStructuredSqlRecords(
  docId: number,
  sourceVersion: string,
  docType: string,
  content: string,
  chunks: DocumentChunk[],
  atomicTableRows?: AtomicTableRow[]
): DocumentSQLRecord[] {
  const tables: DocumentSQLRecord[] = [];
  const text = content || "";

  const findRowChunkId = (pageNum: number, keyNeedles: string[]): string => {
    const validNeedles = keyNeedles.map((n) => (n || "").trim().toLowerCase()).filter((n) => n.length >= 2);
    const pageChunks = chunks.filter((c) => c.document_id === docId && c.page_number === pageNum);
    const pool = pageChunks.length > 0 ? pageChunks : chunks.filter((c) => c.document_id === docId);
    for (const needle of validNeedles) {
      const hit = pool.find((c) => (c.content || "").toLowerCase().includes(needle));
      if (hit) return hit.chunk_id;
    }
    return pool[0]?.chunk_id || `doc-${docId}-p${pageNum}-c0`;
  };

  // 1. Real CSV ingestion (RFC-4180 quoted commas & currency numeric parsing)
  const rawCsvLines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (
    rawCsvLines.length >= 2 &&
    (docType.toUpperCase() === "CSV" || /^[^,\n]+(?:,[^,\n]+){1,}$/m.test(rawCsvLines[0]))
  ) {
    const headers = parseCsvLine(rawCsvLines[0]).map((h) => h.replace(/^"|"$/g, "").trim());
    const dataRows = rawCsvLines.slice(1).map((l) => parseCsvLine(l));
    if (headers.length >= 2 && dataRows.every((cells) => cells.length === headers.length)) {
      const csvChunkId = chunks[0]?.chunk_id || `doc-${docId}-p1-c0`;
      const rows = dataRows.map((vals) => {
        const obj: Record<string, any> = {
          document_id: docId,
          source_page: 1,
          chunk_id: csvChunkId
        };
        headers.forEach((h, idx) => {
          const raw = (vals[idx] || "").replace(/^"|"$/g, "").trim();
          const isNumericCell = /^[-+]?(?:\$|€|£|INR\s*|USD\s*|EUR\s*|GBP\s*)?[-+]?[\d,]+(?:\.\d+)?%?$/i.test(raw);
          if (raw !== "" && isNumericCell) {
            const normalizedNumStr = raw.replace(/(?:INR|USD|EUR|GBP|[$€£%,\s])/gi, "");
            const num = Number(normalizedNumStr);
            obj[h] = !Number.isNaN(num) && Number.isFinite(num) ? num : raw;
          } else {
            obj[h] = raw;
          }
        });
        return obj;
      });
      tables.push({
        table_name: "uploaded_csv_metrics",
        document_id: docId,
        source_version: sourceVersion,
        columns: ["document_id", ...headers, "source_page", "chunk_id"],
        rows
      });
    }
  }

  // 2. Structured Atomic Table Rows (grouped by table_id)
  const classifiedBuckets = new Map<StructuredTableKind, { headers: string[]; rows: AtomicTableRow[] }>();
  if (atomicTableRows && atomicTableRows.length > 0) {
    const grouped = new Map<string, AtomicTableRow[]>();
    for (const r of atomicTableRows) {
      if (r.doc_id !== docId) continue;
      const arr = grouped.get(r.table_id) || [];
      arr.push(r);
      grouped.set(r.table_id, arr);
    }

    for (const tableRows of grouped.values()) {
      const hdrs = tableRows[0]?.header || [];
      if (hdrs.length < 2) continue;
      const kind = classifyAtomicTableByHeaders(hdrs, tableRows);
      if (!kind) continue;

      const existing = classifiedBuckets.get(kind);
      if (!existing) {
        classifiedBuckets.set(kind, { headers: hdrs, rows: [...tableRows] });
      } else {
        existing.rows.push(...tableRows);
      }
    }
  }

  // Helper to convert generic atomic rows into typed SQL table records
  const buildGenericSqlRows = (headers: string[], rawRows: AtomicTableRow[], skipTotalRows: boolean = false) => {
    const colKeys: string[] = [];
    const used = new Set<string>();
    for (const h of headers) {
      let key = normalizeSqlColName(h);
      if (used.has(key)) {
        let suffix = 2;
        while (used.has(`${key}_${suffix}`)) suffix++;
        key = `${key}_${suffix}`;
      }
      used.add(key);
      colKeys.push(key);
    }

    const mappedRows: Array<Record<string, any>> = [];
    for (const row of rawRows) {
      const firstCell = (row.cells[0] || "").trim();
      if (!firstCell) continue;
      if (skipTotalRows && /^(?:total|subtotal|grand\s+total|q[1-4]\s+total|summary)$/i.test(firstCell)) {
        continue;
      }
      const chunkId = findRowChunkId(row.page, [firstCell, row.cells[1] || ""]);
      const rec: Record<string, any> = {
        document_id: docId,
        source_page: row.page,
        chunk_id: chunkId
      };
      colKeys.forEach((k, idx) => {
        rec[k] = parseTypedSqlCellValue(row.cells[idx] ?? "", headers[idx] || k);
      });
      mappedRows.push(rec);
    }
    return {
      columns: ["document_id", ...colKeys, "source_page", "chunk_id"],
      rows: mappedRows
    };
  };

  // Emit generic tables cleanly
  const monthlyBucket = classifiedBuckets.get("monthly_totals");
  if (monthlyBucket && monthlyBucket.rows.length > 0) {
    const { columns, rows } = buildGenericSqlRows(monthlyBucket.headers, monthlyBucket.rows, true);
    if (rows.length > 0) {
      tables.push({
        table_name: "monthly_totals",
        document_id: docId,
        source_version: sourceVersion,
        columns,
        rows
      });
    }
  }

  const salesBucket = classifiedBuckets.get("regional_sales");
  if (salesBucket && salesBucket.rows.length > 0) {
    const { columns, rows } = buildGenericSqlRows(salesBucket.headers, salesBucket.rows, true);
    if (rows.length > 0) {
      tables.push({
        table_name: "regional_sales",
        document_id: docId,
        source_version: sourceVersion,
        columns,
        rows
      });
    }
  }

  const deliveryBucket = classifiedBuckets.get("delivery_report");
  if (deliveryBucket && deliveryBucket.rows.length > 0) {
    const { columns, rows } = buildGenericSqlRows(deliveryBucket.headers, deliveryBucket.rows, false);
    if (rows.length > 0) {
      tables.push({
        table_name: "delivery_report",
        document_id: docId,
        source_version: sourceVersion,
        columns,
        rows
      });
    }
  }

  const riskBucket = classifiedBuckets.get("risk_register");
  if (riskBucket && riskBucket.rows.length > 0) {
    const { columns, rows } = buildGenericSqlRows(riskBucket.headers, riskBucket.rows, false);
    if (rows.length > 0) {
      tables.push({
        table_name: "risk_register",
        document_id: docId,
        source_version: sourceVersion,
        columns,
        rows
      });
    }
  }

  const recBucket = classifiedBuckets.get("recommendations");
  if (recBucket && recBucket.rows.length > 0) {
    const { columns, rows } = buildGenericSqlRows(recBucket.headers, recBucket.rows, false);
    if (rows.length > 0) {
      tables.push({
        table_name: "recommendations",
        document_id: docId,
        source_version: sourceVersion,
        columns,
        rows
      });
    }
  }

  // Meeting Action Items (structured table first, regex fallback only if empty)
  const actionBucket = classifiedBuckets.get("meeting_action_items");
  if (actionBucket && actionBucket.rows.length > 0) {
    const hdrsLow = actionBucket.headers.map((h) => h.trim().toLowerCase());
    const ownerIdx = hdrsLow.findIndex((h) => /\b(?:owner|assignee|responsible)\b/.test(h));
    const actIdx = hdrsLow.findIndex((h) => /\b(?:action(?:\s+item)?|task|deliverable)\b/.test(h));
    const dueIdx = hdrsLow.findIndex((h) => /\b(?:deadline|due(?:\s+date)?|target\s+date)\b/.test(h));
    const rows = actionBucket.rows.map((r) => {
      const owner = (r.cells[ownerIdx >= 0 ? ownerIdx : 0] || "").trim();
      const actionItem = (r.cells[actIdx >= 0 ? actIdx : 1] || "").trim();
      const deadline = (r.cells[dueIdx >= 0 ? dueIdx : 2] || "").trim();
      return {
        document_id: docId,
        owner,
        action_item: actionItem,
        deadline,
        source_page: r.page,
        chunk_id: findRowChunkId(r.page, [owner, actionItem, deadline])
      };
    });
    if (rows.length > 0) {
      tables.push({
        table_name: "meeting_action_items",
        document_id: docId,
        source_version: sourceVersion,
        columns: ["document_id", "owner", "action_item", "deadline", "source_page", "chunk_id"],
        rows
      });
    }
  } else {
    const actionRows: Array<Record<string, any>> = [];
    const lines = text.split("\n");
    for (const line of lines) {
      const t = line.trim();
      const actMatch =
        t.match(/^(?:\d+\.|[-•*])\s*([^|]{2,45})\s*\|\s*([^|]{4,140})\s*\|\s*([^|]{3,40})$/) ||
        t.match(/^Owner\s*[:\-]\s*([^|]{2,45})\s*\|\s*(?:Action(?:\s+Item)?\s*[:\-]\s*)([^|]{4,140})\s*\|\s*(?:Deadline|Due(?:\s+Date)?)\s*[:\-]\s*([^|]{3,40})$/i);
      if (
        actMatch &&
        !/^Region:/i.test(actMatch[1]) &&
        !/^(?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-\d+/i.test(actMatch[1].trim())
      ) {
        const owner = actMatch[1].replace(/^Owner\s*[:\-]\s*/i, "").trim();
        const actionItem = actMatch[2].replace(/^Action(?:\s+Item)?\s*[:\-]\s*/i, "").trim();
        const deadline = actMatch[3].replace(/^(?:Deadline|Due(?:\s+Date)?)\s*[:\-]\s*/i, "").trim();
        const hitChunk = chunks.find(
          (c) => c.document_id === docId && (c.content || "").toLowerCase().includes(owner.toLowerCase())
        );
        actionRows.push({
          document_id: docId,
          owner,
          action_item: actionItem,
          deadline,
          source_page: hitChunk?.page_number || 1,
          chunk_id: hitChunk?.chunk_id || chunks[0]?.chunk_id || `doc-${docId}-p1-c0`
        });
      }
    }
    if (actionRows.length > 0) {
      tables.push({
        table_name: "meeting_action_items",
        document_id: docId,
        source_version: sourceVersion,
        columns: ["document_id", "owner", "action_item", "deadline", "source_page", "chunk_id"],
        rows: actionRows
      });
    }
  }

  // Regional Financial P&L (structured atomic table rows prioritized inside extractRegionalFinancialRecordsFromDoc)
  const pnlBucket = classifiedBuckets.get("regional_p_and_l");
  const pnlRows = extractRegionalFinancialRecordsFromDoc({
    id: docId,
    content: text,
    chunks,
    atomic_table_rows: pnlBucket ? pnlBucket.rows : atomicTableRows
  });
  if (pnlRows.length > 0) {
    tables.push({
      table_name: "regional_p_and_l",
      document_id: docId,
      source_version: sourceVersion,
      columns: [
        "document_id",
        "region",
        "currency",
        "gross_revenue",
        "operating_expenses",
        "operating_profit",
        "margin_pct",
        "reporting_period",
        "source_page",
        "chunk_id"
      ],
      rows: pnlRows.map((r) => ({ ...r, chunk_id: r.source_chunk_id }))
    });
  }

  // Inventory Status & Reorder-Point Records (structured atomic table rows prioritized inside extractInventoryRecordsFromDoc)
  const invBucket = classifiedBuckets.get("inventory_status");
  const invRows = extractInventoryRecordsFromDoc({
    id: docId,
    content: text,
    chunks,
    atomic_table_rows: invBucket ? invBucket.rows : atomicTableRows
  });
  if (invRows.length > 0) {
    tables.push({
      table_name: "inventory_status",
      document_id: docId,
      source_version: sourceVersion,
      columns: [
        "document_id",
        "sku",
        "item_name",
        "item_description",
        "current_stock",
        "reorder_point",
        "deficit",
        "status",
        "source_page",
        "chunk_id"
      ],
      rows: invRows.map((r) => ({ ...r, chunk_id: r.source_chunk_id }))
    });
  }

  // Vendor / Carrier Performance Records (structured table first, NER fallback when absent)
  const vendorBucket = classifiedBuckets.get("vendor_performance");
  if (vendorBucket && vendorBucket.rows.length > 0) {
    const hdrs = vendorBucket.headers;
    const hLow = hdrs.map((h) => h.trim().toLowerCase());
    const carrierIdx = hLow.findIndex((h) => /\b(?:vendor|supplier|carrier|partner|provider)\b/.test(h));
    const otdIdx = hLow.findIndex((h) => /\b(?:on[-\s]?time|otd)\b/.test(h));
    const slaIdx = hLow.findIndex((h) => /\b(?:target|sla)\b/.test(h));
    const varIdx = hLow.findIndex((h) => /\b(?:transit\s+variance|variance)\b/.test(h));
    const dmgIdx = hLow.findIndex((h) => /\bdamage\b/.test(h));
    const ratingIdx = hLow.findIndex((h) => /\brating\b/.test(h));

    const vendorRows = vendorBucket.rows
      .map((r) => {
        const carrier = (r.cells[carrierIdx >= 0 ? carrierIdx : 0] || "").trim();
        if (!carrier) return null;
        const onTimeRaw = otdIdx >= 0 ? r.cells[otdIdx] : "";
        const targetRaw = slaIdx >= 0 ? r.cells[slaIdx] : "";
        const dmgRaw = dmgIdx >= 0 ? r.cells[dmgIdx] : "";
        const ratingRaw = ratingIdx >= 0 ? r.cells[ratingIdx] : "";
        return {
          document_id: docId,
          carrier,
          on_time_pct: onTimeRaw ? parseTypedSqlCellValue(onTimeRaw, "on_time_pct") : null,
          target_pct: targetRaw ? parseTypedSqlCellValue(targetRaw, "target_pct") : null,
          ...(dmgIdx >= 0 ? { damage_pct: dmgRaw ? parseTypedSqlCellValue(dmgRaw, "damage_pct") : null } : {}),
          ...(varIdx >= 0 ? { transit_variance_days: (r.cells[varIdx] || "N/A").trim() } : { transit_variance_days: "N/A" }),
          ...(ratingIdx >= 0 ? { rating: ratingRaw ? parseTypedSqlCellValue(ratingRaw, "rating") : null } : {}),
          recorded_issues: dmgIdx >= 0 && dmgRaw ? `${dmgRaw} damage` : r.raw_row_text.slice(0, 90),
          source_page: r.page,
          chunk_id: findRowChunkId(r.page, [carrier])
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (vendorRows.length > 0) {
      const cols = [
        "document_id",
        "carrier",
        "on_time_pct",
        "target_pct",
        ...(dmgIdx >= 0 ? ["damage_pct"] : []),
        "transit_variance_days",
        ...(ratingIdx >= 0 ? ["rating"] : []),
        "recorded_issues",
        "source_page",
        "chunk_id"
      ];
      tables.push({
        table_name: "vendor_performance",
        document_id: docId,
        source_version: sourceVersion,
        columns: cols,
        rows: vendorRows
      });
    }
  } else {
    const suppliers = extractSuppliersFromText(text, chunks, atomicTableRows, docId);
    const vendorRows = suppliers
      .filter((s) => s.on_time_rate || s.transit_variance || s.issues)
      .map((s) => ({
        document_id: docId,
        carrier: s.name,
        on_time_pct: s.on_time_rate ? Number(s.on_time_rate.replace("%", "")) : null,
        target_pct: s.target_sla ? Number(s.target_sla.replace("%", "")) : null,
        transit_variance_days: s.transit_variance || "N/A",
        recorded_issues: s.issues || s.raw_line.slice(0, 90),
        source_page: s.page_number || 1,
        chunk_id: s.chunk_id || findRowChunkId(s.page_number || 1, [s.name])
      }));
    if (vendorRows.length > 0) {
      tables.push({
        table_name: "vendor_performance",
        document_id: docId,
        source_version: sourceVersion,
        columns: ["document_id", "carrier", "on_time_pct", "target_pct", "transit_variance_days", "recorded_issues", "source_page", "chunk_id"],
        rows: vendorRows
      });
    }
  }

  // Product / Regional Sales Variance sentences
  const productMatch = text.match(/\b(Product\s+[A-Z0-9]+)\b[^.]*?\b(Region\s+[A-Z0-9]+)\b[^.]*?dropped\s+by\s+(\d+(?:\.\d+)?)%\s*[^$]*?\(\$(\d[\d,]+)\s+revenue\s+reduction\)/i);
  if (productMatch) {
    const revDrop = Number(productMatch[4].replace(/,/g, ""));
    const dropPct = Number(productMatch[3]);
    const hitChunk = chunks.find((c) => c.document_id === docId && (c.content || "").includes(productMatch[1]));
    tables.push({
      table_name: "regional_product_variance",
      document_id: docId,
      source_version: sourceVersion,
      columns: ["document_id", "product_name", "region", "variance_dollars", "variance_pct", "source_page", "chunk_id"],
      rows: [
        {
          document_id: docId,
          product_name: productMatch[1],
          region: productMatch[2],
          variance_dollars: -revDrop,
          variance_pct: -dropPct,
          source_page: hitChunk?.page_number || 1,
          chunk_id: hitChunk?.chunk_id || `doc-${docId}-p1-c0`
        }
      ]
    });
  }

  return tables;
}

/**
 * Dynamically extracts strictly provenance-stamped Neo4j entities and relationships
 * verified directly against extracted document chunks.
 */
export function extractDocumentGraph(
  docId: number,
  chunks: DocumentChunk[],
  sqlRecords: DocumentSQLRecord[],
  content: string,
  docTitle?: string,
  sections?: DocumentSection[],
  atomicTableRows?: AtomicTableRow[]
): { nodes: DocumentGraphEntity[]; edges: DocumentGraphRelationship[] } {
  const ts = new Date().toISOString();
  const nodesMap = new Map<string, DocumentGraphEntity>();
  const nameToCanonical = new Map<string, DocumentGraphEntity>();
  const edges: DocumentGraphRelationship[] = [];
  const edgeKeys = new Set<string>();

  const findChunkForText = (needle: string): { chunk_id: string; page_number: number } => {
    const nLower = (needle || "").toLowerCase();
    if (nLower) {
      const hit = chunks.find(
        (c) => c.content.toLowerCase().includes(nLower) || c.section_title.toLowerCase().includes(nLower)
      );
      if (hit) return { chunk_id: hit.chunk_id, page_number: hit.page_number };
    }
    return {
      chunk_id: chunks[0]?.chunk_id || `doc-${docId}-p1-c0`,
      page_number: chunks[0]?.page_number || 1
    };
  };

  const addNode = (
    id: string,
    label: string,
    name: string,
    refText: string,
    props?: Record<string, any>,
    preferredPage?: number
  ) => {
    const cleanName = (name || "").replace(/\s+/g, " ").trim();
    if (!cleanName || cleanName.length < 2) return;
    const nameKey = cleanName.toLowerCase();
    const existingByName = nameToCanonical.get(nameKey);
    if (existingByName) {
      if (props) {
        existingByName.properties = { ...(existingByName.properties || {}), ...props };
      }
      return;
    }
    const prov = findChunkForText(refText || cleanName);
    const node: DocumentGraphEntity = {
      id,
      label,
      name: cleanName,
      document_id: docId,
      source_chunk_id: prov.chunk_id,
      source_page: preferredPage || prov.page_number,
      extraction_timestamp: ts,
      properties: props
    };
    nodesMap.set(`${label}:${nameKey}`, node);
    nameToCanonical.set(nameKey, node);
  };

  const resolveEndpointName = (rawName: string): string => {
    const clean = (rawName || "").replace(/\s+/g, " ").trim();
    return nameToCanonical.get(clean.toLowerCase())?.name || clean;
  };

  const addEdge = (source: string, relation: string, target: string, refText: string, preferredPage?: number) => {
    const src = resolveEndpointName(source);
    const tgt = resolveEndpointName(target);
    if (!src || !tgt || src.toLowerCase() === tgt.toLowerCase()) return;
    const k = `${src}|${relation}|${tgt}`.toLowerCase();
    if (edgeKeys.has(k)) return;
    edgeKeys.add(k);
    const prov = findChunkForText(refText || src);
    edges.push({
      source: src,
      relation,
      target: tgt,
      document_id: docId,
      source_chunk_id: prov.chunk_id,
      source_page: preferredPage || prov.page_number,
      extraction_timestamp: ts
    });
  };

  // 1. Confirmed Suppliers / Vendors / Carriers (NER-verified) + scorecard, lanes, & risk rating
  const entitySummary = extractEntitySummaryFromText(content, chunks, atomicTableRows, docId);
  const suppliers = entitySummary.confirmed_suppliers;
  suppliers.forEach((s, idx) => {
    const sLabel = s.category === "Carrier" ? "Carrier" : s.category === "Vendor" ? "Vendor" : "Supplier";
    const auditChunk =
      chunks.find((c) => c.content.toLowerCase().includes(s.name.toLowerCase()) && /audit|scorecard|vendor|target/i.test(c.content)) ||
      chunks.find((c) => c.content.toLowerCase().includes(s.name.toLowerCase()));
    const auditBody = auditChunk?.content || s.supporting_sentence || "";

    const ratingMatch = auditBody.match(/(?:Overall\s+vendor\s+rating|Risk\s+rating)\s*[:\-]\s*([A-Za-z-]+(?:\s+Risk)?)/i);
    const laneMatch = auditBody.match(/\b([A-Z][a-z]+)\s*[–—-]\s*([A-Z][a-z]+)\s+lane\b/);
    const dmgMatch = auditBody.match(/damage\s+rate\s*:\s*([\d.]+%)/i);

    addNode(`sup-${docId}-${idx}`, sLabel, s.name, s.name, {
      category: s.category,
      ...(s.on_time_rate ? { on_time_rate: s.on_time_rate } : {}),
      ...(s.target_sla ? { target_sla: s.target_sla } : {}),
      ...(s.transit_variance ? { transit_variance: s.transit_variance } : {}),
      ...(dmgMatch ? { damage_rate: dmgMatch[1] } : {}),
      ...(ratingMatch ? { risk_rating: ratingMatch[1].trim() } : {}),
      page: s.page_number
    }, s.page_number);

    if (s.on_time_rate) {
      const otdLabel = `${s.on_time_rate} OTD${s.target_sla ? ` (Target ${s.target_sla})` : ""}`;
      addNode(`sup-otd-${docId}-${idx}`, "PerformanceMetric", otdLabel, s.name, { page: s.page_number }, s.page_number);
      addEdge(s.name, "ON_TIME_RATE", otdLabel, s.name, s.page_number);
    } else if (s.issues) {
      const cleanIssue = s.issues.slice(0, 60);
      addNode(`issue-${docId}-${idx}`, "PerformanceMetric", cleanIssue, s.name, { page: s.page_number }, s.page_number);
      addEdge(s.name, "RECORDED_METRIC", cleanIssue, s.name, s.page_number);
    }

    if (laneMatch) {
      const laneName = `${laneMatch[1]}–${laneMatch[2]} Lane`;
      addNode(`lane-${laneMatch[1].toLowerCase()}-${laneMatch[2].toLowerCase()}`, "DeliveryLane", laneName, laneMatch[0], { page: auditChunk?.page_number || s.page_number }, auditChunk?.page_number || s.page_number);
      addEdge(s.name, "OPERATES_LANE", laneName, laneMatch[0], auditChunk?.page_number || s.page_number);
    }

    if (ratingMatch) {
      const ratingLabel = `${ratingMatch[1].trim()} Risk Rating`;
      addNode(`rat-${docId}-${idx}`, "Risk", ratingLabel, ratingMatch[0], { rating: ratingMatch[1].trim(), page: auditChunk?.page_number || s.page_number }, auditChunk?.page_number || s.page_number);
      addEdge(s.name, "RATED_AS", ratingLabel, ratingMatch[0], auditChunk?.page_number || s.page_number);
    }
  });

  // 2. Explicit Product -> Supplier -> Region links if verbatim in content
  const prodSupMatch = content.match(/\b(Supplier\s+[A-Z0-9]+)\b[^.]*?\b(Region\s+[A-Z0-9]+)\b[^.]*?\bprimary\s+supplier\s+of\s+(Product\s+[A-Z0-9]+)\b/i);
  if (prodSupMatch) {
    addNode(`prod-${docId}`, "Product", prodSupMatch[3], prodSupMatch[3]);
    addNode(`sup-rel-${docId}`, "Supplier", prodSupMatch[1], prodSupMatch[1]);
    addNode(`reg-${docId}`, "Region", prodSupMatch[2], prodSupMatch[2]);
    addEdge(prodSupMatch[3], "SUPPLIED_BY", prodSupMatch[1], prodSupMatch[1]);
    addEdge(prodSupMatch[1], "OPERATES_IN", prodSupMatch[2], prodSupMatch[2]);
  }

  // 3. Inventory Status & Reorder-Point Alerts (registered BEFORE generic entities so SKU-xxx uses canonical InventorySKU)
  const invTable = sqlRecords.find((t) => t.table_name === "inventory_status");
  if (invTable) {
    const belowRows = invTable.rows.filter((r) => r.status === "BELOW REORDER POINT");
    const healthyRows = invTable.rows.filter((r) => r.status !== "BELOW REORDER POINT");

    belowRows.forEach((r, idx) => {
      const skuName = String(r.sku);
      addNode(`sku-${docId}-${idx}`, "InventorySKU", skuName, skuName, {
        item_name: r.item_name,
        current_stock: r.current_stock,
        reorder_point: r.reorder_point,
        deficit: r.deficit,
        status: "BELOW REORDER POINT"
      }, r.source_page);
      addNode(`alert-${docId}-rop`, "ThresholdAlert", "BELOW REORDER POINT", skuName, { severity: "HIGH" }, r.source_page);
      addEdge(skuName, "STATUS", "BELOW REORDER POINT", skuName, r.source_page);
    });

    // Also include remaining SKUs concisely when table is compact (<= 10 rows total)
    if (invTable.rows.length <= 10) {
      healthyRows.forEach((r, idx) => {
        const skuName = String(r.sku);
        addNode(`sku-ok-${docId}-${idx}`, "InventorySKU", skuName, skuName, {
          item_name: r.item_name,
          current_stock: r.current_stock,
          reorder_point: r.reorder_point,
          deficit: 0,
          status: "ABOVE REORDER POINT"
        }, r.source_page);
        addNode(`alert-${docId}-ok`, "InventoryStatus", "ABOVE REORDER POINT", skuName, undefined, r.source_page);
        addEdge(skuName, "STATUS", "ABOVE REORDER POINT", skuName, r.source_page);
      });
    }
  }

  // 4. Incidents, Logistics Delay Post-Mortems, Delivery Lanes & Root Causes
  for (const chunk of chunks) {
    const txt = chunk.content || "";
    const isIncidentSection =
      /post-mortem|root\s*causes?|case\s+log-|reference:\s*inc-|cycle-count\s+check\s+identified\s+a\s+mismatch/i.test(
        `${chunk.section_title}\n${txt}`
      );
    if (!isIncidentSection) continue;

    const caseM = txt.match(/\bCase\s+(LOG-\d+-\d+|INC-\d+-\d+)\b/i);
    const refM = txt.match(/\bReference\s*:\s*(INC-\d+-\d+|LOG-\d+-\d+)\b/i);
    const incM = txt.match(/Incident\s*:\s*([^\n]+)/i);
    const incidentName = caseM
      ? `Case ${caseM[1].toUpperCase()}`
      : refM
        ? refM[1].toUpperCase()
        : incM
          ? incM[1].trim()
          : chunk.section_title || "Logistics Delivery Delay";

    const costM = txt.match(/(?:cost|impact)\s*:\s*((?:INR|USD|EUR|GBP|[$€£₹])\s*[\d,]+(?:\.\d+)?)/i);
    const delayM = txt.match(/\b(two-day|\d+[-\s]day)\s+(?:service\s+)?delay\b/i);
    const locM = txt.match(/\bLocation\s*:\s*([^\n|]{3,55})/i);
    const laneM = txt.match(/\blane\s+from\s+([A-Z][a-z]+)\s+to\s+([A-Z][a-z]+)\b/i);
    const shipM = txt.match(/\bShipment\s+(DLV-\d+)\b/i);

    addNode(`inc-${docId}-${chunk.page_number}`, "Incident", incidentName, incidentName, {
      page: chunk.page_number,
      ...(delayM ? { delay_duration: delayM[0] } : {}),
      ...(costM ? { cost_impact: costM[1].trim() } : {}),
      ...(locM ? { location: locM[1].trim() } : {})
    }, chunk.page_number);

    if (laneM) {
      const laneName = `${laneM[1]}–${laneM[2]} Lane`;
      addNode(`lane-${laneM[1].toLowerCase()}-${laneM[2].toLowerCase()}`, "DeliveryLane", laneName, laneM[0], { page: chunk.page_number }, chunk.page_number);
      addEdge(incidentName, "ON_LANE", laneName, laneM[0], chunk.page_number);
    }

    if (costM) {
      addNode(`cost-${docId}-${chunk.page_number}`, "FinancialMetric", costM[1].trim(), costM[0], { page: chunk.page_number }, chunk.page_number);
      addEdge(incidentName, "COST_IMPACT", costM[1].trim(), costM[0], chunk.page_number);
    }

    if (shipM) {
      addNode(`dlv-${shipM[1].toUpperCase()}`, "Shipment", shipM[1].toUpperCase(), shipM[0], { page: chunk.page_number }, chunk.page_number);
      addEdge(shipM[1].toUpperCase(), "EXPERIENCED_INCIDENT", incidentName, shipM[0], chunk.page_number);
    }

    if (locM) {
      const locName = locM[1].trim();
      addNode(`loc-${docId}-${chunk.page_number}`, "Warehouse", locName, locM[0], { page: chunk.page_number }, chunk.page_number);
      addEdge(incidentName, "OCCURRED_AT", locName, locM[0], chunk.page_number);
    }

    // Link incident directly to any SKU mentioned in incident notes (e.g. "mismatch ... for SKU-002")
    const skuInInc = Array.from(txt.matchAll(/\b((?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-\d+)\b/gi));
    for (const sm of skuInInc) {
      const skuCode = sm[1].toUpperCase();
      addNode(`sku-ref-${docId}-${skuCode}`, "InventorySKU", skuCode, skuCode, { page: chunk.page_number }, chunk.page_number);
      addEdge(incidentName, "AFFECTED_SKU", skuCode, skuCode, chunk.page_number);
    }

    // Extract root cause block bullets or numbered causes ("Root causes" or "Documented Root Causes:")
    const rcBlockMatch = txt.match(/(?:Documented\s+Root\s+Causes?|Root\s+causes?)\s*:?\s*\n([\s\S]+?)(?=\n(?:Corrective|Owners\s+and\s+due|Immediate\s+actions|Pending|Status|$))/i);
    if (rcBlockMatch) {
      const rcLines = rcBlockMatch[1]
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^(?:[•\-*]|\d+\.)\s+/.test(l));
      rcLines.forEach((line, idx) => {
        const cleaned = line
          .replace(/^(?:[•\-*]|\d+\.)\s+/, "")
          .replace(/^Primary\s*:\s*/i, "")
          .replace(/\.$/, "")
          .trim();
        if (cleaned.length >= 6) {
          addNode(`rc-${docId}-${chunk.page_number}-${idx}`, "RootCause", cleaned, line.slice(0, 40), { page: chunk.page_number }, chunk.page_number);
          addEdge(incidentName, "CAUSED_BY", cleaned, line.slice(0, 40), chunk.page_number);
        }
      });
    } else if (/documented\s+root\s+causes?:/i.test(txt)) {
      const causeMatches = txt.match(/^\s*\d+\.\s+([^\n:]+(?:\:[^\n.]+)?)/gm) || [];
      causeMatches.forEach((line, idx) => {
        const cleaned = line.replace(/^\s*\d+\.\s+/, "").split(":")[0].trim();
        if (cleaned.length >= 5) {
          addNode(`rc-${docId}-${chunk.page_number}-${idx}`, "RootCause", cleaned, cleaned, { page: chunk.page_number }, chunk.page_number);
          addEdge(incidentName, "CAUSED_BY", cleaned, cleaned, chunk.page_number);
        }
      });
    }
  }

  // 5. Delivery Report Delayed Shipments & Lanes
  const deliveryTable = sqlRecords.find((t) => t.table_name === "delivery_report");
  if (deliveryTable && deliveryTable.rows.length > 0) {
    deliveryTable.rows
      .filter((r) => /delay/i.test(String(r.status || "")))
      .slice(0, 8)
      .forEach((r, idx) => {
        const dlvId = String(r.delivery_id || `DLV-${idx + 1}`);
        const origin = String(r.origin || "").trim();
        const dest = String(r.destination || "").trim();
        const laneName = origin && dest ? `${origin}–${dest} Lane` : "";
        addNode(`dlv-row-${docId}-${idx}`, "Shipment", dlvId, dlvId, {
          status: r.status,
          actual_days: r.actual_days,
          sla_days: r.sla_days
        }, r.source_page);
        if (laneName) {
          addNode(`lane-${origin.toLowerCase()}-${dest.toLowerCase()}`, "DeliveryLane", laneName, origin, { page: r.source_page }, r.source_page);
          addEdge(dlvId, "ON_LANE", laneName, dlvId, r.source_page);
        }
        addNode(`dlv-status-${docId}-delayed`, "ThresholdAlert", "SLA Breached (Delayed)", dlvId, { severity: "HIGH" }, r.source_page);
        addEdge(dlvId, "DELAY_STATUS", "SLA Breached (Delayed)", dlvId, r.source_page);
      });
  }

  // 6. Supply Chain Risks & Mitigations (from SQL risk_register OR bulleted Risk register)
  const riskTable = sqlRecords.find((t) => t.table_name === "risk_register");
  if (riskTable && riskTable.rows.length > 0) {
    riskTable.rows.slice(0, 8).forEach((r, idx) => {
      const vals = Object.entries(r)
        .filter(([k]) => !["document_id", "source_page", "chunk_id"].includes(k))
        .map(([, v]) => String(v));
      const riskTitle = vals[0] || `Risk #${idx + 1}`;
      addNode(`risk-${docId}-${idx}`, "Risk", riskTitle, riskTitle, { page: r.source_page }, r.source_page);
      if (vals[1]) {
        const lvl = `${vals[1]} Risk`;
        addNode(`risk-lvl-${lvl.toLowerCase()}`, "RiskLevel", lvl, riskTitle, undefined, r.source_page);
        addEdge(riskTitle, "RISK_LEVEL", lvl, riskTitle, r.source_page);
      }
    });
  } else {
    const riskRegex = /^[•\-*]\s+([^—\n]{4,60}?)\s+[—–-]\s+Likelihood\s+(\d+)\s*,\s*Impact\s+(\d+)\s*,\s*Score\s+(\d+)\s*,\s*(High|Medium|Low)\.\s*Mitigation\s*:\s*([^\n.]+)/gim;
    let rm: RegExpExecArray | null;
    let rIdx = 0;
    while ((rm = riskRegex.exec(content)) !== null && rIdx < 8) {
      const riskName = rm[1].trim();
      const score = Number(rm[4]);
      const severity = rm[5].trim();
      const mitigation = rm[6].trim();
      const prov = findChunkForText(riskName);
      addNode(`risk-${docId}-${rIdx}`, "Risk", riskName, riskName, {
        likelihood: Number(rm[2]),
        impact: Number(rm[3]),
        score,
        severity,
        page: prov.page_number
      }, prov.page_number);
      const sevLabel = `${severity} Risk (Score ${score})`;
      addNode(`risk-sev-${severity.toLowerCase()}-${score}`, "ThresholdAlert", sevLabel, riskName, { severity: severity.toUpperCase() }, prov.page_number);
      addEdge(riskName, "SCORED_AS", sevLabel, riskName, prov.page_number);
      if (mitigation.length >= 4) {
        addNode(`mit-${docId}-${rIdx}`, "ActionItem", mitigation, riskName, { page: prov.page_number }, prov.page_number);
        addEdge(riskName, "MITIGATED_BY", mitigation, riskName, prov.page_number);
      }
      rIdx++;
    }
  }

  // 7. Regional Financial P&L (from regional_p_and_l, OR latest monthly_totals when P&L absent) + Sales Hubs
  const pnlTable = sqlRecords.find((t) => t.table_name === "regional_p_and_l");
  if (pnlTable && pnlTable.rows.length > 0) {
    pnlTable.rows.forEach((r, idx) => {
      const rawReg = String(r.region || "").trim();
      const regionLabel = rawReg.startsWith("Region") ? rawReg : `Region ${rawReg}`;
      const currency = r.currency || "INR";
      const profitLabel = `${currency} ${Number(r.operating_profit || 0).toLocaleString()} Profit (${r.margin_pct || "N/A"})`;
      addNode(`pnl-reg-${docId}-${idx}`, "Region", regionLabel, rawReg, {
        gross_revenue: r.gross_revenue,
        operating_expenses: r.operating_expenses,
        operating_profit: r.operating_profit,
        margin: r.margin_pct
      }, r.source_page);
      addNode(`pnl-prof-${docId}-${idx}`, "FinancialMetric", profitLabel, rawReg, undefined, r.source_page);
      addEdge(regionLabel, "REPORTED_PROFIT", profitLabel, rawReg, r.source_page);
    });
  } else {
    const monthlyTable = sqlRecords.find((t) => t.table_name === "monthly_totals");
    if (monthlyTable && monthlyTable.rows.length > 0) {
      const latestByRegion = new Map<string, any>();
      for (const r of monthlyTable.rows) {
        const reg = String(r.region || "").trim();
        if (!reg) continue;
        const prev = latestByRegion.get(reg);
        if (!prev || String(r.month || "") >= String(prev.month || "")) {
          latestByRegion.set(reg, r);
        }
      }
      let mIdx = 0;
      for (const [reg, r] of latestByRegion.entries()) {
        const regionLabel = reg.startsWith("Region") ? reg : `Region ${reg}`;
        const profitKey = Object.keys(r).find((k) => /operating_profit/i.test(k));
        const revKey = Object.keys(r).find((k) => /^revenue/i.test(k));
        const profVal = profitKey ? Number(r[profitKey] || 0) : 0;
        const revVal = revKey ? Number(r[revKey] || 0) : 0;
        const curMatch = profitKey?.match(/_(inr|usd|eur|gbp)$/i);
        const cur = curMatch ? curMatch[1].toUpperCase() : "INR";
        const profLabel = `${cur} ${profVal.toLocaleString()} (${r.month || "Latest"})`;
        addNode(`m-reg-${docId}-${mIdx}`, "Region", regionLabel, reg, {
          month: r.month,
          revenue: revVal,
          operating_profit: profVal
        }, r.source_page);
        addNode(`m-prof-${docId}-${mIdx}`, "FinancialMetric", profLabel, reg, undefined, r.source_page);
        addEdge(regionLabel, "REPORTED_PROFIT", profLabel, reg, r.source_page);
        mIdx++;
      }
    }
  }

  // Regional Sales Cities / Hubs linked cleanly to their Region
  const salesTable = sqlRecords.find((t) => t.table_name === "regional_sales");
  if (salesTable && salesTable.rows.length > 0) {
    salesTable.rows.slice(0, 8).forEach((r, idx) => {
      const reg = String(r.region || "").trim();
      const city = String(r.city || "").trim();
      if (!reg || !city || reg.length > 35 || /fictional|sample\s+data|\bpage\b/i.test(`${reg} ${city}`)) return;
      const regLabel = reg.startsWith("Region") ? reg : `Region ${reg}`;
      addNode(`reg-${reg.toLowerCase()}`, "Region", regLabel, reg, undefined, r.source_page);
      addNode(`city-${docId}-${idx}`, "Location", city, city, {
        units_sold: r.units_sold,
        sales_inr: r.sales_inr,
        target_achievement_pct: r.target_achievement_pct,
        customer_rating: r.customer_rating_5
      }, r.source_page);
      addEdge(regLabel, "HAS_SALES_HUB", city, city, r.source_page);
    });
  }

  // 8. Meeting Action Items Owners & Deadlines (structured SQL table OR bullet "Action log")
  const actionTable = sqlRecords.find((t) => t.table_name === "meeting_action_items");
  if (actionTable && actionTable.rows.length > 0) {
    actionTable.rows.slice(0, 8).forEach((r, idx) => {
      const owner = String(r.owner);
      const task = `${String(r.action_item)} (Due: ${r.deadline})`;
      addNode(`owner-${docId}-${idx}`, "Department", owner, owner, { due: r.deadline, page: r.source_page }, r.source_page);
      addNode(`task-${docId}-${idx}`, "ActionItem", task, owner, { due: r.deadline, page: r.source_page }, r.source_page);
      addEdge(owner, "ASSIGNED_ACTION", task, owner, r.source_page);
      const skuRef = String(r.action_item || "").match(/\b((?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-\d+)\b/i);
      if (skuRef && nameToCanonical.has(skuRef[1].toLowerCase())) {
        addEdge(task, "TARGETS_SKU", skuRef[1].toUpperCase(), skuRef[1], r.source_page);
      }
    });
  } else {
    const actionBlockM = content.match(/^Action\s+log\s*:?\s*\n([\s\S]+?)(?=\n(?:Next\s+meeting|Fictional|$))/im);
    if (actionBlockM) {
      const actLines = actionBlockM[1].split("\n").map((l) => l.trim()).filter(Boolean);
      actLines.slice(0, 8).forEach((line, idx) => {
        if (/Likelihood\s+\d+|Impact\s+\d+|Score\s+\d+|Mitigation\s*:/i.test(line)) return;
        const m = line.match(/^(?:[•\-*]|\d+\.)\s*([^:]+):\s*(.+?)(?:\s+[—–-]\s+([^.\n]+))?\.?$/);
        if (m) {
          const owner = m[1].trim();
          const desc = m[2].trim();
          const due = m[3]?.trim() || "TBD";
          const task = `${desc} (Due: ${due})`;
          const prov = findChunkForText(owner);
          addNode(`owner-log-${docId}-${idx}`, "Department", owner, owner, { page: prov.page_number }, prov.page_number);
          addNode(`task-log-${docId}-${idx}`, "ActionItem", task, owner, { due, page: prov.page_number }, prov.page_number);
          addEdge(owner, "ASSIGNED_ACTION", task, owner, prov.page_number);
          const skuRef = desc.match(/\b((?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-\d+)\b/i);
          if (skuRef && nameToCanonical.has(skuRef[1].toLowerCase())) {
            addEdge(task, "TARGETS_SKU", skuRef[1].toUpperCase(), skuRef[1], prov.page_number);
          }
        }
      });
    }
  }

  // 9. Uploaded CSV records (when document is CSV or tabular)
  const csvTable = sqlRecords.find((t) => t.table_name === "uploaded_csv_metrics");
  if (csvTable && csvTable.rows.length > 0) {
    const docNodeName = docTitle || `Doc #${docId}`;
    addNode(`doc-root-${docId}`, "Document", docNodeName, csvTable.columns[1] || "");
    csvTable.rows.slice(0, 10).forEach((r, idx) => {
      const entries = Object.entries(r).filter(([k]) => k !== "document_id" && k !== "source_page" && k !== "chunk_id");
      const label = entries.slice(0, 2).map(([, v]) => String(v)).join(" — ");
      const metric = entries.slice(2).map(([k, v]) => `${k}: ${v}`).join(", ");
      if (label) {
        addNode(`csv-row-${docId}-${idx}`, "DatasetRecord", label, String(entries[0]?.[1] || ""));
        addEdge(docNodeName, "CONTAINS_RECORD", label, String(entries[0]?.[1] || ""));
        if (metric) {
          addNode(`csv-val-${docId}-${idx}`, "FinancialMetric", metric, String(entries[0]?.[1] || ""));
          addEdge(label, "MEASURED_AS", metric, String(entries[0]?.[1] || ""));
        }
      }
    });
  }

  // 10. Structural Section Backbone (ONLY genuine non-boilerplate sections, and tagged layer: "structural" if rich domain graph already exists)
  const docLabel = docTitle || `Document #${docId}`;
  const docSections = (sections || []).filter(
    (s) =>
      !/fictional\s+(?:sample|test)\s+data|suggested\s+ai\s+testing\s+questions|^page\s+\d+$/i.test(
        s.section_title.trim()
      )
  );
  const otherVerifiedEntities = entitySummary.excluded_entities.filter(
    (e) =>
      ["Warehouse", "Department", "Customer", "Product", "Region", "Location"].includes(e.category) &&
      !nameToCanonical.has(e.name.toLowerCase()) &&
      !(
        // Avoid adding bare "North" when "Region North" is already canonically present
        (e.category === "Region" && nameToCanonical.has(`region ${e.name.toLowerCase()}`))
      )
  );

  const hasRichDomainGraph = edges.length >= 4;
  if (!hasRichDomainGraph || docSections.length > 0) {
    const firstChunkText = chunks[0]?.content.slice(0, 20) || "";
    addNode(`doc-node-${docId}`, "Document", docLabel, firstChunkText, {
      document_id: docId,
      pages: chunks.length > 0 ? Math.max(...chunks.map((c) => c.page_number)) : 1,
      layer: hasRichDomainGraph ? "structural" : "primary"
    });

    docSections.slice(0, 9).forEach((sec, idx) => {
      const secTitle = sec.section_title;
      addNode(`sec-node-${docId}-${idx}`, "Section", secTitle, secTitle, {
        page_number: sec.page_number,
        section_number: sec.section_number,
        layer: hasRichDomainGraph ? "structural" : "primary"
      }, sec.page_number);
      addEdge(docLabel, "HAS_SECTION", secTitle, secTitle, sec.page_number);
    });

    // Connect orphaned entities ONLY if domain edges are sparse (< 4) or if not already connected to any domain node
    const connectedNames = new Set<string>();
    for (const e of edges) {
      connectedNames.add(e.source.toLowerCase());
      connectedNames.add(e.target.toLowerCase());
    }
    otherVerifiedEntities.slice(0, 10).forEach((ent, idx) => {
      const entLow = ent.name.toLowerCase();
      if (hasRichDomainGraph && connectedNames.has(entLow)) return;
      addNode(`ent-${docId}-${idx}`, ent.category, ent.name, ent.name, {
        page: ent.page_number,
        ...(hasRichDomainGraph ? { layer: "structural" } : {})
      }, ent.page_number);
      const targetSec = docSections.find((s) => s.section_title === ent.section_title)?.section_title || docLabel;
      if (nameToCanonical.has(targetSec.toLowerCase())) {
        addEdge(targetSec, "MENTIONS_ENTITY", ent.name, ent.name, ent.page_number);
      } else {
        addEdge(docLabel, "MENTIONS_ENTITY", ent.name, ent.name, ent.page_number);
      }
    });
  }

  return {
    nodes: Array.from(nodesMap.values()),
    edges
  };
}

export interface BuildDocumentInput {
  id: number;
  title: string;
  doc_type: string;
  storage_path: string;
  uploaded_at?: string;
  is_uploaded?: boolean;
  is_active?: boolean;
  pdf_base64?: string;
  content: string;
  pages?: PdfPageInput[];
  unparsed_pages?: number[];
  extraction_status?: "INDEXED" | "SCANNED_PDF_OCR_UNAVAILABLE" | "EXTRACTION_FAILED";
  extraction_notes?: string;
}

export function buildIndexedDocument(input: BuildDocumentInput): DemoDocument {
  const normalizedContent = sanitizePromptInjection((input.content || "").replace(/\r\n/g, "\n").trim());
  const pagesFingerprint = input.pages
    ? input.pages.map((p) => `${p.page_num}:${p.extraction || "text"}:${(p.raw_text || p.text).slice(0, 64)}`).join("|")
    : "";
  const sourceVersion = computeContentHash(`${normalizedContent}::${pagesFingerprint}`);
  const cacheKey = `${input.id}:${sourceVersion}`;

  const cached = indexCache.get(cacheKey);
  if (cached && cached.title === input.title) {
    return cached;
  }

  const rawPages: PageExtractionRecord[] =
    input.pages && input.pages.length > 0
      ? input.pages.map((p) => {
          const verbatim = sanitizePromptInjection((p.raw_text || p.text || "").replace(/\r\n/g, "\n").trim());
          const norm = sanitizePromptInjection(normalizePdfPageText(p.text || p.raw_text || ""));
          const alphaLen = (norm.match(/[a-zA-Z0-9]/g) || []).length;
          const extraction =
            p.extraction || (alphaLen < 15 ? "unparsed" : p.ocr_used ? "ocr" : "text");
          return {
            page_num: p.page_num,
            text: norm,
            raw_text: verbatim || norm,
            extraction,
            ocr_used: Boolean(p.ocr_used || extraction === "ocr"),
            parse_error: p.parse_error
          };
        })
      : normalizedContent
          .split(/\f|\n{3,}/)
          .map((t, idx) => {
            const cleaned = t.trim();
            const norm = normalizePdfPageText(cleaned);
            return {
              page_num: idx + 1,
              text: norm,
              raw_text: cleaned,
              extraction: (norm.match(/[a-zA-Z0-9]/g) || []).length >= 15 ? ("text" as const) : ("unparsed" as const),
              ocr_used: false
            };
          });

  const nonEmptyPages = rawPages.filter((p) => p.text.length > 0);
  const safePages = nonEmptyPages.length > 0 ? nonEmptyPages : [{ page_num: 1, text: normalizedContent }];

  const structuredTablesByPage = new Map<number, string[][][]>();
  if (input.pages) {
    for (const p of input.pages) {
      if (p.tables && p.tables.length > 0) {
        structuredTablesByPage.set(p.page_num, p.tables);
      }
    }
  }

  const atomicTableRows = extractAtomicTablesFromPages(input.id, rawPages, structuredTablesByPage);
  const unparsedPages = Array.from(
    new Set([
      ...(input.unparsed_pages || []),
      ...rawPages.filter((p) => p.extraction === "unparsed").map((p) => p.page_num)
    ])
  ).sort((a, b) => a - b);

  const rawSections = extractDocumentSections(safePages);

  // Build section-aware, non-mixing overlapping chunks
  const chunks: DocumentChunk[] = [];
  const sectionChunkMap = new Map<number, string[]>();
  let chunkIndex = 0;

  for (const sec of rawSections) {
    const paragraphs = sec.raw_text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 8);

    const grouped: string[] = [];
    let buffer = "";
    for (const para of paragraphs.length > 0 ? paragraphs : [sec.raw_text]) {
      if (buffer.length > 0 && buffer.length + para.length > 950) {
        grouped.push(buffer);
        const overlapLine = buffer.split("\n").slice(-1)[0] || "";
        buffer = overlapLine.length < 180 ? `${overlapLine}\n${para}` : para;
      } else {
        buffer = buffer ? `${buffer}\n\n${para}` : para;
      }
    }
    if (buffer) grouped.push(buffer);

    const secIds: string[] = [];
    for (const chunkText of grouped) {
      const chunkId = `doc-${input.id}-p${sec.page_number}-c${chunkIndex}`;
      const isTableContent =
        input.doc_type.toUpperCase() === "CSV" ||
        input.doc_type.toUpperCase() === "XLSX" ||
        (chunkText.match(/\|/g) || []).length >= 4 ||
        /^[^,\n]+(?:,[^,\n]+){2,}/m.test(chunkText);

      chunks.push({
        document_id: input.id,
        document_name: input.title,
        chunk_id: chunkId,
        chunk_index: chunkIndex,
        page_number: sec.page_number,
        section_title: sec.section_title,
        content: chunkText,
        text: chunkText,
        content_type: isTableContent ? "table" : "text",
        source_version: sourceVersion,
        vector: computeDenseVector(`${sec.section_title}\n${chunkText}`),
        metadata: {
          document_id: input.id,
          document_name: input.title,
          page_number: sec.page_number,
          section_title: sec.section_title,
          source_version: sourceVersion
        }
      });
      secIds.push(chunkId);
      chunkIndex++;
    }
    sectionChunkMap.set(sec.section_number, secIds);
  }

  const sections: DocumentSection[] = rawSections.map((s) => ({
    section_number: s.section_number,
    section_title: s.section_title,
    page_number: s.page_number,
    chunk_ids: sectionChunkMap.get(s.section_number) || [],
    raw_text: s.raw_text
  }));

  const sqlRecords = extractStructuredSqlRecords(
    input.id,
    sourceVersion,
    input.doc_type,
    normalizedContent,
    chunks,
    atomicTableRows
  );

  const graph = extractDocumentGraph(input.id, chunks, sqlRecords, normalizedContent, input.title, sections, atomicTableRows);

  const doc: DemoDocument = {
    id: input.id,
    title: input.title,
    doc_type: input.doc_type,
    storage_path: input.storage_path,
    uploaded_at: input.uploaded_at || new Date().toISOString(),
    is_uploaded: Boolean(input.is_uploaded),
    is_active: input.is_active !== false,
    pdf_base64: input.pdf_base64,
    source_version: sourceVersion,
    extraction_status: input.extraction_status || "INDEXED",
    extraction_notes: input.extraction_notes,
    content: normalizedContent,
    pages_count: Math.max(rawPages.length, safePages.length),
    raw_pages: rawPages,
    atomic_table_rows: atomicTableRows,
    unparsed_pages: unparsedPages,
    sections,
    chunks,
    sql_records: sqlRecords,
    graph_nodes: graph.nodes,
    graph_edges: graph.edges
  };

  indexCache.set(cacheKey, doc);
  return doc;
}
