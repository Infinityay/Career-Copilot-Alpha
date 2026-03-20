"""Mock interview session APIs."""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.schemas.mock_interview import MockInterviewSessionCreateRequest, MockInterviewStreamRequest
from app.services.mock_interview_service import MockInterviewService
from app.services.runtime_config import resolve_runtime_config

router = APIRouter(prefix="/mock-interview", tags=["mock-interview"])
logger = logging.getLogger(__name__)



def _format_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"



def _build_sse_error(exc: Exception) -> dict:
    if isinstance(exc, HTTPException) and isinstance(exc.detail, str):
        return {"message": exc.detail, "status": exc.status_code}
    return {"message": "Internal server error", "status": 500}



def _build_service(runtime_config_request) -> MockInterviewService:
    runtime_config = resolve_runtime_config(runtime_config_request)
    return MockInterviewService.from_runtime_config(runtime_config)


@router.post("/session/stream-create")
async def stream_create_mock_interview_session(
    request: MockInterviewSessionCreateRequest,
) -> StreamingResponse:
    service = _build_service(request.runtimeConfig)

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for item in service.stream_create_session(request):
                yield _format_sse(item["event"], item["data"])
        except HTTPException as exc:
            logger.warning("Mock interview stream failed with HTTPException")
            yield _format_sse("error", _build_sse_error(exc))
        except Exception as exc:  # pragma: no cover
            logger.exception("Mock interview stream failed")
            yield _format_sse("error", _build_sse_error(exc))

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/session/{session_id}/stream")
async def stream_mock_interview_session(
    session_id: str,
    request: MockInterviewStreamRequest,
) -> StreamingResponse:
    service = _build_service(request.runtimeConfig)

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for item in service.stream_turn(session_id, request):
                yield _format_sse(item["event"], item["data"])
        except HTTPException as exc:
            logger.warning("Mock interview stream failed with HTTPException")
            yield _format_sse("error", _build_sse_error(exc))
        except Exception as exc:  # pragma: no cover
            logger.exception("Mock interview stream failed")
            yield _format_sse("error", _build_sse_error(exc))

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
