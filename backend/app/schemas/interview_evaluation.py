"""Schemas for LLM-based mock interview evaluation."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.jd import JDData
from app.schemas.mock_interview import MockInterviewMessage, MockInterviewPlan, MockInterviewState
from app.schemas.resume import ResumeData


class EvaluationRubricScore(BaseModel):
    """Score for one rubric dimension."""

    name: str = Field(description="Rubric name, for example structured_thinking")
    score: int = Field(ge=0, le=100)
    reason: str = Field(default="")


class EvaluationFocusJudgment(BaseModel):
    """Per-focus judgment used by review UI to render risk states."""

    focus: str
    answerHighlightIndex: int | None = None
    status: Literal["covered", "missing", "incomplete", "logic_confused", "knowledge_unclear"] = "covered"
    reason: str = Field(default="")


class EvaluationTopicAssessment(BaseModel):
    """Assessment for one interview topic/round."""

    topic: str
    question: str = Field(default="")
    assessmentFocus: list[str] = Field(default_factory=list)
    answerHighlights: list[str] = Field(default_factory=list)
    focusJudgments: list[EvaluationFocusJudgment] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    followUps: list[str] = Field(default_factory=list)
    suggestedAnswer: str = Field(default="")
    rubricScores: list[EvaluationRubricScore] = Field(default_factory=list)
    overallScore: int = Field(ge=0, le=100)


class EvaluationTopicPreview(BaseModel):
    """Lightweight preview for one interview topic/round."""

    topic: str
    question: str = Field(default="")
    previewSummary: str = Field(default="")
    keyIssues: list[str] = Field(default_factory=list)
    rubricScores: list[EvaluationRubricScore] = Field(default_factory=list)
    overallScore: int = Field(ge=0, le=100)


class InterviewEvaluationReport(BaseModel):
    """Structured evaluation result returned by the evaluation agent."""

    summary: str
    overallScore: int = Field(ge=0, le=100)
    recommendation: str = Field(default="")
    strengths: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    priorityActions: list[str] = Field(default_factory=list)
    topicAssessments: list[EvaluationTopicAssessment] = Field(default_factory=list)


class InterviewEvaluationSummary(BaseModel):
    """Overall summary built from all topic assessments."""

    summary: str
    overallScore: int = Field(ge=0, le=100)
    recommendation: str = Field(default="")
    strengths: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    priorityActions: list[str] = Field(default_factory=list)


class InterviewEvaluationAgentInput(BaseModel):
    """Canonical input for the interview evaluation agent."""

    sessionId: str
    jdText: str = Field(default="")
    jdData: JDData | None = None
    resumeSnapshot: ResumeData
    interviewPlan: MockInterviewPlan
    interviewState: MockInterviewState
    messages: list[MockInterviewMessage] = Field(default_factory=list)


class InterviewTopicEvaluationInput(BaseModel):
    """Single-topic input for topic-level evaluation."""

    sessionId: str
    jdText: str = Field(default="")
    jdData: JDData | None = None
    resumeSnapshot: ResumeData
    roundNumber: int = Field(ge=1)
    topic: str
    topicDescription: str = Field(default="")
    question: str = Field(default="")
    transcript: list[MockInterviewMessage] = Field(default_factory=list)


class InterviewSummaryEvaluationInput(BaseModel):
    """Summary input built from all topic assessments."""

    sessionId: str
    jdText: str = Field(default="")
    jdData: JDData | None = None
    resumeSnapshot: ResumeData
    topicAssessments: list[EvaluationTopicAssessment] = Field(default_factory=list)


class InterviewPreviewSummaryInput(BaseModel):
    """Summary input built from lightweight topic previews."""

    sessionId: str
    jdText: str = Field(default="")
    jdData: JDData | None = None
    resumeSnapshot: ResumeData
    topicPreviews: list[EvaluationTopicPreview] = Field(default_factory=list)
