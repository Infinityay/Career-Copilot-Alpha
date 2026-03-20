"""FaceTamato Backend API."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    interviews,
    jd,
    jd_optimization,
    mock_interview,
    resume,
    resume_optimization,
    speech
)
from app.core.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    settings = get_settings()
    print(f"🚀 FaceTamato Backend starting on {settings.app_host}:{settings.app_port}")
    print(f"   📝 CORS origins: {settings.get_cors_origins()}")
    yield
    print("👋 FaceTamato Backend shutting down")


app = FastAPI(
    title="FaceTamato API",
    description="Resume parsing and career assistance API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(resume.router, prefix="/api")
app.include_router(jd.router, prefix="/api")
app.include_router(resume_optimization.router, prefix="/api")
app.include_router(jd_optimization.router, prefix="/api")
app.include_router(interviews.router, prefix="/api")
app.include_router(mock_interview.router, prefix="/api")
app.include_router(speech.router, prefix="/api")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "FaceTamato API",
        "version": "0.1.0",
        "docs": "/docs",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=True,
    )
