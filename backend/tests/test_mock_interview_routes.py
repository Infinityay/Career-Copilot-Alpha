from __future__ import annotations

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.routes import mock_interview as mock_interview_route
from app.main import app
from app.schemas.interview import Category, InterviewType
from app.schemas.jd import JDData, JDBasicInfo, JDRequirements
from app.schemas.mock_interview import (
    MockInterviewPlan,
    MockInterviewRetrievalFilters,
    MockInterviewRetrievalItem,
    MockInterviewRetrievalResult,
    MockInterviewRound,
    MockInterviewSessionCreateResponse,
    MockInterviewSessionLimits,
    MockInterviewState,
)
from app.services.mock_interview_service import get_mock_interview_service


class StubService:
    def _build_session_response(self, request):
        return MockInterviewSessionCreateResponse(
            sessionId="stub-session",
            interviewType=request.interviewType,
            category=request.category,
            limits=MockInterviewSessionLimits(),
            interviewPlan=MockInterviewPlan(
                plan=[
                    MockInterviewRound(round=1, topic="开场介绍", description="自我介绍与岗位动机。"),
                    MockInterviewRound(round=2, topic="项目概述", description="整体介绍最相关项目。"),
                    MockInterviewRound(round=3, topic="技术深挖", description="围绕关键技术决策和难点持续深挖。"),
                    MockInterviewRound(round=4, topic="LeetCode 编码", description="围绕指定代码题考察算法与实现能力。"),
                ],
                total_rounds=4,
                estimated_duration="45-60分钟",
                leetcode_problem="实现一个 LRU Cache",
            ),
            interviewState=MockInterviewState(
                currentRound=1,
                questionsPerRound={"1": 0},
                assistantQuestionCount=0,
                turnCount=0,
                reflectionHistory=[],
                closed=False,
            ),
            jdData=JDData(
                basicInfo=JDBasicInfo(company="阿里巴巴", jobTitle="前端开发工程师"),
                requirements=JDRequirements(techStack=["React"]),
            ),
            retrieval=MockInterviewRetrievalResult(
                queryText="前端开发\n校招\nReact",
                appliedFilters=MockInterviewRetrievalFilters(
                    category=request.category,
                    interviewType=request.interviewType,
                    company="阿里",
                ),
                items=[
                    MockInterviewRetrievalItem(
                        interviewId=11,
                        title="阿里前端一面",
                        company="阿里巴巴",
                        category=request.category,
                        interviewType=request.interviewType,
                        stage="一面",
                        publishTime="2024-10-01 10:00:00",
                        snippet="React 和工程化",
                        score=1.11,
                        reason="公司：阿里巴巴",
                    )
                ],
            ),
            resumeFingerprint="fp_stub",
            expiresAt="2026-03-13T10:00:00+00:00",
        )

    async def stream_create_session(self, request):
        yield {"event": "progress", "data": {"stage": "retrieving_evidence", "message": "正在检索相关面经"}}
        yield {"event": "developer_trace", "data": {"type": "retrieval", "createdAt": "2026-03-13T10:00:00+00:00", "payload": {"queryText": "前端开发", "filterChain": [], "appliedFilters": {"category": request.category, "interviewType": request.interviewType, "company": "阿里"}, "candidateTopk": 20, "topk": 5, "denseWeight": 0.6, "sparseWeight": 0.4, "ragEnabled": True, "resultItems": [], "elapsedMs": 12}}}
        yield {"event": "progress", "data": {"stage": "generating_plan", "message": "正在生成面试计划"}}
        payload = self._build_session_response(request).model_dump(mode="json")
        payload["developerContext"] = {"sessionMode": "frontend_local_only", "privacyMode": "frontend_local_export_only", "ragEnabled": True, "transcriptPersistence": "frontend_local_only", "tracePersistence": "frontend_local_only"}
        yield {"event": "session_created", "data": payload}
        yield {"event": "done", "data": {"sessionId": "stub-session", "status": "ready"}}

    async def stream_turn(self, session_id, request):
        assert request.interviewPlan.total_rounds == 4
        assert request.interviewState.currentRound == 1
        if request.mode == "reply":
            yield {"event": "user_message", "data": {"id": "user-1", "role": "user", "content": request.message}}
            yield {"event": "answer_analysis_started", "data": {"stage": "analyzing_answer", "message": "正在分析你的回答"}}
            yield {"event": "reflection_result", "data": {"depth_score": 4, "authenticity_score": 4, "completeness_score": 4, "logic_score": 4, "overall_assessment": "回答较完整，可以继续。", "should_continue": True, "suggested_follow_up": "请补充更多技术细节。", "reason": "还有可追问空间。"}}
            yield {"event": "developer_trace", "data": {"type": "reflection", "createdAt": "2026-03-13T10:00:00+00:00", "payload": {"promptKey": "reflection", "candidateAnswer": request.message, "currentRoundHistory": "面试官: 请介绍一下项目。", "questionCount": 1, "output": {"depth_score": 4, "authenticity_score": 4, "completeness_score": 4, "logic_score": 4, "overall_assessment": "回答较完整，可以继续。", "should_continue": True, "suggested_follow_up": "请补充更多技术细节。", "reason": "还有可追问空间。"}, "fallbackUsed": False, "elapsedMs": 7}}}
        else:
            yield {"event": "developer_trace", "data": {"type": "interviewer_generation", "createdAt": "2026-03-13T10:00:00+00:00", "payload": {"promptKey": "interviewer", "round": 1, "topic": "开场介绍", "suggestedFollowUp": "", "closeInterview": False, "recentConversation": [], "finalMessage": "你好，先做个自我介绍。", "elapsedMs": 8}}}
        yield {"event": "message_start", "data": {"messageId": "assistant-1", "role": "assistant"}}
        yield {"event": "message_delta", "data": {"messageId": "assistant-1", "delta": "你好，先做个自我介绍。"}}
        yield {
            "event": "message_end",
            "data": {
                "messageId": "assistant-1",
                "content": "你好，先做个自我介绍。",
                "interviewState": {
                    "currentRound": 1,
                    "questionsPerRound": {"1": 1},
                    "assistantQuestionCount": 1,
                    "turnCount": 0,
                    "reflectionHistory": [],
                    "closed": False,
                },
                "elapsedMs": 8,
            },
        }
        yield {
            "event": "done",
            "data": {
                "sessionId": session_id,
                "status": "ready",
                "interviewState": {
                    "currentRound": 1,
                    "questionsPerRound": {"1": 1},
                    "assistantQuestionCount": 1,
                    "turnCount": 0,
                    "reflectionHistory": [],
                    "closed": False,
                },
            },
        }


client = TestClient(app)


def setup_module():
    app.dependency_overrides[get_mock_interview_service] = lambda: StubService()


def teardown_module():
    app.dependency_overrides.clear()


def test_speech_status_reports_unavailable_when_keys_missing(monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.speech.resolve_speech_config",
        lambda runtime_config=None: type("SpeechConfigStub", (), {"available": False})(),
    )

    response = client.get("/api/speech/status")

    assert response.status_code == 200
    assert response.json() == {"available": False}


def test_stream_create_mock_interview_session_route_requires_jd_data():
    response = client.post(
        "/api/mock-interview/session/stream-create",
        headers={"Accept": "text/event-stream"},
        json={
            "interviewType": InterviewType.CAMPUS.value,
            "category": Category.FRONTEND.value,
            "jdText": "熟悉 React",
            "resumeData": {
                "basicInfo": {
                    "name": "",
                    "personalEmail": "",
                    "phoneNumber": "",
                    "age": "",
                    "born": "",
                    "gender": "",
                    "desiredPosition": "",
                    "desiredLocation": [],
                    "currentLocation": "",
                    "placeOfOrigin": "",
                    "rewards": [],
                },
                "workExperience": [],
                "education": [],
                "projects": [],
                "academicAchievements": [],
            },
        },
    )

    assert response.status_code == 422
    assert "jdData is required" in response.text


def test_stream_create_mock_interview_session_route_requires_jd_text():
    response = client.post(
        "/api/mock-interview/session/stream-create",
        headers={"Accept": "text/event-stream"},
        json={
            "interviewType": InterviewType.CAMPUS.value,
            "category": Category.FRONTEND.value,
            "jdText": "   ",
            "jdData": {
                "basicInfo": {
                    "company": "阿里巴巴",
                    "jobTitle": "前端开发工程师"
                },
                "requirements": {
                    "techStack": ["React"]
                }
            },
            "resumeData": {
                "basicInfo": {
                    "name": "",
                    "personalEmail": "",
                    "phoneNumber": "",
                    "age": "",
                    "born": "",
                    "gender": "",
                    "desiredPosition": "",
                    "desiredLocation": [],
                    "currentLocation": "",
                    "placeOfOrigin": "",
                    "rewards": [],
                },
                "workExperience": [],
                "education": [],
                "projects": [],
                "academicAchievements": [],
            },
        },
    )

    assert response.status_code == 422
    assert "jdText is required" in response.text


def test_stream_create_mock_interview_session_route_returns_sse_events(monkeypatch):
    captured = {}

    def fake_build_service(runtime_config_request):
        captured["runtimeConfig"] = runtime_config_request.model_dump() if runtime_config_request else None
        return StubService()

    monkeypatch.setattr(mock_interview_route, "_build_service", fake_build_service)

    response = client.post(
        "/api/mock-interview/session/stream-create",
        json={
            "interviewType": InterviewType.CAMPUS.value,
            "category": Category.FRONTEND.value,
            "jdText": "熟悉 React",
            "runtimeConfig": {"modelProvider": "anthropic", "apiKey": "runtime-key", "baseURL": "https://custom.example/v1", "model": "custom-model"},
            "jdData": {
                "basicInfo": {
                    "company": "阿里巴巴",
                    "jobTitle": "前端开发工程师"
                },
                "requirements": {
                    "techStack": ["React"]
                }
            },
            "resumeData": {
                "basicInfo": {
                    "name": "",
                    "personalEmail": "",
                    "phoneNumber": "",
                    "age": "",
                    "born": "",
                    "gender": "",
                    "desiredPosition": "",
                    "desiredLocation": [],
                    "currentLocation": "",
                    "placeOfOrigin": "",
                    "rewards": [],
                },
                "workExperience": [],
                "education": [],
                "projects": [],
                "academicAchievements": [],
            },
        },
        headers={"Accept": "text/event-stream"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    body = response.text
    assert "event: progress" in body
    assert "retrieving_evidence" in body
    assert "generating_plan" in body
    assert "event: developer_trace" in body
    assert "event: session_created" in body
    assert '"interviewPlan"' in body
    assert '"interviewState"' in body
    assert '"developerContext"' in body
    assert captured["runtimeConfig"] == {
        "modelProvider": "anthropic",
        "apiKey": "runtime-key",
        "baseURL": "https://custom.example/v1",
        "model": "custom-model",
        "ocrApiKey": None,
        "speechAppKey": None,
        "speechAccessKey": None,
    }


def test_stream_mock_interview_route_returns_sse_events(monkeypatch):
    captured = {}

    def fake_build_service(runtime_config_request):
        captured["runtimeConfig"] = runtime_config_request.model_dump() if runtime_config_request else None
        return StubService()

    monkeypatch.setattr(mock_interview_route, "_build_service", fake_build_service)

    response = client.post(
        "/api/mock-interview/session/stub-session/stream",
        json={
            "mode": "start",
            "interviewType": InterviewType.CAMPUS.value,
            "category": Category.FRONTEND.value,
            "jdText": "熟悉 React",
            "runtimeConfig": {"modelProvider": "anthropic", "apiKey": "runtime-key", "baseURL": "https://custom.example/v1", "model": "custom-model"},
            "jdData": {
                "basicInfo": {"company": "阿里巴巴", "jobTitle": "前端开发工程师"},
                "requirements": {"techStack": ["React"]},
            },
            "resumeSnapshot": {
                "basicInfo": {
                    "name": "",
                    "personalEmail": "",
                    "phoneNumber": "",
                    "age": "",
                    "born": "",
                    "gender": "",
                    "desiredPosition": "",
                    "desiredLocation": [],
                    "currentLocation": "",
                    "placeOfOrigin": "",
                    "rewards": [],
                },
                "workExperience": [],
                "education": [],
                "projects": [],
                "academicAchievements": [],
            },
            "retrieval": {
                "queryText": "前端开发\n校招\nReact",
                "appliedFilters": {
                    "category": Category.FRONTEND.value,
                    "interviewType": InterviewType.CAMPUS.value,
                    "company": "阿里",
                },
                "items": [],
            },
            "interviewPlan": {
                "plan": [
                    {"round": 1, "topic": "开场介绍", "description": "自我介绍与岗位动机。"},
                    {"round": 2, "topic": "项目概述", "description": "整体介绍最相关项目。"},
                    {"round": 3, "topic": "技术深挖", "description": "围绕关键技术决策和难点持续深挖。"},
                    {"round": 4, "topic": "LeetCode 编码", "description": "围绕指定代码题考察算法与实现能力。"}
                ],
                "total_rounds": 4,
                "estimated_duration": "45-60分钟",
                "leetcode_problem": "实现一个 LRU Cache"
            },
            "interviewState": {
                "currentRound": 1,
                "questionsPerRound": {"1": 0},
                "assistantQuestionCount": 0,
                "turnCount": 0,
                "reflectionHistory": [],
                "closed": False
            },
            "messages": [],
        },
        headers={"Accept": "text/event-stream"},
    )

    assert response.status_code == 200
    body = response.text
    assert "event: developer_trace" in body
    assert "event: message_start" in body
    assert "event: message_delta" in body
    assert '"interviewState"' in body
    assert "你好，先做个自我介绍。" in body
    assert "event: answer_analysis_started" not in body
    assert captured["runtimeConfig"] == {
        "modelProvider": "anthropic",
        "apiKey": "runtime-key",
        "baseURL": "https://custom.example/v1",
        "model": "custom-model",
        "ocrApiKey": None,
        "speechAppKey": None,
        "speechAccessKey": None,
    }


def test_stream_mock_interview_reply_route_passes_answer_analysis_started_event_through(monkeypatch):
    captured = {}

    def fake_build_service(runtime_config_request):
        captured["runtimeConfig"] = runtime_config_request.model_dump() if runtime_config_request else None
        return StubService()

    monkeypatch.setattr(mock_interview_route, "_build_service", fake_build_service)

    response = client.post(
        "/api/mock-interview/session/stub-session/stream",
        json={
            "mode": "reply",
            "message": "这是我的回答",
            "interviewType": InterviewType.CAMPUS.value,
            "category": Category.FRONTEND.value,
            "jdText": "熟悉 React",
            "runtimeConfig": {"modelProvider": "anthropic", "apiKey": "runtime-key", "baseURL": "https://custom.example/v1", "model": "custom-model"},
            "jdData": {
                "basicInfo": {"company": "阿里巴巴", "jobTitle": "前端开发工程师"},
                "requirements": {"techStack": ["React"]},
            },
            "resumeSnapshot": {
                "basicInfo": {
                    "name": "",
                    "personalEmail": "",
                    "phoneNumber": "",
                    "age": "",
                    "born": "",
                    "gender": "",
                    "desiredPosition": "",
                    "desiredLocation": [],
                    "currentLocation": "",
                    "placeOfOrigin": "",
                    "rewards": [],
                },
                "workExperience": [],
                "education": [],
                "projects": [],
                "academicAchievements": [],
            },
            "retrieval": {
                "queryText": "前端开发\n校招\nReact",
                "appliedFilters": {
                    "category": Category.FRONTEND.value,
                    "interviewType": InterviewType.CAMPUS.value,
                    "company": "阿里",
                },
                "items": [],
            },
            "interviewPlan": {
                "plan": [
                    {"round": 1, "topic": "开场介绍", "description": "自我介绍与岗位动机。"},
                    {"round": 2, "topic": "项目概述", "description": "整体介绍最相关项目。"},
                    {"round": 3, "topic": "技术深挖", "description": "围绕关键技术决策和难点持续深挖。"},
                    {"round": 4, "topic": "LeetCode 编码", "description": "围绕指定代码题考察算法与实现能力。"}
                ],
                "total_rounds": 4,
                "estimated_duration": "45-60分钟",
                "leetcode_problem": "实现一个 LRU Cache"
            },
            "interviewState": {
                "currentRound": 1,
                "questionsPerRound": {"1": 1},
                "assistantQuestionCount": 1,
                "turnCount": 1,
                "reflectionHistory": [],
                "closed": False
            },
            "messages": [{"id": "assistant-1", "role": "assistant", "content": "请介绍一下你的项目。"}],
        },
        headers={"Accept": "text/event-stream"},
    )

    assert response.status_code == 200
    body = response.text
    assert "event: user_message" in body
    assert "event: answer_analysis_started" in body
    assert '"stage": "analyzing_answer"' in body
    assert '"message": "正在分析你的回答"' in body
    assert "event: reflection_result" in body
    assert "event: message_start" in body
    assert captured["runtimeConfig"] == {
        "modelProvider": "anthropic",
        "apiKey": "runtime-key",
        "baseURL": "https://custom.example/v1",
        "model": "custom-model",
        "ocrApiKey": None,
        "speechAppKey": None,
        "speechAccessKey": None,
    }


class FailingCreateService:
    async def stream_create_session(self, request):
        raise RuntimeError("provider stack trace leaked")
        yield


class HttpErrorCreateService:
    async def stream_create_session(self, request):
        raise HTTPException(status_code=409, detail="session already exists")
        yield


class FailingTurnService:
    async def stream_turn(self, session_id, request):
        raise RuntimeError("speech provider trace leaked")
        yield


def _build_create_request() -> dict:
    return {
        "interviewType": InterviewType.CAMPUS.value,
        "category": Category.FRONTEND.value,
        "jdText": "熟悉 React",
        "jdData": {
            "basicInfo": {"company": "阿里巴巴", "jobTitle": "前端开发工程师"},
            "requirements": {"techStack": ["React"]},
        },
        "resumeData": {
            "basicInfo": {
                "name": "",
                "personalEmail": "",
                "phoneNumber": "",
                "age": "",
                "born": "",
                "gender": "",
                "desiredPosition": "",
                "desiredLocation": [],
                "currentLocation": "",
                "placeOfOrigin": "",
                "rewards": [],
            },
            "workExperience": [],
            "education": [],
            "projects": [],
            "academicAchievements": [],
        },
    }


def _build_stream_request() -> dict:
    return {
        "mode": "start",
        "interviewType": InterviewType.CAMPUS.value,
        "category": Category.FRONTEND.value,
        "jdText": "熟悉 React",
        "jdData": {
            "basicInfo": {"company": "阿里巴巴", "jobTitle": "前端开发工程师"},
            "requirements": {"techStack": ["React"]},
        },
        "resumeSnapshot": {
            "basicInfo": {
                "name": "",
                "personalEmail": "",
                "phoneNumber": "",
                "age": "",
                "born": "",
                "gender": "",
                "desiredPosition": "",
                "desiredLocation": [],
                "currentLocation": "",
                "placeOfOrigin": "",
                "rewards": [],
            },
            "workExperience": [],
            "education": [],
            "projects": [],
            "academicAchievements": [],
        },
        "retrieval": {
            "queryText": "前端开发\n校招\nReact",
            "appliedFilters": {
                "category": Category.FRONTEND.value,
                "interviewType": InterviewType.CAMPUS.value,
                "company": "阿里",
            },
            "items": [],
        },
        "interviewPlan": {
            "plan": [
                {"round": 1, "topic": "开场介绍", "description": "自我介绍与岗位动机。"},
                {"round": 2, "topic": "项目概述", "description": "整体介绍最相关项目。"},
                {"round": 3, "topic": "技术深挖", "description": "围绕关键技术决策和难点持续深挖。"},
                {"round": 4, "topic": "LeetCode 编码", "description": "围绕指定代码题考察算法与实现能力。"}
            ],
            "total_rounds": 4,
            "estimated_duration": "45-60分钟",
            "leetcode_problem": "实现一个 LRU Cache"
        },
        "interviewState": {
            "currentRound": 1,
            "questionsPerRound": {"1": 0},
            "assistantQuestionCount": 0,
            "turnCount": 0,
            "reflectionHistory": [],
            "closed": False
        },
        "messages": [],
    }


def test_stream_create_mock_interview_session_sanitizes_generic_sse_errors(monkeypatch):
    monkeypatch.setattr(
        mock_interview_route,
        "_build_service",
        lambda runtime_config_request: FailingCreateService(),
    )

    response = client.post(
        "/api/mock-interview/session/stream-create",
        json=_build_create_request(),
        headers={"Accept": "text/event-stream"},
    )

    assert response.status_code == 200
    assert 'event: error' in response.text
    assert '"message": "Internal server error"' in response.text
    assert '"status": 500' in response.text
    assert "provider stack trace leaked" not in response.text


def test_stream_create_mock_interview_session_preserves_safe_http_error_detail(monkeypatch):
    monkeypatch.setattr(
        mock_interview_route,
        "_build_service",
        lambda runtime_config_request: HttpErrorCreateService(),
    )

    response = client.post(
        "/api/mock-interview/session/stream-create",
        json=_build_create_request(),
        headers={"Accept": "text/event-stream"},
    )

    assert response.status_code == 200
    assert 'event: error' in response.text
    assert '"message": "session already exists"' in response.text
    assert '"status": 409' in response.text


def test_stream_mock_interview_session_sanitizes_generic_sse_errors(monkeypatch):
    monkeypatch.setattr(
        mock_interview_route,
        "_build_service",
        lambda runtime_config_request: FailingTurnService(),
    )

    response = client.post(
        "/api/mock-interview/session/stub-session/stream",
        json=_build_stream_request(),
        headers={"Accept": "text/event-stream"},
    )

    assert response.status_code == 200
    assert 'event: error' in response.text
    assert '"message": "Internal server error"' in response.text
    assert '"status": 500' in response.text
    assert "speech provider trace leaked" not in response.text


def test_speech_websocket_sanitizes_generic_runtime_errors(monkeypatch):
    class SpeechConfigStub:
        available = True

    class FailingSpeechService:
        async def start(self, **kwargs):
            raise RuntimeError("speech provider trace leaked")

        async def close(self):
            return None

    monkeypatch.setattr(
        "app.api.routes.speech.resolve_speech_config",
        lambda runtime_config=None: SpeechConfigStub(),
    )
    monkeypatch.setattr(
        "app.api.routes.speech.create_transcription_service",
        lambda speech_config=None: FailingSpeechService(),
    )

    with client.websocket_connect("/api/speech/transcribe") as websocket:
        websocket.send_json({"type": "start"})
        message = websocket.receive_json()

    assert message == {"type": "error", "message": "Speech transcription failed"}
