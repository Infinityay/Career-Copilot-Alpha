"""Interview review service backed by the interview evaluation agent."""

from __future__ import annotations

from datetime import datetime
from functools import lru_cache
import json
from uuid import uuid4

from langchain_core.messages import HumanMessage, SystemMessage

from app.prompts.interview_review_prompts import get_interview_review_prompts
from app.schemas.interview_evaluation import (
    InterviewEvaluationAgentInput,
    EvaluationTopicAssessment,
    EvaluationTopicPreview,
)
from app.schemas.interview_review import (
    ReviewConversationMessage,
    ReviewExportReportResponse,
    ReviewGenerateTopicDetailResponse,
    ReviewMatchedAnswer,
    ReviewMessageCitation,
    ReviewMessageEvidence,
    ReviewMessageUsage,
    ReviewOptimizationRequest,
    ReviewOptimizationResponse,
    ReviewSessionDetail,
    ReviewTopicOptimizationInput,
    ReviewTopicOptimizationResult,
    ReviewTopicDetail,
    ReviewTopic,
)
from app.schemas.mock_interview import (
    MockInterviewSessionSnapshot,
)
from app.services.interview_evaluation_agent import (
    InterviewEvaluationAgent,
    get_interview_evaluation_agent,
)
from app.services.runtime_config import resolve_runtime_config
from app.utils.structured_output import invoke_with_fallback


def _format_datetime(value: datetime) -> str:
    return value.astimezone().strftime("%Y-%m-%d %H:%M")


def _normalize_whitespace(value: str) -> str:
    return " ".join(value.split()).strip()


def _shorten_text(value: str, limit: int) -> str:
    normalized = _normalize_whitespace(value)
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[: max(limit - 1, 0)].rstrip()}…"


def _shorten_question(value: str) -> str:
    return _normalize_whitespace(value)


def _normalize_display_text(value: str) -> str:
    return _normalize_whitespace(value)


def _build_answer_highlights(item: object, focus_count: int) -> list[str]:
    raw_answers = [
        _normalize_display_text(answer)
        for answer in getattr(item, "answerHighlights", [])
        if isinstance(answer, str) and _normalize_whitespace(answer)
    ]
    if focus_count <= 0:
        return raw_answers[:3]

    answers = raw_answers[:focus_count]
    if len(answers) < focus_count:
        answers.extend(["未明确回答"] * (focus_count - len(answers)))
    return answers


def _build_matched_answers(
    assessment_focus: list[str],
    answer_highlights: list[str],
    focus_judgments: list[object] | None = None,
) -> list[ReviewMatchedAnswer]:
    focus_judgments = focus_judgments or []
    judgment_by_focus = {
        getattr(item, "focus", ""): item for item in focus_judgments if getattr(item, "focus", "")
    }
    matches: list[ReviewMatchedAnswer] = []
    for index, focus in enumerate(assessment_focus):
        answer = answer_highlights[index] if index < len(answer_highlights) else "未明确回答"
        judgment = judgment_by_focus.get(focus)
        answer_index = getattr(judgment, "answerHighlightIndex", None) if judgment else None
        status = getattr(judgment, "status", "") if judgment else ""
        reason = getattr(judgment, "reason", "") if judgment else ""
        if not status:
            status = "covered" if answer and answer != "未明确回答" else "missing"
        matches.append(
            ReviewMatchedAnswer(
                point=focus,
                answerHighlightIndex=(
                    answer_index
                    if answer_index is not None
                    else (index if answer and answer != "未明确回答" else None)
                ),
                status=status,
                reason=reason,
            )
        )
    return matches


def _rubric_name_to_label(name: str) -> str:
    mapping = {
        "structured_thinking": "结构化表达",
        "communication": "沟通表达",
        "domain_judgment": "领域判断",
        "evidence_and_metrics": "证据与量化",
        "authenticity": "真实性",
    }
    return mapping.get(name, name.replace("_", " ").strip() or "能力评估")


def _build_topic_evaluation(item: object) -> str:
    rubric_scores = getattr(item, "rubricScores", [])
    reasons = [score.reason.strip() for score in rubric_scores if getattr(score, "reason", "").strip()]
    if reasons:
        return reasons[0]

    strengths = getattr(item, "strengths", [])
    if strengths:
        return strengths[0]

    weaknesses = getattr(item, "weaknesses", [])
    if weaknesses:
        return f"当前短板：{weaknesses[0]}"

    question = getattr(item, "question", "").strip()
    topic = getattr(item, "topic", "当前主题")
    if question:
        return f"本题围绕“{question}”展开，建议继续补充更具体的案例、指标和取舍。"
    return f"{topic} 这一题已经生成结构化评估，建议继续补充案例细节和结果验证。"


def _build_optimized_answer(item: object) -> str:
    suggested_answer = getattr(item, "suggestedAnswer", "").strip()
    if suggested_answer:
        return suggested_answer

    topic = getattr(item, "topic", "当前主题")
    question = getattr(item, "question", "").strip()
    answers = getattr(item, "answerHighlights", [])
    answer_hint = answers[0].strip() if answers else ""

    if answer_hint:
        return (
            f"回答 {topic} 时，可以先用一句话交代背景和目标，再围绕你的真实做法展开。"
            f"基于你刚才提到的“{answer_hint}”，继续补充关键决策、取舍依据和最终结果。"
        )

    if question:
        return (
            f"回答 {topic} 时，先正面回应“{question}”，"
            "再按背景、行动、结果三个层次展开，补充量化指标和复盘结论。"
        )

    return f"回答 {topic} 时，先讲背景和目标，再讲关键动作、结果验证和复盘。"


class InterviewReviewNotEligibleError(RuntimeError):
    def __init__(self, message: str = "请先完成模拟面试后再生成复盘报告") -> None:
        super().__init__(message)


class InterviewReviewService:
    """Generate interview review reports from frontend-provided mock interview snapshots."""

    def __init__(
        self,
        evaluation_agent: InterviewEvaluationAgent | None = None,
    ) -> None:
        self._evaluation_agent = evaluation_agent or get_interview_evaluation_agent()
        self._review_prompts = get_interview_review_prompts()

    def build_agent_input_from_snapshot(
        self, snapshot: MockInterviewSessionSnapshot
    ) -> InterviewEvaluationAgentInput:
        return InterviewEvaluationAgentInput(
            sessionId=snapshot.sessionId,
            jdText=snapshot.jdText,
            jdData=snapshot.jdData,
            resumeSnapshot=snapshot.resumeSnapshot,
            interviewPlan=snapshot.interviewPlan,
            interviewState=snapshot.interviewState,
            messages=snapshot.messages,
        )

    def generate_review_events(
        self,
        session_id: str,
        snapshot: MockInterviewSessionSnapshot | None = None,
    ):
        if snapshot is None:
            yield {"type": "not_found", "sessionId": session_id}
            return
        resolved_snapshot = snapshot
        self._ensure_review_eligible(resolved_snapshot)

        agent_input = self.build_agent_input_from_snapshot(resolved_snapshot)
        runtime_config_request = resolved_snapshot.runtimeConfig
        evaluation_agent = (
            InterviewEvaluationAgent.from_runtime_config(resolve_runtime_config(runtime_config_request))
            if runtime_config_request
            else self._evaluation_agent
        )

        for event in evaluation_agent.evaluate_previews_with_progress(agent_input):
            event_type = event.get("type")
            if event_type == "topic_complete":
                preview = event.get("preview")
                topic_index = int(event.get("topicIndex", 0))
                if preview is not None and topic_index > 0:
                    review_topic = self._build_review_topic_preview(
                        resolved_snapshot,
                        preview,
                        topic_index,
                    )
                    yield {
                        **event,
                        "preview": review_topic.model_dump(mode="json"),
                    }
                    continue
            if event_type == "done":
                report = event["report"]
                detail = self._build_review_detail_from_preview_report(resolved_snapshot, report)
                yield {
                    "type": "done",
                    "sessionId": session_id,
                    "reportStatus": "ready",
                    "detail": detail.model_dump(mode="json"),
                }
                return
            yield event

    def generate_topic_detail(
        self,
        session_id: str,
        topic_id: str,
        runtime_config_request=None,
        snapshot: MockInterviewSessionSnapshot | None = None,
    ) -> ReviewGenerateTopicDetailResponse | None:
        if snapshot is None:
            return None
        resolved_snapshot = snapshot
        self._ensure_review_eligible(resolved_snapshot)

        topic_index = self._parse_topic_index(session_id, topic_id)
        if topic_index is None:
            return None

        agent_input = self.build_agent_input_from_snapshot(resolved_snapshot)
        evaluation_agent = (
            InterviewEvaluationAgent.from_runtime_config(resolve_runtime_config(runtime_config_request))
            if runtime_config_request
            else self._evaluation_agent
        )
        topic_inputs = evaluation_agent.build_topic_inputs(agent_input)
        if topic_index < 0 or topic_index >= len(topic_inputs):
            return None

        assessment = evaluation_agent.evaluate_topic_detail(topic_inputs[topic_index])
        topic = self._build_review_topic_detail(
            resolved_snapshot,
            assessment,
            topic_index + 1,
        )
        return ReviewGenerateTopicDetailResponse(
            sessionId=session_id,
            topicId=topic_id,
            topic=topic,
        )

    def export_review(self, session_id: str) -> ReviewExportReportResponse | None:
        return ReviewExportReportResponse(
            sessionId=session_id,
            exportStatus="ready",
            downloadUrl=f"/api/interview-reviews/{session_id}/export/download",
            fileName=f"interview-review-{session_id}.json",
        )

    def optimize_topic(
        self,
        request: ReviewOptimizationRequest,
    ) -> ReviewOptimizationResponse | None:
        topic = request.topic
        if topic is None:
            return None

        optimization = self._optimize_topic_with_llm(topic, request)

        existing_conversation = list(request.conversation)
        user_message = ReviewConversationMessage(
            messageId=f"user-{uuid4()}",
            sessionId=request.sessionId,
            topicId=request.topicId,
            role="user",
            content=request.message,
            createdAt=datetime.utcnow(),
        )
        assistant_message = ReviewConversationMessage(
            messageId=f"assistant-{uuid4()}",
            sessionId=request.sessionId,
            topicId=request.topicId,
            role="assistant",
            content=optimization.reply,
            createdAt=datetime.utcnow(),
            citations=[
                ReviewMessageCitation(
                    id=f"topic-{topic.id}",
                    label=f"{topic.name} 当前复盘",
                    snippet=topic.evaluation,
                ),
                ReviewMessageCitation(
                    id=f"question-{topic.id}",
                    label=f"{topic.name} 核心问题",
                    snippet=topic.coreQuestion,
                ),
            ],
            evidence=[
                ReviewMessageEvidence(
                    id=f"evaluation-{topic.id}",
                    type="evaluation",
                    content=topic.evaluation,
                ),
                ReviewMessageEvidence(
                    id=f"optimized-answer-{topic.id}",
                    type="optimized_answer",
                    content=optimization.optimizedAnswer,
                ),
            ],
            usage=ReviewMessageUsage(
                inputTokens=max(12, len(request.message) // 2),
                outputTokens=max(24, len(optimization.reply) // 2 if optimization.reply else 24),
                totalTokens=max(36, (len(request.message) + len(optimization.reply or "")) // 2),
            ),
            suggestions=optimization.suggestions,
        )

        conversation = [*existing_conversation, user_message, assistant_message]
        return ReviewOptimizationResponse(
            topicId=request.topicId,
            reply=assistant_message.content,
            optimizedAnswer=optimization.optimizedAnswer,
            suggestions=optimization.suggestions,
            message=assistant_message,
            conversation=conversation,
        )

    def _build_topic_problem_summary(self, topic: ReviewTopicDetail) -> list[str]:
        problem_lines = [
            item.reason.strip()
            for item in topic.matchedAnswers
            if item.status != "covered" and item.reason.strip()
        ]
        weakness_lines = [item.strip() for item in topic.weaknesses if item.strip()]
        merged = [*problem_lines, *weakness_lines]
        if merged:
            return list(dict.fromkeys(merged))
        return ["当前回答仍需补充更具体的细节、结构和结果表达。"]

    def _build_topic_optimization_input(
        self,
        topic: ReviewTopicDetail,
        request: ReviewOptimizationRequest,
    ) -> ReviewTopicOptimizationInput:
        return ReviewTopicOptimizationInput(
            sessionId=request.sessionId,
            topicId=request.topicId,
            topicName=topic.name,
            coreQuestion=topic.coreQuestion,
            problems=self._build_topic_problem_summary(topic),
            answerHighlights=topic.answerHighlights,
            strengths=topic.strengths,
            weaknesses=topic.weaknesses,
            existingSuggestions=topic.suggestions,
            existingOptimizedAnswer=topic.optimizedAnswer,
            latestUserMessage=request.message,
            conversation=request.conversation,
        )

    def _build_topic_optimization_messages(
        self,
        payload: ReviewTopicOptimizationInput,
        prompts: dict[str, str],
    ):
        serialized = json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, indent=2)
        return [
            SystemMessage(content=prompts["topic_optimization"]),
            HumanMessage(content=f"topic_optimization_input:\n{serialized}"),
        ]

    def _build_fallback_topic_optimization(
        self,
        topic: ReviewTopicDetail,
        request: ReviewOptimizationRequest,
    ) -> ReviewTopicOptimizationResult:
        problems = self._build_topic_problem_summary(topic)
        return ReviewTopicOptimizationResult(
            reply=(
                f"你这题当前主要问题是：{problems[0]} "
                f"建议先正面回应“{topic.coreQuestion}”，再按背景、动作、结果顺序补齐关键缺口。"
            ),
            optimizedAnswer=topic.optimizedAnswer or _build_optimized_answer(topic),
            suggestions=(
                topic.suggestions[:3]
                if topic.suggestions
                else [
                    "先正面回答核心问题，不要先铺背景。",
                    "补齐缺失的关键动作、取舍依据或结果。",
                    "用一句话收束结论，避免回答发散。",
                ]
            ),
        )

    def _optimize_topic_with_llm(
        self,
        topic: ReviewTopicDetail,
        request: ReviewOptimizationRequest,
    ) -> ReviewTopicOptimizationResult:
        payload = self._build_topic_optimization_input(topic, request)
        try:
            optimizer_agent = (
                InterviewEvaluationAgent.from_runtime_config(resolve_runtime_config(request.runtimeConfig))
                if request.runtimeConfig
                else self._evaluation_agent
            )
            optimization_llm = optimizer_agent.chat_model.with_structured_output(
                ReviewTopicOptimizationResult
            )
            prompts = (
                optimizer_agent.prompts
                if hasattr(optimizer_agent, "prompts")
                else self._review_prompts
            )
            messages = self._build_topic_optimization_messages(payload, prompts)
            result = invoke_with_fallback(
                optimization_llm,
                messages,
                ReviewTopicOptimizationResult,
            )
            return result or self._build_fallback_topic_optimization(topic, request)
        except Exception:
            return self._build_fallback_topic_optimization(topic, request)

    @staticmethod
    def _is_review_eligible(snapshot: MockInterviewSessionSnapshot) -> bool:
        return snapshot.status == "completed" or snapshot.interviewState.closed is True

    def _ensure_review_eligible(self, snapshot: MockInterviewSessionSnapshot) -> None:
        if not self._is_review_eligible(snapshot):
            raise InterviewReviewNotEligibleError()

    def _build_review_detail_from_preview_report(
        self,
        snapshot: MockInterviewSessionSnapshot,
        report: dict,
    ) -> ReviewSessionDetail:
        topics: list[ReviewTopic] = []
        for index, item in enumerate(report.get("topicPreviews", []), start=1):
            topics.append(self._build_review_topic_preview(snapshot, item, index))

        return ReviewSessionDetail(
            id=snapshot.sessionId,
            title=self._derive_title(snapshot),
            role=self._derive_role(snapshot),
            round="模拟面试",
            interviewAt=_format_datetime(snapshot.createdAt),
            reportStatus="ready",
            defaultSelectedTopicId=topics[0].id if topics else None,
            overallScore=report["overallScore"],
            summary=report["summary"],
            strengths=report.get("strengths", []),
            risks=report.get("risks", []),
            priority=(
                report.get("recommendation")
                or (report.get("priorityActions", [])[0] if report.get("priorityActions") else "")
            ),
            topics=topics,
            topicDetails={},
        )

    def _build_review_topic_preview(
        self,
        snapshot: MockInterviewSessionSnapshot,
        item: EvaluationTopicPreview,
        index: int,
    ) -> ReviewTopic:
        return ReviewTopic(
            id=f"topic-{snapshot.sessionId}-{index}",
            name=item.topic,
            domain=(
                _rubric_name_to_label(item.rubricScores[0].name)
                if item.rubricScores
                else "能力评估"
            ),
            score=item.overallScore,
            coreQuestion=_shorten_question(item.question),
            evaluation=item.previewSummary or _build_topic_evaluation(item),
            problems=[issue.strip() for issue in item.keyIssues if issue.strip()],
        )

    def _build_review_topic_detail(
        self,
        snapshot: MockInterviewSessionSnapshot,
        item: EvaluationTopicAssessment,
        index: int,
    ) -> ReviewTopicDetail:
        assessment_focus = [
            _normalize_display_text(focus)
            for focus in item.assessmentFocus
            if isinstance(focus, str) and _normalize_whitespace(focus)
        ]
        if not assessment_focus:
            topic_name = _normalize_whitespace(item.topic) or "当前题目"
            assessment_focus = [
                _shorten_text(f"考察是否能围绕{topic_name}结构化作答", 32),
                "考察是否能给出真实细节和结果",
            ]
        answer_highlights = _build_answer_highlights(item, len(assessment_focus))
        matched_answers = _build_matched_answers(
            assessment_focus,
            answer_highlights,
            getattr(item, "focusJudgments", []),
        )
        return ReviewTopicDetail(
            id=f"topic-{snapshot.sessionId}-{index}",
            name=item.topic,
            domain=(
                _rubric_name_to_label(item.rubricScores[0].name)
                if item.rubricScores
                else "能力评估"
            ),
            score=item.overallScore,
            coreQuestion=_shorten_question(item.question),
            evaluation=_build_topic_evaluation(item),
            problems=[problem for problem in item.weaknesses if problem.strip()][:2],
            assessmentFocus=assessment_focus,
            answerHighlights=answer_highlights,
            highlightedPoints=[score.name for score in item.rubricScores],
            matchedAnswers=matched_answers,
            strengths=item.strengths,
            weaknesses=item.weaknesses,
            suggestions=item.followUps,
            followUps=item.followUps,
            optimizedAnswer=_build_optimized_answer(item),
        )

    @staticmethod
    def _parse_topic_index(session_id: str, topic_id: str) -> int | None:
        prefix = f"topic-{session_id}-"
        if not topic_id.startswith(prefix):
            return None
        suffix = topic_id[len(prefix) :]
        if not suffix.isdigit():
            return None
        return int(suffix) - 1

    @staticmethod
    def _derive_role(snapshot: MockInterviewSessionSnapshot) -> str:
        jd_title = (snapshot.jdData.basicInfo.jobTitle if snapshot.jdData else "") or ""
        desired_position = snapshot.resumeSnapshot.basicInfo.desiredPosition
        return jd_title or desired_position or snapshot.category.value

    def _derive_title(self, snapshot: MockInterviewSessionSnapshot) -> str:
        return f"{self._derive_role(snapshot)}模拟面试复盘"


_service: InterviewReviewService | None = None


@lru_cache(maxsize=1)
def get_interview_review_service() -> InterviewReviewService:
    global _service
    if _service is None:
        _service = InterviewReviewService()
    return _service
