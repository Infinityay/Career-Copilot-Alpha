"""LLM-backed framework for structured mock interview evaluation."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import logging
from functools import lru_cache
import time

from langchain.chat_models import init_chat_model
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.rate_limiters import InMemoryRateLimiter

from app.core.config import get_settings
from app.prompts.interview_review_prompts import get_interview_review_prompts
from app.schemas.interview_evaluation import (
    EvaluationFocusJudgment,
    EvaluationTopicPreview,
    EvaluationRubricScore,
    EvaluationTopicAssessment,
    InterviewEvaluationAgentInput,
    InterviewEvaluationSummary,
    InterviewPreviewSummaryInput,
    InterviewSummaryEvaluationInput,
    InterviewTopicEvaluationInput,
)
from app.services.runtime_config import ResolvedRuntimeConfig
from app.utils.structured_output import invoke_with_fallback


logger = logging.getLogger(__name__)
MAX_TOPIC_EVALUATION_CONCURRENCY = 2
TOPIC_EVALUATION_RETRY_DELAY_SECONDS = 1.0
TOPIC_EVALUATION_RETRYABLE_MARKERS = (
    "429",
    "502",
    "504",
    "bad gateway",
    "gateway time-out",
    "gateway timeout",
    "rate limit",
    "temporarily unavailable",
    "service unavailable",
)


class InterviewEvaluationAgent:
    """Generate a structured evaluation report from a mock interview snapshot."""

    @classmethod
    def from_runtime_config(
        cls, runtime_config: ResolvedRuntimeConfig
    ) -> "InterviewEvaluationAgent":
        return cls(
            model_provider=runtime_config.model_provider,
            api_key=runtime_config.api_key,
            base_url=runtime_config.base_url,
            model=runtime_config.model,
        )

    def __init__(
        self,
        model_provider: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        rate_limiter: InMemoryRateLimiter | None = None,
    ) -> None:
        settings = get_settings()
        active_config = settings.get_active_config()
        model_provider = model_provider or active_config["model_provider"]
        api_key = api_key or active_config["api_key"]
        base_url = base_url or active_config["base_url"]
        model = model or active_config["model"]

        if rate_limiter is None:
            rate_limiter = InMemoryRateLimiter(
                requests_per_second=settings.rate_limit_requests_per_second,
                check_every_n_seconds=settings.rate_limit_check_every_n_seconds,
                max_bucket_size=settings.rate_limit_max_bucket_size,
            )

        self.chat_model = self._create_chat_model(
            model_provider=model_provider,
            model=model,
            api_key=api_key,
            base_url=base_url,
            rate_limiter=rate_limiter,
        )
        self.topic_evaluation_llm = self.chat_model.with_structured_output(
            EvaluationTopicAssessment
        )
        self.topic_preview_llm = self.chat_model.with_structured_output(
            EvaluationTopicPreview
        )
        self.summary_evaluation_llm = self.chat_model.with_structured_output(
            InterviewEvaluationSummary
        )
        self.prompts = get_interview_review_prompts()

    def _create_chat_model(
        self,
        model_provider: str,
        model: str,
        api_key: str | None,
        base_url: str | None,
        rate_limiter: InMemoryRateLimiter,
    ):
        if model_provider == "openai":
            kwargs = {
                "model": model,
                "model_provider": "openai",
                "api_key": api_key,
                "rate_limiter": rate_limiter,
            }
            if base_url:
                kwargs["base_url"] = base_url
            return init_chat_model(**kwargs)
        if model_provider == "google_genai":
            return init_chat_model(f"google_genai:{model}", rate_limiter=rate_limiter)
        if model_provider == "anthropic":
            return init_chat_model(
                model, model_provider="anthropic", rate_limiter=rate_limiter
            )
        raise ValueError(f"Unsupported model provider: {model_provider}")

    def _build_topic_messages(self, payload: InterviewTopicEvaluationInput):
        serialized = json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, indent=2)
        return [
            SystemMessage(content=self.prompts["topic_evaluation"]),
            HumanMessage(content=f"topic_interview_slice:\n{serialized}"),
        ]

    def _build_summary_messages(self, payload: InterviewSummaryEvaluationInput):
        serialized = json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, indent=2)
        return [
            SystemMessage(content=self.prompts["summary_evaluation"]),
            HumanMessage(content=f"topic_assessment_summary_input:\n{serialized}"),
        ]

    def _build_topic_preview_messages(self, payload: InterviewTopicEvaluationInput):
        serialized = json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, indent=2)
        return [
            SystemMessage(content=self.prompts["topic_preview"]),
            HumanMessage(content=f"topic_interview_slice:\n{serialized}"),
        ]

    def _build_preview_summary_messages(self, payload: InterviewPreviewSummaryInput):
        serialized = json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, indent=2)
        return [
            SystemMessage(content=self.prompts["summary_evaluation"]),
            HumanMessage(content=f"topic_preview_summary_input:\n{serialized}"),
        ]

    def evaluate_previews_with_progress(self, payload: InterviewEvaluationAgentInput):
        """Yield progress updates while building preview-only interview review data."""
        try:
            topic_inputs = self._build_topic_inputs(payload)
            total_topics = len(topic_inputs)
            yield {
                "type": "start",
                "sessionId": payload.sessionId,
                "totalTopics": total_topics,
            }

            topic_previews: list[EvaluationTopicPreview | None] = [None] * total_topics
            completed_topics = 0
            for topic_index, preview in self._evaluate_topic_previews_with_progress(topic_inputs):
                topic_previews[topic_index] = preview
                completed_topics += 1
                topic_input = topic_inputs[topic_index]
                yield {
                    "type": "topic_complete",
                    "sessionId": payload.sessionId,
                    "currentTopic": completed_topics,
                    "totalTopics": total_topics,
                    "topicName": preview.topic or topic_input.topic,
                    "topicIndex": topic_index + 1,
                    "preview": preview,
                }

            finalized_previews = [
                preview for preview in topic_previews if preview is not None
            ]
            summary_input = InterviewPreviewSummaryInput(
                sessionId=payload.sessionId,
                jdText=payload.jdText,
                jdData=payload.jdData,
                resumeSnapshot=payload.resumeSnapshot,
                topicPreviews=finalized_previews,
            )
            summary = self._evaluate_preview_summary(summary_input)
            yield {
                "type": "done",
                "sessionId": payload.sessionId,
                "report": {
                    "summary": summary.summary,
                    "overallScore": summary.overallScore,
                    "recommendation": summary.recommendation,
                    "strengths": summary.strengths,
                    "risks": summary.risks,
                    "priorityActions": summary.priorityActions,
                    "topicPreviews": finalized_previews,
                },
            }
        except Exception:
            logger.exception(
                "Interview preview generation failed for session %s, using fallback preview report",
                payload.sessionId,
            )
            fallback_previews = [
                self._build_fallback_topic_preview(topic_input)
                for topic_input in self._build_topic_inputs(payload)
            ]
            summary = self._build_fallback_preview_summary(
                InterviewPreviewSummaryInput(
                    sessionId=payload.sessionId,
                    jdText=payload.jdText,
                    jdData=payload.jdData,
                    resumeSnapshot=payload.resumeSnapshot,
                    topicPreviews=fallback_previews,
                )
            )
            yield {
                "type": "done",
                "sessionId": payload.sessionId,
                "report": {
                    "summary": summary.summary,
                    "overallScore": summary.overallScore,
                    "recommendation": summary.recommendation,
                    "strengths": summary.strengths,
                    "risks": summary.risks,
                    "priorityActions": summary.priorityActions,
                    "topicPreviews": fallback_previews,
                },
            }

    def evaluate_topic_detail(
        self, payload: InterviewTopicEvaluationInput
    ) -> EvaluationTopicAssessment:
        return self._evaluate_topic(payload)

    def build_topic_inputs(
        self, payload: InterviewEvaluationAgentInput
    ) -> list[InterviewTopicEvaluationInput]:
        return self._build_topic_inputs(payload)

    def _build_topic_inputs(
        self, payload: InterviewEvaluationAgentInput
    ) -> list[InterviewTopicEvaluationInput]:
        max_started_round = min(
            max(payload.interviewState.currentRound, 0),
            len(payload.interviewPlan.plan),
        )
        plan_items = payload.interviewPlan.plan[:max_started_round]
        transcript_buckets = self._split_messages_by_round(payload, plan_items)
        topic_inputs: list[InterviewTopicEvaluationInput] = []

        for round_index, round_item in enumerate(plan_items):
            topic_messages = (
                transcript_buckets[round_index] if round_index < len(transcript_buckets) else []
            )
            question = next(
                (
                    message.content
                    for message in topic_messages
                    if message.role == "assistant" and message.content.strip()
                ),
                round_item.description,
            )
            topic_inputs.append(
                InterviewTopicEvaluationInput(
                    sessionId=payload.sessionId,
                    jdText=payload.jdText,
                    jdData=payload.jdData,
                    resumeSnapshot=payload.resumeSnapshot,
                    roundNumber=round_item.round,
                    topic=round_item.topic,
                    topicDescription=round_item.description,
                    question=question or round_item.description,
                    transcript=topic_messages,
                )
            )

        return topic_inputs

    def _split_messages_by_round(
        self,
        payload: InterviewEvaluationAgentInput,
        plan_items: list,
    ) -> list[list]:
        buckets: list[list] = [[] for _ in plan_items]
        if not buckets:
            return buckets

        transcript = list(payload.messages)
        pointer = 0

        for round_index, _round_item in enumerate(plan_items):
            round_number = round_index + 1
            questions_left = max(
                0,
                payload.interviewState.questionsPerRound.get(str(round_number), 0),
            )

            while pointer < len(transcript) and questions_left > 0:
                message = transcript[pointer]
                pointer += 1

                if message.role == "assistant":
                    buckets[round_index].append(message)
                    questions_left -= 1

                    while pointer < len(transcript) and transcript[pointer].role != "assistant":
                        buckets[round_index].append(transcript[pointer])
                        pointer += 1
                else:
                    buckets[round_index].append(message)

        current_round_index = min(
            max(payload.interviewState.currentRound - 1, 0),
            len(buckets) - 1,
        )
        while pointer < len(transcript):
            buckets[current_round_index].append(transcript[pointer])
            pointer += 1

        return buckets

    def _max_topic_concurrency(self, topic_count: int) -> int:
        settings = get_settings()
        return max(
            1,
            min(
                topic_count,
                MAX_TOPIC_EVALUATION_CONCURRENCY,
                max(settings.rate_limit_max_bucket_size, 1),
            ),
        )

    def _evaluate_topic_previews_with_progress(
        self, topic_inputs: list[InterviewTopicEvaluationInput]
    ):
        if len(topic_inputs) <= 1:
            for index, topic_input in enumerate(topic_inputs):
                yield index, self._evaluate_topic_preview(topic_input)
            return

        max_workers = self._max_topic_concurrency(len(topic_inputs))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(self._evaluate_topic_preview, topic_input): index
                for index, topic_input in enumerate(topic_inputs)
            }
            for future in as_completed(futures):
                yield futures[future], future.result()

    def _evaluate_topic_preview(
        self, payload: InterviewTopicEvaluationInput
    ) -> EvaluationTopicPreview:
        try:
            result = self._invoke_with_retry(
                label="Topic preview evaluation",
                payload=payload,
                invoke_fn=lambda: self._invoke_topic_preview(payload),
            )
            return result or self._build_fallback_topic_preview(payload)
        except Exception:
            logger.exception(
                "Topic preview evaluation failed for session %s round %s, using fallback topic preview",
                payload.sessionId,
                payload.roundNumber,
            )
            return self._build_fallback_topic_preview(payload)

    def _evaluate_topic(
        self, payload: InterviewTopicEvaluationInput
    ) -> EvaluationTopicAssessment:
        try:
            result = self._invoke_with_retry(
                label="Topic evaluation",
                payload=payload,
                invoke_fn=lambda: self._invoke_topic_evaluation(payload),
            )
            return result or self._build_fallback_topic_assessment(payload)
        except Exception:
            logger.exception(
                "Topic evaluation failed for session %s round %s, using fallback topic assessment",
                payload.sessionId,
                payload.roundNumber,
            )
            return self._build_fallback_topic_assessment(payload)

    def _invoke_with_retry(self, label: str, payload: InterviewTopicEvaluationInput, invoke_fn):
        try:
            return invoke_fn()
        except Exception as exc:
            if self._is_retryable_topic_error(exc):
                logger.warning(
                    "%s transient failure for session %s round %s, retrying once",
                    label,
                    payload.sessionId,
                    payload.roundNumber,
                )
                time.sleep(TOPIC_EVALUATION_RETRY_DELAY_SECONDS)
                try:
                    return invoke_fn()
                except Exception:
                    logger.exception(
                        "%s retry failed for session %s round %s",
                        label,
                        payload.sessionId,
                        payload.roundNumber,
                    )
                    raise
            raise

    def _invoke_topic_evaluation(
        self, payload: InterviewTopicEvaluationInput
    ) -> EvaluationTopicAssessment | None:
        messages = self._build_topic_messages(payload)
        return invoke_with_fallback(
            self.topic_evaluation_llm,
            messages,
            EvaluationTopicAssessment,
        )

    def _invoke_topic_preview(
        self, payload: InterviewTopicEvaluationInput
    ) -> EvaluationTopicPreview | None:
        messages = self._build_topic_preview_messages(payload)
        return invoke_with_fallback(
            self.topic_preview_llm,
            messages,
            EvaluationTopicPreview,
        )

    def _is_retryable_topic_error(self, exc: Exception) -> bool:
        error_text = f"{type(exc).__name__}: {exc}".lower()
        return any(marker in error_text for marker in TOPIC_EVALUATION_RETRYABLE_MARKERS)

    def _evaluate_summary(
        self, payload: InterviewSummaryEvaluationInput
    ) -> InterviewEvaluationSummary:
        messages = self._build_summary_messages(payload)
        try:
            result = invoke_with_fallback(
                self.summary_evaluation_llm,
                messages,
                InterviewEvaluationSummary,
            )
            return result or self._build_fallback_summary(payload)
        except Exception:
            logger.exception(
                "Summary evaluation failed for session %s, using fallback summary",
                payload.sessionId,
            )
            return self._build_fallback_summary(payload)

    def _evaluate_preview_summary(
        self, payload: InterviewPreviewSummaryInput
    ) -> InterviewEvaluationSummary:
        messages = self._build_preview_summary_messages(payload)
        try:
            result = invoke_with_fallback(
                self.summary_evaluation_llm,
                messages,
                InterviewEvaluationSummary,
            )
            return result or self._build_fallback_preview_summary(payload)
        except Exception:
            logger.exception(
                "Preview summary evaluation failed for session %s, using fallback summary",
                payload.sessionId,
            )
            return self._build_fallback_preview_summary(payload)

    def _build_fallback_topic_assessment(
        self, payload: InterviewTopicEvaluationInput
    ) -> EvaluationTopicAssessment:
        answers = [message.content for message in payload.transcript if message.role == "user"]
        score = self._score_answers(answers)
        return EvaluationTopicAssessment(
            topic=payload.topic,
            question=payload.question or payload.topicDescription,
            assessmentFocus=[
                f"考察候选人是否能围绕 {payload.topic} 给出结构化回答",
                f"考察候选人是否能结合真实经历说明 {payload.topic} 的关键判断",
            ],
            answerHighlights=answers[:3],
            focusJudgments=[
                EvaluationFocusJudgment(
                    focus=f"考察候选人是否能围绕 {payload.topic} 给出结构化回答",
                    answerHighlightIndex=0 if len(answers) > 0 else None,
                    status="covered" if len(answers) > 0 else "missing",
                    reason="fallback 根据是否有对应回答生成",
                ),
                EvaluationFocusJudgment(
                    focus=f"考察候选人是否能结合真实经历说明 {payload.topic} 的关键判断",
                    answerHighlightIndex=1 if len(answers) > 1 else None,
                    status="covered" if len(answers) > 1 else "missing",
                    reason="fallback 根据是否有对应回答生成",
                ),
            ],
            strengths=self._build_strengths(payload.topic, answers),
            weaknesses=self._build_weaknesses(payload.topic, answers),
            followUps=[
                f"如果继续追问 {payload.topic}，需要补充哪些真实细节？",
                "是否能补上量化结果、验证方式和关键取舍？",
            ],
            suggestedAnswer=(
                f"回答 {payload.topic} 时，先讲背景和目标，再讲分析过程、关键动作和结果验证。"
            ),
            rubricScores=[
                EvaluationRubricScore(
                    name="structured_thinking",
                    score=score,
                    reason="fallback based on answer completeness",
                ),
                EvaluationRubricScore(
                    name="communication",
                    score=score,
                    reason="fallback based on answer completeness",
                ),
            ],
            overallScore=score,
        )

    def _build_fallback_topic_preview(
        self, payload: InterviewTopicEvaluationInput
    ) -> EvaluationTopicPreview:
        answers = [message.content for message in payload.transcript if message.role == "user"]
        score = self._score_answers(answers)
        return EvaluationTopicPreview(
            topic=payload.topic,
            question=payload.question or payload.topicDescription,
            previewSummary=(
                f"{payload.topic} 当前已有基础回答。"
                if answers
                else f"{payload.topic} 当前回答信息不足，首屏结论仅供参考。"
            ),
            keyIssues=self._build_weaknesses(payload.topic, answers)[:2],
            rubricScores=[
                EvaluationRubricScore(
                    name="structured_thinking",
                    score=score,
                    reason="fallback based on answer completeness",
                ),
                EvaluationRubricScore(
                    name="communication",
                    score=score,
                    reason="fallback based on answer completeness",
                ),
                EvaluationRubricScore(
                    name="domain_judgment",
                    score=score,
                    reason="fallback based on answer completeness",
                ),
            ],
            overallScore=score,
        )

    def _build_fallback_summary(
        self, payload: InterviewSummaryEvaluationInput
    ) -> InterviewEvaluationSummary:
        overall_score = round(
            sum(item.overallScore for item in payload.topicAssessments)
            / max(len(payload.topicAssessments), 1)
        )
        weakest = min(
            payload.topicAssessments,
            key=lambda item: item.overallScore,
            default=None,
        )
        return InterviewEvaluationSummary(
            summary="基于当前面试记录生成了基础评价框架。当前 fallback 结果只依据回答长度和覆盖度，后续可替换为真实 LLM 评价。",
            overallScore=overall_score,
            recommendation="优先补足弱项 topic 的真实案例、量化结果和取舍表达。",
            strengths=[
                "已形成统一输入结构，可直接消费前端快照。",
                "已形成逐轮 topic 评价的标准输出。",
            ],
            risks=[
                "当前 fallback 只做启发式评分，不代表最终面试评价质量。",
                "尚未接入真实复盘生成链路和引用证据能力。",
            ],
            priorityActions=[
                "将前端快照映射到 InterviewEvaluationAgentInput。",
                f"优先增强 {weakest.topic if weakest else '弱项 topic'} 的案例与结果表达。",
                "在 generate_review 中接入真实 agent 调用。",
            ],
        )

    def _build_fallback_preview_summary(
        self, payload: InterviewPreviewSummaryInput
    ) -> InterviewEvaluationSummary:
        overall_score = round(
            sum(item.overallScore for item in payload.topicPreviews)
            / max(len(payload.topicPreviews), 1)
        )
        weakest = min(
            payload.topicPreviews,
            key=lambda item: item.overallScore,
            default=None,
        )
        return InterviewEvaluationSummary(
            summary="已生成首屏复盘预览。当前结果优先展示整体表现和各 topic 的关键问题，详细拆解可按需继续生成。",
            overallScore=overall_score,
            recommendation="先查看整体 summary，再按优先级展开低分 topic 的深度分析。",
            strengths=[
                "已形成跨 topic 的快速复盘视图。",
                "可优先定位需要深挖的关键题目。",
            ],
            risks=[
                "当前首屏只展示轻量预览，不包含完整采分细节。",
                "详细建议需在单 topic 深度分析中进一步展开。",
            ],
            priorityActions=[
                f"优先展开 {weakest.topic if weakest else '低分 topic'} 的深度分析。",
                "优先补强回答中的真实案例、量化结果和关键取舍。",
            ],
        )

    @staticmethod
    def _score_answers(answers: list[str]) -> int:
        if not answers:
            return 55
        total_chars = sum(len(answer.strip()) for answer in answers)
        avg_chars = total_chars / max(len(answers), 1)
        score = 60 + min(16, int(avg_chars / 20)) + min(14, len(answers) * 4)
        return max(55, min(score, 88))

    @staticmethod
    def _build_strengths(topic: str, answers: list[str]) -> list[str]:
        if answers:
            return [
                f"{topic} 已有可分析的候选人回答。",
                "回答至少覆盖了问题的一部分主线。",
            ]
        return [f"{topic} 当前尚未沉淀足够回答内容。"]

    @staticmethod
    def _build_weaknesses(topic: str, answers: list[str]) -> list[str]:
        if len(answers) >= 2:
            return [
                f"{topic} 的回答仍缺少更明确的量化结果。",
                "案例细节、验证过程或取舍表达仍可继续补强。",
            ]
        return [
            f"{topic} 的回答样本不足，当前评价置信度有限。",
            "需要补充真实案例和完整表达链路。",
        ]


@lru_cache(maxsize=1)
def get_interview_evaluation_agent() -> InterviewEvaluationAgent:
    return InterviewEvaluationAgent()
