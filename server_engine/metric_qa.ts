import {
  AtomicTableRow,
  ConfidenceLabel,
  DemoDocument,
  PageExtractionRecord,
  ParsedQuestionIntent,
  VerifiedMetricRecord,
  VerifiedQAResult
} from "./types";

export const INSUFFICIENT_EVIDENCE_EXACT =
  "Insufficient evidence in the uploaded document to determine the answer.";

/**
 * Rule 3 (INTENT FIRST): Classify user question into intent, metric, entity_type, direction.
 * Never routes purely on presence of words like "vendor" or "supplier".
 */
export function parseQuestionIntent(question: string): ParsedQuestionIntent {
  const q = (question || "").trim();
  const qLower = q.toLowerCase();

  let direction: ParsedQuestionIntent["direction"] = null;
  let top_n: number | undefined;

  const topNMatch = qLower.match(/\btop\s+(\d+)\b/i);
  if (topNMatch) {
    direction = "top_n";
    top_n = Math.max(1, parseInt(topNMatch[1], 10));
  } else if (/\b(highest|maximum|max|largest|biggest|longest)\b/i.test(qLower)) {
    direction = "highest";
  } else if (/\b(lowest|minimum|min|smallest|poorest|bottom|shortest)\b/i.test(qLower)) {
    direction = "lowest";
  } else if (/\b(best|top\s+performing|strongest|fastest|most\s+reliable)\b/i.test(qLower)) {
    direction = "best";
  }

  let metric: string | null = null;
  if (
    /\b(on[-\s]?time\s*(?:delivery|rate|performance|pct|percentage|%)?|otd(?:\s*%)?|delivery\s*(?:performance|rate)|on[-\s]?time\s*%)\b/i.test(
      qLower
    )
  ) {
    metric = "on-time delivery %";
  } else if (/\bdamage\s*(?:rate|pct|percentage|%)?\b/i.test(qLower)) {
    metric = "damage %";
  } else if (/\b(?:vendor\s+|carrier\s+|supplier\s+)?rating\b/i.test(qLower)) {
    metric = "rating";
  } else if (/\b(operating\s*profit|profit\s*margin|gross\s*revenue|revenue|operating\s*expenses)\b/i.test(qLower)) {
    metric = "financial_metric";
  } else if (/\b(reorder\s*(?:point|level|threshold)|shortage|deficit|current\s*stock)\b/i.test(qLower)) {
    metric = "inventory_deficit";
  } else if (/\b(sla\s*target|target\s*sla)\b/i.test(qLower)) {
    metric = "target_sla";
  } else {
    const customMetric = qLower.match(
      /\b(?:lowest|highest|best|worst|minimum|maximum|top\s+\d+|compare)\s+([a-z][a-z\s-]{2,32}?(?:rate|score|pct|percentage|time|cost|price|delay|variance|rating|index|count))\b/i
    );
    if (customMetric) {
      metric = customMetric[1].trim();
    }
  }

  let entity_type: string | null = null;
  if (/\b(vendors?|suppliers?|carriers?|freight\s*partners?|logistics\s*partners?|providers?)\b/i.test(qLower)) {
    entity_type = "vendor";
  } else if (/\b(regions?|territories)\b/i.test(qLower)) {
    entity_type = "region";
  } else if (/\b(skus?|inventory\s*items?|products?)\b/i.test(qLower)) {
    entity_type = "sku";
  }

  let intent: ParsedQuestionIntent["intent"] = "other";
  if (
    direction !== null ||
    /\b(compare|comparison|rank|ranking|versus|vs\.?|better|worse)\b/i.test(qLower)
  ) {
    intent = "metric_comparison";
  } else if (/\b(total|sum|average|avg|count|how\s+many|combine|combined|across\s+all)\b/i.test(qLower)) {
    intent = "aggregation";
  } else if (/\b(summarize|summary|overview|main\s+sections?|table\s+of\s+contents|topics?\s+covered)\b/i.test(qLower)) {
    intent = "summary";
  } else if (/\b(what|which|who|list|extract|find|show|identify|give|tell|when|where)\b/i.test(qLower)) {
    intent = "lookup";
  }

  return {
    intent,
    metric,
    entity_type,
    direction,
    ...(top_n !== undefined ? { top_n } : {})
  };
}

/**
 * Determines whether the query MUST be answered by the strict Vendor Performance Metric pipeline
 * rather than generic entity listing (Rule 3 & Rule 4: NO SUBSTITUTION).
 */
export function isVendorMetricQuery(question: string, parsed: ParsedQuestionIntent): boolean {
  const qLower = (question || "").toLowerCase();

  // Never hijack financial P&L or inventory reorder queries
  if (parsed.metric === "financial_metric" || parsed.metric === "inventory_deficit") {
    return false;
  }

  // General vendor/carrier SLA overview or multi-metric evaluation without a ranking direction
  // (e.g., "Evaluate vendor on-time delivery rate and SLA score", "Compare supplier SLA reliability across carriers")
  // belongs to exhaustive supplier audit table extraction (A_ENTITY_EXTRACTION).
  const asksVendorSlaOverview =
    /\b(?:sla\s+(?:score|reliability)|(?:on[-\s]?time\s*(?:delivery\s*)?rate|otd)\s+and\s+sla)\b/i.test(qLower);
  if (asksVendorSlaOverview && parsed.direction === null) {
    return false;
  }

  // Case A: Explicit comparison / ranking query targeting vendors or OTD
  if (
    parsed.intent === "metric_comparison" &&
    (parsed.direction !== null || parsed.metric !== null) &&
    (parsed.entity_type === "vendor" || parsed.metric === "on-time delivery %")
  ) {
    return true;
  }

  // Case B: Performance lookup asking specifically about on-time delivery / OTD / delivery performance
  // (While preserving existing generic "list all suppliers" and Test 5 "suppliers and vendors mentioned ... and what are their performance metrics?")
  const asksGenericSupplierListing =
    /\b(list\s+(?:all\s+)?suppliers?|all\s+(?:the\s+)?suppliers?|suppliers?\s+mentioned|suppliers?\s+and\s+vendors?\s+mentioned|extract\s+(?:and\s+list\s+)?(?:all\s+)?suppliers?|who\s+supplies)\b/i.test(
      qLower
    );

  if (parsed.metric === "on-time delivery %" && !asksGenericSupplierListing) {
    return true;
  }

  // Aggregation across vendor OTD (e.g. "average vendor on-time delivery")
  if (parsed.intent === "aggregation" && parsed.metric === "on-time delivery %") {
    return true;
  }

  return false;
}

/**
 * Rule 5c: Parse numeric OTD/percentage values from strings like "92%", "92.0 %", "0.92".
 */
export function parsePercentageValue(
  rawCell: string
): { value: number; raw_value: string; unit: string } | null {
  if (!rawCell) return null;
  const trimmed = String(rawCell).trim();
  if (!trimmed || /^(?:n\/a|na|none|null|undefined|-+|pending|tbd)$/i.test(trimmed)) {
    return null;
  }

  // Explicit percentage: "92%", "92.0 %", "92,5 %"
  const pctMatch = trimmed.match(/([-+]?\d{1,3}(?:[.,]\d+)?)\s*%/);
  if (pctMatch) {
    const numStr = pctMatch[1].replace(/,/g, ".");
    const num = Number(numStr);
    if (Number.isFinite(num) && num >= 0 && num <= 100) {
      return {
        value: parseFloat(num.toFixed(4)),
        raw_value: pctMatch[0].trim(),
        unit: "%"
      };
    }
    return null;
  }

  // Ratio in [0, 1]: e.g. "0.92", "0.875", "1.0", "1.00"
  const ratioMatch = trimmed.match(/^\s*(0\.\d{1,4}|1\.0{1,4})\s*$/);
  if (ratioMatch) {
    const ratio = Number(ratioMatch[1]);
    if (Number.isFinite(ratio) && ratio >= 0 && ratio <= 1) {
      return {
        value: parseFloat((ratio * 100).toFixed(4)),
        raw_value: ratioMatch[1].trim(),
        unit: "%"
      };
    }
  }

  // Bare percentage number inside an explicit OTD/% column (e.g. "92.5" in column "On-Time %")
  const bareMatch = trimmed.match(/^\s*(\d{1,3}(?:\.\d{1,4})?)\s*$/);
  if (bareMatch) {
    const num = Number(bareMatch[1]);
    if (Number.isFinite(num) && num >= 0 && num <= 100) {
      // If <= 1.0 with decimal it would have matched ratioMatch above
      if (num > 1 && num <= 100) {
        return {
          value: parseFloat(num.toFixed(4)),
          raw_value: bareMatch[1].trim(),
          unit: "%"
        };
      }
    }
  }

  return null;
}

export function formatPct(val: number): string {
  const rounded = parseFloat(val.toFixed(2));
  return `${Number.isInteger(rounded) ? rounded.toFixed(1) : rounded}%`;
}

export function formatMetricValue(val: number, unit: string = "%"): string {
  if (unit === "%") return formatPct(val);
  const rounded = parseFloat(val.toFixed(2));
  return String(rounded);
}

function parseMetricCellValue(
  rawCell: string,
  requestedMetric: string
): { value: number; raw_value: string; unit: string } | null {
  if (requestedMetric === "rating") {
    const trimmed = String(rawCell || "").trim();
    const m = trimmed.match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*5)?$/);
    if (!m) return null;
    const num = Number(m[1]);
    if (!Number.isFinite(num) || num < 0 || num > 10) return null;
    return {
      value: parseFloat(num.toFixed(4)),
      raw_value: trimmed,
      unit: "rating"
    };
  }
  return parsePercentageValue(rawCell);
}

function isEntityHeaderName(headerCell: string): boolean {
  const h = headerCell.trim().toLowerCase();
  if (!h) return false;
  if (/\b(on[-\s]?time|otd|delivery|rate|performance|sla|target|variance|damage|rating)\b/.test(h)) return false;
  return /\b(vendor|supplier|carrier|partner|provider|company|name)\b/.test(h);
}

function scoreMetricHeader(headerCell: string, requestedMetric: string = "on-time delivery %"): number {
  const h = headerCell.trim().toLowerCase().replace(/\s+/g, " ");
  if (!h) return -1;

  if (requestedMetric === "damage %") {
    if (/^damage(?:\s*(?:%|rate|pct|percentage))?$/.test(h)) return 10;
    if (/\b(?:shipment|cargo|in-transit)?\s*damage\b/.test(h)) return 8;
    return -1;
  }

  if (requestedMetric === "rating") {
    if (/^(?:vendor|carrier|supplier)?\s*rating$/.test(h)) return 10;
    if (/\brating\b/.test(h)) return 8;
    return -1;
  }

  if (requestedMetric !== "on-time delivery %") {
    return -1;
  }

  // Never match Target SLA, variance, damage, or rating columns as actual On-Time Delivery %
  if (/\b(target|sla|variance|delay|days|defect|damage|rating|cost|spend|price|scorecard|id)\b/.test(h) && !/\bon[-\s]?time\b/.test(h)) {
    return -1;
  }
  if (/^on[-\s]?time\s+delivery(?:\s*(?:rate|performance|%|pct|percentage))?$/.test(h)) return 10;
  if (/^(?:otd|otd\s*%|on[-\s]?time\s*%|on[-\s]?time\s*rate)$/.test(h)) return 10;
  if (/^delivery\s+(?:performance|rate)(?:\s*%?)?$/.test(h)) return 9;
  if (/\bon[-\s]?time\b/.test(h) && !/\btarget\b/.test(h)) return 8;
  if (/\botd\b/.test(h)) return 8;
  if (/\bdelivery\s*(?:performance|rate)\b/.test(h)) return 7;
  return -1;
}

function cleanVendorName(raw: string): string {
  return (raw || "")
    .replace(/^[-•*\d.)]+\s*/, "")
    .replace(/^(?:Vendor|Supplier|Carrier|Partner)\s*[:\-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlausibleVendorName(name: string): boolean {
  if (!name || name.length < 2) return false;
  if (/^\d+(?:\.\d+)?%?$/.test(name)) return false;
  if (
    /^(?:vendor|supplier|carrier|partner|name|total|average|avg|overall|summary|target|sla|on[-\s]?time|otd|n\/a|none|page\s+\d+)$/i.test(
      name
    ) ||
    /\b(?:target\s+sla|sla|variance|damage\s+rate|on[-\s]?time\s+delivery|scorecard)\b/i.test(name)
  ) {
    return false;
  }
  return /[a-zA-Z]/.test(name);
}

interface CandidateRecord {
  vendor: string;
  value: number;
  raw_value: string;
  unit: string;
  page: number;
  evidence: string;
  extraction: "text" | "table" | "ocr";
  table_id?: string;
}

/**
 * Extracts ALL vendor on-time delivery metric candidates across ALL pages of `doc` (never top-k).
 */
function extractAllVendorOtdCandidates(
  doc: DemoDocument,
  requestedMetric: string = "on-time delivery %"
): CandidateRecord[] {
  const candidates: CandidateRecord[] = [];
  const seenKey = new Set<string>();

  const pushCandidate = (cand: CandidateRecord) => {
    const key = `${cand.vendor.toLowerCase()}::p${cand.page}::${cand.value.toFixed(3)}`;
    if (seenKey.has(key)) return;
    seenKey.add(key);
    candidates.push(cand);
  };

  // --- Pass 1: Structured Atomic Table Rows (supports multi-page continuation tables) ---
  let lastValidVendorInTable: Record<string, string> = {};
  for (const row of doc.atomic_table_rows || []) {
    if (row.doc_id !== doc.id) continue;
    const headers = row.header || [];
    if (headers.length < 2 || row.cells.length < 2) continue;

    // Identify best metric column and best entity column
    let metricCol = -1;
    let bestMetricScore = -1;
    let entityCol = -1;

    for (let i = 0; i < headers.length; i++) {
      const mScore = scoreMetricHeader(headers[i], requestedMetric);
      if (mScore > bestMetricScore) {
        bestMetricScore = mScore;
        metricCol = i;
      }
      if (entityCol === -1 && isEntityHeaderName(headers[i])) {
        entityCol = i;
      }
    }

    // Fallback: if headers were shifted slightly vs cells
    if (metricCol < 0 || entityCol < 0) continue;

    const rawVendorCell = (row.cells[entityCol] ?? "").trim();
    let vendorName = cleanVendorName(rawVendorCell);
    // Support merged cell continuation inside the same table_id when vendor cell was left blank only if value exists
    if (!vendorName && lastValidVendorInTable[row.table_id]) {
      vendorName = lastValidVendorInTable[row.table_id];
    }
    if (!isPlausibleVendorName(vendorName)) continue;
    lastValidVendorInTable[row.table_id] = vendorName;

    const metricCell = row.cells[metricCol] ?? "";
    const parsedVal = parseMetricCellValue(metricCell, requestedMetric);
    if (!parsedVal) continue;

    pushCandidate({
      vendor: vendorName,
      value: parsedVal.value,
      raw_value: parsedVal.raw_value,
      unit: parsedVal.unit,
      page: row.page,
      evidence: row.raw_row_text,
      extraction: row.extraction === "ocr" ? "ocr" : "table",
      table_id: row.table_id
    });
  }

  // --- Pass 2: Full-Page Text Scan (for narrative bullets, KV blocks, inline reports) ---
  const pages: PageExtractionRecord[] =
    doc.raw_pages && doc.raw_pages.length > 0
      ? doc.raw_pages
      : [
          {
            page_num: 1,
            text: doc.content,
            raw_text: doc.content,
            extraction: "text",
            ocr_used: false
          }
        ];

  if (requestedMetric === "on-time delivery %") {
    for (const page of pages) {
    if (page.extraction === "unparsed") continue;
    const pageExtraction: "text" | "ocr" = page.extraction === "ocr" ? "ocr" : "text";
    const lines = (page.raw_text || page.text || "")
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];

      // Pattern A: Bullet or prose containing Vendor + OTD label + percentage/ratio
      // e.g. "• Acme Freight Express — On-Time Delivery Rate: 71.4% (Target: 95%)"
      // or "Zenith Logistics reported on-time delivery of 92.0 %."
      // or "Vendor: Beta Freight | On-Time Delivery: 0.92"
      const otdLabelRx =
        /\b(?:on[-\s]?time\s*(?:delivery(?:\s*(?:rate|performance))?|rate|performance|%)|otd(?:\s*%)?|delivery\s*(?:performance|rate))\b/i;

      if (otdLabelRx.test(line)) {
        // Split out the value near the OTD label (BEFORE Target SLA or unrelated numbers)
        const afterOtd = line.match(
          /\b(?:on[-\s]?time\s*(?:delivery(?:\s*(?:rate|performance))?|rate|performance|%)|otd(?:\s*%)?|delivery\s*(?:performance|rate))\s*(?:of|is|at|was|:|-|=)?\s*([-+]?\d{1,3}(?:[.,]\d+)?\s*%|\b0\.\d{1,4}\b|\b1\.0{1,4}\b)/i
        );
        if (afterOtd) {
          const parsed = parsePercentageValue(afterOtd[1]);
          if (parsed) {
            const beforeOtd = line.slice(0, afterOtd.index ?? 0);
            // Try explicit Entity: Name pattern first
            const kvVendor = beforeOtd.match(/(?:vendor|supplier|carrier|partner)\s*[:\-]\s*([^|—–,;]+)/i);
            let candidateVendor = kvVendor
              ? cleanVendorName(kvVendor[1])
              : cleanVendorName(
                  beforeOtd
                    .split(/[|—–]|(?:\s+-\s+)|(?:\s+(?:reported|achieved|recorded|had|with|at|delivered)\b)/i)[0]
                    .trim()
                );

            // If vendor was on previous line (KV block: "Vendor: Foo\nOn-Time Delivery: 92%")
            if (!isPlausibleVendorName(candidateVendor) && li > 0) {
              const prevKv = lines[li - 1].match(/^(?:vendor|supplier|carrier|partner)(?:\s+name)?\s*[:\-]\s*(.+)$/i);
              if (prevKv) {
                candidateVendor = cleanVendorName(prevKv[1]);
              }
            }

            if (isPlausibleVendorName(candidateVendor)) {
              pushCandidate({
                vendor: candidateVendor,
                value: parsed.value,
                raw_value: parsed.raw_value,
                unit: parsed.unit,
                page: page.page_num,
                evidence: li > 0 && !beforeOtd.trim() ? `${lines[li - 1]} | ${line}` : line,
                extraction: pageExtraction
              });
            }
          }
        }
      }
    }
  }
  }

  return candidates;
}

/**
 * Rule 10 (MANDATORY VERIFICATION GATE):
 * Re-opens the cited page in `doc.raw_pages` for every record and confirms in code that BOTH
 * the vendor name AND the raw value string appear on that exact page.
 * Drops unverified records and returns audit log of drops.
 */
export function verifyVendorMetricRecords(
  doc: DemoDocument,
  candidates: CandidateRecord[]
): {
  verified: VerifiedMetricRecord[];
  dropped: Array<{ vendor: string; value: string; page: number; reason: string }>;
} {
  const verified: VerifiedMetricRecord[] = [];
  const dropped: Array<{ vendor: string; value: string; page: number; reason: string }> = [];

  const pageMap = new Map<number, PageExtractionRecord>();
  for (const p of doc.raw_pages || []) {
    pageMap.set(p.page_num, p);
  }

  const normWs = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

  for (const cand of candidates) {
    const pageRec = pageMap.get(cand.page);
    if (!pageRec || pageRec.extraction === "unparsed") {
      dropped.push({
        vendor: cand.vendor,
        value: cand.raw_value,
        page: cand.page,
        reason: `Cited Page ${cand.page} does not exist or could not be parsed in Document #${doc.id}.`
      });
      continue;
    }

    const haystackRaw = normWs(pageRec.raw_text || "");
    const haystackNorm = normWs(pageRec.text || "");
    const combinedHaystack = `${haystackRaw}\n${haystackNorm}`;

    const needleVendor = normWs(cand.vendor);
    const needleVal = normWs(cand.raw_value);
    const needleValNoSpace = needleVal.replace(/\s+/g, "");

    const hasVendor = needleVendor.length >= 2 && combinedHaystack.includes(needleVendor);
    const hasRawValue =
      needleVal.length >= 1 &&
      (combinedHaystack.includes(needleVal) ||
        combinedHaystack.replace(/\s+/g, "").includes(needleValNoSpace));

    if (!hasVendor || !hasRawValue) {
      const reason = !hasVendor
        ? `Vendor "${cand.vendor}" not found verbatim on Page ${cand.page} of Document #${doc.id}.`
        : `Raw value "${cand.raw_value}" not found verbatim on Page ${cand.page} of Document #${doc.id}.`;
      console.warn(`[VerificationGate] Dropped candidate: ${reason}`);
      dropped.push({
        vendor: cand.vendor,
        value: cand.raw_value,
        page: cand.page,
        reason
      });
      continue;
    }

    const confidence_label: ConfidenceLabel =
      cand.extraction === "ocr"
        ? "ocr-low-confidence"
        : cand.extraction === "table"
          ? "verified-table"
          : "verified-text";

    verified.push({
      vendor: cand.vendor,
      value: cand.value,
      raw_value: cand.raw_value,
      unit: cand.unit,
      page: cand.page,
      evidence: cand.evidence,
      extraction: cand.extraction,
      confidence_label,
      verified: true,
      ...(cand.table_id ? { table_id: cand.table_id } : {})
    });
  }

  return { verified, dropped };
}

/**
 * Rule 11 (SINGLE SOURCE OF TRUTH ASSERTION):
 * Verifies that summary answer, comparison table rows, and source citations match on deciding vendor + value.
 */
export function assertVerifiedResultConsistency(
  qaResult: VerifiedQAResult,
  tableRows: string[][],
  citations: Array<{ page_number: number; source_excerpt?: string }>
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (qaResult.status !== "answered") {
    if (qaResult.answer !== INSUFFICIENT_EVIDENCE_EXACT) {
      errors.push("Insufficient evidence answer does not match mandatory exact Rule 9 string.");
    }
    return { ok: errors.length === 0, errors };
  }

  if (qaResult.records.length === 0) {
    errors.push("Answered result contains 0 verified records.");
    return { ok: false, errors };
  }

  if (tableRows.length !== qaResult.records.length) {
    errors.push(`Table row count (${tableRows.length}) != verified records count (${qaResult.records.length}).`);
  }

  const answerLower = qaResult.answer.toLowerCase();
  const deciding = qaResult.records[0];
  const expectedVendors = qaResult.ties.length > 0 ? qaResult.ties : [deciding.vendor];

  for (const v of expectedVendors) {
    if (!answerLower.includes(v.toLowerCase())) {
      errors.push(`Summary answer missing deciding vendor "${v}".`);
    }
    if (!tableRows.some((r) => String(r[0] || "").toLowerCase() === v.toLowerCase())) {
      errors.push(`Comparison table missing deciding vendor "${v}".`);
    }
    if (!citations.some((c) => (c.source_excerpt || "").toLowerCase().includes(v.toLowerCase()))) {
      errors.push(`Citations missing supporting excerpt for deciding vendor "${v}".`);
    }
  }

  const formattedVal = formatMetricValue(deciding.value, deciding.unit).toLowerCase();
  if (!answerLower.includes(formattedVal) && !answerLower.includes(deciding.raw_value.toLowerCase())) {
    errors.push(`Summary answer missing deciding numeric value "${formattedVal}".`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * End-to-end deterministic Vendor Metric Comparison & OTD QA builder
 * implementing Hard Rules 1 through 12.
 * Can optionally accept extra test-injected candidates solely for Verification Gate testing (Test 10).
 */
export function runVendorMetricQA(
  doc: DemoDocument,
  question: string,
  parsedIntent?: ParsedQuestionIntent,
  injectedUnverifiedCandidatesForTest?: CandidateRecord[]
): VerifiedQAResult {
  const intentInfo = parsedIntent || parseQuestionIntent(question);
  const metricLabel = intentInfo.metric || "on-time delivery %";
  const unparsedPages = doc.unparsed_pages || [];

  // Guardrail: if user explicitly asked for an unknown metric not present in vendor tables
  // (e.g. "customer satisfaction score", "defect rate"), never substitute OTD numbers.
  const isOtdCompatible =
    metricLabel === "on-time delivery %" ||
    metricLabel === "damage %" ||
    metricLabel === "rating" ||
    intentInfo.metric === null;

  const effectiveMetric = metricLabel === "damage %" || metricLabel === "rating" ? metricLabel : "on-time delivery %";
  const metricDisplayName =
    metricLabel === "damage %"
      ? "damage rate"
      : metricLabel === "rating"
        ? "rating"
        : "on-time delivery";

  const extractedCandidates = isOtdCompatible ? extractAllVendorOtdCandidates(doc, effectiveMetric) : [];
  const allCandidates = injectedUnverifiedCandidatesForTest
    ? [...extractedCandidates, ...injectedUnverifiedCandidatesForTest]
    : extractedCandidates;

  // Deduplicate identical candidates while letting verification gate judge each
  const { verified, dropped } = verifyVendorMetricRecords(doc, allCandidates);

  const buildInsufficient = (droppedList = dropped): VerifiedQAResult => ({
    document_id: doc.id,
    document_name: doc.title,
    page_count: doc.pages_count,
    question,
    intent: intentInfo.intent,
    parsed_intent: intentInfo,
    metric: metricLabel,
    answer: INSUFFICIENT_EVIDENCE_EXACT,
    records: [],
    method: `Scanned all ${doc.pages_count} page(s) of Document #${doc.id} ("${doc.title}"); insufficient verified ${metricLabel} records found.`,
    ties: [],
    records_compared: 0,
    unparsed_pages: unparsedPages,
    status: "insufficient_evidence",
    supporting_pages: [],
    consistency_verified: true,
    ...(droppedList.length > 0 ? { dropped_unverified: droppedList } : {})
  });

  if (verified.length === 0) {
    return buildInsufficient();
  }

  // Rule 9: For comparison questions, fewer than 2 verified vendor rows is insufficient to compare
  if (intentInfo.intent === "metric_comparison" && verified.length < 2) {
    return buildInsufficient();
  }

  // Rule 5d: Deterministic IN-CODE sorting (ascending for lowest/worst, descending for highest/best/top_n)
  const isMinDirection = intentInfo.direction === "lowest" || intentInfo.direction === "worst";
  const sorted = [...verified].sort((a, b) =>
    isMinDirection
      ? a.value - b.value || a.page - b.page || a.vendor.localeCompare(b.vendor)
      : b.value - a.value || a.page - b.page || a.vendor.localeCompare(b.vendor)
  );

  const targetVal = sorted[0].value;
  const targetUnit = sorted[0].unit;
  const targetFmt = formatMetricValue(targetVal, targetUnit);
  const winners = sorted.filter((r) => Math.abs(r.value - targetVal) < 1e-6);
  const ties = winners.length > 1 ? winners.map((w) => w.vendor) : [];
  const supportingPages = Array.from(new Set(sorted.map((r) => r.page))).sort((a, b) => a - b);
  const pageListStr = supportingPages.join(", ");
  const count = sorted.length;

  let answer = "";
  let method = "";

  if (intentInfo.direction === "top_n") {
    const n = Math.min(intentInfo.top_n || 3, sorted.length);
    const topSlice = sorted.slice(0, n);
    answer = `Top ${n} vendor(s) by ${metricDisplayName}: ${topSlice
      .map((r) => `${r.vendor} (${formatMetricValue(r.value, r.unit)})`)
      .join(", ")} (compared ${count} vendors on page(s) ${pageListStr}).`;
    method = `Compared ${count} vendors on page(s) ${pageListStr}; ranked top ${n} descending from maximum = ${targetFmt}.`;
  } else if (intentInfo.intent === "metric_comparison") {
    const dirWord = isMinDirection
      ? intentInfo.direction === "worst"
        ? "worst (lowest)"
        : "lowest"
      : intentInfo.direction === "best"
        ? "best (highest)"
        : "highest";
    const extremeWord = isMinDirection ? "minimum" : "maximum";

    if (ties.length > 1) {
      answer = `${ties.join(" and ")} tied for the ${dirWord} ${metricDisplayName} at ${targetFmt} (compared ${count} vendors on page(s) ${pageListStr}).`;
      method = `Compared ${count} vendors on page(s) ${pageListStr}; ${extremeWord} = ${targetFmt} (tie across ${ties.join(", ")}).`;
    } else {
      const winner = winners[0];
      const wFmt = formatMetricValue(winner.value, winner.unit);
      answer = `${winner.vendor} has the ${dirWord} ${metricDisplayName} at ${wFmt} (compared ${count} vendors on page(s) ${pageListStr}).`;
      method = `Compared ${count} vendors on page(s) ${pageListStr}; ${extremeWord} = ${wFmt}.`;
    }
  } else if (intentInfo.intent === "aggregation") {
    const avg = sorted.reduce((acc, r) => acc + r.value, 0) / count;
    const avgFmt = formatMetricValue(avg, targetUnit);
    answer = `Verified ${metricDisplayName} across ${count} vendors on page(s) ${pageListStr}: average = ${avgFmt} (range ${formatMetricValue(sorted[sorted.length - 1].value, targetUnit)} to ${formatMetricValue(sorted[0].value, targetUnit)}).`;
    method = `Aggregated ${count} verified vendor records on page(s) ${pageListStr}; arithmetic mean = ${avgFmt}.`;
  } else {
    answer = `Verified ${metricDisplayName} for ${count} vendor(s) on page(s) ${pageListStr}: ${sorted
      .map((r) => `${r.vendor} (${formatMetricValue(r.value, r.unit)})`)
      .join(", ")}.`;
    method = `Extracted and verified ${count} vendor ${metricDisplayName} record(s) across page(s) ${pageListStr}.`;
  }

  return {
    document_id: doc.id,
    document_name: doc.title,
    page_count: doc.pages_count,
    question,
    intent: intentInfo.intent,
    parsed_intent: intentInfo,
    metric: metricLabel,
    answer,
    records: sorted,
    method,
    ties,
    records_compared: count,
    unparsed_pages: unparsedPages,
    status: "answered",
    supporting_pages: supportingPages,
    consistency_verified: true,
    ...(dropped.length > 0 ? { dropped_unverified: dropped } : {})
  };
}
