from __future__ import annotations

import asyncio
import gzip
import json
import struct
import threading
import uuid
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

from websockets.sync.client import connect

from app.core.config import get_settings
from app.services.runtime_config import ResolvedSpeechConfig

SendEventFn = Callable[[dict], Awaitable[None]]


class ProtocolVersion:
    V1 = 0b0001


class MessageType:
    CLIENT_FULL_REQUEST = 0b0001
    CLIENT_AUDIO_ONLY_REQUEST = 0b0010
    SERVER_FULL_RESPONSE = 0b1001
    SERVER_ERROR_RESPONSE = 0b1111


class MessageTypeSpecificFlags:
    POS_SEQUENCE = 0b0001
    NEG_WITH_SEQUENCE = 0b0011


class SerializationType:
    NO_SERIALIZATION = 0b0000
    JSON = 0b0001


class CompressionType:
    GZIP = 0b0001


@dataclass
class ParsedResponse:
    code: int = 0
    event: int = 0
    is_last_package: bool = False
    payload_sequence: int = 0
    payload_size: int = 0
    payload_msg: Optional[dict] = None


class VolcengineProtocolMixin:
    def __init__(self, speech_config: ResolvedSpeechConfig | None = None):
        settings = get_settings()
        speech_config = speech_config or ResolvedSpeechConfig(
            app_key=settings.volcengine_speech_app_key,
            access_key=settings.volcengine_speech_access_key,
        )
        if not speech_config.app_key:
            raise ValueError("Volcengine speech app key is not configured")
        if not speech_config.access_key:
            raise ValueError("Volcengine speech access key is not configured")

        self.url = settings.volcengine_speech_base_url
        self.app_key = speech_config.app_key
        self.access_key = speech_config.access_key
        self.resource_id = settings.volcengine_speech_resource_id
        self.mode = settings.volcengine_speech_mode
        self.language = "zh-CN"
        self.sample_rate = 16000
        self.send_event: Optional[SendEventFn] = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.closed = False
        self.seq = 1

    def _connect_headers(self) -> dict[str, str]:
        return {
            "X-Api-Resource-Id": self.resource_id,
            "X-Api-Request-Id": str(uuid.uuid4()),
            "X-Api-Connect-Id": str(uuid.uuid4()),
            "X-Api-Access-Key": self.access_key,
            "X-Api-App-Key": self.app_key,
        }

    def _build_full_client_request(self, seq: int, *, enable_nonstream: bool) -> bytes:
        header = self._build_header(
            message_type=MessageType.CLIENT_FULL_REQUEST,
            flags=MessageTypeSpecificFlags.POS_SEQUENCE,
            serialization=SerializationType.JSON,
            compression=CompressionType.GZIP,
        )
        payload = {
            "user": {
                "uid": "face-tamato",
            },
            "audio": {
                "format": "pcm",
                "codec": "raw",
                "rate": self.sample_rate,
                "bits": 16,
                "channel": 1,
                "language": self.language,
            },
            "request": {
                "model_name": "bigmodel",
                "enable_itn": True,
                "enable_punc": True,
                "enable_ddc": True,
                "show_utterances": True,
                "result_type": "single",
                "enable_nonstream": enable_nonstream,
            },
        }
        payload_bytes = gzip.compress(json.dumps(payload).encode("utf-8"))
        request = bytearray()
        request.extend(header)
        request.extend(struct.pack(">i", seq))
        request.extend(struct.pack(">I", len(payload_bytes)))
        request.extend(payload_bytes)
        return bytes(request)

    def _build_audio_only_request(self, seq: int, audio_bytes: bytes, *, is_last: bool) -> bytes:
        flags = MessageTypeSpecificFlags.NEG_WITH_SEQUENCE if is_last else MessageTypeSpecificFlags.POS_SEQUENCE
        seq_value = -seq if is_last else seq
        header = self._build_header(
            message_type=MessageType.CLIENT_AUDIO_ONLY_REQUEST,
            flags=flags,
            serialization=SerializationType.NO_SERIALIZATION,
            compression=CompressionType.GZIP,
        )
        compressed_audio = gzip.compress(audio_bytes)
        request = bytearray()
        request.extend(header)
        request.extend(struct.pack(">i", seq_value))
        request.extend(struct.pack(">I", len(compressed_audio)))
        request.extend(compressed_audio)
        return bytes(request)

    def _build_header(self, *, message_type: int, flags: int, serialization: int, compression: int) -> bytes:
        return bytes(
            [
                (ProtocolVersion.V1 << 4) | 1,
                (message_type << 4) | flags,
                (serialization << 4) | compression,
                0x00,
            ]
        )

    def _parse_response(self, msg: bytes) -> ParsedResponse:
        response = ParsedResponse()
        header_size = msg[0] & 0x0F
        message_type = msg[1] >> 4
        flags = msg[1] & 0x0F
        serialization = msg[2] >> 4
        compression = msg[2] & 0x0F
        payload = msg[header_size * 4 :]

        if flags & 0x01:
            response.payload_sequence = struct.unpack(">i", payload[:4])[0]
            payload = payload[4:]
        if flags & 0x02:
            response.is_last_package = True
        if flags & 0x04:
            response.event = struct.unpack(">i", payload[:4])[0]
            payload = payload[4:]

        if message_type == MessageType.SERVER_FULL_RESPONSE:
            response.payload_size = struct.unpack(">I", payload[:4])[0]
            payload = payload[4:]
        elif message_type == MessageType.SERVER_ERROR_RESPONSE:
            response.code = struct.unpack(">i", payload[:4])[0]
            response.payload_size = struct.unpack(">I", payload[4:8])[0]
            payload = payload[8:]

        if payload and compression == CompressionType.GZIP:
            payload = gzip.decompress(payload)
        if payload and serialization == SerializationType.JSON:
            response.payload_msg = json.loads(payload.decode("utf-8"))
        return response

    def _extract_error_message(self, response: ParsedResponse) -> str:
        payload_msg = response.payload_msg or {}
        if isinstance(payload_msg, dict):
            error = payload_msg.get("error")
            if isinstance(error, str) and error:
                return error
        return f"Volcengine ASR error: {response.code}"

    async def _safe_send_event(self, payload: dict) -> None:
        if self.send_event is None:
            return
        try:
            await self.send_event(payload)
        except Exception as exc:
            print("volcengine send_event skipped:", repr(exc))

    def _extract_text_and_final(self, payload_msg: Optional[dict]) -> tuple[str, bool]:
        if not isinstance(payload_msg, dict):
            return "", False

        result = payload_msg.get("result")
        if isinstance(result, dict):
            text = result.get("text")
            if isinstance(text, str):
                utterances = result.get("utterances")
                if isinstance(utterances, list):
                    is_final = any(isinstance(item, dict) and item.get("definite") is True for item in utterances)
                    return text.strip(), is_final
                return text.strip(), False

        if isinstance(result, list):
            texts: list[str] = []
            definite = False
            for item in result:
                if not isinstance(item, dict):
                    continue
                text = item.get("text")
                if isinstance(text, str) and text:
                    texts.append(text)
                definite = definite or bool(item.get("definite"))
            return "".join(texts).strip(), definite

        text = payload_msg.get("text")
        if isinstance(text, str):
            return text.strip(), False
        return "", False


class VolcengineTranscriptionService(VolcengineProtocolMixin):
    """No-stream bridge: buffer PCM and submit the full clip on stop."""

    def __init__(self, speech_config: ResolvedSpeechConfig | None = None):
        super().__init__(speech_config=speech_config)
        self.audio_buffer = bytearray()

    async def start(self, *, language: str, encoding: str, sample_rate: int, send_event: SendEventFn) -> None:
        if self.closed:
            raise RuntimeError("Cannot start a closed VolcengineTranscriptionService")
        if encoding != "linear16":
            raise ValueError(f"Volcengine service expects linear16 PCM, got {encoding}")

        self.loop = asyncio.get_running_loop()
        self.send_event = send_event
        self.language = language
        self.sample_rate = sample_rate
        self.audio_buffer.clear()

        print(
            "volcengine start:",
            {
                "url": self.url,
                "resource_id": self.resource_id,
                "language": self.language,
                "sample_rate": self.sample_rate,
                "mode": "nostream-buffered",
            },
        )

    async def send_audio(self, chunk: bytes) -> None:
        if not self.closed:
            self.audio_buffer.extend(chunk)

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True

        if not self.audio_buffer:
            return

        try:
            final_text = await asyncio.to_thread(self._transcribe_pcm_bytes, bytes(self.audio_buffer))
            if final_text:
                await self._safe_send_event({"type": "final", "text": final_text})
                await self._safe_send_event({"type": "end_of_turn"})
        except Exception as exc:
            print("volcengine transcription failed:", repr(exc))
            await self._safe_send_event({"type": "error", "message": str(exc)})

    def _transcribe_pcm_bytes(self, pcm_bytes: bytes) -> str:
        connection_cm = None
        connection = None
        seq = 1

        try:
            connection_cm = connect(
                self.url,
                additional_headers=self._connect_headers(),
                open_timeout=10,
                close_timeout=5,
            )
            connection = connection_cm.__enter__()

            connection.send(self._build_full_client_request(seq, enable_nonstream=True))
            seq += 1

            init_raw = connection.recv()
            if not isinstance(init_raw, bytes):
                raise RuntimeError("Expected binary init response from Volcengine")
            init_response = self._parse_response(init_raw)
            print("volcengine init response:", init_response.payload_msg or {"code": init_response.code})
            if init_response.code != 0:
                raise RuntimeError(f"Volcengine ASR init failed: {init_response.code}")

            connection.send(self._build_audio_only_request(seq, pcm_bytes, is_last=True))

            final_text = ""
            while True:
                raw = connection.recv()
                if raw is None:
                    break
                if not isinstance(raw, bytes):
                    continue

                response = self._parse_response(raw)
                print(
                    "volcengine response:",
                    {
                        "code": response.code,
                        "event": response.event,
                        "sequence": response.payload_sequence,
                        "is_last_package": response.is_last_package,
                        "payload_msg": response.payload_msg,
                    },
                )
                if response.code != 0:
                    raise RuntimeError(self._extract_error_message(response))

                text, _ = self._extract_text_and_final(response.payload_msg)
                if text:
                    final_text = text

                if response.is_last_package:
                    break

            return final_text
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass
            if connection_cm is not None:
                try:
                    connection_cm.__exit__(None, None, None)
                except Exception:
                    pass


class VolcengineRealtimeTranscriptionService(VolcengineProtocolMixin):
    """Realtime bridge for bigmodel / bigmodel_async."""

    def __init__(self, speech_config: ResolvedSpeechConfig | None = None):
        super().__init__(speech_config=speech_config)
        self.connection_cm = None
        self.connection = None
        self.ready_event = threading.Event()
        self.reader_thread: Optional[threading.Thread] = None
        self.send_lock = threading.Lock()

    async def start(self, *, language: str, encoding: str, sample_rate: int, send_event: SendEventFn) -> None:
        if self.closed:
            raise RuntimeError("Cannot start a closed VolcengineRealtimeTranscriptionService")
        if encoding != "linear16":
            raise ValueError(f"Volcengine realtime service expects linear16 PCM, got {encoding}")

        self.loop = asyncio.get_running_loop()
        self.send_event = send_event
        self.language = language
        self.sample_rate = sample_rate
        self.seq = 1

        print(
            "volcengine realtime start:",
            {
                "url": self.url,
                "resource_id": self.resource_id,
                "language": self.language,
                "sample_rate": self.sample_rate,
                "mode": self.mode,
            },
        )

        self.connection_cm = connect(
            self.url,
            additional_headers=self._connect_headers(),
            open_timeout=10,
            close_timeout=5,
        )
        self.connection = self.connection_cm.__enter__()

        with self.send_lock:
            self.connection.send(self._build_full_client_request(self.seq, enable_nonstream=self.mode == "streaming_async"))
            self.seq += 1

        init_raw = self.connection.recv()
        if not isinstance(init_raw, bytes):
            raise RuntimeError("Expected binary init response from Volcengine")
        init_response = self._parse_response(init_raw)
        print("volcengine realtime init response:", init_response.payload_msg or {"code": init_response.code})
        if init_response.code != 0:
            raise RuntimeError(self._extract_error_message(init_response))

        self.ready_event.set()

        def run_reader():
            try:
                while not self.closed and self.connection is not None:
                    raw = self.connection.recv()
                    if raw is None:
                        break
                    if not isinstance(raw, bytes):
                        continue

                    response = self._parse_response(raw)
                    print(
                        "volcengine realtime response:",
                        {
                            "code": response.code,
                            "event": response.event,
                            "sequence": response.payload_sequence,
                            "is_last_package": response.is_last_package,
                            "payload_msg": response.payload_msg,
                        },
                    )
                    self._handle_server_event(response)

                    if response.is_last_package:
                        break
            except Exception as exc:
                print("volcengine realtime reader failed:", repr(exc))
                if self.closed or self.loop is None:
                    return
                asyncio.run_coroutine_threadsafe(self._safe_send_event({"type": "error", "message": str(exc)}), self.loop)

        self.reader_thread = threading.Thread(target=run_reader, daemon=True)
        self.reader_thread.start()

    async def send_audio(self, chunk: bytes) -> None:
        if self.closed or self.connection is None or not self.ready_event.is_set():
            return
        with self.send_lock:
            self.connection.send(self._build_audio_only_request(self.seq, chunk, is_last=False))
            self.seq += 1

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        self.ready_event.clear()

        if self.connection is not None:
            try:
                with self.send_lock:
                    self.connection.send(self._build_audio_only_request(self.seq, b"", is_last=True))
                    self.seq += 1
            except Exception as exc:
                print("volcengine realtime final packet skipped:", repr(exc))

        await asyncio.sleep(0.8)

        if self.connection is not None:
            try:
                self.connection.close()
            except Exception:
                pass
        if self.connection_cm is not None:
            try:
                self.connection_cm.__exit__(None, None, None)
            except Exception:
                pass

        self.connection = None
        self.connection_cm = None
        self.reader_thread = None

    def _handle_server_event(self, response: ParsedResponse) -> None:
        if self.loop is None:
            return
        if response.code != 0:
            asyncio.run_coroutine_threadsafe(
                self._safe_send_event({"type": "error", "message": self._extract_error_message(response)}),
                self.loop,
            )
            return

        text, is_final = self._extract_text_and_final(response.payload_msg)
        if text:
            asyncio.run_coroutine_threadsafe(
                self._safe_send_event({"type": "final" if is_final else "partial", "text": text}),
                self.loop,
            )
        if is_final:
            asyncio.run_coroutine_threadsafe(
                self._safe_send_event({"type": "end_of_turn"}),
                self.loop,
            )
