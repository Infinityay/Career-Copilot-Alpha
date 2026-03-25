"""Resume document parsing strategies for text, OCR, and direct LLM extraction."""

from __future__ import annotations

import asyncio
import base64
import platform
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from io import BytesIO
from typing import Literal
from zipfile import BadZipFile, ZipFile

from langchain.chat_models import init_chat_model
from langchain_core.messages import HumanMessage, SystemMessage
from zai import ZhipuAiClient

from app.schemas.resume import ResumeData
from app.prompts.resume_prompts import RESUME_VALIDITY_PROMPT
from app.schemas.resume import ResumeValidityResponse
from app.services.resume_extractor import InvalidResumeContentError, ResumeExtractor
from app.services.runtime_config import ResolvedRuntimeConfig
from app.utils.structured_output import invoke_with_fallback

DIRECT_TEXT_EXTENSIONS = {"txt", "md", "docx"}
OCR_SOURCE_EXTENSIONS = {"pdf", "jpg", "jpeg", "png"}
SUPPORTED_EXTENSIONS = DIRECT_TEXT_EXTENSIONS | OCR_SOURCE_EXTENSIONS
MULTIMODAL_FILE_EXTENSIONS = {"pdf", "jpg", "jpeg", "png"}
MULTIMODAL_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png"}
DIRECT_FILE_SUPPORTED_PROVIDERS = {"openai", "google_genai", "anthropic"}
DOCX_NAMESPACE = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

EXTENSION_TO_MIME: dict[str, str] = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "md": "text/markdown",
    "txt": "text/plain",
}
MIN_PDF_TEXT_CHAR_COUNT = 80
PDF_IMAGE_RENDER_MAX_PAGES = 5
PDF_IMAGE_RENDER_SCALE = 1.5
PDF_IMAGE_JPEG_QUALITY = 75


class DirectFileParsingUnsupportedError(RuntimeError):
    """Raised when the active model is unlikely to support direct file parsing."""


@dataclass(frozen=True, slots=True)
class DocumentParseResult:
    """Normalized resume parsing result before response serialization."""

    text: str
    ocr_elapsed: float
    llm_elapsed: float
    extraction_method: Literal["ocr_then_llm", "llm_file_direct", "text_then_llm", "image_then_llm"]
    guidance: str = ""
    llm_file_parsing_available: bool = False


@dataclass(frozen=True, slots=True)
class OcrResult:
    """OCR extraction output."""

    text: str
    elapsed_time: float


@dataclass(frozen=True, slots=True)
class FileDirectExtractionResult:
    """Direct multimodal extraction output."""

    data: ResumeData
    elapsed_time: float
    llm_file_parsing_available: bool



def _cleand_ocr_text(response) -> str:
    """Clean OCR text by removing unwanted lines and characters."""
    texts = []
    for page in response.layout_details or []:
        for item in page:
            if item.label == "text" and item.content:
                text = item.content
                text = re.sub(r"<[^>]+>", "", text)
                text = re.sub(r"^#+\s*", "", text, flags=re.MULTILINE)
                text = text.replace("**", "")
                text = text.replace("__", "")
                text = text.strip()
                if text:
                    texts.append(text)
    return "\n".join(texts)


def guess_mimetype_from_extension(file_extension: str) -> str:
    """Return MIME type from known extension mapping."""
    ext = file_extension.lower()
    return EXTENSION_TO_MIME.get(ext, "application/octet-stream")


async def get_mimetype_from_file_bytes(file_bytes: bytes, file_extension: str) -> str:
    """Detect MIME type from file bytes with Windows-safe extension fallback."""
    ext = file_extension.lower()

    if platform.system() == "Windows":
        return guess_mimetype_from_extension(ext)

    try:
        import magic

        mime = magic.Magic(mime=True)
        return mime.from_buffer(file_bytes[:2048])
    except Exception:
        return guess_mimetype_from_extension(ext)


async def to_data_uri(file_bytes: bytes, mime_type: str) -> str:
    """Convert file bytes to a data URI for HTTP transmission."""
    encoded = base64.b64encode(file_bytes).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


async def call_ocr(file_bytes: bytes, api_key: str, file_extension: str) -> OcrResult:
    """Run GLM OCR on binary document content and return normalized text."""
    start_time = time.time()
    client = ZhipuAiClient(api_key=api_key)
    mime_type = await get_mimetype_from_file_bytes(file_bytes, file_extension)
    data_uri = await to_data_uri(file_bytes, mime_type)
    response = client.layout_parsing.create(
        model="glm-ocr",
        file=data_uri,
    )
    cleaned_text = _cleand_ocr_text(response)
    elapsed_time = round(time.time() - start_time, 2)
    return OcrResult(text=cleaned_text, elapsed_time=elapsed_time)


async def extract_text_content(file_bytes: bytes) -> tuple[str, float]:
    """Read plain text content without OCR."""
    start_time = time.time()
    try:
        text = file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = file_bytes.decode("gbk")
        except UnicodeDecodeError:
            text = file_bytes.decode("utf-8", errors="ignore")
    elapsed = round(time.time() - start_time, 2)
    return text, elapsed


def _normalize_docx_paragraph_text(paragraph: ET.Element) -> str:
    """Collapse DOCX paragraph text while preserving explicit tab spacing."""
    parts: list[str] = []
    for node in paragraph.iter():
        tag = node.tag.rsplit("}", 1)[-1]
        if tag == "t" and node.text:
            parts.append(node.text)
        elif tag == "tab":
            parts.append("\t")
    return "".join(parts).strip()


async def extract_docx_text_content(file_bytes: bytes) -> tuple[str, float]:
    """Read DOCX document.xml text as plain text without OCR."""
    start_time = time.time()
    try:
        with ZipFile(BytesIO(file_bytes)) as archive:
            document_xml = archive.read("word/document.xml")
    except (BadZipFile, KeyError) as exc:
        raise ValueError("Unable to read DOCX content") from exc

    try:
        root = ET.fromstring(document_xml)
    except ET.ParseError as exc:
        raise ValueError("Unable to read DOCX content") from exc

    paragraphs = []
    for paragraph in root.findall(".//w:body/w:p", DOCX_NAMESPACE):
        text = _normalize_docx_paragraph_text(paragraph)
        if text:
            paragraphs.append(text)

    elapsed = round(time.time() - start_time, 2)
    return "\n".join(paragraphs), elapsed


def _normalize_extracted_text(text: str) -> str:
    """Normalize extracted text for downstream validation."""
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def _count_meaningful_text_chars(text: str) -> int:
    """Count non-whitespace characters to judge whether extracted text is usable."""
    return len(re.sub(r"\s+", "", text))


async def extract_pdf_text_content(file_bytes: bytes) -> tuple[str, float]:
    """Read machine-extractable text from PDF content when available."""
    start_time = time.time()
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("pypdf is required for local PDF text extraction") from exc

    def _extract() -> str:
        reader = PdfReader(BytesIO(file_bytes))
        texts: list[str] = []
        for page in reader.pages:
            page_text = page.extract_text() or ""
            if page_text.strip():
                texts.append(page_text)
        return _normalize_extracted_text("\n".join(texts))

    text = await asyncio.to_thread(_extract)
    elapsed = round(time.time() - start_time, 2)
    return text, elapsed


async def render_pdf_to_image_parts(
    file_bytes: bytes,
    max_pages: int = PDF_IMAGE_RENDER_MAX_PAGES,
) -> tuple[list[dict], float]:
    """Render a PDF into compressed JPEG image parts for multimodal parsing."""
    start_time = time.time()
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise RuntimeError("pypdfium2 is required for PDF image fallback") from exc

    def _render() -> list[dict]:
        pdf = pdfium.PdfDocument(file_bytes)
        page_count = min(len(pdf), max_pages)
        image_parts: list[dict] = []

        for page_index in range(page_count):
            page = pdf[page_index]
            bitmap = page.render(scale=PDF_IMAGE_RENDER_SCALE)
            image = bitmap.to_pil()
            buffer = BytesIO()
            image.save(
                buffer,
                format="JPEG",
                quality=PDF_IMAGE_JPEG_QUALITY,
                optimize=True,
            )
            encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
            image_parts.append(
                {
                    "type": "image",
                    "base64": encoded,
                    "mime_type": "image/jpeg",
                }
            )

        if hasattr(pdf, "close"):
            pdf.close()
        return image_parts

    image_parts = await asyncio.to_thread(_render)
    elapsed = round(time.time() - start_time, 2)
    return image_parts, elapsed


async def prepare_binary_for_parsing(file_bytes: bytes, file_extension: str) -> tuple[bytes, str]:
    """Normalize binary files for OCR or direct file parsing."""
    ext = file_extension.lower()
    if ext in MULTIMODAL_FILE_EXTENSIONS:
        return file_bytes, ext
    raise ValueError(f"Unsupported file type: {ext}")



def supports_direct_file_parsing(runtime_config: ResolvedRuntimeConfig, file_extension: str) -> bool:
    """Best-effort capability check for direct multimodal/file parsing."""
    ext = file_extension.lower()
    if ext not in MULTIMODAL_FILE_EXTENSIONS:
        return False

    if runtime_config.model_provider not in DIRECT_FILE_SUPPORTED_PROVIDERS:
        return False

    model_name = (runtime_config.model or "").lower()
    if not model_name:
        return False

    multimodal_markers = (
        "gpt-4o",
        "gpt-4.1",
        "gpt-5",
        "omni",
        "gemini",
        "claude",
        "sonnet",
        "opus",
        "haiku",
        "vision",
        "multimodal",
    )
    return any(marker in model_name for marker in multimodal_markers)



def build_direct_file_guidance(runtime_config: ResolvedRuntimeConfig, file_extension: str) -> str:
    """Provide actionable guidance when direct file parsing is unavailable."""
    ext_label = file_extension.upper()
    model = runtime_config.model or "当前模型"
    return (
        f"当前模型 {model} 未明确支持 {ext_label} 文件直抽。"
        "请切换到支持视觉/文件解析的模型，或补充 OCR Key，或改传 TXT/Markdown/可复制文本版简历。"
    )


async def build_multimodal_content_part(
    file_bytes: bytes,
    file_extension: str,
    filename: str | None = None,
) -> dict:
    """Build a multimodal content block for the given file using the active MIME type."""
    normalized_bytes, normalized_extension = await prepare_binary_for_parsing(
        file_bytes, file_extension
    )
    mime_type = await get_mimetype_from_file_bytes(normalized_bytes, normalized_extension)
    encoded = base64.b64encode(normalized_bytes).decode("utf-8")

    if normalized_extension in MULTIMODAL_IMAGE_EXTENSIONS:
        return {
            "type": "image",
            "base64": encoded,
            "mime_type": mime_type,
        }

    normalized_filename = filename or f"resume.{normalized_extension}"
    if "." in normalized_filename:
        normalized_filename = normalized_filename.rsplit(".", 1)[0]
    normalized_filename = f"{normalized_filename}.{normalized_extension}"

    return {
        "type": "file",
        "base64": encoded,
        "mime_type": mime_type,
        "filename": normalized_filename,
    }


class ResumeFileDirectExtractor:
    """Directly extract structured resume data from binary files using multimodal LLMs."""

    SYSTEM_PROMPT = (
        "你是专业的中文简历结构化提取助手。"
        "请直接阅读用户提供的简历文件，输出严格符合 ResumeData schema 的 JSON。"
        "若某字段缺失请返回空字符串或空数组，不要编造经历。"
    )

    def __init__(self, runtime_config: ResolvedRuntimeConfig):
        self.runtime_config = runtime_config
        self.chat_model = self._create_chat_model(runtime_config)
        self.validity_llm = self.chat_model.with_structured_output(ResumeValidityResponse)
        self.structured_llm = self.chat_model.with_structured_output(ResumeData)

    def _create_chat_model(self, runtime_config: ResolvedRuntimeConfig):
        provider = runtime_config.model_provider
        model = runtime_config.model
        api_key = runtime_config.api_key
        base_url = runtime_config.base_url

        if provider == "openai":
            kwargs = {
                "model": model,
                "model_provider": "openai",
                "api_key": api_key,
            }
            if base_url:
                kwargs["base_url"] = base_url
            return init_chat_model(**kwargs)

        if provider == "google_genai":
            return init_chat_model(f"google_genai:{model}")

        if provider == "anthropic":
            return init_chat_model(model, model_provider="anthropic")

        raise ValueError(f"Unsupported model provider: {provider}")

    async def _invoke_structured(
        self,
        content_parts: list[dict],
        prompt_text: str,
    ) -> FileDirectExtractionResult:
        messages = [
            SystemMessage(content=self.SYSTEM_PROMPT),
            HumanMessage(content=[*content_parts, {"type": "text", "text": prompt_text}]),
        ]

        loop = asyncio.get_running_loop()
        start_time = time.perf_counter()
        result = await loop.run_in_executor(
            None,
            lambda: invoke_with_fallback(self.structured_llm, messages, ResumeData),
        )
        elapsed_time = round(time.perf_counter() - start_time, 2)
        return FileDirectExtractionResult(
            data=result,
            elapsed_time=elapsed_time,
            llm_file_parsing_available=True,
        )

    async def _invoke_validity(
        self,
        content_parts: list[dict],
        prompt_text: str,
    ) -> bool:
        messages = [
            SystemMessage(content=self.SYSTEM_PROMPT),
            HumanMessage(content=[*content_parts, {"type": "text", "text": prompt_text}]),
        ]

        loop = asyncio.get_running_loop()
        validity = await loop.run_in_executor(
            None,
            lambda: invoke_with_fallback(
                self.validity_llm,
                messages,
                ResumeValidityResponse,
            ),
        )
        return validity.isResume == "Yes"

    async def extract(
        self,
        file_bytes: bytes,
        file_extension: str,
        filename: str | None = None,
    ) -> FileDirectExtractionResult:
        normalized_extension = file_extension.lower()
        if not supports_direct_file_parsing(self.runtime_config, normalized_extension):
            raise DirectFileParsingUnsupportedError(
                build_direct_file_guidance(self.runtime_config, normalized_extension)
            )

        is_resume = await self.classify_is_resume(
            file_bytes,
            file_extension,
            filename=filename,
        )
        if not is_resume:
            raise InvalidResumeContentError("上传内容不是一份正常简历，请上传求职简历文件后重试。")

        file_part = await build_multimodal_content_part(
            file_bytes,
            file_extension,
            filename=filename,
        )
        prompt_text = (
            "请直接阅读这份简历文件或图片，并提取为 ResumeData JSON。"
            "不要输出解释，只返回结构化结果。"
        )
        return await self._invoke_structured([file_part], prompt_text)

    async def classify_is_resume(
        self,
        file_bytes: bytes,
        file_extension: str,
        filename: str | None = None,
    ) -> bool:
        """Classify whether the uploaded binary is a normal resume."""
        normalized_extension = file_extension.lower()
        if not supports_direct_file_parsing(self.runtime_config, normalized_extension):
            raise DirectFileParsingUnsupportedError(
                build_direct_file_guidance(self.runtime_config, normalized_extension)
            )

        file_part = await build_multimodal_content_part(
            file_bytes,
            file_extension,
            filename=filename,
        )
        classify_messages = [
            file_part,
        ]
        return await self._invoke_validity(
            classify_messages,
            (
                f"{RESUME_VALIDITY_PROMPT}\n"
                "请基于这份文件直接判断是否为正常求职简历。"
            ),
        )

    async def extract_from_image_parts(self, image_parts: list[dict]) -> FileDirectExtractionResult:
        """Extract structured resume data from rendered image pages."""
        if not image_parts:
            raise ValueError("No rendered images available for parsing")

        is_resume = await self.classify_is_resume_from_image_parts(image_parts)
        if not is_resume:
            raise InvalidResumeContentError("上传内容不是一份正常简历，请上传求职简历文件后重试。")

        return await self._invoke_structured(
            image_parts,
            "这些图片是同一份简历的分页内容。请综合所有页面提取 ResumeData JSON。",
        )

    async def classify_is_resume_from_image_parts(self, image_parts: list[dict]) -> bool:
        """Classify whether rendered image pages belong to a resume."""
        if not image_parts:
            return False

        return await self._invoke_validity(
            image_parts,
            (
                f"{RESUME_VALIDITY_PROMPT}\n"
                "这些图片是同一份文档的分页截图，请综合判断是否为正常求职简历。"
            ),
        )


async def parse_resume_document(
    *,
    file_bytes: bytes,
    file_extension: str,
    runtime_config: ResolvedRuntimeConfig,
    extractor: ResumeExtractor,
    ocr_api_key: str | None = None,
    filename: str | None = None,
) -> tuple[ResumeData, DocumentParseResult]:
    """Parse a resume with demo-friendly fallback rules."""
    ext = file_extension.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {ext}")

    if ext in DIRECT_TEXT_EXTENSIONS:
        if ext == "docx":
            text, elapsed = await extract_docx_text_content(file_bytes)
        else:
            text, elapsed = await extract_text_content(file_bytes)
        extractor.validate_resume_text_or_raise(text)
        resume_data, llm_elapsed = await asyncio.to_thread(
            extractor.extract_all, text
        )
        return resume_data, DocumentParseResult(
            text=text,
            ocr_elapsed=elapsed,
            llm_elapsed=llm_elapsed,
            extraction_method="text_then_llm",
            llm_file_parsing_available=False,
        )

    if ext == "pdf":
        try:
            text, elapsed = await extract_pdf_text_content(file_bytes)
        except RuntimeError:
            text, elapsed = "", 0.0

        if _count_meaningful_text_chars(text) >= MIN_PDF_TEXT_CHAR_COUNT:
            extractor.validate_resume_text_or_raise(text)
            resume_data, llm_elapsed = await asyncio.to_thread(
                extractor.extract_all, text
            )
            return resume_data, DocumentParseResult(
                text=text,
                ocr_elapsed=elapsed,
                llm_elapsed=llm_elapsed,
                extraction_method="text_then_llm",
                llm_file_parsing_available=False,
            )

    if ocr_api_key:
        normalized_bytes, normalized_extension = await prepare_binary_for_parsing(file_bytes, ext)
        ocr_result = await call_ocr(normalized_bytes, ocr_api_key, normalized_extension)
        extractor.validate_resume_text_or_raise(ocr_result.text)
        resume_data, llm_elapsed = await asyncio.to_thread(
            extractor.extract_all, ocr_result.text
        )
        return resume_data, DocumentParseResult(
            text=ocr_result.text,
            ocr_elapsed=ocr_result.elapsed_time,
            llm_elapsed=llm_elapsed,
            extraction_method="ocr_then_llm",
            llm_file_parsing_available=supports_direct_file_parsing(runtime_config, ext),
        )

    if ext == "pdf":
        if not supports_direct_file_parsing(runtime_config, "png"):
            raise DirectFileParsingUnsupportedError(
                "当前模型未明确支持图片解析，且该 PDF 未提取到足够文本。"
                "请切换到支持视觉的模型，或提供 OCR Key。"
            )

        try:
            image_parts, _render_elapsed = await render_pdf_to_image_parts(file_bytes)
        except RuntimeError as exc:
            raise DirectFileParsingUnsupportedError(
                "当前服务缺少 PDF 转图片依赖，且该 PDF 未提取到足够文本。"
                "请安装 PDF 渲染依赖，或提供 OCR Key。"
            ) from exc
        direct_extractor = ResumeFileDirectExtractor(runtime_config)
        image_result = await direct_extractor.extract_from_image_parts(image_parts)
        return image_result.data, DocumentParseResult(
            text="",
            ocr_elapsed=0.0,
            llm_elapsed=image_result.elapsed_time,
            extraction_method="image_then_llm",
            llm_file_parsing_available=True,
        )

    direct_extractor = ResumeFileDirectExtractor(runtime_config)
    direct_result = await direct_extractor.extract(file_bytes, ext, filename=filename)
    return direct_result.data, DocumentParseResult(
        text="",
        ocr_elapsed=0.0,
        llm_elapsed=direct_result.elapsed_time,
        extraction_method="llm_file_direct",
        llm_file_parsing_available=direct_result.llm_file_parsing_available,
    )
