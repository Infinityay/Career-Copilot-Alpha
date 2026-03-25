"""Schemas for interview review source APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.interview import Category, InterviewType
from app.schemas.jd import JDData
from app.schemas.mock_interview import (
    MockInterviewMessage,
    MockInterviewPlan,
    MockInterviewRetrievalResult,
    MockInterviewSessionSnapshot,
    MockInterviewState,
)
from app.schemas.resume import ResumeData
from app.schemas.runtime_config import RuntimeConfig


class InterviewReviewSourceInterviewMeta(BaseModel):
    """Top-level metadata for the original mock interview session."""

    interviewType: InterviewType
    category: Category


class InterviewReviewSourceResume(BaseModel):
    """Resume source payload used for review generation."""

    fingerprint: str
    snapshot: ResumeData


class InterviewReviewSourceJD(BaseModel):
    """JD source payload used for review generation."""

    text: str = ""
    data: JDData | None = None


class InterviewReviewSourceInterview(BaseModel):
    """Interview runtime payload used for review generation."""

    plan: MockInterviewPlan
    state: MockInterviewState
    messages: list[MockInterviewMessage] = Field(default_factory=list)
    retrieval: MockInterviewRetrievalResult = Field(default_factory=MockInterviewRetrievalResult)


class InterviewReviewSourceResponse(BaseModel):
    """Aggregated source data for generating an interview review."""

    sessionId: str
    status: str
    createdAt: datetime
    updatedAt: datetime
    expiresAt: datetime
    interviewMeta: InterviewReviewSourceInterviewMeta
    resume: InterviewReviewSourceResume
    jd: InterviewReviewSourceJD
    interview: InterviewReviewSourceInterview


ReviewReportStatus = Literal["pending", "ready"]


class ReviewMatchedAnswer(BaseModel):
    point: str
    answerHighlightIndex: int | None = None
    status: Literal["covered", "missing", "incomplete", "logic_confused", "knowledge_unclear"] = "covered"
    reason: str = ""


class ReviewTopic(BaseModel):
    id: str
    name: str
    domain: str
    score: int = Field(ge=0, le=100)
    coreQuestion: str
    evaluation: str
    problems: list[str] = Field(default_factory=list)


class ReviewTopicDetail(ReviewTopic):
    id: str
    assessmentFocus: list[str] = Field(default_factory=list)
    answerHighlights: list[str] = Field(default_factory=list)
    highlightedPoints: list[str] = Field(default_factory=list)
    matchedAnswers: list[ReviewMatchedAnswer] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    followUps: list[str] = Field(default_factory=list)
    optimizedAnswer: str = ""


class ReviewSessionListItem(BaseModel):
    id: str
    title: str
    role: str
    round: str
    interviewAt: str
    reportStatus: ReviewReportStatus
    overallScore: int | None = None
    topicCount: int = 0


class ReviewSessionListResponse(BaseModel):
    items: list[ReviewSessionListItem] = Field(default_factory=list)


class ReviewUploadSessionResponse(BaseModel):
    sessionId: str
    title: str
    role: str
    round: str
    interviewAt: str
    reportStatus: ReviewReportStatus
    topicCount: int = 0


class ReviewSessionDetail(BaseModel):
    id: str
    title: str
    role: str
    round: str
    interviewAt: str
    reportStatus: ReviewReportStatus
    defaultSelectedTopicId: str | None = None
    overallScore: int = Field(ge=0, le=100)
    summary: str
    strengths: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    priority: str = ""
    topics: list[ReviewTopic] = Field(default_factory=list)
    topicDetails: dict[str, ReviewTopicDetail] = Field(default_factory=dict)


class ReviewMessageCitation(BaseModel):
    id: str
    label: str
    snippet: str | None = None


class ReviewMessageEvidence(BaseModel):
    id: str
    type: str
    content: str


class ReviewMessageUsage(BaseModel):
    inputTokens: int | None = None
    outputTokens: int | None = None
    totalTokens: int | None = None


class ReviewConversationMessage(BaseModel):
    messageId: str
    sessionId: str
    topicId: str
    role: Literal["user", "assistant"]
    content: str
    createdAt: datetime
    citations: list[ReviewMessageCitation] = Field(default_factory=list)
    evidence: list[ReviewMessageEvidence] = Field(default_factory=list)
    usage: ReviewMessageUsage | None = None
    suggestions: list[str] = Field(default_factory=list)


class ReviewOptimizationRequest(BaseModel):
    sessionId: str
    topicId: str
    message: str
    topic: ReviewTopicDetail | None = None
    conversation: list[ReviewConversationMessage] = Field(default_factory=list)
    runtimeConfig: RuntimeConfig | None = None


class ReviewGenerateTopicDetailRequest(BaseModel):
    sessionId: str
    snapshot: MockInterviewSessionSnapshot | None = None
    runtimeConfig: RuntimeConfig | None = None


class ReviewGenerateTopicDetailResponse(BaseModel):
    sessionId: str
    topicId: str
    topic: ReviewTopicDetail


class ReviewTopicOptimizationInput(BaseModel):
    sessionId: str
    topicId: str
    topicName: str
    coreQuestion: str
    problems: list[str] = Field(default_factory=list)
    answerHighlights: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    existingSuggestions: list[str] = Field(default_factory=list)
    existingOptimizedAnswer: str = ""
    latestUserMessage: str
    conversation: list[ReviewConversationMessage] = Field(default_factory=list)


class ReviewTopicOptimizationResult(BaseModel):
    reply: str
    optimizedAnswer: str = ""
    suggestions: list[str] = Field(default_factory=list)


class ReviewOptimizationResponse(BaseModel):
    topicId: str
    reply: str
    optimizedAnswer: str = ""
    suggestions: list[str] = Field(default_factory=list)
    message: ReviewConversationMessage
    conversation: list[ReviewConversationMessage] = Field(default_factory=list)


class ReviewGenerateReportResponse(BaseModel):
    sessionId: str
    reportStatus: ReviewReportStatus
    detail: ReviewSessionDetail | None = None


class ReviewExportReportResponse(BaseModel):
    sessionId: str
    exportStatus: Literal["ready"]
    downloadUrl: str | None = None
    fileName: str | None = None


ReviewGenerateTopicDetailRequest.model_rebuild()
