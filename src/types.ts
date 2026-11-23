export type Role = "admin" | "analyst" | "viewer";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  company?: string;
  department?: string;
  token?: string;
  createdAt?: string;
}

export interface SQLEvidence {
  query: string;
  parameters?: Array<string | number>;
  is_valid: boolean;
  rows: Array<Record<string, any>>;
  row_count: number;
  execution_ms: number;
  table_inspected?: string;
  status_message?: string;
  conflicts_with_pdf?: string[];
}

export interface GraphPath {
  source: string;
  relation: string;
  target: string;
  document_id?: number;
  source_chunk_id?: string;
  source_page?: number;
  extraction_timestamp?: string;
}

export interface GraphEvidence {
  cypher: string;
  is_valid: boolean;
  skipped?: boolean;
  paths: GraphPath[];
  raw_nodes: Array<{
    id: string;
    label: string;
    name?: string;
    description?: string;
    severity?: string;
    reliability?: number;
    document_id?: number;
    source_chunk_id?: string;
    source_page?: number;
    extraction_timestamp?: string;
  }>;
  status_message?: string;
}

export interface ExtractedTable {
  headers: string[];
  rows: string[][];
  caption?: string;
  source_citation?: string;
}

export interface DocChunk {
  document_id: number;
  document_name?: string;
  chunk_id?: string;
  page_number?: number;
  section_title?: string;
  content?: string;
  content_type?: "text" | "table";
  source_version?: string;
  title: string;
  doc_type: string;
  chunk_text: string;
  score: number;
  dense_score?: number;
  keyword_score?: number;
}

export interface DocEvidence {
  chunks: DocChunk[];
}

export interface AnalyticsResult {
  q2_revenue_region_a: number;
  q3_revenue_region_a: number;
  revenue_delta_dollars: number;
  period_over_period_pct: number;
  other_regions_avg_growth_pct: number;
  anomaly_detected: boolean;
  anomaly_score: number;
  volatility_std: number;
}

export interface ForecastPoint {
  period: string;
  predicted_revenue: number;
}

export interface ForecastResult {
  status: "success" | "insufficient_history" | "not_applicable";
  historical_periods_used: number;
  point_estimates: ForecastPoint[];
  lower_bounds: number[];
  upper_bounds: number[];
  confidence_interval_pct: number;
}

export interface EvidenceRef {
  id: string;
  type: "sql" | "graph" | "doc" | "analytics";
  summary: string;
  page_number?: number;
  document_id?: number;
}

export interface UnverifiedEntityNote {
  name: string;
  category: string;
  page_number: number;
  supporting_sentence: string;
  reason: string;
}

export interface InventoryRecordPayload {
  sku: string;
  item_description: string;
  current_stock: number;
  reorder_point: number;
  deficit: number;
  status: string;
  source_page?: number;
}

export interface InventoryAnalysisPayload {
  query_mode: "largest_shortage" | "total_replenishment" | "below_reorder" | "above_reorder" | "all_records";
  inventory_records: InventoryRecordPayload[];
  total_records: number;
  total_below_reorder: number;
  total_above_reorder: number;
  total_replenishment_units: number;
  largest_shortage_sku: InventoryRecordPayload | null;
  largest_shortage_ties?: InventoryRecordPayload[];
  calculation_details: string;
  source_document_id: number;
  source_pages: number[];
}

export type ConfidenceLabel = "verified-text" | "verified-table" | "ocr-low-confidence";

export interface VerifiedMetricRecord {
  vendor: string;
  value: number;
  raw_value: string;
  unit: string;
  page: number;
  evidence: string;
  extraction: "text" | "table" | "ocr";
  confidence_label: ConfidenceLabel;
  verified: boolean;
  table_id?: string;
}

export interface VerifiedQAResult {
  document_id: number;
  document_name: string;
  page_count: number;
  question: string;
  intent: "lookup" | "metric_comparison" | "aggregation" | "summary" | "other";
  metric: string;
  answer: string;
  records: VerifiedMetricRecord[];
  method: string;
  ties: string[];
  records_compared: number;
  unparsed_pages: number[];
  status: "answered" | "insufficient_evidence";
  supporting_pages: number[];
  consistency_verified: boolean;
  dropped_unverified?: Array<{ vendor: string; value: string; page: number; reason: string }>;
}

export interface Decision {
  query_category?: string;
  answer_type?: "table" | "diagnostic" | "list" | "comparison" | "insufficient_evidence";
  title?: string;
  direct_answer?: string;
  table_data?: ExtractedTable;
  inventory_analysis?: InventoryAnalysisPayload;
  qa_result?: VerifiedQAResult;
  bullet_points?: string[];
  unverified_entities?: UnverifiedEntityNote[];
  conclusion?: string;
  root_cause: string;
  recommendation: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  source_citation?: string;
  source_document_title?: string;
  source_page?: number | string;
  evidence_refs: EvidenceRef[];
  assumptions: string[];
  insufficient_evidence_reason?: string;
}

export interface ScoreBreakdown {
  retrieval_relevance?: number;
  evidence_coverage?: number;
  source_provenance?: number;
  numerical_consistency?: number;
  entity_consistency?: number;
  citation_validity?: number;
  cross_source_agreement?: number;
  evidence_completeness: number;
  source_agreement: number;
  data_recency: number;
  statistical_significance: number;
}

export interface CriticChecklistItem {
  check_number: number;
  name: string;
  passed: boolean;
  detail: string;
}

export interface ValidationResult {
  is_valid: boolean;
  validation_status?: "PASSED" | "REJECTED" | "INSUFFICIENT_EVIDENCE" | "CONFLICT_DETECTED";
  number_check_passed: boolean;
  contradictions_found: boolean;
  confidence_score: number;
  score_breakdown: ScoreBreakdown;
  checklist?: CriticChecklistItem[];
  rejection_reasons?: string[];
  feedback: string;
}

export interface EvidencePackage {
  active_document_id: number;
  active_document_name: string;
  source_document_version: string;
  investigation_id: string;
  current_user_query: string;
  query_category: string;
  inventory_analysis?: InventoryAnalysisPayload;
  qa_result?: VerifiedQAResult;
  unparsed_pages?: number[];
  directly_extracted_facts: Array<{
    statement: string;
    value?: string;
    unit_or_currency?: string;
    page_number: number;
    chunk_id: string;
    section_title: string;
  }>;
  calculated_values: Array<{
    metric: string;
    formula: string;
    result: string;
    source_inputs: string[];
  }>;
  interpretations: string[];
  optional_recommendations: string[];
  missing_information: string[];
  conflicts_detected: string[];
  source_citations?: Array<{
    document_id: number;
    document_name: string;
    chunk_id: string;
    page_number: number;
    section_title: string;
    source_excerpt?: string;
    support_role?: string;
  }>;
  audit_source_citations?: Array<{
    document_id: number;
    document_name: string;
    chunk_id: string;
    page_number: number;
    section_title: string;
  }>;
}

export interface InvestigationDiagnostics {
  active_document_id: number;
  active_document_name: string;
  source_document_version: string;
  investigation_id: string;
  current_user_query: string;
  query_classification: string;
  retrieved_chunks_count: number;
  retrieved_page_numbers: number[];
  retrieval_relevance_scores: Array<{
    chunk_id: string;
    page_number: number;
    section_title: string;
    combined_score: number;
    dense_score: number;
    keyword_score: number;
  }>;
  sql_execution_status: string;
  neo4j_execution_status: string;
  evidence_validation_status: string;
  critic_rejection_reasons: string[];
  entity_classification?: {
    confirmed_suppliers: Array<{ name: string; category: string; page_number: number; source_text: string }>;
    unverified_entities: Array<{ name: string; category: string; page_number: number; reason: string }>;
    excluded_entities: Array<{ name: string; category: string; page_number: number; reason: string }>;
  };
  final_source_citations: Array<{
    document_id: number;
    chunk_id: string;
    page_number: number;
    section_title: string;
    source_excerpt?: string;
    support_role?: string;
  }>;
  audit_source_citations?: Array<{
    document_id: number;
    chunk_id: string;
    page_number: number;
    section_title: string;
  }>;
}

export interface AgentState {
  session_id: string;
  investigation_id?: string;
  active_document_id?: number;
  active_document_name?: string;
  source_document_version?: string;
  question: string;
  plan: {
    intent: string;
    needs_sql: boolean;
    needs_graph: boolean;
    needs_docs: boolean;
    needs_forecast: boolean;
    reasoning: string;
  };
  sql_evidence?: SQLEvidence;
  graph_evidence?: GraphEvidence;
  doc_evidence?: DocEvidence;
  analytics_result?: AnalyticsResult;
  forecast_result?: ForecastResult;
  evidence_package?: EvidencePackage;
  qa_result?: VerifiedQAResult;
  decision?: Decision;
  validation_result?: ValidationResult;
  diagnostics?: InvestigationDiagnostics;
  iteration_count: number;
  errors: string[];
}

export interface KPI {
  id: string;
  title: string;
  value: string;
  change: string;
  trend: "up" | "down" | "neutral";
  target: string;
}
