export type QueryCategory =
  | "A_ENTITY_EXTRACTION"
  | "B_SECTION_HEADING_LISTING"
  | "C_ACTION_ITEM_EXTRACTION"
  | "D_FINANCIAL_TABLE_CALCULATION"
  | "FINANCIAL_COMPARATIVE_ANALYSIS"
  | "E_INVENTORY_THRESHOLD_CHECK"
  | "F_ROOT_CAUSE_DIAGNOSIS"
  | "G_RELATIONSHIP_GRAPHRAG_QUERY"
  | "H_AGGREGATION_SUMMARY"
  | "I_COMPARISON_RANKING"
  | "J_RECOMMENDATION_EXTRACTION"
  | "K_MISSING_INFO_DETECTION";

export interface DocumentChunk {
  document_id: number;
  document_name: string;
  chunk_id: string;
  chunk_index: number;
  page_number: number;
  section_title: string;
  content: string;
  /** Kept for frontend compatibility alongside `content` */
  text: string;
  content_type: "text" | "table";
  source_version: string;
  vector: number[];
  metadata?: Record<string, any>;
}

export interface DocumentSection {
  section_number: number;
  section_title: string;
  page_number: number;
  chunk_ids: string[];
  raw_text: string;
}

export interface DocumentSQLRecord {
  table_name: string;
  document_id: number;
  source_version: string;
  columns: string[];
  rows: Array<Record<string, any>>;
}

export interface DocumentGraphEntity {
  id: string;
  label: string;
  name: string;
  document_id: number;
  source_chunk_id: string;
  source_page: number;
  extraction_timestamp: string;
  properties?: Record<string, any>;
}

export interface DocumentGraphRelationship {
  source: string;
  relation: string;
  target: string;
  document_id: number;
  source_chunk_id: string;
  source_page: number;
  extraction_timestamp: string;
  properties?: Record<string, any>;
}

export type QuestionIntent = "lookup" | "metric_comparison" | "aggregation" | "summary" | "other";
export type ComparisonDirection = "lowest" | "highest" | "best" | "worst" | "top_n" | null;
export type ConfidenceLabel = "verified-text" | "verified-table" | "ocr-low-confidence";

export interface ParsedQuestionIntent {
  intent: QuestionIntent;
  metric: string | null;
  entity_type: string | null;
  direction: ComparisonDirection;
  top_n?: number;
}

export interface PageExtractionRecord {
  page_num: number;
  text: string;
  raw_text: string;
  extraction: "text" | "ocr" | "unparsed";
  ocr_used: boolean;
  parse_error?: string;
}

export interface AtomicTableRow {
  doc_id: number;
  page: number;
  table_id: string;
  header: string[];
  cells: string[];
  raw_row_text: string;
  extraction: "text" | "table" | "ocr";
  continued_from_page?: number;
}

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
  intent: QuestionIntent;
  parsed_intent?: ParsedQuestionIntent;
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

export interface DemoDocument {
  id: number;
  title: string;
  doc_type: string;
  storage_path: string;
  uploaded_at: string;
  is_uploaded?: boolean;
  is_active?: boolean;
  pdf_base64?: string;
  source_version: string;
  extraction_status: "INDEXED" | "SCANNED_PDF_OCR_UNAVAILABLE" | "EXTRACTION_FAILED";
  extraction_notes?: string;
  content: string;
  pages_count: number;
  raw_pages: PageExtractionRecord[];
  atomic_table_rows: AtomicTableRow[];
  unparsed_pages: number[];
  sections: DocumentSection[];
  chunks: DocumentChunk[];
  sql_records: DocumentSQLRecord[];
  graph_nodes: DocumentGraphEntity[];
  graph_edges: DocumentGraphRelationship[];
}

export interface RetrievedChunkResult {
  document_id: number;
  document_name: string;
  chunk_id: string;
  page_number: number;
  section_title: string;
  content: string;
  content_type: "text" | "table";
  source_version: string;
  title: string;
  doc_type: string;
  chunk_text: string;
  score: number;
  dense_score: number;
  keyword_score: number;
  section_boost: number;
}

export interface QueryClassificationResult {
  category: QueryCategory;
  is_missing_or_out_of_scope: boolean;
  missing_entities: string[];
  requires_exhaustive_scan: boolean;
  needs_sql: boolean;
  needs_graph: boolean;
  reasoning: string;
  target_section_keywords: string[];
  excluded_section_keywords: string[];
  parsed_intent?: ParsedQuestionIntent;
}

export interface SQLEvidenceResult {
  query: string;
  parameters: Array<string | number>;
  is_valid: boolean;
  rows: Array<Record<string, any>>;
  row_count: number;
  execution_ms: number;
  table_inspected: string;
  status_message?: string;
  conflicts_with_pdf?: string[];
}

export interface GraphEvidenceResult {
  cypher: string;
  is_valid: boolean;
  skipped?: boolean;
  paths: Array<{
    source: string;
    relation: string;
    target: string;
    document_id: number;
    source_chunk_id: string;
    source_page: number;
    extraction_timestamp: string;
  }>;
  raw_nodes: Array<{
    id: string;
    label: string;
    name: string;
    document_id: number;
    source_chunk_id: string;
    source_page: number;
    extraction_timestamp: string;
    properties?: Record<string, any>;
  }>;
  status_message?: string;
}

export interface ExtractedFact {
  statement: string;
  value?: string;
  unit_or_currency?: string;
  page_number: number;
  chunk_id: string;
  section_title: string;
}

export interface CalculatedValue {
  metric: string;
  formula: string;
  result: string;
  source_inputs: string[];
}

export type EntityCategory =
  | "Supplier"
  | "Vendor"
  | "Carrier"
  | "Customer"
  | "Product"
  | "Region"
  | "Warehouse"
  | "Location"
  | "Department"
  | "Document heading"
  | "Financial metric"
  | "Unverified";

export interface EntityOccurrence {
  page_number: number;
  chunk_id: string;
  section_title: string;
  source_text: string;
  support_priority?: number;
  support_role?: "Primary Identification" | "Supporting Context";
}

export interface ClassifiedEntity {
  name: string;
  normalized_name: string;
  category: EntityCategory;
  confidence: number;
  is_confirmed_supplier: boolean;
  supporting_sentence: string;
  section_title: string;
  page_number: number;
  chunk_id: string;
  occurrences: EntityOccurrence[];
  classification_reason: string;
  exclusion_reason?: string;
  on_time_rate?: string;
  target_sla?: string;
  transit_variance?: string;
  issues?: string;
}

export interface EntityExtractionSummary {
  confirmed_suppliers: ClassifiedEntity[];
  unverified_entities: ClassifiedEntity[];
  excluded_entities: ClassifiedEntity[];
  all_entities: ClassifiedEntity[];
}

export interface InventoryRecordPayload {
  sku: string;
  item_description: string;
  current_stock: number;
  reorder_point: number;
  deficit: number;
  status: "BELOW REORDER POINT" | "Above Reorder Point";
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

export interface EvidencePackage {
  active_document_id: number;
  active_document_name: string;
  source_document_version: string;
  investigation_id: string;
  current_user_query: string;
  query_category: QueryCategory;
  entity_classification?: EntityExtractionSummary;
  inventory_analysis?: InventoryAnalysisPayload;
  qa_result?: VerifiedQAResult;
  unparsed_pages?: number[];
  directly_extracted_facts: ExtractedFact[];
  calculated_values: CalculatedValue[];
  interpretations: string[];
  optional_recommendations: string[];
  missing_information: string[];
  conflicts_detected: string[];
  source_citations: Array<{
    document_id: number;
    document_name: string;
    chunk_id: string;
    page_number: number;
    section_title: string;
    source_excerpt: string;
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

export interface MultiFactorScoreBreakdown {
  retrieval_relevance: number;
  evidence_coverage: number;
  source_provenance: number;
  numerical_consistency: number;
  entity_consistency: number;
  citation_validity: number;
  cross_source_agreement: number;
  // Backward-compatible summary fields used in UI
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

export interface CriticValidationResult {
  is_valid: boolean;
  validation_status: "PASSED" | "REJECTED" | "INSUFFICIENT_EVIDENCE" | "CONFLICT_DETECTED";
  number_check_passed: boolean;
  contradictions_found: boolean;
  confidence_score: number;
  score_breakdown: MultiFactorScoreBreakdown;
  checklist: CriticChecklistItem[];
  rejection_reasons: string[];
  feedback: string;
}

export interface InvestigationDiagnostics {
  active_document_id: number;
  active_document_name: string;
  source_document_version: string;
  investigation_id: string;
  current_user_query: string;
  query_classification: QueryCategory;
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
    confirmed_suppliers: Array<{ name: string; category: EntityCategory; page_number: number; source_text: string }>;
    unverified_entities: Array<{ name: string; category: EntityCategory; page_number: number; reason: string }>;
    excluded_entities: Array<{ name: string; category: EntityCategory; page_number: number; reason: string }>;
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
