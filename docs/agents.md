# Agent Architecture & Multi-Agent Pipeline Documentation

## Overview

The Enterprise Decision Intelligence Platform uses an explicit state graph orchestrated by **LangGraph**. The workflow handles complex enterprise questions by decomposing them into a multi-phase investigation:

`Question → Supervisor Plan → Parallel Retrieval (SQL + Graph + RAG) → Analytics Math → Forecasting → Decision Agent → Critic Validation → Response`

---

## Shared State Model (`AgentState`)

```typescript
export interface AgentState {
  session_id: string;
  question: string;
  plan: {
    intent: "descriptive" | "diagnostic" | "predictive" | "prescriptive";
    needs_sql: boolean;
    needs_graph: boolean;
    needs_docs: boolean;
    needs_forecast: boolean;
    reasoning: string;
  };
  sql_evidence?: {
    query: string;
    rows: Array<Record<string, any>>;
    row_count: number;
    execution_ms: number;
  };
  graph_evidence?: {
    cypher: string;
    paths: Array<{
      source: string;
      relation: string;
      target: string;
      details?: Record<string, any>;
    }>;
    raw_nodes: Array<any>;
  };
  doc_evidence?: {
    chunks: Array<{
      document_id: number;
      title: string;
      chunk_text: string;
      score: number;
      doc_type: string;
    }>;
  };
  analytics_result?: {
    metrics: Record<string, number | string>;
    period_over_period_pct: number;
    trend: string;
    anomaly_detected: boolean;
    anomaly_score: number;
  };
  forecast_result?: {
    status: "success" | "insufficient_history";
    point_estimates: Array<{ period: string; predicted_revenue: number }>;
    lower_bounds: number[];
    upper_bounds: number[];
    confidence_interval_pct: number;
    historical_periods_used: number;
  };
  decision?: {
    root_cause: string;
    recommendation: string;
    priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    evidence_refs: Array<{
      id: string;
      type: "sql" | "graph" | "doc" | "analytics";
      summary: string;
    }>;
    assumptions: string[];
  };
  validation_result?: {
    is_valid: boolean;
    number_check_passed: boolean;
    contradictions_found: boolean;
    confidence_score: number;
    score_breakdown: {
      evidence_completeness: number; // 0.0 - 1.0
      source_agreement: number;     // 0.0 - 1.0
      data_recency: number;         // 0.0 - 1.0
      statistical_significance: number; // 0.0 - 1.0
    };
    feedback: string;
  };
  iteration_count: number; // Hard cap at 3
  errors: string[];
}
```

---

## Agent Node Roles & Specifications

### 1. Supervisor / Planner Agent
- **Function**: Classifies user intent and produces structured planning flags (`needs_sql`, `needs_graph`, `needs_docs`, `needs_forecast`).
- **Structured Output**: Enforced JSON Schema via LLM provider.

### 2. SQL Agent
- **Function**: Generates read-only SQL queries against Postgres schema views.
- **Guardrails**: `SELECT`-only, mandatory row limit, strict validation against disallowed tables or system metadata.
- **Traceability**: Stalls and logs exact SQL query executed under `session_id`.

### 3. GraphRAG Agent
- **Function**: Queries Neo4j Knowledge Graph via parameterized Cypher templates or validated Cypher MATCH statements.
- **Result**: Traversed multi-hop subgraphs (e.g. `Product X -> Supplier Y -> Region A -> Problem`).

### 4. RAG Agent
- **Function**: Computes query embeddings using BGE-M3 and performs top-K cosine similarity search against Qdrant vector database (`business_documents` collection).
- **Output**: Ranked chunks tied directly to `document_id`.

### 5. Analytics Agent
- **Function**: Receives raw SQL evidence rows and performs **all arithmetic computations in Pandas / NumPy**.
- **Rule**: The LLM is strictly prohibited from generating numbers; all growth percentages and sums originate in this node.

### 6. Forecasting Agent
- **Function**: Evaluates historical time-series data. Executes linear baseline or XGBoost forecast model with confidence intervals.
- **Safety**: Automatically returns `insufficient_history` if historical periods < 6.

### 7. Decision Agent
- **Function**: Synthesizes SQL, Graph, RAG, Analytics, and Forecast results into an actionable executive root cause and strategic recommendation.
- **Traceability**: Every claim must explicitly cite an `evidence_ref` ID (e.g. `[Ref: SQL-1]`, `[Ref: Graph-2]`, `[Ref: Doc-3]`).

### 8. Critic / Validation Agent
- **Function**: Verifies evidence citations, compares numerical claims against Analytics Agent outputs, and computes the deterministic **Confidence Score**.
- **Iteration Cap**: Re-routes back to Supervisor up to 3 times if validation fails. After 3 iterations, returns partial results with an explicit "insufficient evidence" disclaimer.

---

## Computed Confidence Score Formula

Confidence score is calculated deterministically as a weighted sum:

$$\text{Confidence Score} = 0.40 \cdot E + 0.30 \cdot A + 0.20 \cdot R + 0.10 \cdot S$$

Where:
- **$E$ (Evidence Completeness)**: Fraction of required retrieval sources (SQL, Graph, Docs) that successfully returned non-empty evidence ($0.0 - 1.0$).
- **$A$ (Source Agreement)**: Alignment metric verifying that SQL metrics, Graph problem relationships, and Document text corroborates the same root cause ($0.0 - 1.0$).
- **$R$ (Data Recency)**: Recency score based on the latest transaction / report date ($0.0 - 1.0$).
- **$S$ (Statistical Significance)**: Significance measure based on dataset row volume and variance ($0.0 - 1.0$).
