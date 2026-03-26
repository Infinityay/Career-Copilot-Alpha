"""Resume parsing API routes."""

import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.core.config import get_settings
from app.schemas.resume import ElapsedTime, ParseMeta, ResumeParseResponse
from app.schemas.runtime_config import RuntimeConfig
from app.services.pdf_parser import (
    DirectFileParsingUnsupportedError,
    parse_resume_document,
)
from app.services.resume_extractor import InvalidResumeContentError, ResumeExtractor
from app.services.runtime_config import resolve_ocr_api_key, resolve_runtime_config

router = APIRouter(prefix="/resume", tags=["resume"])

SUPPORTED_EXTENSIONS = {"pdf", "jpg", "jpeg", "png", "docx", "txt", "md"}
logger = logging.getLogger(__name__)



def _get_extension(filename: str) -> str:
    """Extract lowercase file extension from filename."""
    if "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()



def _make_error(code: str, message: str, details: dict | None = None) -> dict:
    """Create standardized error response dict."""
    payload = {"code": code, "message": message}
    if details:
        payload["details"] = details
    return {"error": payload}



def _validate_file(file: UploadFile) -> tuple[str, str]:
    """Validate uploaded file and return filename plus extension."""
    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail=_make_error("NO_FILE", "No file provided"),
        )

    ext = _get_extension(file.filename)
    if ext == "doc":
        raise HTTPException(
            status_code=400,
            detail=_make_error(
                "UNSUPPORTED_FILE_TYPE",
                "暂不支持 DOC 格式，请先转换为 DOCX 或 PDF 后再上传。",
            ),
        )
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=_make_error(
                "UNSUPPORTED_FILE_TYPE",
                f"Unsupported file type: {ext}. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
            ),
        )

    return file.filename, ext


@router.post("/parse", response_model=ResumeParseResponse)
async def parse_resume(
    file: UploadFile = File(..., description="Resume file to parse"),
    runtime_model_provider: str | None = Form(default=None),
    runtime_api_key: str | None = Form(default=None),
    runtime_base_url: str | None = Form(default=None),
    runtime_model: str | None = Form(default=None),
    runtime_ocr_api_key: str | None = Form(default=None),
):
    """Parse uploaded resume file and return structured data."""
    filename, ext = _validate_file(file)
    logger.info("resume_route.parse.start filename=%s extension=%s size=%s", filename, ext, file.size)
    settings = get_settings()
    max_size = settings.max_upload_mb * 1024 * 1024

    if file.size is not None and file.size > max_size:
        raise HTTPException(
            status_code=413,
            detail=_make_error(
                "FILE_TOO_LARGE",
                f"File size exceeds {settings.max_upload_mb}MB limit",
            ),
        )

    try:
        chunks = []
        total_size = 0
        while True:
            chunk = await file.read(64 * 1024)
            if not chunk:
                break
            total_size += len(chunk)
            if total_size > max_size:
                raise HTTPException(
                    status_code=413,
                    detail=_make_error(
                        "FILE_TOO_LARGE",
                        f"File size exceeds {settings.max_upload_mb}MB limit",
                    ),
                )
            chunks.append(chunk)
        content = b"".join(chunks)
        logger.info("resume_route.parse.read_complete filename=%s extension=%s bytes=%s", filename, ext, len(content))

        runtime_config = resolve_runtime_config(
            RuntimeConfig(
                modelProvider=runtime_model_provider,
                apiKey=runtime_api_key,
                baseURL=runtime_base_url,
                model=runtime_model,
            )
        )
        logger.info(
            "resume_route.parse.runtime provider=%s model=%s base_url=%s ocr_enabled=%s",
            runtime_config.model_provider,
            runtime_config.model,
            runtime_config.base_url,
            bool(resolve_ocr_api_key(runtime_ocr_api_key)),
        )
        extractor = ResumeExtractor.from_runtime_config(runtime_config)
        ocr_api_key = resolve_ocr_api_key(runtime_ocr_api_key)

        try:
            resume_data, parse_result = await parse_resume_document(
                file_bytes=content,
                file_extension=ext,
                runtime_config=runtime_config,
                extractor=extractor,
                ocr_api_key=ocr_api_key,
                filename=filename,
            )
            logger.info(
                "resume_route.parse.success filename=%s extension=%s method=%s ocr_elapsed=%.2fs llm_elapsed=%.2fs",
                filename,
                ext,
                parse_result.extraction_method,
                parse_result.ocr_elapsed,
                parse_result.llm_elapsed,
            )
        except DirectFileParsingUnsupportedError as exc:
            logger.warning(
                "resume_route.parse.bad_request filename=%s extension=%s code=LLM_FILE_PARSING_UNAVAILABLE message=%s",
                filename,
                ext,
                str(exc),
            )
            raise HTTPException(
                status_code=400,
                detail=_make_error(
                    "LLM_FILE_PARSING_UNAVAILABLE",
                    str(exc),
                    details={
                        "parseMeta": ParseMeta(
                            filename=filename,
                            extension=ext,
                            guidance=str(exc),
                        ).model_dump()
                    },
                ),
            ) from exc
        except InvalidResumeContentError as exc:
            logger.warning(
                "resume_route.parse.bad_request filename=%s extension=%s code=INVALID_RESUME_CONTENT message=%s",
                filename,
                ext,
                str(exc),
            )
            raise HTTPException(
                status_code=400,
                detail=_make_error("INVALID_RESUME_CONTENT", str(exc)),
            ) from exc
        except ValueError as exc:
            logger.warning(
                "resume_route.parse.bad_request filename=%s extension=%s code=UNSUPPORTED_FILE_TYPE message=%s",
                filename,
                ext,
                str(exc),
            )
            raise HTTPException(
                status_code=400,
                detail=_make_error("UNSUPPORTED_FILE_TYPE", str(exc)),
            ) from exc
        except RuntimeError as exc:
            logger.exception("Resume parse failed")
            if ocr_api_key:
                raise HTTPException(
                    status_code=502,
                    detail=_make_error("OCR_FAILED", "Failed to parse document"),
                ) from exc
            raise HTTPException(
                status_code=502,
                detail=_make_error("LLM_FAILED", "Failed to extract resume data"),
            ) from exc
        except Exception as exc:
            logger.exception("Resume extraction failed")
            raise HTTPException(
                status_code=502,
                detail=_make_error("LLM_FAILED", "Failed to extract resume data"),
            ) from exc

        if parse_result.extraction_method not in {"llm_file_direct", "image_then_llm"} and not parse_result.text.strip():
            logger.warning(
                "resume_route.parse.bad_request filename=%s extension=%s code=EMPTY_CONTENT method=%s",
                filename,
                ext,
                parse_result.extraction_method,
            )
            raise HTTPException(
                status_code=400,
                detail=_make_error(
                    "EMPTY_CONTENT",
                    "Could not extract text from the uploaded file",
                ),
            )

        return ResumeParseResponse(
            data=resume_data,
            meta=ParseMeta(
                filename=filename,
                extension=ext,
                elapsed=ElapsedTime(
                    ocr_seconds=parse_result.ocr_elapsed,
                    llm_seconds=parse_result.llm_elapsed,
                ),
                guidance=parse_result.guidance,
            ),
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected resume route failure")
        raise HTTPException(
            status_code=500,
            detail=_make_error("INTERNAL_ERROR", "Internal server error"),
        ) from exc
