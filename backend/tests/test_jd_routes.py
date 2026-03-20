from fastapi.testclient import TestClient

from app.main import app
from app.schemas.jd import JDData

client = TestClient(app)


class RuntimeConfigStub:
    model_provider = "openai"
    api_key = "runtime-key"
    base_url = "https://example.com/v1"
    model = "gpt-4o-mini"


class InvalidContentExtractor:
    def extract_to_dict(self, text: str):
        raise ValueError("should not be used")


class FailingExtractor:
    def extract_to_dict(self, text: str):
        raise RuntimeError("upstream provider stack trace")


class SuccessfulExtractor:
    def extract_to_dict(self, text: str):
        return JDData().model_dump(), 0.42


def test_extract_jd_sanitizes_invalid_jd_content(monkeypatch):
    from app.services.jd_extractor import InvalidJDContentError

    monkeypatch.setattr(
        "app.api.routes.jd.resolve_runtime_config",
        lambda runtime_config=None: RuntimeConfigStub(),
    )
    monkeypatch.setattr(
        "app.api.routes.jd.JDExtractor.from_runtime_config",
        lambda runtime_config: InvalidContentExtractor(),
    )

    def fake_run_in_executor(executor, func):
        raise InvalidJDContentError("raw classifier output leaked")

    class LoopStub:
        async def run_in_executor(self, executor, func):
            return fake_run_in_executor(executor, func)

    monkeypatch.setattr("app.api.routes.jd.asyncio.get_event_loop", lambda: LoopStub())

    response = client.post("/api/jd/extract", json={"text": "not a job description"})

    assert response.status_code == 400
    assert response.json()["detail"]["error"] == {
        "code": "INVALID_JD_CONTENT",
        "message": "上传内容不是一份正常的岗位 JD，请粘贴职位描述后重试。",
    }
    assert "raw classifier output leaked" not in response.text


def test_extract_jd_sanitizes_llm_failures(monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.jd.resolve_runtime_config",
        lambda runtime_config=None: RuntimeConfigStub(),
    )
    monkeypatch.setattr(
        "app.api.routes.jd.JDExtractor.from_runtime_config",
        lambda runtime_config: FailingExtractor(),
    )

    class LoopStub:
        async def run_in_executor(self, executor, func):
            raise RuntimeError("upstream provider stack trace")

    monkeypatch.setattr("app.api.routes.jd.asyncio.get_event_loop", lambda: LoopStub())

    response = client.post("/api/jd/extract", json={"text": "frontend engineer jd"})

    assert response.status_code == 502
    assert response.json()["detail"]["error"] == {
        "code": "LLM_FAILED",
        "message": "Failed to extract JD data",
    }
    assert "upstream provider stack trace" not in response.text


def test_extract_jd_keeps_success_contract(monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.jd.resolve_runtime_config",
        lambda runtime_config=None: RuntimeConfigStub(),
    )
    monkeypatch.setattr(
        "app.api.routes.jd.JDExtractor.from_runtime_config",
        lambda runtime_config: SuccessfulExtractor(),
    )

    class LoopStub:
        async def run_in_executor(self, executor, func):
            return func()

    monkeypatch.setattr("app.api.routes.jd.asyncio.get_event_loop", lambda: LoopStub())

    response = client.post("/api/jd/extract", json={"text": "frontend engineer jd"})

    assert response.status_code == 200
    payload = response.json()
    assert payload == {
        "data": JDData().model_dump(),
        "elapsed_seconds": 0.42,
    }
