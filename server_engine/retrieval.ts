import {
  computeDenseVector,
  cosineSimilarity,
  extractInventoryRecordsFromDoc,
  extractRegionalFinancialRecordsFromDoc,
  extractSuppliersFromText
} from "./ingestion";
import { isVendorMetricQuery, parseQuestionIntent } from "./metric_qa";
import {
  DemoDocument,
  QueryCategory,
  QueryClassificationResult,
  RetrievedChunkResult
} from "./types";

const STOP_WORDS = new Set([
  "what", "where", "when", "which", "who", "whom", "whose", "why", "how",
  "are", "is", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "can", "could", "should", "would", "shall", "will",
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "about", "into", "through", "during",
  "before", "after", "above", "below", "between", "under", "again", "further",
  "then", "once", "here", "there", "all", "any", "both", "each", "few",
  "more", "most", "other", "some", "such", "no", "nor", "not", "only",
  "own", "same", "so", "than", "too", "very", "just", "now", "document",
  "selected", "uploaded", "mentioned", "their", "this", "that", "give", "tell",
  "show", "find", "extract", "list", "identify", "analyze", "please", "pdf",
  "file", "covered", "company", "report"
]);

/**
 * 11-Category Query Classifier (Categories A through K) with strict missing-entity
 * and missing-attribute detection (e.g. CEO vs Chief Operating Officer, Contract Value).
 */
export function classifyUserQuery(
  question: string,
  doc: DemoDocument
): QueryClassificationResult {
  const q = (question || "").trim();
  const qLower = q.toLowerCase();
  const docLower = (doc.content || "").toLowerCase();
  const parsedIntent = parseQuestionIntent(q);

  // --- CATEGORY K: Missing Information / Out-of-Scope Detection ---
  const missingEntities: string[] = [];

  // Role distinction checks (do NOT confuse COO with CEO, etc.)
  const executiveRoles: Array<{ regex: RegExp; presentRegex: RegExp; label: string }> = [
    { regex: /\b(ceo|chief\s+executive\s+officer)\b/i, presentRegex: /\b(ceo|chief\s+executive\s+officer)\b/i, label: "CEO (Chief Executive Officer)" },
    { regex: /\b(cfo|chief\s+financial\s+officer)\b/i, presentRegex: /\b(cfo|chief\s+financial\s+officer)\b/i, label: "CFO (Chief Financial Officer)" },
    { regex: /\b(cto|chief\s+technology\s+officer)\b/i, presentRegex: /\b(cto|chief\s+technology\s+officer)\b/i, label: "CTO (Chief Technology Officer)" },
    { regex: /\b(coo|chief\s+operating\s+officer)\b/i, presentRegex: /\b(coo|chief\s+operating\s+officer)\b/i, label: "COO (Chief Operating Officer)" }
  ];

  for (const role of executiveRoles) {
    if (role.regex.test(qLower) && !role.presentRegex.test(docLower)) {
      missingEntities.push(role.label);
    }
  }

  // Specific attribute checks (e.g. contract value / pricing / SLA fee not present in doc)
  if (/\bcontract\s+value\b|\bcontract\s+amount\b|\btotal\s+contract\s+price\b/i.test(qLower)) {
    const hasContractValue =
      /\bcontract\s+value\b|\bannual\s+contract\b|\bcontract\s+amount\b/i.test(docLower) ||
      (/\bcontract\b/i.test(docLower) && /(?:inr|\$|usd|eur)\s*[\d,]+/i.test(docLower) && !/region:\s*north/i.test(docLower));
    if (!hasContractValue) {
      missingEntities.push("Supplier Contract Value");
    }
  }

  // Explicit named entities like Product X, Region A, Supplier Y, Cohort B (case-sensitive code suffix!)
  const affirmativeDocText = (doc.content || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((s) => !/\b(does\s+not\s+contain|no\s+records?\s+(?:found|present|available)|not\s+present|none\s+found)\b/i.test(s))
    .join("\n")
    .toLowerCase();
  const sqlBlobLower = JSON.stringify(doc.sql_records || []).toLowerCase();

  const namedCodes =
    q.match(/\b(?:(?:Product|Region|Supplier|Cohort)\s+(?:[A-Z]\b|[A-Z0-9]{1,3}\d|\d+)|(?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-\d+)\b/g) ||
    [];
  for (const code of namedCodes) {
    const codeLow = code.toLowerCase();
    if (!affirmativeDocText.includes(codeLow) && !sqlBlobLower.includes(codeLow)) {
      missingEntities.push(code);
    }
  }

  if (missingEntities.length > 0) {
    return {
      category: "K_MISSING_INFO_DETECTION",
      is_missing_or_out_of_scope: true,
      missing_entities: Array.from(new Set(missingEntities)),
      requires_exhaustive_scan: true,
      needs_sql: doc.sql_records.length > 0,
      needs_graph: false,
      reasoning: `Checked active document #${doc.id} ("${doc.title}") exhaustively; requested attribute/entity (${missingEntities.join(", ")}) is not present in the source document.`,
      target_section_keywords: [],
      excluded_section_keywords: [],
      parsed_intent: parsedIntent
    };
  }

  const isCausalQuery =
    /\b(what\s+caused|why\s+(?:did|was|were|is|are)|root\s*causes?|causes?\s+of|mismatch(?:es)?|discrepanc(?:y|ies)|reason\s+for)\b/i.test(
      qLower
    );
  const isMultiAspectSynthesis =
    /\bconnect\s+all\s+details\b|\ball\s+details\s+(?:across|regarding)\b|\bacross\s+(?:the\s+)?documents?\b/i.test(qLower) ||
    (/\broot\s*causes?\b/i.test(qLower) && /\b(?:cost\s+impact|delay\s+duration|vendor\s+audit)\b/i.test(qLower));

  if (isMultiAspectSynthesis) {
    return {
      category: "F_ROOT_CAUSE_DIAGNOSIS",
      is_missing_or_out_of_scope: false,
      missing_entities: [],
      requires_exhaustive_scan: true,
      needs_sql: doc.sql_records.length > 0,
      needs_graph: doc.graph_edges.length > 0,
      reasoning:
        "User requested cross-section synthesis connecting multiple operational facets (delays, costs, root causes, and audit findings).",
      target_section_keywords: [],
      excluded_section_keywords: [],
      parsed_intent: parsedIntent
    };
  }

  // --- CATEGORY B: Section Heading / Document Structure Listing ---
  if (
    /\b(main\s+sections?|sections?\s+covered|table\s+of\s+contents|document\s+sections?|chapters?|headings?\s+in\s+(?:this|the)\s+(?:pdf|document)|what\s+topics?\s+(?:are\s+)?covered)\b/i.test(qLower)
  ) {
    return {
      category: "B_SECTION_HEADING_LISTING",
      is_missing_or_out_of_scope: false,
      missing_entities: [],
      requires_exhaustive_scan: true,
      needs_sql: false,
      needs_graph: false,
      reasoning: "User requested an exhaustive list of all main sections and topics covered in the active document.",
      target_section_keywords: [],
      excluded_section_keywords: []
    };
  }

  // --- CATEGORY C: Meeting Action Items / Owners & Deadlines ---
  if (
    /\b(meeting\s*action\s*items?|action\s*items?|owners?\s*(?:,|and)\s*(?:due\s*dates?|deadlines?)|meeting\s*(?:minutes|notes)|who\s+is\s+responsible|deadlines?|tasks?\b[^.?!]*\b(?:due|owners?|meeting))\b/i.test(qLower)
  ) {
    return {
      category: "C_ACTION_ITEM_EXTRACTION",
      is_missing_or_out_of_scope: false,
      missing_entities: [],
      requires_exhaustive_scan: /\ball\b/i.test(qLower),
      needs_sql: doc.sql_records.some((r) => r.table_name === "meeting_action_items"),
      needs_graph: false,
      reasoning: "User requested structured extraction of meeting action items with owners and deadlines.",
      target_section_keywords: ["meeting", "minutes", "action item"],
      excluded_section_keywords: ["vendor performance", "p&l", "inventory", "financial", "revenue", "profit"]
    };
  }

  // --- FINANCIAL COMPARATIVE ANALYSIS & P&L ---
  if (
    /\b(regional\s*financial\s*performance|financial\s*(?:performance(?:\s*analysis)?|comparative(?:\s*analysis)?|comparison|results)|compare\s+regional\s+revenue|regional\s*operating\s*profit|total\s+operating\s+profit|operating\s+profit\s+across|september(?:\s+\d{4})?\s*financial|gross\s*revenue.*operating\s*expenses|profit\s*margins?\s*by\s*region|regional\s*financial|financially|profitability|operating\s*income|net\s*income)\b/i.test(qLower) ||
    (/\b(regional|regions?)\b/i.test(qLower) && /\b(revenue|profit|expenses|margins?|financial|financially)\b/i.test(qLower)) ||
    (/\b(operating\s*profit|operating\s*expenses|gross\s*revenue)\b/i.test(qLower) && /\b(regions?|regional|september)\b/i.test(qLower)) ||
    /\b(operating\s*profit|highest\s*operating\s*profit|profit\s*in\s*september|september\s*profit|regional\s*operating\s*profit|p&l|gross\s*revenue|operating\s*expenses|profit\s*margins?|margins?|financial\s*review|revenue)\b/i.test(qLower)
  ) {
    const hasFinRecords =
      doc.sql_records.some((r) => r.table_name === "regional_p_and_l" || r.table_name === "uploaded_csv_metrics") ||
      extractRegionalFinancialRecordsFromDoc(doc).length > 0;
    return {
      category: "FINANCIAL_COMPARATIVE_ANALYSIS",
      is_missing_or_out_of_scope: false,
      missing_entities: [],
      requires_exhaustive_scan: true,
      needs_sql: hasFinRecords,
      needs_graph: false,
      reasoning: "User requested regional financial comparative analysis including region, revenue, operating expenses, operating profit, profit margin, and reporting period.",
      target_section_keywords: ["financial", "p&l", "profit", "revenue", "margin", "expenses", "september", "region"],
      excluded_section_keywords: ["meeting", "action items", "minutes", "vendor performance"]
    };
  }

  // --- CATEGORY E: Inventory Threshold & Reorder Point Check ---
  if (
    !isCausalQuery &&
    /\b(reorder\s*(?:points?|thresholds?|levels?)|(?:below|above)\s*(?:their\s*)?reorder|inventory\s*(?:items?|skus?|status|records?|levels?|table|list)?|stock\s*(?:levels?|shortages?|deficits?)|stockouts?|(?:[a-z]{2,6}-)*(?:sku|item|part|mat)-\d+|largest\s+shortage|total\s+replenishment|shortage|replenishment|bring\s+all\s+below|units\s+(?:required|needed)\s+to)\b/i.test(qLower)
  ) {
    const hasInvRecords =
      doc.sql_records.some((r) => r.table_name === "inventory_status" || r.table_name === "uploaded_csv_metrics") ||
      extractInventoryRecordsFromDoc(doc).length > 0;
    return {
      category: "E_INVENTORY_THRESHOLD_CHECK",
      is_missing_or_out_of_scope: false,
      missing_entities: [],
      requires_exhaustive_scan: true,
      needs_sql: hasInvRecords,
      needs_graph: false,
      reasoning: "User requested deterministic threshold evaluation, shortage ranking, or replenishment calculation over inventory SKUs and reorder points.",
      target_section_keywords: ["inventory", "reorder", "sku", "stock", "deficit", "shortage"],
      excluded_section_keywords: ["meeting", "vendor performance", "p&l"]
    };
  }

  // --- RULE 3 & 4 (INTENT FIRST): Vendor Performance Metric Comparison / OTD Ranking ---
  // Runs BEFORE A_ENTITY_EXTRACTION so vendor performance comparison questions NEVER fall back to generic supplier lists!
  if (isVendorMetricQuery(q, parsedIntent)) {
    return {
      category: "I_COMPARISON_RANKING",
      is_missing_or_out_of_scope: false,
      missing_entities: [],
      requires_exhaustive_scan: true,
      needs_sql: doc.sql_records.some((r) => r.table_name === "vendor_performance"),
      needs_graph: false,
      reasoning: `Intent-first routing (${parsedIntent.intent}, metric=${parsedIntent.metric || "performance"}, direction=${parsedIntent.direction || "none"}) dispatched to exhaustive all-page metric comparison pipeline.`,
      target_section_keywords: ["vendor", "supplier", "carrier", "on-time", "otd", "delivery", "performance", "rate"],
      excluded_section_keywords: ["meeting", "action items", "minutes"],
      parsed_intent: parsedIntent
    };
  }

  // --- CATEGORY A: Entity Extraction (Suppliers, Vendors, Carriers, Stakeholders) ---
  if (
    !isCausalQuery &&
    /\b(suppliers?|vendors?|carriers?|freight\s*(?:carriers?|partners?|express)?|logistics\s*partners?|who\s*supplies|sourcing|delivery\s*(?:rates?|performance)|vendor\s*audit|carrier\s*issues?|sla\s*breach(?:es)?)\b/i.test(qLower)
  ) {
    return {
      category: "A_ENTITY_EXTRACTION",
      is_missing_or_out_of_scope: false,
      missing_entities: [],
      requires_exhaustive_scan: true, // Scan whole document so no supplier in any section is missed
      needs_sql: doc.sql_records.some((r) => r.table_name === "vendor_performance"),
      needs_graph: doc.graph_edges.length > 0,
      reasoning: "User requested exhaustive extraction and metrics verification of all suppliers/vendors/carriers in the active document.",
      target_section_keywords: ["vendor", "supplier", "carrier", "freight", "transit", "delivery", "sla"],
      excluded_section_keywords: ["meeting", "action items", "p&l", "post-mortem", "inventory", "summary", "throughput", "governance"],
      parsed_intent: parsedIntent
    };
  }

  // --- CATEGORY J: Recommendation Extraction (explicit recommendations check runs before Root Cause so "recommendations to fix delays" routes cleanly) ---
  if (/\b(recommendations?|recommended\s+actions?|mitigation|how\s+to\s+fix|next\s+steps)\b/i.test(qLower)) {
    return {
      category: "J_RECOMMENDATION_EXTRACTION",
      is_missing_or_out_of_scope: false,
      missing_entities: [],
      requires_exhaustive_scan: true,
      needs_sql: false,
      needs_graph: false,
      reasoning: "User requested extraction of documented recommendations clearly separated from raw factual assertions.",
      target_section_keywords: ["recommendation", "recommended", "action", "recovery"],
      excluded_section_keywords: []
    };
  }

  // --- CATEGORY F: Root Cause Diagnosis ---
  if (
    isCausalQuery ||
    /\b(root\s*causes?|why\s+did|post-mortem|delay\s*(?:causes?|reasons?)|bottlenecks?|cross-dock|drop(?:ped)?|decline|adverse\s*events?)\b/i.test(qLower)
  ) {
    const mentionsInventory = /\b(inventory|sku|stock|mismatch|packaging|reorder)\b/i.test(qLower);
    const mentionsVendor = /\b(supplier|vendor|carrier|audit|sla)\b/i.test(qLower);
    const defaultExcludes = ["meeting", "action items", "p&l"];
    if (!mentionsInventory) defaultExcludes.push("inventory");
    if (!mentionsVendor) defaultExcludes.push("vendor");

    return {
      category: "F_ROOT_CAUSE_DIAGNOSIS",
      is_missing_or_out_of_scope: false,
      missing_entities: [],
      requires_exhaustive_scan: mentionsInventory || isMultiAspectSynthesis || /\b(?:sku|item|part|mat)-\d+/i.test(qLower),
      needs_sql: doc.sql_records.length > 0 && (mentionsInventory || /\bsales|revenue|margin|variance\b/i.test(qLower)),
      needs_graph: doc.graph_edges.length > 0,
      reasoning: "User requested causal root-cause diagnosis grounded in document findings and graph topology.",
      target_section_keywords: [
        "root cause",
        "post-mortem",
        "delay",
        "incident",
        "latency",
        "adverse",
        "endpoint",
        ...(mentionsInventory ? ["inventory", "mismatch", "sku", "audit"] : [])
      ],
      excluded_section_keywords: defaultExcludes
    };
  }

  // --- CATEGORY G: Relationship / GraphRAG Query ---
  if (/\b(graph|neo4j|relationships?|connected|dependency|dependencies|linked|path)\b/i.test(qLower)) {
    return {
      category: "G_RELATIONSHIP_GRAPHRAG_QUERY",
      is_missing_or_out_of_scope: false,
      missing_entities: [],
      requires_exhaustive_scan: true,
      needs_sql: false,
      needs_graph: true,
      reasoning: "User explicitly requested entity relationship and provenance-verified graph traversal.",
      target_section_keywords: [],
      excluded_section_keywords: []
    };
  }

  // --- CATEGORY I: Comparison / Ranking ---
  if (/\b(compare|comparison|highest|lowest|longest|shortest|rank|best|worst|top\s+\d+)\b/i.test(qLower)) {
    return {
      category: "I_COMPARISON_RANKING",
      is_missing_or_out_of_scope: false,
      missing_entities: [],
      requires_exhaustive_scan: true,
      needs_sql: doc.sql_records.length > 0,
      needs_graph: false,
      reasoning: "User requested ranking or side-by-side comparison of documented entities or figures.",
      target_section_keywords: [],
      excluded_section_keywords: [],
      parsed_intent: parsedIntent
    };
  }

  // --- CATEGORY H: Aggregation / Summary / General ---
  return {
    category: "H_AGGREGATION_SUMMARY",
    is_missing_or_out_of_scope: false,
    missing_entities: [],
    requires_exhaustive_scan: /\b(all|every|summary|summarize|overview|complete|entire)\b/i.test(qLower) || doc.chunks.length <= 12,
    needs_sql: doc.sql_records.length > 0,
    needs_graph: doc.graph_edges.length > 0,
    reasoning: "User requested comprehensive synthesis or factual extraction across the active document.",
    target_section_keywords: [],
    excluded_section_keywords: [],
    parsed_intent: parsedIntent
  };
}

/**
 * Hybrid Qdrant Retrieval:
 * - Strictly filters by active `document_id`
 * - Combines 1024-dim dense cosine similarity + keyword overlap + section reranking
 * - Excludes irrelevant noise sections (e.g., meeting minutes during vendor search)
 * - Performs exhaustive scan across the active document when required ("List ALL...")
 */
export function hybridRetrieveChunks(
  doc: DemoDocument,
  query: string,
  classification: QueryClassificationResult,
  topK: number = 6
): RetrievedChunkResult[] {
  const queryVector = computeDenseVector(query);
  const cleanQuery = (query || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  const rawTerms = cleanQuery.split(/\s+/).filter((t) => t.length >= 2);
  const meaningfulTerms = rawTerms.filter((t) => !STOP_WORDS.has(t));
  const queryTerms = meaningfulTerms.length > 0 ? meaningfulTerms : rawTerms;

  // For exhaustive entity queries (e.g., suppliers), know real extracted entity names in doc
  const knownSupplierNames =
    classification.category === "A_ENTITY_EXTRACTION"
      ? extractSuppliersFromText(doc.content, doc.chunks, doc.atomic_table_rows, doc.id).map((s) => s.name.toLowerCase())
      : [];

  const seenContent = new Set<string>();
  const scored: RetrievedChunkResult[] = [];

  for (const chunk of doc.chunks) {
    // Hard document isolation invariant
    if (chunk.document_id !== doc.id) continue;

    const dedupKey = chunk.content.trim().toLowerCase().slice(0, 180);
    if (seenContent.has(dedupKey)) continue;
    seenContent.add(dedupKey);

    const textLower = chunk.content.toLowerCase();
    const sectionLower = (chunk.section_title || "").toLowerCase();

    // Check negative section exclusions (strict query-to-retrieval alignment)
    const containsKnownSupplier = knownSupplierNames.some((n) => textLower.includes(n));
    const isExcludedSection =
      classification.excluded_section_keywords.length > 0 &&
      classification.excluded_section_keywords.some((kw) => sectionLower.includes(kw)) &&
      !containsKnownSupplier;

    if (isExcludedSection) {
      continue;
    }

    // 1. Dense cosine similarity (1024-dim vector)
    const denseScore = cosineSimilarity(queryVector, chunk.vector);

    // 2. Keyword & entity match ratio
    let keywordHits = 0;
    for (const term of queryTerms) {
      if (textLower.includes(term) || sectionLower.includes(term)) {
        keywordHits++;
      }
    }
    const keywordScore = queryTerms.length > 0 ? keywordHits / queryTerms.length : 0.35;

    // 3. Section-level reranking boost
    let sectionBoost = 0;
    for (const kw of classification.target_section_keywords) {
      if (sectionLower.includes(kw)) sectionBoost += 0.25;
      else if (textLower.includes(kw)) sectionBoost += 0.12;
    }
    if (containsKnownSupplier) {
      sectionBoost += 0.35;
    }
    if (
      classification.category === "FINANCIAL_COMPARATIVE_ANALYSIS" &&
      /(?:gross\s+)?revenue|(?:operating\s+)?expenses|operating\s+profit|(?:profit\s+)?margin/i.test(chunk.content)
    ) {
      sectionBoost += 0.2;
    }
    if (
      classification.category === "E_INVENTORY_THRESHOLD_CHECK" &&
      /\b(?:(?:[a-z]{2,6}-)*(?:sku|item|part|mat)-\d+|reorder\s*(?:point|level|threshold)|current\s+stock|below\s+reorder)\b/i.test(chunk.content)
    ) {
      sectionBoost += 0.25;
    }
    sectionBoost = Math.min(0.55, sectionBoost);

    // Combined hybrid relevance score
    let combined = 0.45 * denseScore + 0.40 * keywordScore + sectionBoost;
    if (classification.category === "B_SECTION_HEADING_LISTING" || classification.category === "K_MISSING_INFO_DETECTION") {
      combined = Math.max(combined, 0.55);
    }
    combined = parseFloat(Math.max(0.05, Math.min(0.99, combined)).toFixed(3));

    scored.push({
      document_id: doc.id,
      document_name: doc.title,
      chunk_id: chunk.chunk_id,
      page_number: chunk.page_number,
      section_title: chunk.section_title,
      content: chunk.content,
      content_type: chunk.content_type,
      source_version: doc.source_version,
      title: doc.title,
      doc_type: doc.doc_type,
      chunk_text: chunk.content,
      score: combined,
      dense_score: parseFloat(denseScore.toFixed(3)),
      keyword_score: parseFloat(keywordScore.toFixed(3)),
      section_boost: parseFloat(sectionBoost.toFixed(3))
    });
  }

  scored.sort((a, b) => b.score - a.score || a.page_number - b.page_number);

  if (classification.requires_exhaustive_scan) {
    // For exhaustive queries, keep all domain-relevant chunks (never truncate at top 3!)
    const relevant = scored.filter((c) => c.score >= 0.28 || c.section_boost > 0);
    return relevant.length > 0 ? relevant : scored;
  }

  const aboveThreshold = scored.filter((c) => c.score >= 0.32);
  return (aboveThreshold.length > 0 ? aboveThreshold : scored).slice(0, topK);
}
