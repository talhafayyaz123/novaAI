import json
import logging
import os
from pathlib import Path
from typing import AsyncIterator
from urllib.parse import quote

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
import httpx
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..admin.audit import record_ai_request
from ..auth.dependencies import SessionLocal, User, get_current_user, get_db
from ..db.models import Conversation, Message
from ..gemini import GeminiClient
from ..rate_limit import enforce_rate_limit

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")

logger = logging.getLogger(__name__)
router = APIRouter()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
MAX_CONTEXT_MESSAGES = 20
GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"


class ChatMessageRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    conversation_id: int | None = None


class ConversationUpdateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)


def _event(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _persist_exchange(
    owner_id: int,
    conversation_id: int | None,
    user_content: str,
    assistant_content: str,
    tokens_used: int,
) -> int:
    db = SessionLocal()
    try:
        if conversation_id is None:
            title = user_content.replace("\n", " ")[:72] or "New conversation"
            conversation = Conversation(owner_id=owner_id, title=title)
            db.add(conversation)
            db.flush()
            conversation_id = conversation.id
        else:
            conversation = (
                db.query(Conversation)
                .filter(
                    Conversation.id == conversation_id,
                    Conversation.owner_id == owner_id,
                )
                .first()
            )
            if conversation is None:
                raise ValueError("Conversation not found")

        db.add_all(
            [
                Message(
                    conversation_id=conversation_id,
                    role="user",
                    content=user_content,
                ),
                Message(
                    conversation_id=conversation_id,
                    role="assistant",
                    content=assistant_content,
                ),
            ]
        )
        record_ai_request(db, owner_id, "chat", tokens_used=tokens_used)
        db.commit()
        return conversation_id
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@router.get("/conversations")
def list_conversations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, object]]:
    conversations = (
        db.query(Conversation)
        .filter(Conversation.owner_id == current_user.id)
        .order_by(Conversation.created_at.desc(), Conversation.id.desc())
        .all()
    )
    return [
        {
            "id": conversation.id,
            "title": conversation.title or "New conversation",
            "created_at": conversation.created_at.isoformat(),
        }
        for conversation in conversations
    ]


@router.delete("/conversations")
def delete_all_conversations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deleted = (
        db.query(Conversation)
        .filter(Conversation.owner_id == current_user.id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted_count": deleted}


@router.get("/conversations/{conversation_id}/messages")
def get_conversation_messages(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, object]]:
    conversation = (
        db.query(Conversation)
        .filter(
            Conversation.id == conversation_id,
            Conversation.owner_id == current_user.id,
        )
        .first()
    )
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation.id)
        .order_by(Message.created_at.asc(), Message.id.asc())
        .all()
    )
    return [
        {
            "id": message.id,
            "role": message.role,
            "content": message.content,
            "created_at": message.created_at.isoformat(),
        }
        for message in messages
    ]


@router.patch("/conversations/{conversation_id}")
def rename_conversation(
    conversation_id: int,
    payload: ConversationUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conversation = (
        db.query(Conversation)
        .filter(
            Conversation.id == conversation_id,
            Conversation.owner_id == current_user.id,
        )
        .first()
    )
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Title cannot be blank")
    conversation.title = title
    db.commit()
    db.refresh(conversation)
    return {"id": conversation.id, "title": conversation.title, "created_at": conversation.created_at.isoformat()}


@router.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conversation = (
        db.query(Conversation)
        .filter(
            Conversation.id == conversation_id,
            Conversation.owner_id == current_user.id,
        )
        .first()
    )
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    db.delete(conversation)
    db.commit()
    return {"detail": "Conversation deleted"}


@router.post("/conversations/{conversation_id}/summarize")
def summarize_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    enforce_rate_limit(f"chat-summary:{current_user.id}")
    conversation = (
        db.query(Conversation)
        .filter(
            Conversation.id == conversation_id,
            Conversation.owner_id == current_user.id,
        )
        .first()
    )
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation.id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(40)
        .all()
    )
    messages.reverse()
    if not messages:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Conversation has no messages to summarize")

    transcript = "\n".join(
        f"{message.role.upper()}: {message.content}"
        for message in messages
    )
    prompt = (
        "Summarize this conversation for future context. "
        "Preserve important facts, decisions, preferences, names, and unfinished tasks. "
        "Use concise bullet points and do not invent anything.\n\n"
        f"{transcript}"
    )
    try:
        client = GeminiClient()
        summary = client.generate(prompt)
        if not isinstance(summary, str) or not summary.strip():
            raise RuntimeError("Gemini returned an empty summary")
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not summarize conversation: {exc}",
        ) from exc

    conversation.summary = summary.strip()
    record_ai_request(
        db,
        current_user.id,
        "chat_summary",
        tokens_used=client.last_usage_tokens or 0,
        details={"conversation_id": conversation.id},
    )
    db.commit()
    db.refresh(conversation)
    return {
        "id": conversation.id,
        "summary": conversation.summary,
        "tokens_used": client.last_usage_tokens or 0,
    }


@router.post("/message")
def send_message(
    payload: ChatMessageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    enforce_rate_limit(f"chat:{current_user.id}")
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Chat is not configured yet. Add GEMINI_API_KEY to the project .env and restart the backend.",
        )
    message_content = payload.message.strip()
    if not message_content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Message cannot be blank",
        )

    conversation_id = payload.conversation_id
    if conversation_id is not None:
        conversation = (
            db.query(Conversation)
            .filter(
                Conversation.id == conversation_id,
                Conversation.owner_id == current_user.id,
            )
            .first()
        )
        if conversation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found",
            )
        summary = getattr(conversation, "summary", None)
        prior_messages = (
            db.query(Message)
            .filter(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(MAX_CONTEXT_MESSAGES)
            .all()
        )
        prior_messages.reverse()
    else:
        prior_messages = []
        summary = None

    request_messages = [
        {"role": message.role, "content": message.content}
        for message in prior_messages
    ]
    if summary:
        request_messages.insert(
            0,
            {"role": "user", "content": f"Remember this existing conversation summary:\n{summary}"},
        )
    request_messages.append({"role": "user", "content": message_content})
    contents = [
        {
            "role": "model" if message["role"] == "assistant" else "user",
            "parts": [{"text": message["content"]}],
        }
        for message in request_messages
    ]

    async def stream_response() -> AsyncIterator[str]:
        response_parts: list[str] = []
        tokens_used = 0
        if conversation_id is not None:
            yield _event({"type": "start", "conversation_id": conversation_id})
        try:
            model = quote(GEMINI_MODEL, safe="")
            url = f"{GEMINI_API_BASE_URL}/{model}:streamGenerateContent?alt=sse"
            body = {"contents": contents}
            timeout = httpx.Timeout(connect=10, read=90, write=20, pool=10)
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                    "POST",
                    url,
                    headers={"x-goog-api-key": GEMINI_API_KEY},
                    json=body,
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if not data:
                            continue
                        chunk = json.loads(data)
                        usage = chunk.get("usageMetadata")
                        if isinstance(usage, dict):
                            total_tokens = usage.get("totalTokenCount")
                            if isinstance(total_tokens, int):
                                tokens_used = total_tokens
                        candidates = chunk.get("candidates", [])
                        if not candidates:
                            continue
                        parts = candidates[0].get("content", {}).get("parts", [])
                        for part in parts:
                            delta = part.get("text")
                            if isinstance(delta, str) and delta:
                                response_parts.append(delta)
                                yield _event({"type": "delta", "content": delta})

            answer = "".join(response_parts).strip()
            if not answer:
                logger.error("Gemini returned an empty chat response")
                yield _event(
                    {
                        "type": "error",
                        "message": "The AI returned an empty response. Please try again.",
                    }
                )
                return

            saved_conversation_id = await run_in_threadpool(
                _persist_exchange,
                current_user.id,
                conversation_id,
                message_content,
                answer,
                tokens_used,
            )
            if conversation_id is None:
                yield _event(
                    {"type": "start", "conversation_id": saved_conversation_id}
                )
            yield _event({"type": "done"})
        except httpx.HTTPStatusError as exc:
            logger.error("Gemini chat request failed with HTTP %s", exc.response.status_code)
            if exc.response.status_code == 429:
                message = "Gemini rate limit or free-tier quota reached. Check your Google AI Studio quota and try again later."
            else:
                message = f"Gemini request failed with HTTP {exc.response.status_code}. Check the API key and configured model."
            yield _event({"type": "error", "message": message})
        except httpx.RequestError:
            logger.exception("Could not connect to Gemini")
            yield _event(
                {
                    "type": "error",
                    "message": "Could not connect to Gemini. Check the backend network connection and try again.",
                }
            )
        except json.JSONDecodeError:
            logger.exception("Gemini returned an invalid streaming response")
            yield _event(
                {
                    "type": "error",
                    "message": "Gemini returned an invalid response. Please try again.",
                }
            )
        except Exception:
            logger.exception("Chat response could not be completed or saved")
            yield _event(
                {
                    "type": "error",
                    "message": "The response could not be saved. Please reload the conversation and try again.",
                }
            )
    return StreamingResponse(
        stream_response(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
