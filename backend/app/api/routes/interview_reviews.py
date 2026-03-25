"""Interview review APIs."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.schemas.interview_review import (
    ReviewExportReportResponse,
    ReviewGenerateTopicDetailRequest,
    ReviewGenerateTopicDetailResponse,
    ReviewOptimizationRequest,
    ReviewOptimizationResponse,
)
from app.schemas.mock_interview import MockInterviewSessionSnapshot
from app.services.interview_review_service import (
    InterviewReviewNotEligibleError,
    InterviewReviewService,
    get_interview_review_service,
)

router = APIRouter(prefix="/interview-reviews", tags=["interview-reviews"])


def _next_event_or_none(iterator):
    try:
        return next(iterator)
    except StopIteration:
        return None


def _format_sse(event_name: str, payload: dict) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/{session_id}/generate/stream")
async def stream_interview_review_generation(
    session_id: str,
    snapshot: MockInterviewSessionSnapshot | None = Body(default=None),
    service: InterviewReviewService = Depends(get_interview_review_service),
):
    if snapshot is not None and snapshot.sessionId != session_id:
        raise HTTPException(status_code=400, detail="Session id mismatch")

    async def event_stream():
        try:
            iterator = service.generate_review_events(session_id, snapshot)
            while True:
                event = await asyncio.to_thread(_next_event_or_none, iterator)
                if event is None:
                    break
                event_name = event.get("type", "message")
                yield _format_sse(event_name, event)
        except InterviewReviewNotEligibleError as exc:
            yield _format_sse(
                "error",
                {"type": "error", "sessionId": session_id, "message": str(exc)},
            )
        except Exception as exc:
            yield _format_sse(
                "error",
                {"type": "error", "sessionId": session_id, "message": str(exc)},
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{session_id}/export", response_model=ReviewExportReportResponse)
async def export_interview_review(
    session_id: str,
    service: InterviewReviewService = Depends(get_interview_review_service),
) -> ReviewExportReportResponse:
    try:
        result = await asyncio.to_thread(service.export_review, session_id)
    except InterviewReviewNotEligibleError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Mock interview session not found")
    return result


@router.post(
    "/{session_id}/topics/{topic_id}/generate-detail",
    response_model=ReviewGenerateTopicDetailResponse,
)
async def generate_interview_review_topic_detail(
    session_id: str,
    topic_id: str,
    request: ReviewGenerateTopicDetailRequest,
    service: InterviewReviewService = Depends(get_interview_review_service),
) -> ReviewGenerateTopicDetailResponse:
    if request.sessionId != session_id:
        raise HTTPException(status_code=400, detail="Session id mismatch")
    try:
        result = await asyncio.to_thread(
            service.generate_topic_detail,
            session_id,
            topic_id,
            request.runtimeConfig,
            request.snapshot,
        )
    except InterviewReviewNotEligibleError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Interview review session or topic not found")
    return result


@router.post("/{session_id}/topics/{topic_id}/optimize", response_model=ReviewOptimizationResponse)
async def optimize_interview_review_topic(
    session_id: str,
    topic_id: str,
    request: ReviewOptimizationRequest,
    service: InterviewReviewService = Depends(get_interview_review_service),
) -> ReviewOptimizationResponse:
    if request.sessionId != session_id or request.topicId != topic_id:
        raise HTTPException(status_code=400, detail="Session or topic id mismatch")
    try:
        result = await asyncio.to_thread(service.optimize_topic, request)
    except InterviewReviewNotEligibleError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Interview review session or topic not found")
    return result
