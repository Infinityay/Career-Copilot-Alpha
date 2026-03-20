"""JD extraction API routes."""

import asyncio
import logging

from fastapi import APIRouter, HTTPException

from app.schemas.jd import JDData, JDExtractRequest, JDExtractResponse
from app.services.jd_extractor import JDExtractor, InvalidJDContentError
from app.services.runtime_config import resolve_runtime_config

router = APIRouter(prefix="/jd", tags=["jd"])

MAX_TEXT_LENGTH = 30000
logger = logging.getLogger(__name__)



def _make_error(code: str, message: str) -> dict:
    """Create standardized error response dict."""
    return {"error": {"code": code, "message": message}}


@router.post("/extract", response_model=JDExtractResponse)
async def extract_jd(request: JDExtractRequest):
    """Extract structured data from JD text."""
    if not request.text or not request.text.strip():
        raise HTTPException(
            status_code=400,
            detail=_make_error("EMPTY_TEXT", "JD text content is required"),
        )

    if len(request.text) > MAX_TEXT_LENGTH:
        raise HTTPException(
            status_code=413,
            detail=_make_error(
                "TEXT_TOO_LARGE",
                f"Text exceeds {MAX_TEXT_LENGTH} character limit",
            ),
        )

    try:
        loop = asyncio.get_event_loop()
        runtime_config = resolve_runtime_config(request.runtimeConfig)
        extractor = JDExtractor.from_runtime_config(runtime_config)
        result, elapsed = await loop.run_in_executor(
            None, lambda: extractor.extract_to_dict(request.text)
        )

        return JDExtractResponse(
            data=JDData(**result),
            elapsed_seconds=elapsed,
        )

    except InvalidJDContentError as exc:
        logger.warning("JD content validation failed")
        raise HTTPException(
            status_code=400,
            detail=_make_error(
                "INVALID_JD_CONTENT",
                "上传内容不是一份正常的岗位 JD，请粘贴职位描述后重试。",
            ),
        ) from exc

    except Exception as exc:
        logger.exception("JD extraction failed")
        raise HTTPException(
            status_code=502,
            detail=_make_error(
                "LLM_FAILED",
                "Failed to extract JD data",
            ),
        ) from exc
