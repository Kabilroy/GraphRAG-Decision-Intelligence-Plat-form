import {
  AtomicTableRow,
  ClassifiedEntity,
  DocumentChunk,
  EntityCategory,
  EntityExtractionSummary
} from "./types";

const FINANCIAL_TOKENS = new Set([
  "revenue",
  "cogs",
  "ebitda",
  "profit",
  "margin",
  "margins",
  "expense",
  "expenses",
  "cost",
  "costs",
  "inr",
  "usd",
  "eur",
  "gbp",
  "budget",
  "forecast",
  "variance",
  "ratio",
  "subtotal",
  "balance",
  "income",
  "capex",
  "opex",
  "arr",
  "mrr",
  "roi",
  "kpi",
  "kpis",
  "tax",
  "gross",
  "operating",
  "currency",
  "price",
  "pricing",
  "p&l",
  "pnl",
  "sales",
  "financial",
  "freight-charge",
  "amount"
]);

const HEADING_META_TOKENS = new Set([
  "audit",
  "report",
  "reports",
  "summary",
  "post-mortem",
  "minutes",
  "overview",
  "breakdown",
  "conclusion",
  "roadmap",
  "statement",
  "checklist",
  "scope",
  "evaluation",
  "assessment",
  "findings",
  "third-party",
  "benchmark",
  "agenda",
  "notes",
  "appendix",
  "chapter",
  "section",
  "header",
  "title",
  "review",
  "analysis",
  "certification",
  "protocol",
  "compliance",
  "throughput",
  "governance",
  "name",
  "notes",
  "tier",
  "contract",
  "description",
  "status"
]);

const WAREHOUSE_TOKENS = new Set([
  "warehouse",
  "warehouses",
  "depot",
  "depots",
  "fulfillment",
  "cross-dock",
  "crossdock",
  "hub",
  "hubs",
  "terminal",
  "terminals",
  "yard",
  "dock",
  "plant",
  "facility",
  "facilities",
  "storage",
  "consolidation",
  "centre",
  "center"
]);

const DEPARTMENT_TOKENS = new Set([
  "department",
  "division",
  "team",
  "unit",
  "committee",
  "board",
  "office",
  "council",
  "procurement",
  "finance",
  "controller",
  "manager",
  "lead",
  "officer",
  "head",
  "ceo",
  "cfo",
  "coo",
  "cto",
  "dispatchers",
  "operations",
  "engineering",
  "marketing",
  "legal",
  "hr"
]);

const DIRECTION_OR_REGION_PREFIXES = new Set([
  "north",
  "south",
  "east",
  "west",
  "central",
  "upper",
  "lower",
  "metro",
  "urban",
  "regional",
  "local",
  "domestic",
  "international",
  "emea",
  "apac",
  "latam",
  "nam",
  "eastern",
  "western",
  "northern",
  "southern"
]);

const GENERIC_NON_PROPER_PREFIXES = new Set([
  "the",
  "all",
  "any",
  "our",
  "this",
  "that",
  "other",
  "primary",
  "secondary",
  "backup",
  "alternate",
  "expedited",
  "three",
  "two",
  "four",
  "five",
  "third-party",
  "approved",
  "preferred",
  "key",
  "major",
  "top",
  "total",
  "overall",
  "current",
  "systemic",
  "recurring",
  "elevated",
  "missing",
  "unclear",
  "general",
  "vendor",
  "supplier",
  "carrier"
]);

const TABLE_HEADER_NOISE_TOKENS = new Set([
  "sla",
  "variance",
  "rate",
  "rates",
  "accuracy",
  "delivery",
  "target",
  "targets",
  "damage",
  "rating",
  "ratings",
  "score",
  "scores",
  "metric",
  "metrics",
  "benchmark",
  "reorder",
  "deficit",
  "shortage",
  "shortfall",
  "stock",
  "threshold",
  "delay",
  "delays",
  "achievement",
  "severity",
  "likelihood",
  "mitigation",
  "priority",
  "timeline",
  "impact",
  "deadline",
  "owner",
  "action"
]);

const ORG_SUFFIX_REGEX =
  /\b(Freight\s+Express|Logistics\s+Corp|Carrier\s+Partners|Transit\s+Services|Rail\s+Carriers|Maritime\s+Logistics|Freight\s+Services|Logistics\s+Pvt\.?\s+Ltd\.?|Transport\s+Co\.?|Logistics|Freight|Transit|Carriers?|Express|Transport|Shipping|Supply|Holdings|Group|Partners|Services|Corp\.?|Corporation|Inc\.?|Pvt\.?\s+Ltd\.?|Ltd\.?|LLC|GmbH|Solutions|Enterprises|Industries|Systems|Global|Co\.?)$/i;

const GENERIC_PHRASE_BLACKLIST = new Set([
  "vendor performance",
  "vendor performance audit",
  "vendor performance audit report",
  "supplier performance",
  "overall vendor performance issues",
  "vendor audit figures",
  "carrier logistics partners",
  "freight and carrier logistics partners",
  "primary freight and carrier logistics partners",
  "executive operations meeting",
  "logistics delay post-mortem",
  "enterprise supply chain",
  "north america east",
  "secondary suppliers",
  "secondary supplier",
  "primary supplier",
  "primary suppliers",
  "expedited carriers",
  "alternate expedited carriers",
  "primary freight carriers",
  "three primary freight carriers",
  "logistics partners",
  "carrier partners",
  "supply chain",
  "vendor recovery plan",
  "freight-charge validation",
  "carrier service agreements",
  "carrier dispatch logs",
  "delivery metrics",
  "supplier metrics",
  "name",
  "vendor name",
  "supplier name",
  "carrier name",
  "company name",
  "notes",
  "audit group",
  "contract tier",
  "contract status",
  "primary warehouse",
  "warehouse",
  "warehouse system",
  "manager",
  "department",
  "division",
  "facility",
  "location",
  "centre",
  "center",
  "regional",
  "carrier manager",
  "suggested ai testing questions",
  "document pack"
]);

function tokenizeLower(str: string): string[] {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9&-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function isSentenceFiniteVerbPresent(line: string): boolean {
  return /\b(is|was|are|were|has|have|had|delivered|supplied|sourced|shipped|handled|experienced|breached|dropped|increased|decreased|generated|reached|observed|convenes|must|requires|scheduled|recognized|contributed|showed|remained|remains|reallocate|routed|stored|dispatched|sold|purchased|contracted|partnered|operated|transported)\b/i.test(
    line
  );
}

export function detectHeadingOrTableHeaderLine(line: string, sectionTitle?: string): {
  isHeading: boolean;
  isTableHeader: boolean;
} {
  const t = (line || "").trim();
  if (!t) return { isHeading: false, isTableHeader: false };

  // Never treat pipe rows with concrete numeric percentages/currencies/dates as headers
  const hasMetricNumbers = /\d+(?:\.\d+)?%|\b\d{4}\b|[+-]\d+(?:\.\d+)?\s*days?|\b(?:INR|USD|\$)\s*[\d,]+/i.test(t);

  // Table header detection (either pipe-delimited headers or space-separated financial/metric column names)
  const tokens = tokenizeLower(t);
  const financialOrColTokens = tokens.filter(
    (tok) =>
      FINANCIAL_TOKENS.has(tok) ||
      [
        "logistics",
        "carrier",
        "vendor",
        "supplier",
        "name",
        "delivery",
        "on-time",
        "otd",
        "notes",
        "tier",
        "contract",
        "description",
        "item",
        "deficit",
        "region",
        "sku",
        "stock",
        "reorder",
        "status",
        "owner",
        "action",
        "deadline",
        "rate",
        "target",
        "sla",
        "metric",
        "metrics",
        "quarter",
        "q1",
        "q2",
        "q3",
        "q4",
        "units",
        "variance",
        "damage",
        "rating",
        "severity",
        "likelihood",
        "mitigation",
        "priority",
        "timeline",
        "impact",
        "route",
        "actual",
        "delay",
        "month",
        "city",
        "hub",
        "sold",
        "achievement",
        "date",
        "page"
      ].includes(tok)
  );

  const hasColonKeyValue = /:\s+/.test(t);
  const hasLongPipeNarrative = t.includes("|") && t.split("|").some((cell) => cell.trim().split(/\s+/).length >= 5);
  const isTableHeader =
    !hasMetricNumbers &&
    !hasColonKeyValue &&
    !hasLongPipeNarrative &&
    !isSentenceFiniteVerbPresent(t) &&
    ((t.includes("|") && financialOrColTokens.length >= 2) ||
      (tokens.length >= 2 &&
        tokens.length <= 12 &&
        financialOrColTokens.length >= Math.max(2, Math.ceil(tokens.length * 0.5))));

  if (isTableHeader) {
    return { isHeading: false, isTableHeader: true };
  }

  // Heading detection
  const words = t.split(/\s+/);
  if (
    sectionTitle &&
    t.toLowerCase() === sectionTitle.trim().toLowerCase() &&
    !t.endsWith(".") &&
    !t.includes("|") &&
    !hasMetricNumbers &&
    !isSentenceFiniteVerbPresent(t) &&
    words.length <= 10
  ) {
    return { isHeading: true, isTableHeader: false };
  }
  if (/^(?:SECTION\s+\d+|Section\s+\d+|#{1,4}\s+)/i.test(t) && !hasMetricNumbers) {
    return { isHeading: true, isTableHeader: false };
  }
  if (/^[A-Z0-9\s,&/():.-]{5,95}$/.test(t) && !hasMetricNumbers && !t.includes("|")) {
    return { isHeading: true, isTableHeader: false };
  }
  // Title-case standalone header line without verbs, colons, pipes, or terminal period
  const allTitleCased =
    words.length >= 2 &&
    words.length <= 10 &&
    words.every((w) => /^[A-Z0-9][A-Za-z0-9&-]*$/.test(w) || /^(?:of|and|the|for|in|vs|to|on|at)$/i.test(w));

  if (
    allTitleCased &&
    !t.includes(":") &&
    !t.includes("|") &&
    !t.endsWith(".") &&
    !hasMetricNumbers &&
    !isSentenceFiniteVerbPresent(t)
  ) {
    return { isHeading: true, isTableHeader: false };
  }

  return { isHeading: false, isTableHeader: false };
}

interface CandidateMention {
  rawName: string;
  explicitRoleHint?: EntityCategory;
  line: string;
  sentence: string;
  page_number: number;
  chunk_id: string;
  section_title: string;
  isHeadingLine: boolean;
  isTableHeaderLine: boolean;
}

function cleanCandidateSpan(raw: string): string {
  let s = (raw || "").replace(/^[-•*\d.)\s]+/, "").replace(/[,:;.\s]+$/, "").trim();
  // Trim trailing lowercase prose clause (e.g. "Apex Transit Services handled inbound..." -> "Apex Transit Services")
  // Preserve connectors like "of", "and", "&", "for", "the" ONLY when immediately followed by a capitalized Proper Word.
  const words = s.split(/\s+/);
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const nextW = words[i + 1];
    const isCapitalizedOrCode = /^[A-Z0-9]/.test(w) || w === "&";
    const isConnectorBeforeCap =
      /^(?:of|and|the|for|in|at|on|by)$/i.test(w) &&
      i > 0 &&
      Boolean(nextW && /^[A-Z0-9]/.test(nextW)) &&
      !/^(?:handled|supplied|delivered|shipped|managed|operated|breached|experienced|recorded|provided|is|was|are|were|has|have|had)$/i.test(w);

    if (isCapitalizedOrCode || isConnectorBeforeCap) {
      kept.push(w);
    } else {
      break;
    }
  }
  s = kept.join(" ").replace(/[,:;.\s]+$/, "").trim();

  // Trim leading determiners / financial / audit prefixes that shouldn't attach to a company name
  let changed = true;
  while (changed) {
    changed = false;
    const firstWordMatch = s.match(/^([A-Za-z0-9-]+)\s+(.+)$/);
    if (firstWordMatch) {
      const fw = firstWordMatch[1].toLowerCase();
      if (
        GENERIC_NON_PROPER_PREFIXES.has(fw) &&
        !/^(?:supplier\s+[a-z0-9]+)$/i.test(s)
      ) {
        s = firstWordMatch[2].trim();
        changed = true;
      }
    }
  }
  return s;
}

function findSentenceContaining(text: string, needle: string, fallbackLine: string): string {
  const sentences = (text || "").split(/(?<=[.!?])\s+|\n+/);
  const nLow = needle.toLowerCase();
  const found = sentences.find((s) => s.toLowerCase().includes(nLow));
  return (found || fallbackLine || "").trim();
}

export function classifyEntityCandidate(candidate: CandidateMention): {
  category: EntityCategory;
  confidence: number;
  is_confirmed_supplier: boolean;
  reason: string;
  exclusion_reason?: string;
} {
  const name = candidate.rawName.trim();
  const nameLow = name.toLowerCase();
  const tokens = tokenizeLower(name);
  const sent = candidate.sentence || candidate.line || "";
  const sentLow = sent.toLowerCase();
  const lineLow = (candidate.line || "").toLowerCase();

  // 0. Blacklisted generic non-entity phrases
  if (GENERIC_PHRASE_BLACKLIST.has(nameLow) || tokens.length === 0) {
    return {
      category: "Document heading",
      confidence: 0.92,
      is_confirmed_supplier: false,
      reason: "Generic supply-chain terminology or section phrase, not a named external entity.",
      exclusion_reason: "Generic business terminology"
    };
  }

  // 1. Financial Metric check (column headers, currency/accounting tuples like "Revenue INR COGS INR Logistics")
  const finCount = tokens.filter((tok) => FINANCIAL_TOKENS.has(tok)).length;
  if (
    finCount >= 2 ||
    (finCount >= 1 && (candidate.isTableHeaderLine || tokens.some((tok) => ["inr", "usd", "eur", "gbp", "cogs", "ebitda", "revenue", "profit", "margin"].includes(tok))))
  ) {
    return {
      category: "Financial metric",
      confidence: 0.96,
      is_confirmed_supplier: false,
      reason: `Contains financial/accounting metric tokens (${tokens.filter((tok) => FINANCIAL_TOKENS.has(tok)).join(", ")}).`,
      exclusion_reason: "Financial metric / column header"
    };
  }
  if (candidate.isTableHeaderLine) {
    return {
      category: "Financial metric",
      confidence: 0.92,
      is_confirmed_supplier: false,
      reason: "Extracted from a tabular column header row rather than a data entity.",
      exclusion_reason: "Table header"
    };
  }

  // 1b. Table header metric / SLA / variance / KPI noise check (e.g. "Target SLA Transit", "Transit Variance")
  const headerNoiseHits = tokens.filter((tok) => TABLE_HEADER_NOISE_TOKENS.has(tok));
  if (headerNoiseHits.length >= 1) {
    return {
      category: "Financial metric",
      confidence: 0.95,
      is_confirmed_supplier: false,
      reason: `Contains tabular KPI/column header terminology (${headerNoiseHits.join(", ")}), not a named external entity.`,
      exclusion_reason: "Tabular metric / header terminology"
    };
  }

  // 2. Document Heading / Audit Title check
  const headCount = tokens.filter((tok) => HEADING_META_TOKENS.has(tok)).length;
  const endsWithBareRole = /\b(?:audit\s+supplier|performance\s+audit|audit\s+report|vendor|supplier|carrier)$/i.test(name) &&
    !/^Supplier\s+[A-Z0-9]+$/i.test(name);
  if (
    candidate.isHeadingLine ||
    headCount >= 1 ||
    endsWithBareRole ||
    (candidate.section_title && nameLow === candidate.section_title.toLowerCase())
  ) {
    return {
      category: "Document heading",
      confidence: 0.95,
      is_confirmed_supplier: false,
      reason: candidate.isHeadingLine
        ? "Appears as a standalone document or section heading line."
        : `Contains document/audit heading terminology (${tokens.filter((tok) => HEADING_META_TOKENS.has(tok)).join(", ") || name}).`,
      exclusion_reason: "Document or section heading"
    };
  }

  // 3. Product / SKU check
  if (
    candidate.explicitRoleHint === "Product" ||
    /^(?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-\d+$/i.test(name) ||
    /^(?:[A-Z]{2,6}-)+\d{2,6}$/i.test(name) ||
    /^Product\s+[A-Z0-9]+$/i.test(name) ||
    /\b(?:bearings|seal|valve|coupler|cable\s+assembly|sensor\s+hub|sensors)\b/i.test(name)
  ) {
    return {
      category: "Product",
      confidence: 0.94,
      is_confirmed_supplier: false,
      reason: "Matches product identifier, SKU, or physical goods terminology.",
      exclusion_reason: "Product / SKU entity"
    };
  }

  // 4. Department / Role check
  const deptHits = tokens.filter((tok) => DEPARTMENT_TOKENS.has(tok)).length;
  if (
    candidate.explicitRoleHint === "Department" ||
    deptHits >= 1 ||
    /\bhead\s+of\b/i.test(name) ||
    /\bchief\s+[a-z]+\s+officer\b/i.test(name)
  ) {
    return {
      category: "Department",
      confidence: 0.93,
      is_confirmed_supplier: false,
      reason: "Identifies an internal department, committee, or executive job title.",
      exclusion_reason: "Department or internal role"
    };
  }

  // 5. Customer / Internal Portal / Software System check
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bound = `(?:^|[^a-zA-Z0-9])${escapedName}(?:$|[^a-zA-Z0-9])`;
  const hasCarrierOrLogisticsSuffix = /\b(?:Carriers?|Freight|Logistics|Transit|Transport|Shipping|Supply|Express)\b/i.test(name);
  const hasExplicitCustomerWord = tokens.some((tok) => ["customer", "client", "buyer", "consignee"].includes(tok));
  const hasInternalPortalToken =
    !hasCarrierOrLogisticsSuffix &&
    tokens.some((tok) => ["portal", "dashboard", "platform", "software", "module", "system"].includes(tok));
  const hasCustomerOrPortalToken = hasExplicitCustomerWord || hasInternalPortalToken;
  const isCustomerContext =
    candidate.explicitRoleHint === "Customer" ||
    hasCustomerOrPortalToken ||
    new RegExp(`\\b(?:customer|client|buyer|account|consignee)\\s*[:\\-]?\\s*${escapedName}(?:$|[^a-zA-Z0-9])`, "i").test(sent) ||
    new RegExp(`\\b(?:sold\\s+to|purchased\\s+by|ordered\\s+by|shipped\\s+to\\s+customer)\\s+${escapedName}(?:$|[^a-zA-Z0-9])`, "i").test(sent);
  if (isCustomerContext) {
    return {
      category: "Customer",
      confidence: 0.92,
      is_confirmed_supplier: false,
      reason: hasCustomerOrPortalToken
        ? "Contains customer, client, or internal portal/system terminology rather than an external supplier."
        : "Sentence context identifies entity as a customer/buyer rather than a supplier.",
      exclusion_reason: "Customer or internal platform entity"
    };
  }

  // 6. Warehouse / Distribution Center check
  const hasLegalOrCarrierSuffix = /\b(?:Corp\.?|Corporation|Inc\.?|Ltd\.?|LLC|Partners|Group|Services|Freight\s+Express|Logistics\s+Corp|Transit\s+Services|Rail\s+Carriers|Maritime\s+Logistics|Express|Carriers?|Logistics|Freight|Transport|Shipping|Solutions)\b/i.test(
    name
  );
  const warehouseTokenHit = tokens.some((tok) => WAREHOUSE_TOKENS.has(tok)) && !hasLegalOrCarrierSuffix;
  const isCompassDistributionFacility =
    tokens.length <= 3 &&
    DIRECTION_OR_REGION_PREFIXES.has(tokens[0]) &&
    tokens[tokens.length - 1] === "distribution" &&
    !hasLegalOrCarrierSuffix;

  const isWarehouseSentenceContext =
    !hasLegalOrCarrierSuffix &&
    (new RegExp(`\\b(?:warehouse|facility|depot|hub|cross-dock|distribution\\s+center|terminal)\\s*[:\\-]?\\s*${escapedName}(?:$|[^a-zA-Z0-9])`, "i").test(sent) ||
      new RegExp(`\\b(?:stored\\s+at|dispatched\\s+from|routed\\s+through|utilization\\s+at|throughput\\s+at|inventory\\s+at)\\s+${escapedName}(?:$|[^a-zA-Z0-9])`, "i").test(sent) ||
      (isCompassDistributionFacility && !new RegExp(`\\b(?:supplier|vendor|carrier)\\s*[:\\-]\\s*${escapedName}(?:$|[^a-zA-Z0-9])`, "i").test(sent)));

  if (
    candidate.explicitRoleHint === "Warehouse" ||
    warehouseTokenHit ||
    isWarehouseSentenceContext ||
    isCompassDistributionFacility
  ) {
    return {
      category: "Warehouse",
      confidence: 0.93,
      is_confirmed_supplier: false,
      reason: isCompassDistributionFacility
        ? "Regional/directional distribution facility without external corporate vendor suffix or supplier role assignment."
        : "Identified as a warehouse, hub, or distribution facility in sentence context.",
      exclusion_reason: "Warehouse / distribution facility"
    };
  }

  // 7. Region check
  if (
    candidate.explicitRoleHint === "Region" ||
    /^Region\s+[A-Z0-9]+$/i.test(name) ||
    /^(?:North|South|East|West|North\s+America|North\s+America\s+East|EMEA|APAC|LATAM|NAM|Europe|Asia\s+Pacific)$/i.test(
      name
    ) ||
    new RegExp(`\\bRegion\\s*[:\\-]\\s*${escapedName}\\b`, "i").test(sent)
  ) {
    return {
      category: "Region",
      confidence: 0.94,
      is_confirmed_supplier: false,
      reason: "Identifies a geographic or sales region.",
      exclusion_reason: "Region name"
    };
  }

  // 8. Location check
  if (
    candidate.explicitRoleHint === "Location" ||
    /^Port\s+of\s+/i.test(name) ||
    new RegExp(`\\b(?:location|city|port|site)\\s*[:\\-]\\s*${escapedName}\\b`, "i").test(sent)
  ) {
    return {
      category: "Location",
      confidence: 0.90,
      is_confirmed_supplier: false,
      reason: "Identifies a physical port, city, or geographic location.",
      exclusion_reason: "Location name"
    };
  }

  // 9. Positive Contextual Verification for Supplier / Vendor / Carrier
  // Requirement 8: Do NOT classify merely because it appears in a vendor-related section!
  // Score MUST come from the candidate's own sentence/row and lexical org structure.
  let sentenceEvidence = 0;
  const evidenceSignals: string[] = [];

  // 9a. Explicit role assignment in surrounding sentence/row
  const hasExplicitSupplierLabel =
    candidate.explicitRoleHint === "Supplier" ||
    new RegExp(
      `\\b(?:primary\\s+suppliers?|secondary\\s+suppliers?|approved\\s+suppliers?|suppliers?)\\s*(?::|-|\\b(?:is|are|include|includes|mentioned)\\b)?\\s*[^.\\n]{0,40}${bound}`,
      "i"
    ).test(sent) ||
    new RegExp(
      `${bound}[^.\\n]{0,35}\\b(?:is|was|serves\\s+as|acts\\s+as)\\s+(?:a|an|the|our)?\\s*(?:[a-z-]+\\s+){0,3}supplier\\b`,
      "i"
    ).test(sent) ||
    new RegExp(`${escapedName}\\s*\\(\\s*supplier\\s*\\)`, "i").test(sent);

  const hasExplicitVendorLabel =
    candidate.explicitRoleHint === "Vendor" ||
    new RegExp(
      `\\b(?:primary\\s+vendors?|secondary\\s+vendors?|approved\\s+vendors?|vendors?)\\s*(?::|-|\\b(?:is|are|include|includes)\\b)?\\s*[^.\\n]{0,40}${bound}`,
      "i"
    ).test(sent) ||
    new RegExp(
      `${bound}[^.\\n]{0,35}\\b(?:is|was|serves\\s+as|acts\\s+as)\\s+(?:a|an|the|our)?\\s*(?:[a-z-]+\\s+){0,3}vendor\\b`,
      "i"
    ).test(sent) ||
    new RegExp(`${escapedName}\\s*\\(\\s*vendor\\s*\\)`, "i").test(sent);

  const hasExplicitCarrierLabel =
    candidate.explicitRoleHint === "Carrier" ||
    new RegExp(
      `\\b(?:primary\\s+carriers?|backup\\s+carriers?|freight\\s+partners?|logistics\\s+partners?|carriers?)\\s*(?::|-|\\b(?:is|are|include|includes)\\b)?\\s*[^.\\n]{0,40}${bound}`,
      "i"
    ).test(sent) ||
    new RegExp(
      `${bound}[^.\\n]{0,35}\\b(?:is|was|serves\\s+as|acts\\s+as)\\s+(?:a|an|the|our)?\\s*(?:[a-z-]+\\s+){0,3}(?:carrier|freight\\s+partner|logistics\\s+partner)\\b`,
      "i"
    ).test(sent) ||
    new RegExp(`${escapedName}\\s*\\(\\s*carrier\\s*\\)`, "i").test(sent);

  if (hasExplicitSupplierLabel || hasExplicitVendorLabel || hasExplicitCarrierLabel) {
    sentenceEvidence += 0.55;
    evidenceSignals.push("explicit supplier/vendor/carrier role assignment in sentence");
  }

  // 9b. Sourcing / fulfillment / logistics action verb in surrounding sentence
  const hasSupplyVerbContext =
    new RegExp(
      `\\b(?:supplied\\s+by|sourced\\s+(?:from|by)|shipped\\s+(?:via|by|through)|delivered\\s+by|transported\\s+by|handled\\s+by|carried\\s+by|fulfilled\\s+by|operated\\s+by|contracted\\s+(?:with|by)|partnered\\s+with|reallocate\\b[^.]{0,50}\\bto)\\s+(?:[a-z]+\\s+){0,3}${escapedName}(?:$|[^a-zA-Z0-9])`,
      "i"
    ).test(sent) ||
    new RegExp(
      `${bound}[^.\\n]{0,60}\\b(?:supplies|supplied|provides|delivers|delivered|completed|transports|handles|handled|experienced|breached|recorded|operates|manages\\s+freight|fulfills)\\b`,
      "i"
    ).test(sent) ||
    /\b(?:shipment\s+damage\s+rate|telemetry\s+visibility)\s+at\b/i.test(sent);

  if (hasSupplyVerbContext) {
    sentenceEvidence += 0.45;
    evidenceSignals.push("sourcing/delivery action context in sentence");
  }

  // 9c. Structured vendor/carrier performance row in same line/sentence
  const isPerformanceMetricRow =
    /(?:on-?time(?:\s+delivery)?|otd|target(?:\s+sla)?|transit\s+variance|sla\s+breach|shipment\s+damage|cargo\s+damage|telemetry\s+(?:availability|coverage)|fulfillment\s+latency|lead\s+time|fill\s+rate|\d+(?:\.\d+)?%\s*(?:\||on-?time|target|sla))/i.test(
      lineLow
    ) &&
    (lineLow.startsWith(nameLow) ||
      new RegExp(`^(?:[-•*]|\\d+\\.)\\s*${escapedName}\\s*[:|]`, "i").test(candidate.line.trim()) ||
      new RegExp(`\\b${escapedName}\\s*\\|`, "i").test(candidate.line));

  if (isPerformanceMetricRow) {
    sentenceEvidence += 0.48;
    evidenceSignals.push("structured vendor/carrier KPI row");
  }

  // 9d. Proper external organization lexical form (not a direction+generic word)
  const hasOrgForm =
    /^Supplier\s+[A-Z0-9]+$/i.test(name) ||
    (ORG_SUFFIX_REGEX.test(name) && !DIRECTION_OR_REGION_PREFIXES.has(tokens[0])) ||
    (tokens.length >= 2 &&
      !DIRECTION_OR_REGION_PREFIXES.has(tokens[0]) &&
      !FINANCIAL_TOKENS.has(tokens[0]) &&
      !HEADING_META_TOKENS.has(tokens[0]));

  if (hasOrgForm) {
    sentenceEvidence += 0.32;
    evidenceSignals.push("proper external organization form");
  }

  if (sentenceEvidence >= 0.72) {
    // Sub-classify accurately into Carrier vs Vendor vs Supplier
    let chosenClass: EntityCategory = "Supplier";
    if (hasExplicitSupplierLabel) {
      chosenClass = "Supplier";
    } else if (hasExplicitVendorLabel && !/\b(?:freight|transit|carrier|shipping|rail|maritime|telemetry|on-time delivery)\b/i.test(nameLow + " " + sentLow)) {
      chosenClass = "Vendor";
    } else if (
      hasExplicitCarrierLabel ||
      /\b(?:freight|transit|carrier|carriers|shipping|rail|maritime|express|on-time\s+delivery|transit\s+variance|telemetry)\b/i.test(
        nameLow + " " + sentLow
      )
    ) {
      chosenClass = "Carrier";
    } else if (/\bvendor\b/i.test(sentLow)) {
      chosenClass = "Vendor";
    }

    return {
      category: chosenClass,
      confidence: parseFloat(Math.min(0.99, sentenceEvidence).toFixed(2)),
      is_confirmed_supplier: true,
      reason: `Verified as ${chosenClass} via ${evidenceSignals.join(" + ")}.`
    };
  }

  // 10. Uncertain classification -> exclude from confirmed suppliers, classify as Unverified
  return {
    category: "Unverified",
    confidence: parseFloat(Math.max(0.25, Math.min(0.65, sentenceEvidence)).toFixed(2)),
    is_confirmed_supplier: false,
    reason: "Insufficient sentence-level evidence confirming entity acts as a Supplier, Vendor, or Carrier.",
    exclusion_reason: "Unverified entity classification"
  };
}

function extractMetricsFromLine(rawLine: string): {
  on_time_rate?: string;
  target_sla?: string;
  transit_variance?: string;
  issues?: string;
} {
  const onTimeMatch =
    rawLine.match(/(?:On-?Time(?:\s+Delivery)?(?:\s+Rate)?\s*[:=]?\s*|OTD\s*[:=]?\s*)(\d+(?:\.\d+)?%)/i) ||
    rawLine.match(/(\d+(?:\.\d+)?%)\s*(?:on-?time(?:\s+delivery)?|otd)/i);
  const targetMatch = rawLine.match(/Target(?:\s+SLA)?\s*[:=]?\s*(\d+(?:\.\d+)?%)/i);
  const varMatch = rawLine.match(/Transit\s+Variance\s*[:=]?\s*([+-]?\d+(?:\.\d+)?\s*days?)/i);
  const latMatch = rawLine.match(/(?:latency|fulfillment\s+latency)[^.\n]*?(\d+(?:\.\d+)?\s*days?(?:\s+to\s+\d+(?:\.\d+)?\s*days?)?)/i);

  const issueParts: string[] = [];
  const slaMatch = rawLine.match(/SLA\s+Breach(?:\s+Count)?\s*[:=]?\s*(\d+\s*incidents?)/i);
  if (slaMatch) issueParts.push(`${slaMatch[1]} (SLA breaches)`);
  const dmgMatch = rawLine.match(/(?:In-Transit\s+)?(?:Shipment|Cargo)\s+Damage\s*[:=]?\s*(\d+(?:\.\d+)?%)/i);
  if (dmgMatch) issueParts.push(`${dmgMatch[1]} cargo damage`);
  const telMatch = rawLine.match(/(?:GPS\s+)?Telemetry\s+(?:Availability|Coverage)\s*[:=]?\s*(\d+(?:\.\d+)?%)/i);
  if (telMatch) issueParts.push(`${telMatch[1]} telemetry availability`);
  const noteAfterPipe = rawLine
    .split("|")
    .find((p) => /(breach|damage|telemetry|delay|backlog|congestion|constraint|penalty|risk)/i.test(p) && !/Transit\s+Variance/i.test(p));
  if (issueParts.length === 0 && noteAfterPipe) {
    issueParts.push(noteAfterPipe.trim());
  }

  return {
    on_time_rate: onTimeMatch?.[1],
    target_sla: targetMatch?.[1],
    transit_variance: varMatch?.[1] || latMatch?.[1],
    issues: issueParts.length > 0 ? issueParts.join("; ") : undefined
  };
}

/**
 * Full Named Entity Recognition & Contextual Entity Classification across all chunks/pages.
 * - Extracts candidates across all 11 entity types + Unverified
 * - Deduplicates across multiple pages while preserving all page/source occurrences
 * - Guarantees traceable supporting source text + page number for every returned supplier
 */
export function extractAndClassifyEntities(
  text: string,
  chunks?: DocumentChunk[],
  atomicTableRows?: AtomicTableRow[],
  docId?: number
): EntityExtractionSummary {
  const fallbackDocId = docId ?? chunks?.[0]?.document_id ?? 1;
  const sourceChunks: Array<{ chunk_id: string; page_number: number; section_title: string; content: string }> =
    chunks && chunks.length > 0
      ? chunks.map((c) => ({
          chunk_id: c.chunk_id,
          page_number: c.page_number,
          section_title: c.section_title,
          content: c.content
        }))
      : [{ chunk_id: `doc-${fallbackDocId}-p1-c0`, page_number: 1, section_title: "Document", content: text || "" }];

  const docLower = (text || "").toLowerCase();
  const candidates: CandidateMention[] = [];

  for (const chunk of sourceChunks) {
    const lines = (chunk.content || "").split("\n");
    let activeListCue: EntityCategory | undefined;

    for (const rawLine of lines) {
      const t = rawLine.trim();
      if (!t) {
        activeListCue = undefined;
        continue;
      }

      // Detect strict explicit entity list introducer ending in ":" (e.g. "Approved Suppliers:" or "Contracted Carriers:")
      // Never trigger on audit/report headings (Requirement 8)
      const listCueMatch = t.match(
        /^(?:Confirmed|Approved|Primary|Secondary|Active|Contracted|Authorized|Designated)?\s*(Suppliers?|Vendors?|Carriers?)(?:\s+(?:Mentioned|List|Directory))?\s*:\s*$/i
      );
      if (listCueMatch) {
        const kw = listCueMatch[1].toLowerCase();
        activeListCue = kw.startsWith("supplier") ? "Supplier" : kw.startsWith("vendor") ? "Vendor" : "Carrier";
        continue;
      }

      // Skip meeting action item structured rows for supplier extraction, but still note Department owners if helpful
      const isActionItem = /^\d+\.\s+[^|]+\|\s*[^|]+\|\s*(?:\d{1,2}\s+[A-Za-z]+\s+\d{4}|Q\d)/i.test(t);
      const isRootCause = /^\d+\.\s+(?:Cross-dock|Missing|Unclear|Systemic|Recurring|Elevated)/i.test(t);
      const { isHeading, isTableHeader } = detectHeadingOrTableHeaderLine(t, chunk.section_title);

      if (isTableHeader) {
        activeListCue = undefined;
        candidates.push({
          rawName: t.replace(/\s*\|\s*/g, " ").trim(),
          line: t,
          sentence: t,
          page_number: chunk.page_number,
          chunk_id: chunk.chunk_id,
          section_title: chunk.section_title,
          isHeadingLine: false,
          isTableHeaderLine: true
        });
        continue;
      }

      if (isHeading) {
        activeListCue = undefined;
        candidates.push({
          rawName: t,
          line: t,
          sentence: t,
          page_number: chunk.page_number,
          chunk_id: chunk.chunk_id,
          section_title: chunk.section_title,
          isHeadingLine: true,
          isTableHeaderLine: false
        });
        continue;
      }

      if (isActionItem) {
        activeListCue = undefined;
        const ownerPart = t.split("|")[0]?.replace(/^\d+\.\s*/, "").trim();
        if (ownerPart) {
          candidates.push({
            rawName: ownerPart,
            explicitRoleHint: "Department",
            line: t,
            sentence: t,
            page_number: chunk.page_number,
            chunk_id: chunk.chunk_id,
            section_title: chunk.section_title,
            isHeadingLine: false,
            isTableHeaderLine: false
          });
        }
        continue;
      }

      if (isRootCause) {
        activeListCue = undefined;
        continue;
      }

      const isPlainBullet = /^(?:[-•*]|\d+\.)\s+([A-Z][A-Za-z0-9&'.\-\s]{2,55})$/.test(t) && !t.includes(":") && !t.includes("|");
      if (isPlainBullet && activeListCue) {
        const cleaned = cleanCandidateSpan(t);
        if (cleaned.length >= 3) {
          candidates.push({
            rawName: cleaned,
            explicitRoleHint: activeListCue,
            line: t,
            sentence: `${activeListCue}: ${cleaned}`,
            page_number: chunk.page_number,
            chunk_id: chunk.chunk_id,
            section_title: chunk.section_title,
            isHeadingLine: false,
            isTableHeaderLine: false
          });
        }
        continue;
      } else if (!/^[-•*\d]/.test(t)) {
        activeListCue = undefined;
      }

      // 1. Explicit colon-labeled entities
      const labelRegex =
        /\b(Primary\s+Suppliers?|Secondary\s+Suppliers?|Approved\s+Suppliers?|Suppliers?|Vendors?|Carriers?|Freight\s+Partners?|Logistics\s+Partners?|Customers?|Clients?|Warehouses?|Facilities|Regions?|Locations?|Departments?|Products?)\s*[:\-]\s*([^|;\n.—–(\[]{2,65})/gi;
      let labelMatch: RegExpExecArray | null;
      while ((labelMatch = labelRegex.exec(t)) !== null) {
        const keyWord = labelMatch[1].toLowerCase();
        let hint: EntityCategory | undefined;
        if (/supplier/.test(keyWord)) hint = "Supplier";
        else if (/vendor/.test(keyWord)) hint = "Vendor";
        else if (/carrier|freight|logistics/.test(keyWord)) hint = "Carrier";
        else if (/customer|client/.test(keyWord)) hint = "Customer";
        else if (/warehouse|facilit/.test(keyWord)) hint = "Warehouse";
        else if (/region/.test(keyWord)) hint = "Region";
        else if (/location/.test(keyWord)) hint = "Location";
        else if (/department/.test(keyWord)) hint = "Department";
        else if (/product/.test(keyWord)) hint = "Product";

        const items = labelMatch[2].split(/\s*,\s*|\s+and\s+/i).map((x) => cleanCandidateSpan(x)).filter((x) => x.length >= 2);
        for (const item of items) {
          candidates.push({
            rawName: item,
            explicitRoleHint: hint,
            line: t,
            sentence: findSentenceContaining(chunk.content, item, t),
            page_number: chunk.page_number,
            chunk_id: chunk.chunk_id,
            section_title: chunk.section_title,
            isHeadingLine: false,
            isTableHeaderLine: false
          });
        }
      }

      // 2. Bulleted or pipe-delimited row entity prefix
      const bulletMatch = t.match(/^(?:[-•*]|\d+\.)\s+([A-Z][A-Za-z0-9&'.\-\s()]{2,50}?)(?:\s*[:|—–]\s+|\s+-\s+)(.+)$/);
      if (bulletMatch) {
        const prefix = cleanCandidateSpan(bulletMatch[1]);
        if (prefix.length >= 3) {
          candidates.push({
            rawName: prefix,
            line: t,
            sentence: findSentenceContaining(chunk.content, prefix, t),
            page_number: chunk.page_number,
            chunk_id: chunk.chunk_id,
            section_title: chunk.section_title,
            isHeadingLine: false,
            isTableHeaderLine: false
          });
        }
      } else if (t.includes("|")) {
        const cells = t.split("|").map((c) => c.trim()).filter(Boolean);
        if (cells.length >= 2) {
          const firstCell = cleanCandidateSpan(cells[0]);
          if (/^[A-Z][A-Za-z0-9&'.\-\s]{2,45}$/.test(firstCell)) {
            candidates.push({
              rawName: firstCell,
              line: t,
              sentence: findSentenceContaining(chunk.content, firstCell, t),
              page_number: chunk.page_number,
              chunk_id: chunk.chunk_id,
              section_title: chunk.section_title,
              isHeadingLine: false,
              isTableHeaderLine: false
            });
          }
        }
      }

      // 3. Relational phrasing (secondary supplier X, sourced by X, handled by X, etc.)
      const relSupplierRegex =
        /\b(?:primary\s+supplier|secondary\s+supplier|primary\s+vendor|backup\s+carrier|supplied\s+by|sourced\s+(?:from|by)|shipped\s+(?:via|by|through)|delivered\s+by|transported\s+by|handled\s+by|carried\s+by|fulfilled\s+by|operated\s+by|contracted\s+(?:with|by)|partnered\s+with)\s+([A-Z][A-Za-z0-9&'-]+(?:\s+[A-Z][A-Za-z0-9&'-]+){0,3})/g;
      let relM: RegExpExecArray | null;
      while ((relM = relSupplierRegex.exec(t)) !== null) {
        const cleaned = cleanCandidateSpan(relM[1]);
        if (cleaned.length >= 3) {
          candidates.push({
            rawName: cleaned,
            explicitRoleHint: /carrier/.test(relM[0].toLowerCase()) ? "Carrier" : "Supplier",
            line: t,
            sentence: findSentenceContaining(chunk.content, cleaned, t),
            page_number: chunk.page_number,
            chunk_id: chunk.chunk_id,
            section_title: chunk.section_title,
            isHeadingLine: false,
            isTableHeaderLine: false
          });
        }
      }

      // 4. Lexical NER spans: Organization suffixes, Supplier <Code>, Warehouse/Distribution spans, SKU/Product, Region
      const nerSpanRegex =
        /\b(?:Supplier\s+[A-Z0-9]+|Product\s+[A-Z0-9]+|Region\s+[A-Z0-9]+|(?:[A-Z]{2,6}-)*(?:SKU|ITEM|PART|MAT)-\d+|[A-Z][A-Za-z0-9&'.-]+(?:\s+[A-Z][A-Za-z0-9&'.-]+){0,4}\s+(?:Freight\s+Express|Logistics\s+Corp|Carrier\s+Partners|Transit\s+Services|Rail\s+Carriers|Maritime\s+Logistics|Freight\s+Services|Logistics\s+Pvt\.?\s+Ltd\.?|Transport\s+Co\.?|Logistics|Freight|Carriers?|Transit|Express|Transport|Shipping|Supply|Distribution(?:\s+(?:Centre|Center|Hub|Facility))?|Warehouse|Department|Division|Committee|Corp\.?|Corporation|Partners|Services|Inc\.?|Pvt\.?\s+Ltd\.?|Ltd\.?|LLC|Holdings|Group|Solutions|Co\.?))\b/g;
      let nerM: RegExpExecArray | null;
      while ((nerM = nerSpanRegex.exec(t)) !== null) {
        const cleaned = cleanCandidateSpan(nerM[0]);
        if (cleaned.length >= 3) {
          candidates.push({
            rawName: cleaned,
            line: t,
            sentence: findSentenceContaining(chunk.content, cleaned, t),
            page_number: chunk.page_number,
            chunk_id: chunk.chunk_id,
            section_title: chunk.section_title,
            isHeadingLine: false,
            isTableHeaderLine: false
          });
        }
      }
    }
  }

  // Pass B: Structured Atomic Table Extraction for Vendor / Carrier Scorecard tables
  const structuredMetricsByEntity = new Map<
    string,
    { on_time_rate?: string; target_sla?: string; transit_variance?: string; issues?: string }
  >();
  if (atomicTableRows && atomicTableRows.length > 0) {
    const grouped = new Map<string, AtomicTableRow[]>();
    for (const r of atomicTableRows) {
      if (docId !== undefined && r.doc_id !== docId) continue;
      const list = grouped.get(r.table_id) || [];
      list.push(r);
      grouped.set(r.table_id, list);
    }

    for (const rows of grouped.values()) {
      const hdrs = rows[0]?.header || [];
      if (hdrs.length < 2) continue;
      const hdrLow = hdrs.map((h) => h.trim().toLowerCase());
      const entityCol = hdrLow.findIndex((h) =>
        /\b(?:vendor|supplier|carrier|partner|provider)(?:\s+name)?\b/i.test(h)
      );
      if (entityCol < 0) continue;

      const otdCol = hdrLow.findIndex(
        (h) => /\b(?:on[-\s]?time|otd)\b/i.test(h) && !/\b(?:target|sla)\b/i.test(h)
      );
      const slaCol = hdrLow.findIndex((h) => /\b(?:target(?:\s+sla)?|sla)\b/i.test(h));
      const varCol = hdrLow.findIndex((h) => /\btransit\s+variance\b/i.test(h));
      const dmgCol = hdrLow.findIndex((h) => /\bdamage\b/i.test(h));
      const ratCol = hdrLow.findIndex((h) => /\brating\b/i.test(h));
      const isDeliveryIdTable = hdrLow.some((h) => /\b(?:delivery\s*id|shipment\s*id|route)\b/i.test(h));
      const roleHint: EntityCategory = /\bcarrier\b/i.test(hdrLow[entityCol]) ? "Carrier" : /\bsupplier\b/i.test(hdrLow[entityCol]) ? "Supplier" : "Vendor";

      for (const row of rows) {
        const rawCell = cleanCandidateSpan(row.cells[entityCol] || "");
        if (!rawCell || rawCell.length < 2) continue;
        const pageChunks = sourceChunks.filter((c) => c.page_number === row.page);
        const matchChunk =
          pageChunks.find((c) => c.content.toLowerCase().includes(rawCell.toLowerCase())) ||
          pageChunks[0];
        const verbatimLine =
          (matchChunk?.content || "")
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l.toLowerCase().includes(rawCell.toLowerCase())) || row.cells.join(" ");

        candidates.push({
          rawName: rawCell,
          explicitRoleHint: roleHint,
          line: row.raw_row_text,
          sentence: verbatimLine,
          page_number: row.page,
          chunk_id: matchChunk?.chunk_id || `doc-${fallbackDocId}-p${row.page}-c0`,
          section_title: matchChunk?.section_title || "Document",
          isHeadingLine: false,
          isTableHeaderLine: false
        });

        if (!isDeliveryIdTable && (otdCol >= 0 || slaCol >= 0 || varCol >= 0 || dmgCol >= 0 || ratCol >= 0)) {
          const eKey = rawCell.toLowerCase();
          const cur = structuredMetricsByEntity.get(eKey) || {};
          if (!cur.on_time_rate && otdCol >= 0 && row.cells[otdCol]) cur.on_time_rate = row.cells[otdCol].trim();
          if (!cur.target_sla && slaCol >= 0 && row.cells[slaCol]) cur.target_sla = row.cells[slaCol].trim();
          if (!cur.transit_variance && varCol >= 0 && row.cells[varCol]) cur.transit_variance = row.cells[varCol].trim();
          const issueBits: string[] = [];
          if (dmgCol >= 0 && row.cells[dmgCol]) issueBits.push(`Damage: ${row.cells[dmgCol].trim()}`);
          if (ratCol >= 0 && row.cells[ratCol]) issueBits.push(`Rating: ${row.cells[ratCol].trim()}`);
          if (!cur.issues && issueBits.length > 0) cur.issues = issueBits.join("; ");
          structuredMetricsByEntity.set(eKey, cur);
        }
      }
    }
  }

  // Classify & Deduplicate across all pages
  const entityMap = new Map<string, ClassifiedEntity>();

  for (const cand of candidates) {
    const cleanName = cand.rawName.replace(/[,:;.\s]+$/, "").trim();
    if (cleanName.length < 3 || cleanName.length > 85) continue;

    // Ignore entities mentioned solely inside negative-existence disclaimers (e.g. "does not contain any records ... concerning Product X or Region A")
    const candSent = cand.sentence || cand.line || "";
    if (
      /\b(?:does\s+not\s+(?:contain|include|mention|cover)|do\s+not\s+(?:contain|include|mention)|no\s+records?\s+(?:or\s+metrics\s+)?(?:of|for|concerning|regarding)|absent\s+from|not\s+(?:present|mentioned|included)\s+in)\b/i.test(
        candSent
      )
    ) {
      continue;
    }

    // Must exist verbatim in source document (unless table header stripped pipes)
    const verbatimCheck = cand.isTableHeaderLine
      ? cleanName.split(/\s+/).every((tok) => docLower.includes(tok.toLowerCase()))
      : docLower.includes(cleanName.toLowerCase());
    if (!verbatimCheck) continue;

    const classification = classifyEntityCandidate({ ...cand, rawName: cleanName });
    const key = cleanName.toLowerCase();

    // Cross-page deduplication + short-form corporate merge (e.g., "Delta Logistics" -> "Delta Logistics Corp")
    let targetKey = key;
    if (classification.is_confirmed_supplier) {
      for (const [eKey, eVal] of entityMap.entries()) {
        if (!eVal.is_confirmed_supplier) continue;
        if (eKey !== key && eKey.startsWith(key + " ")) {
          targetKey = eKey;
          break;
        }
        if (eKey !== key && key.startsWith(eKey + " ")) {
          // Promote shorter prefix entry into the fuller corporate name
          entityMap.delete(eKey);
          entityMap.set(key, {
            ...eVal,
            name: cleanName,
            normalized_name: key
          });
          targetKey = key;
          break;
        }
      }
    }

    const lineMetrics = classification.is_confirmed_supplier ? extractMetricsFromLine(cand.line) : {};
    const structMetrics = classification.is_confirmed_supplier ? structuredMetricsByEntity.get(key) : undefined;
    const metrics = {
      on_time_rate: lineMetrics.on_time_rate || structMetrics?.on_time_rate,
      target_sla: lineMetrics.target_sla || structMetrics?.target_sla,
      transit_variance: lineMetrics.transit_variance || structMetrics?.transit_variance,
      issues: lineMetrics.issues || structMetrics?.issues
    };
    const existing = entityMap.get(targetKey);

    const isPrimaryIdentification =
      classification.is_confirmed_supplier &&
      (Boolean(cand.explicitRoleHint && ["Supplier", "Vendor", "Carrier"].includes(cand.explicitRoleHint)) ||
        /\b(?:supplier|vendor|carrier|freight\s+partner|logistics\s+partner)\s*[:\-]/i.test(cand.line || "") ||
        Boolean(metrics.on_time_rate || metrics.target_sla || metrics.transit_variance) ||
        /\b(?:audit\s+period|on-?time\s+delivery|transit\s+variance|sla\s+breach|primary\s+supplier|secondary\s+supplier)\b/i.test(
          cand.sentence || cand.line
        ));

    const occurrence = {
      page_number: cand.page_number,
      chunk_id: cand.chunk_id,
      section_title: cand.section_title,
      source_text: cand.sentence || cand.line,
      support_priority: isPrimaryIdentification ? 1 : 2,
      support_role: (isPrimaryIdentification ? "Primary Identification" : "Supporting Context") as
        | "Primary Identification"
        | "Supporting Context"
    };

    if (!existing) {
      entityMap.set(targetKey, {
        name: cleanName,
        normalized_name: targetKey,
        category: classification.category,
        confidence: classification.confidence,
        is_confirmed_supplier: classification.is_confirmed_supplier,
        supporting_sentence: cand.sentence || cand.line,
        section_title: cand.section_title,
        page_number: cand.page_number,
        chunk_id: cand.chunk_id,
        occurrences: [occurrence],
        classification_reason: classification.reason,
        exclusion_reason: classification.exclusion_reason,
        ...metrics
      });
    } else {
      // Merge multi-page occurrences without duplication
      const alreadyHasOcc = existing.occurrences.some(
        (o) => o.page_number === occurrence.page_number && o.source_text === occurrence.source_text
      );
      if (!alreadyHasOcc) {
        existing.occurrences.push(occurrence);
      }
      // If a later occurrence confirms it or provides better metrics/confidence, keep strongest verified evidence
      if (!existing.is_confirmed_supplier && classification.is_confirmed_supplier) {
        existing.category = classification.category;
        existing.is_confirmed_supplier = true;
        existing.confidence = classification.confidence;
        existing.supporting_sentence = cand.sentence || cand.line;
        existing.page_number = cand.page_number;
        existing.chunk_id = cand.chunk_id;
        existing.section_title = cand.section_title;
        existing.classification_reason = classification.reason;
        existing.exclusion_reason = undefined;
      }
      if (!existing.on_time_rate && metrics.on_time_rate) existing.on_time_rate = metrics.on_time_rate;
      if (!existing.target_sla && metrics.target_sla) existing.target_sla = metrics.target_sla;
      if (!existing.transit_variance && metrics.transit_variance) existing.transit_variance = metrics.transit_variance;
      if (!existing.issues && metrics.issues) existing.issues = metrics.issues;
    }
  }

  const allEntities = Array.from(entityMap.values());
  const confirmedSuppliers = allEntities.filter(
    (e) => e.is_confirmed_supplier && (e.category === "Supplier" || e.category === "Vendor" || e.category === "Carrier")
  );

  // Verified Cross-Page Supporting Occurrence Pass for confirmed suppliers:
  // Ensures secondary monitoring/approval/audit pages mentioning a confirmed supplier are captured,
  // excluding bare headings and negative/absent statements, and sorted with Primary Identification first.
  for (const sup of confirmedSuppliers) {
    const escapedSup = sup.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const supBoundaryRegex = new RegExp(`(?:^|[^a-zA-Z0-9])${escapedSup}(?:$|[^a-zA-Z0-9])`, "i");

    for (const chunk of sourceChunks) {
      if (!supBoundaryRegex.test(chunk.content || "")) continue;
      const lines = (chunk.content || "").split("\n");
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !supBoundaryRegex.test(line)) continue;
        const headerCheck = detectHeadingOrTableHeaderLine(line, chunk.section_title);
        if (headerCheck.isHeading || headerCheck.isTableHeader) continue;

        const exactSentence = findSentenceContaining(chunk.content, sup.name, line);
        if (!exactSentence || !supBoundaryRegex.test(exactSentence)) continue;
        // Skip negative/exclusion clauses (do not treat "does not include X" as supporting evidence)
        if (/\b(?:does\s+not\s+(?:contain|include|mention)|no\s+records?\s+(?:of|for)|not\s+(?:present|mentioned|included)|excluded)\b/i.test(exactSentence)) {
          continue;
        }
        // Require substantive supplier/monitoring/audit/operational context in the sentence
        if (
          !/\b(?:supplier|vendor|carrier|freight|transit|approved|monitoring|monitored|audit|sla|on-?time|delivery|variance|breach|damage|telemetry|contract|sourcing|reallocate|escalat|recover|compliance|latency|shipped|delivered|supplied|handled|primary|secondary)\b/i.test(
            exactSentence
          )
        ) {
          continue;
        }

        const isPrimary =
          /\b(?:supplier|vendor|carrier|freight\s+partner|logistics\s+partner)\s*[:\-]/i.test(exactSentence) ||
          /\b(?:audit\s+period|on-?time\s+delivery|transit\s+variance|sla\s+breach|primary\s+supplier|secondary\s+supplier)\b/i.test(
            exactSentence
          );

        const alreadyExists = sup.occurrences.some(
          (o) =>
            o.page_number === chunk.page_number &&
            o.chunk_id === chunk.chunk_id &&
            (o.source_text.toLowerCase() === exactSentence.toLowerCase() ||
              o.source_text.toLowerCase().includes(exactSentence.toLowerCase()) ||
              exactSentence.toLowerCase().includes(o.source_text.toLowerCase()))
        );
        if (!alreadyExists) {
          sup.occurrences.push({
            page_number: chunk.page_number,
            chunk_id: chunk.chunk_id,
            section_title: chunk.section_title,
            source_text: exactSentence,
            support_priority: isPrimary ? 1 : 2,
            support_role: isPrimary ? "Primary Identification" : "Supporting Context"
          });
        }
      }
    }

    sup.occurrences.sort((a, b) => (a.support_priority || 2) - (b.support_priority || 2) || a.page_number - b.page_number);
    if (sup.occurrences.length > 0) {
      const primaryOcc = sup.occurrences[0];
      sup.page_number = primaryOcc.page_number;
      sup.chunk_id = primaryOcc.chunk_id;
      sup.section_title = primaryOcc.section_title;
      sup.supporting_sentence = primaryOcc.source_text;
    }
  }

  const unverifiedEntities = allEntities.filter((e) => e.category === "Unverified");
  const rawExcluded = allEntities.filter((e) => !e.is_confirmed_supplier && e.category !== "Unverified");
  // Collapse substring duplicates across excluded entities (e.g. "South Distribution" absorbed by "South Distribution Centre")
  const excludedEntities = rawExcluded.filter((ent) => {
    const key = ent.normalized_name;
    const isShortSubstring = rawExcluded.some(
      (other) =>
        other !== ent &&
        other.normalized_name.length > key.length &&
        (other.normalized_name.startsWith(key + " ") ||
          (other.category === ent.category && other.normalized_name.endsWith(" " + key)))
    );
    return !isShortSubstring;
  });

  return {
    confirmed_suppliers: confirmedSuppliers,
    unverified_entities: unverifiedEntities,
    excluded_entities: excludedEntities,
    all_entities: allEntities
  };
}

/**
 * Independent Critic Helper:
 * Audits whether an arbitrary entity string in a confirmed supplier output
 * is genuinely a verified Supplier / Vendor / Carrier with source evidence in `text`,
 * or whether it is a non-supplier entity (heading, financial metric, warehouse, region, etc.).
 */
export function auditEntityClassificationInDocument(
  entityName: string,
  text: string,
  chunks?: DocumentChunk[],
  atomicTableRows?: AtomicTableRow[],
  docId?: number
): {
  is_valid_supplier: boolean;
  detected_category: EntityCategory;
  reason: string;
} {
  const clean = (entityName || "").trim();
  const docLower = (text || "").toLowerCase();
  const fallbackDocId = docId ?? chunks?.[0]?.document_id ?? 1;
  if (!clean || !docLower.includes(clean.toLowerCase())) {
    return {
      is_valid_supplier: false,
      detected_category: "Unverified",
      reason: `Entity "${clean}" does not exist verbatim in active document.`
    };
  }

  const summary = extractAndClassifyEntities(text, chunks, atomicTableRows, docId);
  const key = clean.toLowerCase();

  const confirmedMatch = summary.confirmed_suppliers.find(
    (e) => e.normalized_name === key || e.normalized_name.startsWith(key + " ") || key.startsWith(e.normalized_name + " ")
  );
  if (confirmedMatch) {
    if (!confirmedMatch.supporting_sentence || !confirmedMatch.page_number) {
      return {
        is_valid_supplier: false,
        detected_category: confirmedMatch.category,
        reason: `Supplier "${clean}" lacks supporting source sentence or page provenance.`
      };
    }
    return {
      is_valid_supplier: true,
      detected_category: confirmedMatch.category,
      reason: confirmedMatch.classification_reason
    };
  }

  const excludedOrUnverified = summary.all_entities.find((e) => e.normalized_name === key);
  if (excludedOrUnverified) {
    return {
      is_valid_supplier: false,
      detected_category: excludedOrUnverified.category,
      reason: `Entity "${clean}" classified as "${excludedOrUnverified.category}" (${excludedOrUnverified.exclusion_reason || excludedOrUnverified.classification_reason}), NOT a confirmed Supplier/Vendor/Carrier.`
    };
  }

  // Fallback direct single-entity classification against its source chunk/line
  const hitChunk = (chunks || []).find((c) => c.content.toLowerCase().includes(key));
  const hitLine =
    (hitChunk?.content || text || "")
      .split("\n")
      .find((l) => l.toLowerCase().includes(key)) || clean;
  const headerFlags = detectHeadingOrTableHeaderLine(hitLine, hitChunk?.section_title);
  const directEval = classifyEntityCandidate({
    rawName: clean,
    line: hitLine,
    sentence: findSentenceContaining(hitChunk?.content || text, clean, hitLine),
    page_number: hitChunk?.page_number || 1,
    chunk_id: hitChunk?.chunk_id || `doc-${fallbackDocId}-p1-c0`,
    section_title: hitChunk?.section_title || "Document",
    isHeadingLine: headerFlags.isHeading,
    isTableHeaderLine: headerFlags.isTableHeader
  });

  return {
    is_valid_supplier: directEval.is_confirmed_supplier,
    detected_category: directEval.category,
    reason: directEval.reason
  };
}

