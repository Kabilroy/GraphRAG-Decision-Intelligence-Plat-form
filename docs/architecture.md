# System Architecture & Technical Specifications

## Architectural Blueprint

```
+-------------------------------------------------------------------------------+
|                             React + TS Frontend                               |
| (Dashboard | AI Analyst | Evidence Tabs | Graph Explorer | Reports | Data)     |
+-------------------------------------------------------------------------------+
                                       |
                         REST APIs + SSE Stream (/ai/query)
                                       v
+-------------------------------------------------------------------------------+
|                           Express / FastAPI Gateway                           |
|                    (Auth, RBAC, Rate Limiting, Audit Logs)                    |
+-------------------------------------------------------------------------------+
                                       |
                  +--------------------+--------------------+
                  |                                         |
                  v                                         v
+-----------------------------------+     +-----------------------------------+
|      LangGraph Multi-Agent        |     |     Analytics & ML Engine         |
|  (Supervisor, SQL, Graph, RAG,    |     |  (Pandas Metrics, PoP %,          |
|   Analytics, Forecast, Decision,  |     |   XGBoost / Trend Forecaster)     |
|   Critic / Validation Agent)      |     +-----------------------------------+
+-----------------------------------+
                  |
        +---------+---------+--------------------+
        |                   |                    |
        v                   v                    v
+---------------+   +---------------+   +------------------+
| Postgres DB   |   | Neo4j Graph   |   | Qdrant Vector DB |
| (Read-Only)   |   | (Read-Only)   |   | (BGE-M3 Embed)   |
+---------------+   +---------------+   +------------------+
```

---

## Read-Only Security Model
1. **Postgres Role**: Queries originate from a read-only DB role (`SELECT` only).
2. **Neo4j Role**: Neo4j driver uses a restricted user with `MATCH` permissions.
3. **Guardrail Sanitizer**: Rejects multi-statement execution, `;` chaining, and mutating Cypher/SQL syntax before hitting DB drivers.

---

## Data Synchronization & Trace Key
Every user request generates a unique `analysis_session.id` trace key. All logs in Postgres, Cypher executions, and Qdrant queries carry this key for auditability.
