from fastapi.testclient import TestClient

from app.main import app
from app.schemas.resume import ResumeData
from app.schemas.resume_optimization import ResumeSuggestionsResponse, SectionSuggestions, SuggestionItem, SuggestionLocation

client = TestClient(app)


class StubOptimizer:
    async def get_suggestions(self, resume_data: ResumeData):
        return (
            ResumeSuggestionsResponse(
                sections=[
                    SectionSuggestions(
                        section="workExperience",
                        suggestions=[
                            SuggestionItem(
                                id="SUG-WORK-001",
                                priority=1,
                                issue_type="wording_issue",
                                location=SuggestionLocation(section="workExperience", item_index=0),
                                problem="描述偏弱",
                                original="负责接口开发",
                                suggestion="主导接口开发与性能优化",
                            )
                        ],
                    )
                ]
            ),
            0.12,
        )


class RuntimeConfigStub:
    model_provider = "openai"
    api_key = "runtime-key"
    base_url = "https://example.com/v1"
    model = "gpt-4o-mini"


def test_resume_suggestions_route_returns_display_only_contract(monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.resume_optimization.resolve_runtime_config",
        lambda runtime_config=None: RuntimeConfigStub(),
    )
    monkeypatch.setattr(
        "app.api.routes.resume_optimization.ResumeOptimizer.from_runtime_config",
        lambda runtime_config: StubOptimizer(),
    )

    response = client.post(
        "/api/resume/suggestions",
        json=ResumeData().model_dump(),
    )

    assert response.status_code == 200
    payload = response.json()
    suggestion = payload["sections"][0]["suggestions"][0]
    assert suggestion == {
        "id": "SUG-WORK-001",
        "priority": 1,
        "issue_type": "wording_issue",
        "location": {
            "section": "workExperience",
            "item_index": 0,
        },
        "problem": "描述偏弱",
        "original": "负责接口开发",
        "suggestion": "主导接口开发与性能优化",
    }
    assert "suggestion_type" not in suggestion
    assert "field_path" not in suggestion["location"]
    assert "field_label" not in suggestion["location"]


class FailingOptimizer:
    async def get_overview(self, resume_data: ResumeData):
        raise RuntimeError("provider returned raw stack details")

    async def get_suggestions(self, resume_data: ResumeData):
        raise RuntimeError("provider suggestions failure")


def test_resume_overview_route_sanitizes_runtime_failures(monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.resume_optimization.resolve_runtime_config",
        lambda runtime_config=None: RuntimeConfigStub(),
    )
    monkeypatch.setattr(
        "app.api.routes.resume_optimization.ResumeOptimizer.from_runtime_config",
        lambda runtime_config: FailingOptimizer(),
    )

    response = client.post("/api/resume/overview", json=ResumeData().model_dump())

    assert response.status_code == 502
    assert response.json()["detail"]["error"] == {
        "code": "LLM_FAILED",
        "message": "Failed to generate overview",
    }
    assert "provider returned raw stack details" not in response.text


def test_resume_suggestions_route_sanitizes_runtime_failures(monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.resume_optimization.resolve_runtime_config",
        lambda runtime_config=None: RuntimeConfigStub(),
    )
    monkeypatch.setattr(
        "app.api.routes.resume_optimization.ResumeOptimizer.from_runtime_config",
        lambda runtime_config: FailingOptimizer(),
    )

    response = client.post("/api/resume/suggestions", json=ResumeData().model_dump())

    assert response.status_code == 502
    assert response.json()["detail"]["error"] == {
        "code": "LLM_FAILED",
        "message": "Failed to generate suggestions",
    }
    assert "provider suggestions failure" not in response.text
