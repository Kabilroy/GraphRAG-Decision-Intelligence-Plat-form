# API Reference & Endpoints

## Authentication & Users
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login (returns JWT token & role)
- `GET /api/auth/me` - Get current authenticated user profile

## Dashboard & Analytics
- `GET /api/dashboard/summary` - Enterprise KPI summary (Total revenue, Q/Q growth, active region performance)
- `GET /api/dashboard/kpis` - Detailed metric cards
- `GET /api/dashboard/trends` - Time series sales and regional breakdown data

## AI Decision Intelligence Engine
- `POST /api/ai/query` - Submits a natural language question, creates an `analysis_session`, initiates multi-agent investigation pipeline. Returns `{ session_id }`.
- `GET /api/ai/query/:session_id` - Retrieves state snapshot of an investigation session.
- `GET /api/ai/query/:session_id/stream` - SSE (Server-Sent Events) endpoint streaming real-time agent execution events and evidence filling.

## Knowledge Graph & Entities
- `GET /api/graph/entities` - Returns graph nodes and summary edge stats.
- `GET /api/graph/explore/:entity_id` - Returns multi-hop visual graph subgraph centered around `entity_id`.
- `POST /api/graph/query` - Executes validated Cypher query against read-only Neo4j engine.

## Documents & Vector Store
- `GET /api/documents` - List ingested documents in Postgres/Qdrant.
- `GET /api/documents/:id` - Get document metadata and vector chunks.
- `POST /api/data/upload` - Ingests document/CSV, chunking (~400-600 tokens with 15% overlap) and generating BGE-M3 embeddings.

## Reports & Settings
- `GET /api/reports` - List saved executive briefing reports.
- `POST /api/reports/generate` - Generates executive decision briefing (Markdown/PDF view).
- `GET /api/audit-logs` - Audit trail of system actions and security validation logs.
