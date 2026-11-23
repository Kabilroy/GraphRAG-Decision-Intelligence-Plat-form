import { extractEntitySummaryFromText } from "./ingestion";
import { DemoDocument } from "./types";

export interface SuggestedPromptOption {
  label: string;
  q: string;
  category: string;
  color: string;
}

export function buildSuggestedPromptsForDocument(doc: DemoDocument): SuggestedPromptOption[] {
  const prompts: SuggestedPromptOption[] = [];
  const docLower = (doc.content || "").toLowerCase();
  const hasTable = (name: string) => doc.sql_records.some((t) => t.table_name === name && t.rows.length > 0);
  const entitySummary = extractEntitySummaryFromText(doc.content, doc.chunks, doc.atomic_table_rows, doc.id);

  // 1. Suppliers / Vendors / Carriers (if detected or domain keywords present)
  if (entitySummary.confirmed_suppliers.length > 0 || /\b(suppliers?|vendors?|carriers?|freight)\b/i.test(docLower)) {
    prompts.push({
      label: `List Suppliers (${entitySummary.confirmed_suppliers.length})`,
      q: "List all suppliers mentioned in the uploaded PDF.",
      category: "A_ENTITY_EXTRACTION",
      color: "text-rose-400"
    });
  }

  // 2. Document Structure / Main Sections (always relevant for any PDF)
  if (doc.sections.length > 0) {
    prompts.push({
      label: `Main Sections (${doc.sections.length})`,
      q: "What are the main sections covered in this PDF?",
      category: "B_SECTION_HEADING_LISTING",
      color: "text-cyan-400"
    });
  }

  // 3. Meeting Action Items (only if table or action items present in doc)
  if (hasTable("meeting_action_items") || /\baction\s+items?\b/i.test(docLower)) {
    prompts.push({
      label: "Meeting Action Items",
      q: "Extract all meeting action items with owners and deadlines.",
      category: "C_ACTION_ITEM_EXTRACTION",
      color: "text-indigo-400"
    });
  }

  // 4. Financial P&L / Profit Comparison (only if financial table/data present in doc)
  if (hasTable("regional_p_and_l")) {
    prompts.push({
      label: "Regional Operating Profit",
      q: "Which regions generated the highest operating profit in September?",
      category: "FINANCIAL_COMPARATIVE_ANALYSIS",
      color: "text-emerald-400"
    });
  } else if (hasTable("uploaded_csv_metrics")) {
    prompts.push({
      label: "Analyze Tabular Metrics",
      q: "Compare all rows and compute totals and averages across metrics.",
      category: "D_FINANCIAL_TABLE_CALCULATION",
      color: "text-emerald-400"
    });
  } else if (/\b(revenue|operating\s+profit|margin|budget|cost|financial)\b/i.test(docLower)) {
    prompts.push({
      label: "Financial Findings",
      q: "Summarize all financial figures, metrics, and totals in this document.",
      category: "H_AGGREGATION_SUMMARY",
      color: "text-emerald-400"
    });
  }

  // 5. Inventory Threshold Check (only if inventory_status present in doc)
  if (hasTable("inventory_status")) {
    prompts.push({
      label: "Inventory Below Reorder",
      q: "Which inventory SKUs are below their reorder points?",
      category: "E_INVENTORY_THRESHOLD_CHECK",
      color: "text-amber-400"
    });
  }

  // 6. Root Causes / Operational Bottlenecks (only if present in doc)
  if (/\b(root\s*cause|post-mortem|delay|bottleneck|latency|incident|risk)\b/i.test(docLower)) {
    prompts.push({
      label: "Delay & Risk Root Causes",
      q: /\blogistics\b/i.test(docLower)
        ? "Identify the logistics delay root causes."
        : "Identify the primary operational issues, bottlenecks, and root causes in this document.",
      category: "F_ROOT_CAUSE_DIAGNOSIS",
      color: "text-purple-400"
    });
  }

  // 7. Knowledge Graph Relationships (when graph edges exist)
  if (doc.graph_edges.length > 0) {
    prompts.push({
      label: `Graph Relationships (${doc.graph_edges.length})`,
      q: "Show the key entity relationships and dependencies in this document's Knowledge Graph.",
      category: "G_RELATIONSHIP_GRAPHRAG_QUERY",
      color: "text-cyan-400"
    });
  }

  // 8. Recommendations (only if doc contains recommendations)
  if (/\b(recommend(?:ed|ations?)?|mitigations?|next\s+steps|action\s+plan)\b/i.test(docLower)) {
    prompts.push({
      label: "Documented Recommendations",
      q: "What recommendations are explicitly stated in this document?",
      category: "J_RECOMMENDATION_EXTRACTION",
      color: "text-emerald-400"
    });
  }

  // 9. Executive Summary of uploaded doc (always available)
  prompts.push({
    label: "Executive Summary",
    q: "Summarize the key findings and facts in this document.",
    category: "H_AGGREGATION_SUMMARY",
    color: "text-indigo-400"
  });

  // 10. Hallucination / Missing-Info Guardrail Check (pick a check guaranteed missing if absent)
  if (!/\b(ceo|chief\s+executive\s+officer)\b/i.test(docLower)) {
    prompts.push({
      label: "CEO Check (Missing Info)",
      q: "Who is the CEO of the company?",
      category: "K_MISSING_INFO_DETECTION",
      color: "text-rose-400"
    });
  } else if (!/\bcontract\s+value\b/i.test(docLower)) {
    prompts.push({
      label: "Contract Value Check",
      q: "What is the supplier's contract value?",
      category: "K_MISSING_INFO_DETECTION",
      color: "text-amber-400"
    });
  }

  return prompts;
}

export function buildDocumentDashboardAnalytics(doc: DemoDocument, latestSession?: any) {
  const entitySummary = extractEntitySummaryFromText(doc.content, doc.chunks, doc.atomic_table_rows, doc.id);
  const pnlTable = doc.sql_records.find((t) => t.table_name === "regional_p_and_l");
  const invTable = doc.sql_records.find((t) => t.table_name === "inventory_status");
  const vendorTable = doc.sql_records.find((t) => t.table_name === "vendor_performance");
  const csvTable = doc.sql_records.find((t) => t.table_name === "uploaded_csv_metrics");
  const actionTable = doc.sql_records.find((t) => t.table_name === "meeting_action_items");
  const varTable = doc.sql_records.find((t) => t.table_name === "regional_product_variance");

  // 1. Dynamic KPIs strictly computed from active `doc` ONLY
  const kpis: Array<{ id: string; title: string; value: string; change: string; trend: "up" | "down" | "neutral"; target: string }> = [
    {
      id: "kpi-doc",
      title: "Active Document Coverage",
      value: `${doc.pages_count} Page${doc.pages_count === 1 ? "" : "s"}`,
      change: `${doc.sections.length} Sections · ${doc.chunks.length} Chunks`,
      trend: "up",
      target: `Doc #${doc.id}`
    },
    {
      id: "kpi-graph",
      title: "Knowledge Graph Topology",
      value: `${doc.graph_nodes.length} Nodes`,
      change: `${doc.graph_edges.length} Verified Edges`,
      trend: doc.graph_edges.length > 0 ? "up" : "neutral",
      target: "Provenance Stamped"
    }
  ];

  // Dynamic KPI #3 from document's primary quantitative content
  if (pnlTable && pnlTable.rows.length > 0) {
    const currency = pnlTable.rows[0].currency || "INR";
    const totalProfit = pnlTable.rows.reduce((s, r) => s + Number(r.operating_profit || 0), 0);
    const totalRev = pnlTable.rows.reduce((s, r) => s + Number(r.gross_revenue || 0), 0);
    kpis.push({
      id: "kpi-metric",
      title: `Total Operating Profit (${pnlTable.rows.length} Regions)`,
      value: `${currency} ${totalProfit.toLocaleString()}`,
      change: `Rev: ${currency} ${totalRev.toLocaleString()}`,
      trend: "up",
      target: "Regional P&L Table"
    });
  } else if (invTable && invTable.rows.length > 0) {
    const belowCount = invTable.rows.filter((r) => r.status === "BELOW REORDER POINT").length;
    kpis.push({
      id: "kpi-metric",
      title: "Inventory Reorder Thresholds",
      value: `${belowCount} Below Reorder`,
      change: `Out of ${invTable.rows.length} SKUs`,
      trend: belowCount > 0 ? "down" : "up",
      target: "0 SKUs Below"
    });
  } else if (vendorTable && vendorTable.rows.length > 0) {
    const otdRows = vendorTable.rows.filter((r) => r.on_time_pct !== null && r.on_time_pct !== undefined && Number.isFinite(Number(r.on_time_pct)));
    const avgOtd =
      otdRows.length > 0
        ? otdRows.reduce((s, r) => s + Number(r.on_time_pct), 0) / otdRows.length
        : null;
    kpis.push({
      id: "kpi-metric",
      title: "Vendor Avg On-Time Rate",
      value: avgOtd !== null ? `${avgOtd.toFixed(1)}%` : "N/A",
      change: `${vendorTable.rows.length} Carriers Audited`,
      trend: avgOtd === null ? "neutral" : avgOtd >= 90 ? "up" : "down",
      target: "95.0% SLA"
    });
  } else if (csvTable && csvTable.rows.length > 0) {
    const visibleCsvCols = csvTable.columns.filter(
      (c) => c !== "document_id" && c !== "chunk_id" && c !== "source_chunk_id" && c !== "source_page"
    );
    kpis.push({
      id: "kpi-metric",
      title: "CSV Structured Dataset",
      value: `${csvTable.rows.length} Rows`,
      change: `${visibleCsvCols.length} Columns`,
      trend: "up",
      target: "SQL Read-Only"
    });
  } else if (varTable && varTable.rows.length > 0) {
    const row = varTable.rows[0];
    kpis.push({
      id: "kpi-metric",
      title: `${row.product_name} (${row.region})`,
      value: `${row.variance_pct}%`,
      change: `$${Math.abs(Number(row.variance_dollars || 0)).toLocaleString()} delta`,
      trend: Number(row.variance_pct) < 0 ? "down" : "up",
      target: "Audit Variance"
    });
  } else {
    kpis.push({
      id: "kpi-metric",
      title: "Confirmed Suppliers / Entities",
      value: `${entitySummary.confirmed_suppliers.length} Suppliers`,
      change: `${entitySummary.all_entities.length} Total NER Spans`,
      trend: "up",
      target: "NER Verified"
    });
  }

  // Dynamic KPI #4: Latest Critic Validation or Extraction Status
  const valRes = latestSession?.state?.validation_result;
  kpis.push({
    id: "kpi-critic",
    title: "12-Point Critic Gate",
    value: valRes ? `${(valRes.confidence_score * 100).toFixed(1)}%` : doc.extraction_status,
    change: valRes ? valRes.validation_status : "Strict Isolation On",
    trend: valRes && !valRes.is_valid ? "down" : "up",
    target: "Document-Verified"
  });

  // 2. Dynamic Chart Datasets computed ONLY from `doc`
  const regionalPnlChart = (pnlTable?.rows || []).map((r) => ({
    region: String(r.region),
    gross_revenue: Number(r.gross_revenue || 0),
    operating_expenses: Number(r.operating_expenses || 0),
    operating_profit: Number(r.operating_profit || 0),
    margin_pct: r.margin_pct,
    currency: r.currency || "INR"
  }));

  const vendorPerformanceChart = (vendorTable?.rows || []).map((r) => ({
    carrier: String(r.carrier),
    on_time_pct:
      r.on_time_pct !== null && r.on_time_pct !== undefined && Number.isFinite(Number(r.on_time_pct))
        ? Number(r.on_time_pct)
        : null,
    target_pct: Number(r.target_pct || 95),
    transit_variance_days: String(r.transit_variance_days || "0")
  }));

  const inventoryChart = (invTable?.rows || []).map((r) => ({
    sku: String(r.sku),
    item_name: String(r.item_name),
    current_stock: Number(r.current_stock || 0),
    reorder_point: Number(r.reorder_point || 0),
    deficit: Number(r.deficit || 0),
    status: String(r.status)
  }));

  let csvChart: { labelKey: string; valueKeys: string[]; rows: Array<Record<string, any>> } | null = null;
  if (csvTable && csvTable.rows.length > 0) {
    const cols = csvTable.columns.filter(
      (c) => c !== "document_id" && c !== "chunk_id" && c !== "source_chunk_id" && c !== "source_page"
    );
    const firstRow = csvTable.rows[0];
    const stringCol = cols.find((c) => typeof firstRow[c] === "string") || cols[0];
    const numericCols = cols.filter((c) => typeof firstRow[c] === "number" && c !== stringCol).slice(0, 3);
    if (numericCols.length > 0) {
      csvChart = {
        labelKey: stringCol,
        valueKeys: numericCols,
        rows: csvTable.rows.map(({ document_id: _d, chunk_id: _c, source_chunk_id: _sc, source_page: _sp, ...rest }) => rest)
      };
    }
  }

  // Section coverage & token distribution chart (ALWAYS populated for ANY uploaded PDF!)
  const sectionDistributionChart = doc.sections.map((sec) => {
    const words = sec.raw_text.split(/\s+/).filter(Boolean).length;
    const label = sec.section_title.length > 26 ? `${sec.section_title.slice(0, 24)}…` : sec.section_title;
    return {
      section: `Sec ${sec.section_number}: ${label}`,
      full_title: sec.section_title,
      page_number: sec.page_number,
      words,
      chunks: sec.chunk_ids.length
    };
  });

  // Entity classification breakdown chart (ALWAYS populated from NER on uploaded PDF!)
  const categoryCounts = new Map<string, number>();
  for (const ent of entitySummary.all_entities) {
    categoryCounts.set(ent.category, (categoryCounts.get(ent.category) || 0) + 1);
  }
  const entityBreakdownChart = Array.from(categoryCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // Page-by-page character & chunk density chart (useful for multi-page uploaded PDFs)
  const pageMap = new Map<number, { page: string; chars: number; chunks: number }>();
  for (const c of doc.chunks) {
    const existing = pageMap.get(c.page_number) || { page: `Page ${c.page_number}`, chars: 0, chunks: 0 };
    existing.chars += c.content.length;
    existing.chunks += 1;
    pageMap.set(c.page_number, existing);
  }
  const pageDensityChart = Array.from(pageMap.values());

  return {
    document: {
      id: doc.id,
      title: doc.title,
      doc_type: doc.doc_type,
      pages_count: doc.pages_count,
      sections_count: doc.sections.length,
      chunks_count: doc.chunks.length,
      source_version: doc.source_version,
      uploaded_at: doc.uploaded_at,
      is_uploaded: Boolean(doc.is_uploaded)
    },
    kpis,
    charts: {
      regional_pnl: regionalPnlChart,
      vendor_performance: vendorPerformanceChart,
      inventory_status: inventoryChart,
      csv_metrics: csvChart,
      section_distribution: sectionDistributionChart,
      entity_breakdown: entityBreakdownChart,
      page_density: pageDensityChart
    },
    tables_available: doc.sql_records.map((t) => ({
      table_name: t.table_name,
      row_count: t.rows.length,
      columns: t.columns.filter(
        (c) =>
          c !== "document_id" &&
          c !== "chunk_id" &&
          c !== "source_chunk_id" &&
          !(t.table_name === "uploaded_csv_metrics" && c === "source_page")
      )
    })),
    action_items_count: actionTable?.rows.length || 0,
    confirmed_suppliers: entitySummary.confirmed_suppliers.map((s) => ({
      name: s.name,
      category: s.category,
      page_number: s.page_number,
      on_time_rate: s.on_time_rate,
      transit_variance: s.transit_variance
    }))
  };
}

export function buildDocumentBriefing(doc: DemoDocument, latestSession?: any) {
  const entitySummary = extractEntitySummaryFromText(doc.content, doc.chunks, doc.atomic_table_rows, doc.id);
  const pnlTable = doc.sql_records.find((t) => t.table_name === "regional_p_and_l");
  const invTable = doc.sql_records.find((t) => t.table_name === "inventory_status");
  const vendorTable = doc.sql_records.find((t) => t.table_name === "vendor_performance");
  const actionTable = doc.sql_records.find((t) => t.table_name === "meeting_action_items");
  const csvTable = doc.sql_records.find((t) => t.table_name === "uploaded_csv_metrics");

  // Extract verbatim recommendations from this document ONLY
  const recommendations: string[] = [];
  for (const chunk of doc.chunks) {
    const lines = chunk.content.split("\n");
    const isRecSection = /\b(recommend(?:ed|ations?)?|mitigations?|action\s+plan)\b/i.test(chunk.section_title || "");
    let inRecBlock = isRecSection;
    for (const l of lines) {
      const t = l.trim();
      if (/^(?:SECTION\s+\d+\s*[:.\-]?\s*)?(?:RECOMMENDED\s+ACTIONS?|ACTIONABLE\s+EXECUTIVE\s+RECOMMENDATIONS?|RECOMMENDATIONS?|TRIAL\s+RECOMMENDATION)\s*:?/i.test(t)) {
        inRecBlock = true;
        const inline = t.replace(/^(?:SECTION\s+\d+\s*[:.\-]?\s*)?(?:RECOMMENDED\s+ACTIONS?|ACTIONABLE\s+EXECUTIVE\s+RECOMMENDATIONS?|RECOMMENDATIONS?|TRIAL\s+RECOMMENDATION)\s*:?\s*/i, "").trim();
        if (inline.length > 8) recommendations.push(inline);
        continue;
      }
      if (inRecBlock) {
        if (!t) {
          if (!isRecSection) inRecBlock = false;
          continue;
        }
        if (/^(?:SECTION\s+\d+\s*[:.\-]?\s*)?[A-Z][A-Z\s&/()-]+:$/.test(t)) {
          inRecBlock = false;
        } else if (/^[-•*\d.)]\s*/.test(t)) {
          const clean = t.replace(/^[-•*\d.)]+\s*/, "").trim();
          if (clean.length > 4) recommendations.push(clean);
        } else if (!/^SECTION\s+\d+/i.test(t)) {
          recommendations.push(t);
        }
      } else {
        const inlineRec = t.match(/(?:Immediate\s+recommendation\s+is\s+to|Recommended\s+action\s*[:\-])\s*(.+)/i);
        if (inlineRec) recommendations.push(inlineRec[1].trim());
      }
    }
  }

  // Build quantitative highlights strictly from doc's tables or text
  const keyMetrics: Array<{ label: string; value: string; note: string; accent: "emerald" | "rose" | "amber" | "cyan" }> = [];
  if (pnlTable && pnlTable.rows.length > 0) {
    const currency = pnlTable.rows[0].currency || "INR";
    const maxProfit = Math.max(...pnlTable.rows.map((r) => Number(r.operating_profit || 0)));
    const topRegs = pnlTable.rows.filter((r) => Number(r.operating_profit || 0) === maxProfit).map((r) => r.region);
    keyMetrics.push({
      label: "Peak Regional Operating Profit",
      value: `${currency} ${maxProfit.toLocaleString()}`,
      note: `Leading region(s): ${topRegs.join(" & ")}`,
      accent: "emerald"
    });
  }
  if (invTable && invTable.rows.length > 0) {
    const below = invTable.rows.filter((r) => r.status === "BELOW REORDER POINT");
    keyMetrics.push({
      label: "Inventory Reorder Alert",
      value: `${below.length} / ${invTable.rows.length} SKUs`,
      note: below.length > 0 ? `Below threshold: ${below.map((r) => r.sku).join(", ")}` : "All SKUs healthy",
      accent: below.length > 0 ? "rose" : "emerald"
    });
  }
  if (vendorTable && vendorTable.rows.length > 0) {
    const otdRows = vendorTable.rows.filter((r) => r.on_time_pct !== null && r.on_time_pct !== undefined && Number.isFinite(Number(r.on_time_pct)));
    if (otdRows.length > 0) {
      const avgOtd = otdRows.reduce((s, r) => s + Number(r.on_time_pct), 0) / otdRows.length;
      keyMetrics.push({
        label: "Verified Carrier Avg OTD",
        value: `${avgOtd.toFixed(1)}%`,
        note: `${vendorTable.rows.length} confirmed carrier(s) evaluated`,
        accent: avgOtd >= 90 ? "emerald" : "amber"
      });
    } else {
      keyMetrics.push({
        label: "Verified Carriers Audited",
        value: `${vendorTable.rows.length} Carrier(s)`,
        note: `OTD percentage not specified in source`,
        accent: "amber"
      });
    }
  }
  if (keyMetrics.length < 3) {
    keyMetrics.push({
      label: "Document Coverage",
      value: `${doc.pages_count} Pages · ${doc.sections.length} Sections`,
      note: `${doc.chunks.length} Qdrant BGE-M3 indexed chunks`,
      accent: "cyan"
    });
  }
  if (keyMetrics.length < 3) {
    keyMetrics.push({
      label: "Graph Entities & Links",
      value: `${doc.graph_nodes.length} Nodes · ${doc.graph_edges.length} Edges`,
      note: `Document #${doc.id} provenance subgraph`,
      accent: "emerald"
    });
  }
  if (keyMetrics.length < 3) {
    keyMetrics.push({
      label: "Verified Suppliers / Carriers",
      value: `${entitySummary.confirmed_suppliers.length} Confirmed`,
      note: `${entitySummary.excluded_entities.length} non-supplier spans filtered`,
      accent: "amber"
    });
  }

  // Executive summary strictly from document sections / latest investigation on this doc
  const sectionSummaries = doc.sections.slice(0, 6).map((sec) => {
    const cleanBody = sec.raw_text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 10 && l.toLowerCase() !== sec.section_title.toLowerCase())
      .slice(0, 3)
      .join(" ");
    return {
      section_number: sec.section_number,
      section_title: sec.section_title,
      page_number: sec.page_number,
      excerpt: cleanBody.slice(0, 260)
    };
  });

  const valRes = latestSession?.state?.validation_result;
  const confidencePct = valRes ? (valRes.confidence_score * 100).toFixed(1) : "100.0";

  return {
    document_id: doc.id,
    document_title: doc.title,
    doc_type: doc.doc_type,
    source_version: doc.source_version,
    pages_count: doc.pages_count,
    sections_count: doc.sections.length,
    uploaded_at: doc.uploaded_at,
    verified_confidence_pct: confidencePct,
    validation_status: valRes?.validation_status || "INDEXED_VERIFIED",
    latest_investigation: latestSession?.state?.decision
      ? {
          investigation_id: latestSession.investigation_id,
          question: latestSession.question,
          title: latestSession.state.decision.title,
          direct_answer: latestSession.state.decision.direct_answer,
          conclusion: latestSession.state.decision.conclusion
        }
      : null,
    section_summaries: sectionSummaries,
    key_metrics: keyMetrics.slice(0, 3),
    confirmed_suppliers: entitySummary.confirmed_suppliers.map((s) => ({
      name: s.name,
      category: s.category,
      page_number: s.page_number,
      on_time_rate: s.on_time_rate,
      transit_variance: s.transit_variance,
      supporting_sentence: s.supporting_sentence
    })),
    structured_tables: doc.sql_records.map((t) => ({
      table_name: t.table_name,
      columns: t.columns.filter(
        (c) =>
          c !== "document_id" &&
          c !== "chunk_id" &&
          c !== "source_chunk_id" &&
          !(t.table_name === "uploaded_csv_metrics" && c === "source_page")
      ),
      rows: t.rows.map(({ document_id: _d, chunk_id: _c, source_chunk_id: _sc, ...rest }) => rest)
    })),
    action_items_count: actionTable?.rows.length || 0,
    csv_row_count: csvTable?.rows.length || 0,
    recommendations: Array.from(new Set(recommendations)),
    citations: [
      ...doc.sql_records.map((t) => ({
        ref_id: `SQL-${t.table_name}`,
        type: "SQL",
        detail: `SELECT ${t.columns.filter((c) => c !== "document_id").join(", ")} FROM ${t.table_name} WHERE document_id = ${doc.id} (${t.rows.length} rows)`
      })),
      ...doc.graph_edges.slice(0, 4).map((e, i) => ({
        ref_id: `Graph-${i + 1}`,
        type: "Neo4j",
        detail: `(${e.source})-[:${e.relation}]->(${e.target}) [Doc #${doc.id}, Page ${e.source_page}]`
      })),
      ...doc.chunks.slice(0, 4).map((c) => ({
        ref_id: c.chunk_id,
        type: "Qdrant",
        detail: `Page ${c.page_number} · ${c.section_title}: "${c.content.slice(0, 120).replace(/\n/g, " ")}..."`
      }))
    ]
  };
}
