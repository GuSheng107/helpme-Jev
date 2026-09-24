"""图片素材：上传校验、落盘、多模态读图。

产品约束（DESIGN.md §8.7）：
- 只有默认 LLM ``supports_vision`` 时图片才可用 —— **系统不做任何 OCR**，
  原图以 data URL 交给多模态 LLM 读，读出的英文描述进注释翻译管线；
- PNG / JPEG / WEBP，单张 ≤ 4MB，一条消息最多 9 张。
"""

from __future__ import annotations

import base64
import json
import shutil
import time
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from ..clients.llm_client import chat_json
from ..domain.errors import DomainError, DomainErrorCode
from ..repositories.models import Material

ALLOWED_MIME = {"image/png", "image/jpeg", "image/webp"}
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_IMAGES_PER_MESSAGE = 9
MATERIALS_DIR = Path("data") / "materials"

_DESCRIBE_PROMPT = """You read chat screenshots for a decision model that only reads English.
Describe what is visible: who is talking (if determinable), the key readable content translated
into English, and the overall tone. Do not invent anything you cannot see.
Keep it under 3 sentences. Return JSON: {"description": "..."}"""


def _extension(mime: str) -> str:
    return {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}.get(mime, ".bin")


def save_image(
    db: Session,
    *,
    owner_user_id: int,
    conversation_id: int,
    content: bytes,
    mime: str,
) -> Material:
    """校验并落盘一张图片，返回 Material 行（未提交，调用方 commit）。"""
    if mime not in ALLOWED_MIME:
        raise DomainError(
            DomainErrorCode.VALIDATION_FAILED, "只接受 PNG、JPEG 或 WEBP", status_code=422
        )
    if len(content) > MAX_IMAGE_BYTES:
        raise DomainError(DomainErrorCode.PAYLOAD_TOO_LARGE, "图片超过 4MB", status_code=413)
    folder = MATERIALS_DIR / str(owner_user_id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{uuid4().hex}{_extension(mime)}"
    path.write_bytes(content)
    row = Material(
        owner_user_id=owner_user_id,
        conversation_id=conversation_id,
        kind="screenshot",
        file_path=str(path),
        mime=mime,
        bytes=len(content),
        retention="keep",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_user_materials(owner_user_id: int) -> None:
    """账号删除后移除该用户的图片文件。"""
    shutil.rmtree(MATERIALS_DIR / str(owner_user_id), ignore_errors=True)


def _data_url(content: bytes, mime: str) -> str:
    return f"data:{mime or 'image/png'};base64,{base64.b64encode(content).decode('ascii')}"


def _image_ids(raw: str | None) -> list[int]:
    try:
        parsed = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    ids = []
    for item in parsed:
        if isinstance(item, dict) and item.get("type") == "image":
            try:
                ids.append(int(item.get("id")))
            except (TypeError, ValueError):
                continue
    return ids


def image_context_contents(
    db: Session,
    *,
    llm,
    api_key: str,
    rows,
    owner_user_id: int,
    trace_id: str = "",
) -> list[str]:
    """消息正文 + 附件图片的多模态描述。

    仅当默认 LLM 支持看图时读图；读出的描述以 ``[attached image: …]``
    追加在正文后，走同一条注释翻译管线进 JEV。不支持看图或读失败时
    原样返回正文（不阻塞主流程）。
    """
    contents: list[str] = []
    for row in rows:
        text = row.content or ""
        ids = _image_ids(getattr(row, "attachments", None))
        if not ids or not llm.supports_vision:
            contents.append(text)
            continue
        urls: list[str] = []
        for material_id in ids:
            material = db.get(Material, material_id)
            if material is None or material.owner_user_id != owner_user_id:
                continue
            path = Path(material.file_path or "")
            if path.is_file():
                urls.append(_data_url(path.read_bytes(), material.mime or "image/png"))
        if not urls:
            contents.append(text)
            continue
        result = chat_json(
            endpoint_url=llm.endpoint_url,
            api_key=api_key,
            model=llm.model,
            protocol=llm.protocol,
            messages=[
                {"role": "system", "content": _DESCRIBE_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Describe the attached image(s)."},
                        *(
                            {"type": "image_url", "image_url": {"url": url}}
                            for url in urls
                        ),
                    ],
                },
            ],
        )
        _write_describe_log(
            db,
            owner_user_id=owner_user_id,
            trace_id=trace_id,
            llm=llm,
            result=result,
            image_count=len(urls),
        )
        description = str(result.payload.get("description") or "").strip() if result.ok else ""
        if description:
            contents.append(f"{text}\n[attached image: {description}]" if text else f"[attached image: {description}]")
        else:
            contents.append(text)
    return contents


def _write_describe_log(db: Session, *, owner_user_id: int, trace_id: str, llm, result, image_count: int) -> None:
    """读图调用也进调用日志（phase=describe），方便分清是读图错还是判断错。

    读图失败**不中断分析**（退回纯正文继续），故记 warn 而非 error。
    """
    from ..core.logging import dump_body, pick_level
    from ..repositories.models import CallLog

    response_body, response_cut = dump_body(result.payload)
    request_body, request_cut = dump_body(
        {"images": image_count, "note": "原图以 data URL 交给多模态模型，系统未做 OCR"}
    )
    truncated = request_cut or response_cut
    db.add(
        CallLog(
            owner_user_id=owner_user_id,
            trace_id=trace_id,
            kind="llm",
            phase="describe",
            level=pick_level(ok=True, degraded=not result.ok or truncated),
            endpoint_url=llm.endpoint_url,
            model=llm.model,
            request_body=request_body,
            response_body=response_body,
            truncated=truncated,
            status_code=result.status_code,
            latency_ms=result.latency_ms,
            error="" if result.ok else result.detail,
        )
    )
