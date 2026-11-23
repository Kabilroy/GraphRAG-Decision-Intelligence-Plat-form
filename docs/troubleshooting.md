# Error Handling & Troubleshooting Matrix

| Failure Mode | API Error Code | System Handling & User Message |
|---|---|---|
| **Ollama Down / LLM Timeout** | `LLM_PROVIDER_UNAVAILABLE` | Gracefully falls back to cloud Gemini provider or returns structured degraded mode analysis based on stored deterministic SQL & Graph results. |
| **Neo4j Unreachable** | `NEO4J_CONNECTION_FAILED` | GraphRAG node sets `graph_evidence = null`. Supervisor notes degraded mode in decision output and lowers `evidence_completeness` score. |
| **Postgres Database Down** | `DATABASE_UNAVAILABLE` | Immediate 503 response with descriptive error message; session logged as failed. |
| **Qdrant Down** | `VECTOR_STORE_UNAVAILABLE` | RAG agent logs empty chunk list; decision agent relies on SQL + Graph with reduced document confidence. |
| **SQL Generation Invalid / Mutating** | `SQL_GUARDRAIL_VIOLATION` | Query validator rejects destructive SQL (`DROP`, `DELETE`, `;`). SQL Agent logs query rejection and regenerates `SELECT`-only code. |
| **Cypher Injection Attempt** | `CYPHER_GUARDRAIL_VIOLATION` | Query rejected before driver execution. Audit log records injection attempt. |
| **Agent Iteration Cap Hit (3 iterations)** | `CRITIC_ITERATION_EXCEEDED` | Critic agent terminates graph loop and returns partial evidence with explicit disclaimer: *"Insufficient evidence to fully validate 100% of claims."* |
| **Conflicting Evidence** | `EVIDENCE_CONTRADICTION` | Critic agent detects metric discrepancy, flags `contradictions_found = true`, reduces `source_agreement` component in confidence score. |
