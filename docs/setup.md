# Local & Docker Compose Setup Guide

## Requirements
- Docker & Docker Compose (v2.20+)
- Minimum RAM: 8GB (Recommended: 16GB+ RAM)
- Node.js 20+ (for local frontend/express development)

## Quick Start via Docker Compose

```bash
# 1. Copy environment example
cp .env.example .env

# 2. Build and launch all services
docker compose up -d

# 3. Verify health status
docker compose ps
```

## Services Included
- `postgres` (Port 5432)
- `neo4j` (Port 7474 HTTP, 7687 Bolt)
- `qdrant` (Port 6333 REST)
- `redis` (Port 6379)
- `ollama` (Port 11434)
- `embedding-service` (FastAPI / BGE-M3)
- `backend` (FastAPI / Express API Gateway)
- `celery-worker` (Async task worker)
- `frontend` (React + Vite Web UI on Port 3000)
