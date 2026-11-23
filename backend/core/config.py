from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "Enterprise Decision Intelligence Platform"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Database Settings
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres_password@localhost:5432/decision_db"
    READ_ONLY_DATABASE_URL: str = "postgresql+asyncpg://readonly_user:readonly_pass@localhost:5432/decision_db"
    
    # Neo4j Settings
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "neo4j_password"
    
    # Vector DB
    QDRANT_URL: str = "http://localhost:6333"
    
    # Redis & Celery
    REDIS_URL: str = "redis://localhost:6379/0"
    
    # LLM Settings
    OLLAMA_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3.1:8b-instruct"
    GEMINI_API_KEY: Optional[str] = None

    class Config:
        env_file = ".env"

settings = Settings()
