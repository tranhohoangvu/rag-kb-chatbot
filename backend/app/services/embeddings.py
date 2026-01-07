from functools import lru_cache
from typing import List
import numpy as np
from sentence_transformers import SentenceTransformer
from app.core.config import settings

@lru_cache
def _model() -> SentenceTransformer:
    return SentenceTransformer(settings.EMBED_MODEL_NAME)

def embed_passages(texts: List[str]) -> List[List[float]]:
    model = _model()
    prefixed = [f"passage: {t}" for t in texts]
    emb = model.encode(prefixed, normalize_embeddings=True)
    emb = np.asarray(emb, dtype=np.float32)
    return emb.tolist()

def embed_query(text: str) -> List[float]:
    model = _model()
    emb = model.encode([f"query: {text}"], normalize_embeddings=True)[0]
    emb = np.asarray(emb, dtype=np.float32)
    return emb.tolist()
