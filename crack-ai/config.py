"""
CrackPOS AI — Config Settings
All configuration comes from environment variables.
No hardcoded defaults for secrets — they MUST be set in environment.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator, model_validator

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        extra="ignore",
    )

    database_url: str

    jwt_secret: str
    jwt_algorithm: str = "HS256"

    internal_api_key: str

    llm_api_key: str
    llm_base_url: str = "https://openrouter.ai/api/v1"
    llm_model: str = "nvidia/nemotron-3.5-lightning:free"
    # Comma-separated rotation pool. Empty = use built-in free tool-capable list.
    llm_models: str = ""
    # Max models to try per request before giving up
    llm_max_attempts: int = 4

    backend_url: str = "http://localhost:8000"
    backend_internal_api_key: str = ""

    port: int = 8001
    cors_origins: str = "http://localhost:3000,http://localhost:3001"

    max_query_limit: int = 50

    max_query_length: int = 2000

    @field_validator("internal_api_key")
    @classmethod
    def validate_internal_api_key(cls, v: str) -> str:
        """Ensure INTERNAL_API_KEY is set to a non-default, strong value."""
        if not v:
            raise ValueError(
                "INTERNAL_API_KEY is required! Set a strong random value in .env. "
                "Generate one with: openssl rand -hex 32"
            )
        if v == "crack-ai-internal-key-dev":
            raise ValueError(
                "INTERNAL_API_KEY must be changed from the default development value! "
                "This default is publicly known and is a security risk. "
                "Generate a new one with: openssl rand -hex 32"
            )
        if len(v) < 16:
            raise ValueError(
                f"INTERNAL_API_KEY is too short ({len(v)} chars). "
                "Minimum 16 characters required for security. "
                "Use: openssl rand -hex 32"
            )
        return v

    @field_validator("llm_api_key")
    @classmethod
    def validate_llm_api_key(cls, v: str) -> str:
        """Ensure LLM API key is set."""
        if not v:
            raise ValueError(
                "LLM_API_KEY is required! Set your API key in .env. "
                "For OpenRouter, get one at: https://openrouter.ai/keys"
            )
        return v

    @model_validator(mode="after")
    def validate_llm_key_matches_provider(self) -> "Settings":
        """Sanity-check: OpenRouter keys (sk-or-...) must use OpenRouter base URL."""
        if self.llm_api_key.startswith("sk-or-") and "openrouter.ai" not in self.llm_base_url:
            raise ValueError(
                f"LLM_API_KEY is an OpenRouter key (sk-or-...) but LLM_BASE_URL is "
                f"'{self.llm_base_url}'. Set LLM_BASE_URL=https://openrouter.ai/api/v1"
            )
        return self

settings = Settings()

