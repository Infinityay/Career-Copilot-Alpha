from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.schemas.runtime_config import RuntimeConfig
from app.services.runtime_config import resolve_speech_config
from app.services.speech_transcription_service import create_transcription_service

router = APIRouter(prefix="/speech", tags=["speech"])
logger = logging.getLogger(__name__)


@router.get("/status")
async def get_speech_status(
    runtime_speech_app_key: str | None = Query(default=None),
    runtime_speech_access_key: str | None = Query(default=None),
):
    speech_config = resolve_speech_config(
        RuntimeConfig(
            speechAppKey=runtime_speech_app_key,
            speechAccessKey=runtime_speech_access_key,
        )
    )
    return {"available": speech_config.available}


@router.websocket("/transcribe")
async def transcribe_speech(websocket: WebSocket):
    await websocket.accept()
    service = None
    chunk_count = 0

    try:
        first_message = await websocket.receive()

        if first_message["type"] != "websocket.receive" or "text" not in first_message:
            await websocket.send_json({"type": "error", "message": "expected initial start payload"})
            await websocket.close()
            return

        try:
            payload = json.loads(first_message["text"])
        except json.JSONDecodeError:
            await websocket.send_json({"type": "error", "message": "invalid start payload"})
            await websocket.close()
            return

        if payload.get("type") != "start":
            await websocket.send_json({"type": "error", "message": "expected start payload"})
            await websocket.close()
            return

        language = payload.get("language", "zh-CN")
        encoding = payload.get("encoding", "linear16")
        sample_rate = int(payload.get("sampleRate", 16000))
        speech_config = resolve_speech_config(
            RuntimeConfig(
                speechAppKey=payload.get("speechAppKey"),
                speechAccessKey=payload.get("speechAccessKey"),
            )
        )
        if not speech_config.available:
            await websocket.send_json({"type": "error", "message": "speech capability is not configured"})
            await websocket.close()
            return

        logger.info(
            "speech websocket start",
            extra={
                "language": language,
                "encoding": encoding,
                "sample_rate": sample_rate,
            },
        )

        service = create_transcription_service(speech_config=speech_config)
        await service.start(
            language=language,
            encoding=encoding,
            sample_rate=sample_rate,
            send_event=websocket.send_json,
        )

        await websocket.send_json({"type": "ready"})

        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                logger.info("speech websocket disconnected by client")
                break

            if "bytes" in message and message["bytes"] is not None:
                chunk_count += 1
                if chunk_count <= 5 or chunk_count % 20 == 0:
                    logger.info(
                        "speech websocket audio chunk",
                        extra={"index": chunk_count, "size": len(message["bytes"])}
                    )
                await service.send_audio(message["bytes"])
                continue

            if "text" in message and message["text"] is not None:
                try:
                    text_payload = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue

                if text_payload.get("type") == "stop":
                    logger.info("speech websocket stop")
                    break

    except WebSocketDisconnect:
        logger.info("speech websocket disconnected unexpectedly")
    except Exception as exc:
        logger.exception("speech websocket error")
        try:
            await websocket.send_json({"type": "error", "message": "Speech transcription failed"})
        except Exception:
            pass
    finally:
        if service is not None:
            await service.close()
        try:
            await websocket.close()
        except Exception:
            pass
