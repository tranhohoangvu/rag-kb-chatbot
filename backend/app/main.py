from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router
from app.db.models import Base
from app.db.session import engine

app = FastAPI(title="RAG KB Chatbot")

# dev cors (cho frontend gọi)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    # tạo tables cho nhanh (sau này bạn thích thì chuyển sang Alembic)
    Base.metadata.create_all(bind=engine)

app.include_router(router)
