from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.schemas.resume import ResumeData
from app.services import pdf_parser
from app.services.pdf_parser import DocumentParseResult, DirectFileParsingUnsupportedError

client = TestClient(app)


class StubExtractor:
    def __init__(self, result: ResumeData | None = None):
        self.result = result or ResumeData()

    def validate_resume_text_or_raise(self, text: str):
        return None

    def extract_all(self, text: str):
        return self.result, 0.42


class RuntimeConfigStub:
    def __init__(self, model: str = "gpt-4o-mini", model_provider: str = "openai"):
        self.model_provider = model_provider
        self.api_key = "runtime-key"
        self.base_url = "https://example.com/v1"
        self.model = model



def test_parse_resume_keeps_success_response_contract(monkeypatch):
    async def fake_parse_resume_document(**kwargs):
        assert kwargs["file_bytes"] == b"resume content"
        assert kwargs["file_extension"] == "txt"
        assert kwargs["filename"] == "resume.txt"
        return ResumeData(), DocumentParseResult(
            text="resume text",
            ocr_elapsed=1.23,
            llm_elapsed=0.66,
            extraction_method="text_then_llm",
            guidance="",
            llm_file_parsing_available=False,
        )

    monkeypatch.setattr("app.api.routes.resume.ResumeExtractor.from_runtime_config", lambda runtime_config: StubExtractor())
    monkeypatch.setattr("app.api.routes.resume.resolve_runtime_config", lambda runtime_config=None: RuntimeConfigStub())
    monkeypatch.setattr("app.api.routes.resume.resolve_ocr_api_key", lambda runtime_ocr_api_key=None: None)
    monkeypatch.setattr("app.api.routes.resume.parse_resume_document", fake_parse_resume_document)

    response = client.post(
        "/api/resume/parse",
        files={"file": ("resume.txt", b"resume content", "text/plain")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"] == ResumeData().model_dump()
    assert "skills" not in payload["data"]["basicInfo"]
    assert payload["meta"] == {
        "filename": "resume.txt",
        "extension": "txt",
        "elapsed": {"ocr_seconds": 1.23, "llm_seconds": 0.66},
        "guidance": "",
    }



def test_parse_resume_accepts_runtime_override_form_fields(monkeypatch):
    captured = {}

    async def fake_parse_resume_document(**kwargs):
        captured["runtime_model"] = kwargs["runtime_config"].model
        return ResumeData(), DocumentParseResult(
            text="resume text",
            ocr_elapsed=0.0,
            llm_elapsed=0.5,
            extraction_method="text_then_llm",
        )

    def fake_resolve_runtime_config(runtime_config=None):
        captured["runtime_config"] = runtime_config.model_dump()
        return RuntimeConfigStub(
            model=runtime_config.model.strip(),
            model_provider=runtime_config.modelProvider.strip(),
        )

    monkeypatch.setattr("app.api.routes.resume.ResumeExtractor.from_runtime_config", lambda runtime_config: StubExtractor())
    monkeypatch.setattr("app.api.routes.resume.resolve_runtime_config", fake_resolve_runtime_config)
    monkeypatch.setattr("app.api.routes.resume.resolve_ocr_api_key", lambda runtime_ocr_api_key=None: None)
    monkeypatch.setattr("app.api.routes.resume.parse_resume_document", fake_parse_resume_document)

    response = client.post(
        "/api/resume/parse",
        data={
            "runtime_model_provider": " anthropic ",
            "runtime_api_key": " user-key ",
            "runtime_base_url": " https://custom.example/v1 ",
            "runtime_model": " custom-model ",
        },
        files={"file": ("resume.txt", b"resume content", "text/plain")},
    )

    assert response.status_code == 200
    assert captured["runtime_config"] == {
        "modelProvider": " anthropic ",
        "apiKey": " user-key ",
        "baseURL": " https://custom.example/v1 ",
        "model": " custom-model ",
        "ocrApiKey": None,
        "speechAppKey": None,
        "speechAccessKey": None,
    }
    assert captured["runtime_model"] == "custom-model"



def test_parse_resume_maps_direct_file_guidance_to_clear_error(monkeypatch):
    monkeypatch.setattr("app.api.routes.resume.ResumeExtractor.from_runtime_config", lambda runtime_config: StubExtractor())
    monkeypatch.setattr("app.api.routes.resume.resolve_runtime_config", lambda runtime_config=None: RuntimeConfigStub(model="text-only-model"))
    monkeypatch.setattr("app.api.routes.resume.resolve_ocr_api_key", lambda runtime_ocr_api_key=None: None)

    async def fail_parse_resume_document(**kwargs):
        raise DirectFileParsingUnsupportedError("当前模型 text-only-model 未明确支持 PDF 文件直抽。")

    monkeypatch.setattr("app.api.routes.resume.parse_resume_document", fail_parse_resume_document)

    response = client.post(
        "/api/resume/parse",
        files={"file": ("resume.pdf", b"%PDF-1.4", "application/pdf")},
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["detail"]["error"]["code"] == "LLM_FILE_PARSING_UNAVAILABLE"
    assert payload["detail"]["error"]["details"]["parseMeta"] == {
        "filename": "resume.pdf",
        "extension": "pdf",
        "elapsed": {"ocr_seconds": 0.0, "llm_seconds": 0.0},
        "guidance": "当前模型 text-only-model 未明确支持 PDF 文件直抽。",
    }



def test_parse_resume_preserves_ocr_branch_metadata(monkeypatch):
    monkeypatch.setattr("app.api.routes.resume.ResumeExtractor.from_runtime_config", lambda runtime_config: StubExtractor())
    monkeypatch.setattr("app.api.routes.resume.resolve_runtime_config", lambda runtime_config=None: RuntimeConfigStub(model="gpt-4o"))
    monkeypatch.setattr("app.api.routes.resume.resolve_ocr_api_key", lambda runtime_ocr_api_key=None: "ocr-key")

    async def fake_parse_resume_document(**kwargs):
        assert kwargs["ocr_api_key"] == "ocr-key"
        return ResumeData(), DocumentParseResult(
            text="ocr text",
            ocr_elapsed=1.0,
            llm_elapsed=0.7,
            extraction_method="ocr_then_llm",
            guidance="",
            llm_file_parsing_available=True,
        )

    monkeypatch.setattr("app.api.routes.resume.parse_resume_document", fake_parse_resume_document)

    response = client.post(
        "/api/resume/parse",
        data={"runtime_ocr_api_key": "ocr-key"},
        files={"file": ("resume.png", b"png-bytes", "image/png")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"] == {
        "filename": "resume.png",
        "extension": "png",
        "elapsed": {"ocr_seconds": 1.0, "llm_seconds": 0.7},
        "guidance": "",
    }



def test_parse_resume_maps_runtime_error_to_ocr_failed(monkeypatch):
    monkeypatch.setattr("app.api.routes.resume.ResumeExtractor.from_runtime_config", lambda runtime_config: StubExtractor())
    monkeypatch.setattr("app.api.routes.resume.resolve_runtime_config", lambda runtime_config=None: RuntimeConfigStub())
    monkeypatch.setattr("app.api.routes.resume.resolve_ocr_api_key", lambda runtime_ocr_api_key=None: "ocr-key")

    async def fail_parse_resume_document(**kwargs):
        raise RuntimeError("ocr backend unavailable")

    monkeypatch.setattr("app.api.routes.resume.parse_resume_document", fail_parse_resume_document)

    response = client.post(
        "/api/resume/parse",
        files={"file": ("resume.pdf", b"%PDF-1.4", "application/pdf")},
    )

    assert response.status_code == 502
    payload = response.json()
    assert payload["detail"]["error"] == {
        "code": "OCR_FAILED",
        "message": "Failed to parse document",
    }
    assert "ocr backend unavailable" not in response.text



def test_parse_resume_maps_runtime_error_to_llm_failed_without_ocr(monkeypatch):
    monkeypatch.setattr("app.api.routes.resume.ResumeExtractor.from_runtime_config", lambda runtime_config: StubExtractor())
    monkeypatch.setattr("app.api.routes.resume.resolve_runtime_config", lambda runtime_config=None: RuntimeConfigStub())
    monkeypatch.setattr("app.api.routes.resume.resolve_ocr_api_key", lambda runtime_ocr_api_key=None: None)

    async def fail_parse_resume_document(**kwargs):
        raise RuntimeError("llm direct parsing failed")

    monkeypatch.setattr("app.api.routes.resume.parse_resume_document", fail_parse_resume_document)

    response = client.post(
        "/api/resume/parse",
        files={"file": ("resume.pdf", b"%PDF-1.4", "application/pdf")},
    )

    assert response.status_code == 502
    payload = response.json()
    assert payload["detail"]["error"] == {
        "code": "LLM_FAILED",
        "message": "Failed to extract resume data",
    }
    assert "llm direct parsing failed" not in response.text



def test_parse_resume_windows_ocr_path_does_not_depend_on_libmagic(monkeypatch):
    monkeypatch.setattr(pdf_parser.platform, "system", lambda: "Windows")
    monkeypatch.setattr("app.api.routes.resume.ResumeExtractor.from_runtime_config", lambda runtime_config: StubExtractor())
    monkeypatch.setattr("app.api.routes.resume.resolve_runtime_config", lambda runtime_config=None: RuntimeConfigStub(model="text-only-model"))
    monkeypatch.setattr("app.api.routes.resume.resolve_ocr_api_key", lambda runtime_ocr_api_key=None: "ocr-key")

    async def fake_call_ocr(file_bytes: bytes, api_key: str, file_extension: str):
        assert file_bytes == b"%PDF-1.4"
        assert api_key == "ocr-key"
        assert file_extension == "pdf"
        return pdf_parser.OcrResult(text="windows ocr text", elapsed_time=0.5)

    monkeypatch.setattr(pdf_parser, "call_ocr", fake_call_ocr)

    response = client.post(
        "/api/resume/parse",
        data={"runtime_ocr_api_key": "ocr-key"},
        files={"file": ("resume.pdf", b"%PDF-1.4", "application/pdf")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["extension"] == "pdf"
    assert payload["meta"]["elapsed"]["ocr_seconds"] == 0.5



def test_parse_resume_sanitizes_unexpected_internal_errors(monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.resume.resolve_runtime_config",
        lambda runtime_config=None: (_ for _ in ()).throw(Exception("unexpected runtime config leak")),
    )

    response = client.post(
        "/api/resume/parse",
        files={"file": ("resume.txt", b"resume content", "text/plain")},
    )

    assert response.status_code == 500
    assert response.json()["detail"]["error"] == {
        "code": "INTERNAL_ERROR",
        "message": "Internal server error",
    }
    assert "unexpected runtime config leak" not in response.text



def test_parse_resume_rejects_doc_with_conversion_guidance():
    response = client.post(
        "/api/resume/parse",
        files={"file": ("resume.doc", b"legacy-doc", "application/msword")},
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["detail"]["error"]["code"] == "UNSUPPORTED_FILE_TYPE"
    assert payload["detail"]["error"]["message"] == "暂不支持 DOC 格式，请先转换为 DOCX 或 PDF 后再上传。"
