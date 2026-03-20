from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from app.schemas.resume import ResumeData
from app.services import pdf_parser
from app.services.runtime_config import ResolvedRuntimeConfig


@pytest.fixture
def anyio_backend():
    return "asyncio"


class StubResumeExtractor:
    def __init__(self, resume_data: ResumeData | None = None, elapsed: float = 0.66):
        self.resume_data = resume_data or ResumeData()
        self.elapsed = elapsed
        self.texts: list[str] = []

    def validate_resume_text_or_raise(self, text: str):
        return None

    def extract_all(self, text: str):
        self.texts.append(text)
        return self.resume_data, self.elapsed


def build_docx_bytes(*paragraphs: str) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as archive:
        body = "".join(
            f"<w:p><w:r><w:t>{paragraph}</w:t></w:r></w:p>" for paragraph in paragraphs
        )
        archive.writestr(
            "word/document.xml",
            (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                f"<w:body>{body}</w:body>"
                "</w:document>"
            ),
        )
    return buffer.getvalue()


@pytest.mark.anyio
async def test_parse_resume_document_reads_txt_without_ocr(monkeypatch: pytest.MonkeyPatch):
    async def fail_ocr(*args, **kwargs):
        raise AssertionError("OCR should not be called for txt")

    runtime_config = ResolvedRuntimeConfig(
        model_provider="openai",
        api_key="key",
        base_url="https://example.com/v1",
        model="text-only-model",
    )
    monkeypatch.setattr(pdf_parser, "call_ocr", fail_ocr)

    resume_data, result = await pdf_parser.parse_resume_document(
        file_bytes="hello world".encode("utf-8"),
        file_extension="txt",
        runtime_config=runtime_config,
        extractor=StubResumeExtractor(),
    )

    assert resume_data == ResumeData()
    assert "skills" not in resume_data.model_dump()["basicInfo"]
    assert result.text == "hello world"
    assert result.extraction_method == "text_then_llm"
    assert result.ocr_elapsed >= 0
    assert result.llm_elapsed == 0.66


@pytest.mark.anyio
async def test_parse_resume_document_reads_md_without_ocr(monkeypatch: pytest.MonkeyPatch):
    async def fail_ocr(*args, **kwargs):
        raise AssertionError("OCR should not be called for md")

    runtime_config = ResolvedRuntimeConfig(
        model_provider="openai",
        api_key="key",
        base_url="https://example.com/v1",
        model="text-only-model",
    )
    monkeypatch.setattr(pdf_parser, "call_ocr", fail_ocr)

    _, result = await pdf_parser.parse_resume_document(
        file_bytes="# Title\nbody".encode("utf-8"),
        file_extension="md",
        runtime_config=runtime_config,
        extractor=StubResumeExtractor(),
    )

    assert result.text == "# Title\nbody"
    assert result.extraction_method == "text_then_llm"


@pytest.mark.anyio
async def test_parse_resume_document_reads_docx_as_text_without_ocr_or_file_direct(
    monkeypatch: pytest.MonkeyPatch,
):
    async def fail_ocr(*args, **kwargs):
        raise AssertionError("OCR should not be called for docx")

    async def fail_prepare(*args, **kwargs):
        raise AssertionError("Binary normalization should not be called for docx")

    class FailDirectExtractor:
        def __init__(self, *args, **kwargs):
            raise AssertionError("Direct file parsing should not be used for docx")

    runtime_config = ResolvedRuntimeConfig(
        model_provider="openai",
        api_key="key",
        base_url="https://example.com/v1",
        model="text-only-model",
    )
    extractor = StubResumeExtractor()
    monkeypatch.setattr(pdf_parser, "call_ocr", fail_ocr)
    monkeypatch.setattr(pdf_parser, "prepare_binary_for_parsing", fail_prepare)
    monkeypatch.setattr(pdf_parser, "ResumeFileDirectExtractor", FailDirectExtractor)

    _, result = await pdf_parser.parse_resume_document(
        file_bytes=build_docx_bytes("Alice Example", "Python Engineer"),
        file_extension="docx",
        runtime_config=runtime_config,
        extractor=extractor,
    )

    assert extractor.texts == ["Alice Example\nPython Engineer"]
    assert result.text == "Alice Example\nPython Engineer"
    assert result.extraction_method == "text_then_llm"
    assert result.llm_elapsed == 0.66


@pytest.mark.anyio
@pytest.mark.parametrize("extension", ["pdf", "jpg", "jpeg", "png"])
async def test_prepare_binary_for_parsing_keeps_supported_binary_extensions(extension: str):
    normalized_bytes, normalized_extension = await pdf_parser.prepare_binary_for_parsing(
        b"binary-bytes", extension
    )

    assert normalized_bytes == b"binary-bytes"
    assert normalized_extension == extension


@pytest.mark.anyio
@pytest.mark.parametrize("extension", ["pdf", "jpg", "jpeg", "png"])
async def test_parse_resume_document_uses_ocr_when_configured(
    monkeypatch: pytest.MonkeyPatch, extension: str
):
    calls: dict[str, object] = {}
    runtime_config = ResolvedRuntimeConfig(
        model_provider="openai",
        api_key="key",
        base_url="https://example.com/v1",
        model="text-only-model",
    )

    async def fake_prepare_binary(file_bytes: bytes, incoming_extension: str):
        calls["prepare"] = (file_bytes, incoming_extension)
        return b"normalized-bytes", incoming_extension

    async def fake_call_ocr(file_bytes: bytes, api_key: str, file_extension: str):
        calls["ocr"] = (file_bytes, api_key, file_extension)
        return pdf_parser.OcrResult(text=f"{extension} text", elapsed_time=2.5)

    monkeypatch.setattr(pdf_parser, "prepare_binary_for_parsing", fake_prepare_binary)
    monkeypatch.setattr(pdf_parser, "call_ocr", fake_call_ocr)

    _, result = await pdf_parser.parse_resume_document(
        file_bytes=b"binary-content",
        file_extension=extension,
        runtime_config=runtime_config,
        extractor=StubResumeExtractor(),
        ocr_api_key="ocr-key",
    )

    assert calls["prepare"] == (b"binary-content", extension)
    assert calls["ocr"] == (b"normalized-bytes", "ocr-key", extension)
    assert result.text == f"{extension} text"
    assert result.ocr_elapsed == 2.5
    assert result.extraction_method == "ocr_then_llm"


@pytest.mark.anyio
async def test_parse_resume_document_uses_normalized_extension_for_ocr(monkeypatch: pytest.MonkeyPatch):
    calls: dict[str, object] = {}
    runtime_config = ResolvedRuntimeConfig(
        model_provider="openai",
        api_key="key",
        base_url="https://example.com/v1",
        model="text-only-model",
    )

    async def fake_prepare_binary(file_bytes: bytes, incoming_extension: str):
        calls["prepare"] = (file_bytes, incoming_extension)
        return b"normalized-pdf", "pdf"

    async def fake_call_ocr(file_bytes: bytes, api_key: str, file_extension: str):
        calls["ocr"] = (file_bytes, api_key, file_extension)
        return pdf_parser.OcrResult(text="normalized text", elapsed_time=1.1)

    monkeypatch.setattr(pdf_parser, "prepare_binary_for_parsing", fake_prepare_binary)
    monkeypatch.setattr(pdf_parser, "call_ocr", fake_call_ocr)

    _, result = await pdf_parser.parse_resume_document(
        file_bytes=b"image-bytes",
        file_extension="png",
        runtime_config=runtime_config,
        extractor=StubResumeExtractor(),
        ocr_api_key="ocr-key",
    )

    assert calls["prepare"] == (b"image-bytes", "png")
    assert calls["ocr"] == (b"normalized-pdf", "ocr-key", "pdf")
    assert result.text == "normalized text"
    assert result.extraction_method == "ocr_then_llm"


@pytest.mark.anyio
async def test_parse_resume_document_rejects_doc_extension():
    runtime_config = ResolvedRuntimeConfig(
        model_provider="openai",
        api_key="key",
        base_url="https://example.com/v1",
        model="text-only-model",
    )

    with pytest.raises(ValueError, match="Unsupported file type: doc"):
        await pdf_parser.parse_resume_document(
            file_bytes=b"legacy-doc",
            file_extension="doc",
            runtime_config=runtime_config,
            extractor=StubResumeExtractor(),
        )


@pytest.mark.anyio
async def test_parse_resume_document_rejects_unsupported_extension():
    runtime_config = ResolvedRuntimeConfig(
        model_provider="openai",
        api_key="key",
        base_url="https://example.com/v1",
        model="text-only-model",
    )

    with pytest.raises(ValueError, match="Unsupported file type: xlsx"):
        await pdf_parser.parse_resume_document(
            file_bytes=b"sheet",
            file_extension="xlsx",
            runtime_config=runtime_config,
            extractor=StubResumeExtractor(),
        )


@pytest.mark.anyio
async def test_call_ocr_uses_passed_api_key(monkeypatch: pytest.MonkeyPatch):
    async def fake_get_mimetype(file_bytes: bytes, file_extension: str) -> str:
        assert file_bytes == b"file-bytes"
        assert file_extension == "pdf"
        return "application/pdf"

    monkeypatch.setattr(pdf_parser, "get_mimetype_from_file_bytes", fake_get_mimetype)

    async def fake_to_data_uri(file_bytes: bytes, mime_type: str) -> str:
        assert file_bytes == b"file-bytes"
        assert mime_type == "application/pdf"
        return "data:application/pdf;base64,abc"

    class FakeClient:
        def __init__(self, api_key: str):
            assert api_key == "ocr-key"
            self.layout_parsing = SimpleNamespace(
                create=lambda **kwargs: SimpleNamespace(
                    layout_details=[[SimpleNamespace(label="text", content="识别文本")]]
                )
            )

    monkeypatch.setattr(pdf_parser, "to_data_uri", fake_to_data_uri)
    monkeypatch.setattr(pdf_parser, "ZhipuAiClient", FakeClient)

    result = await pdf_parser.call_ocr(b"file-bytes", "ocr-key", "pdf")

    assert result.text == "识别文本"
    assert result.elapsed_time >= 0


@pytest.mark.anyio
@pytest.mark.parametrize("extension", ["pdf", "png", "jpg", "jpeg"])
async def test_parse_resume_document_uses_llm_file_direct_when_ocr_missing(
    monkeypatch: pytest.MonkeyPatch, extension: str
):
    runtime_config = ResolvedRuntimeConfig(
        model_provider="openai",
        api_key="runtime-key",
        base_url="https://example.com/v1",
        model="gpt-4o",
    )
    expected_data = ResumeData()

    class FakeDirectExtractor:
        def __init__(self, resolved_runtime_config):
            assert resolved_runtime_config == runtime_config

        async def extract(self, file_bytes: bytes, file_extension: str, filename: str | None = None):
            assert file_bytes == b"binary-bytes"
            assert file_extension == extension
            assert filename == f"resume.{extension}"
            return pdf_parser.FileDirectExtractionResult(
                data=expected_data,
                elapsed_time=1.8,
                llm_file_parsing_available=True,
            )

    monkeypatch.setattr(pdf_parser, "ResumeFileDirectExtractor", FakeDirectExtractor)

    resume_data, result = await pdf_parser.parse_resume_document(
        file_bytes=b"binary-bytes",
        file_extension=extension,
        runtime_config=runtime_config,
        extractor=StubResumeExtractor(),
        ocr_api_key=None,
        filename=f"resume.{extension}",
    )

    assert resume_data == expected_data
    assert result.text == ""
    assert result.extraction_method == "llm_file_direct"
    assert result.llm_elapsed == 1.8
    assert result.llm_file_parsing_available is True


@pytest.mark.anyio
async def test_resume_file_direct_extractor_uses_image_block_for_png(monkeypatch: pytest.MonkeyPatch):
    runtime_config = ResolvedRuntimeConfig(
        model_provider="openai",
        api_key="runtime-key",
        base_url="https://example.com/v1",
        model="gpt-4o",
    )
    calls: dict[str, object] = {}

    async def fake_prepare_binary(file_bytes: bytes, incoming_extension: str):
        calls["prepare"] = (file_bytes, incoming_extension)
        return b"png-bytes", "png"

    async def fake_get_mimetype(file_bytes: bytes, file_extension: str):
        calls["mime"] = (file_bytes, file_extension)
        return "image/png"

    monkeypatch.setattr(pdf_parser, "prepare_binary_for_parsing", fake_prepare_binary)
    monkeypatch.setattr(pdf_parser, "get_mimetype_from_file_bytes", fake_get_mimetype)

    extractor = pdf_parser.ResumeFileDirectExtractor(runtime_config)
    captured: dict[str, object] = {}

    def fake_invoke_with_fallback(structured_llm, messages, schema):
        captured.setdefault("calls", []).append({"messages": messages, "schema": schema})
        if schema is pdf_parser.ResumeValidityResponse:
            return pdf_parser.ResumeValidityResponse(isResume="Yes")
        return ResumeData()

    monkeypatch.setattr(pdf_parser, "invoke_with_fallback", fake_invoke_with_fallback)

    result = await extractor.extract(b"png-original", "png", filename="resume.png")

    assert calls["prepare"] == (b"png-original", "png")
    assert calls["mime"] == (b"png-bytes", "png")
    assert result.data == ResumeData()
    assert result.llm_file_parsing_available is True
    classify_call, extract_call = captured["calls"]
    assert classify_call["schema"] is pdf_parser.ResumeValidityResponse
    assert extract_call["schema"] is ResumeData
    message = extract_call["messages"][1]
    assert message.content[0] == {
        "type": "image",
        "base64": "cG5nLWJ5dGVz",
        "mime_type": "image/png",
    }


@pytest.mark.anyio
async def test_parse_resume_document_returns_guidance_when_multimodal_unavailable(monkeypatch: pytest.MonkeyPatch):
    runtime_config = ResolvedRuntimeConfig(
        model_provider="openai",
        api_key="runtime-key",
        base_url="https://example.com/v1",
        model="text-only-model",
    )

    class FakeDirectExtractor:
        def __init__(self, resolved_runtime_config):
            assert resolved_runtime_config == runtime_config

        async def extract(self, file_bytes: bytes, file_extension: str, filename: str | None = None):
            assert filename == "resume.pdf"
            raise pdf_parser.DirectFileParsingUnsupportedError(
                pdf_parser.build_direct_file_guidance(runtime_config, file_extension)
            )

    monkeypatch.setattr(pdf_parser, "ResumeFileDirectExtractor", FakeDirectExtractor)

    with pytest.raises(pdf_parser.DirectFileParsingUnsupportedError, match="未明确支持 PDF 文件直抽"):
        await pdf_parser.parse_resume_document(
            file_bytes=b"pdf-bytes",
            file_extension="pdf",
            runtime_config=runtime_config,
            extractor=StubResumeExtractor(),
            ocr_api_key=None,
            filename="resume.pdf",
        )


@pytest.mark.parametrize(
    ("model_provider", "model", "expected"),
    [
        ("openai", "gpt-4o", True),
        ("openai", "gpt-4o-mini", True),
        ("openai", "text-only-model", False),
        ("google_genai", "gemini-2.0-flash", True),
        ("anthropic", "claude-sonnet-4-5-20250929", True),
    ],
)
def test_supports_direct_file_parsing(model_provider: str, model: str, expected: bool):
    runtime_config = ResolvedRuntimeConfig(
        model_provider=model_provider,
        api_key="runtime-key",
        base_url="https://example.com/v1" if model_provider == "openai" else None,
        model=model,
    )

    assert pdf_parser.supports_direct_file_parsing(runtime_config, "pdf") is expected


@pytest.mark.parametrize(
    ("file_extension", "expected_mime"),
    [
        ("png", "image/png"),
        ("jpg", "image/jpeg"),
        ("jpeg", "image/jpeg"),
        ("pdf", "application/pdf"),
        (
            "docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        ("md", "text/markdown"),
        ("txt", "text/plain"),
    ],
)
def test_guess_mimetype_from_extension(file_extension: str, expected_mime: str):
    assert pdf_parser.guess_mimetype_from_extension(file_extension) == expected_mime


@pytest.mark.anyio
async def test_get_mimetype_from_file_bytes_uses_extension_on_windows(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(pdf_parser.platform, "system", lambda: "Windows")

    mime = await pdf_parser.get_mimetype_from_file_bytes(b"ignored", "pdf")

    assert mime == "application/pdf"


def test_cleaned_ocr_text_keeps_text_items_only():
    response = SimpleNamespace(
        layout_details=[
            [
                SimpleNamespace(label="text", content="# Heading\n**Bold** text"),
                SimpleNamespace(label="image", content="ignored"),
                SimpleNamespace(label="text", content="<p>Second</p> __line__"),
                SimpleNamespace(label="text", content="   "),
            ]
        ]
    )

    cleaned = pdf_parser._cleand_ocr_text(response)

    assert cleaned == "Heading\nBold text\nSecond line"
