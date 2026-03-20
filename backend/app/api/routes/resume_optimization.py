"""Resume optimization API routes."""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.schemas.resume import ResumeData
from app.schemas.resume_optimization import ResumeOverviewResponse, ResumeSuggestionsResponse
from app.schemas.runtime_config import RuntimeConfig
from app.services.resume_optimizer import ResumeOptimizer
from app.services.runtime_config import resolve_runtime_config

router = APIRouter(prefix="/resume", tags=["resume-optimization"])
logger = logging.getLogger(__name__)


class ResumeOptimizationRequest(ResumeData):
    """Resume optimization request with optional runtime overrides."""

    runtimeConfig: RuntimeConfig | None = Field(
        default=None, description="请求级模型配置覆盖"
    )



def _make_error(code: str, message: str) -> dict:
    """Create standardized error response dict."""
    return {"error": {"code": code, "message": message}}



def _build_optimizer(request: ResumeOptimizationRequest) -> ResumeOptimizer:
    runtime_config = resolve_runtime_config(request.runtimeConfig)
    return ResumeOptimizer.from_runtime_config(runtime_config)


@router.post("/overview", response_model=ResumeOverviewResponse)
async def get_resume_overview(request: ResumeOptimizationRequest):
    """Generate resume overview analysis."""
    try:
        optimizer = _build_optimizer(request)
        result, _ = await optimizer.get_overview(ResumeData.model_validate(request.model_dump()))
        return result
    except Exception:
        logger.exception("Resume overview failed")
        raise HTTPException(
            status_code=502,
            detail=_make_error(
                "LLM_FAILED",
                "Failed to generate overview",
            ),
        )


@router.post("/suggestions", response_model=ResumeSuggestionsResponse)
async def get_resume_suggestions(request: ResumeOptimizationRequest):
    """Generate resume modification suggestions."""
    try:
        optimizer = _build_optimizer(request)
        result, _ = await optimizer.get_suggestions(ResumeData.model_validate(request.model_dump()))
        return result
    except Exception:
        logger.exception("Resume suggestions failed")
        raise HTTPException(
            status_code=502,
            detail=_make_error(
                "LLM_FAILED",
                "Failed to generate suggestions",
            ),
        )
