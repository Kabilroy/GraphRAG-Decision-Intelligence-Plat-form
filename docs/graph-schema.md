# Neo4j Knowledge Graph Schema Documentation

## Executive Overview
The Knowledge Graph models enterprise entity relationships across operational domains (Sales, Customers, Products, Supply Chain, Human Resources, Documentation, and Operational Problems).

---

## Nodes Justification & Schema

Each node in this schema is intentionally included because it participates in at least one root-cause decision intelligence path used by the platform (specifically demonstrated in the Product X sales decline investigation scenario). Unused decorative nodes (such as generic `Campaign` or `Department` nodes) are excluded to maintain clean GraphRAG retrieval performance.

### 1. `Customer`
- **Properties**: `id` (int), `name` (string), `segment` (string, e.g., 'Enterprise', 'SMB'), `region_id` (int)
- **Role**: Originator of purchases and regional demand trends.

### 2. `Product`
- **Properties**: `id` (int), `name` (string), `category_id` (int), `supplier_id` (int), `unit_price` (float)
- **Role**: Target of financial analysis and performance root cause investigations.

### 3. `Category`
- **Properties**: `id` (int), `name` (string)
- **Role**: Product group classification for aggregate trend analysis.

### 4. `Supplier`
- **Properties**: `id` (int), `name` (string), `region_id` (int), `reliability_score` (float)
- **Role**: Supply chain source node linked directly to product delivery fulfillment.

### 5. `Region`
- **Properties**: `id` (int), `name` (string), `country` (string)
- **Role**: Geographic boundary for regional sales performance and operational context.

### 6. `Employee`
- **Properties**: `id` (int), `name` (string), `role` (string), `region_id` (int)
- **Role**: Account/region management owner.

### 7. `Document`
- **Properties**: `id` (int, **shared key** matching Postgres `documents.id` and Qdrant vector payload), `title` (string), `doc_type` (string), `storage_path` (string)
- **Role**: Bridges unstructured text chunks in vector storage with graph entities.

### 8. `Problem`
- **Properties**: `id` (string/int), `description` (string), `severity` (string), `reported_date` (string)
- **Role**: Operational anomaly or bottleneck entity (e.g., "Supplier Y Delivery Delays Q3") linked directly to affected products and described in internal documents.

---

## Graph Relationships

1. `(:Customer)-[:PURCHASED {quantity: Int, revenue: Float, sale_date: String}]->(:Product)`
2. `(:Product)-[:BELONGS_TO]->(:Category)`
3. `(:Product)-[:SUPPLIED_BY]->(:Supplier)`
4. `(:Customer)-[:LOCATED_IN]->(:Region)`
5. `(:Supplier)-[:OPERATES_IN]->(:Region)`
6. `(:Employee)-[:MANAGES]->(:Region)`
7. `(:Product)-[:AFFECTED_BY]->(:Problem)`
8. `(:Document)-[:DESCRIBES]->(:Problem)`

---

## Cypher Template & Guardrail Enforcement

All Cypher queries are executed using a **read-only Neo4j driver credential**. Before execution, generated Cypher queries pass through a strict regex validator that enforces:
1. `MATCH` or `OPTIONAL MATCH` starting statements only.
2. Complete rejection of mutating keywords: `CREATE|MERGE|DELETE|SET|REMOVE|DROP|DETACH|CALL`.
3. Allow-list verification against known edge relationship types (`PURCHASED`, `BELONGS_TO`, `SUPPLIED_BY`, `LOCATED_IN`, `OPERATES_IN`, `MANAGES`, `AFFECTED_BY`, `DESCRIBES`).
