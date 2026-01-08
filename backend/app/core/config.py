from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]  # .../backend


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    DATABASE_URL: str

    EMBED_MODEL_NAME: str = "intfloat/multilingual-e5-small"
    EMBED_DIM: int = 384

    # RAG gating: nếu cosine distance của chunk tốt nhất > ngưỡng này => coi như "không đủ liên quan"
    # (cosine distance càng nhỏ càng giống)
    RAG_MAX_COSINE_DISTANCE: float = 0.35


settings = Settings()
