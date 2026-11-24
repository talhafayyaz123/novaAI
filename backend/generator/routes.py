from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..admin.audit import record_ai_request
from ..auth.dependencies import User, get_current_user, get_db
from ..gemini import (
    GeminiBlockedError,
    GeminiClient,
    GeminiConfigurationError,
    GeminiError,
)
from ..rate_limit import enforce_rate_limit


router = APIRouter()

ContentType = Literal[
    "email",
    "tweet",
    "linkedin_post",
    "blog_outline",
    "product_description",
    "business_description",
    "project_proposal",
    "professional_summary",
]
Tone = Literal["professional", "friendly", "casual", "persuasive", "concise"]
Length = Literal["short", "medium", "long"]


class GenerateRequest(BaseModel):
    content_type: ContentType
    instructions: str = Field(..., min_length=1, max_length=8000)
    tone: Tone = "professional"
    language: str = Field(default="English", min_length=1, max_length=50)
    length: Length = "medium"


class GenerateResponse(BaseModel):
    content: str
    content_type: ContentType
    tone: Tone
    language: str
    length: Length
    tokens_used: int


def build_prompt(payload: GenerateRequest) -> str:
    format_rules = {
        "email": "Write an email with a subject line, greeting, body, and sign-off.",
        "tweet": "Write a concise social post suitable for Twitter/X. Keep it within 280 characters and use at most one hashtag.",
        "linkedin_post": "Write a LinkedIn post with a strong hook, short readable paragraphs, and a clear closing call-to-action.",
        "blog_outline": "Write a blog outline with a title, introduction, descriptive section headings, and key points beneath each section.",
        "product_description": "Write a benefit-led product description with key details and a concise closing.",
        "business_description": "Write a clear, compelling description of the business, its audience, products or services, and value proposition using only the supplied facts. Do not invent claims.",
        "project_proposal": "Write a project proposal with an executive summary, objectives, scope, deliverables, timeline, budget assumptions, and next steps. Mark unknown details as items to confirm instead of inventing them.",
        "professional_summary": "Write a polished professional summary based only on the supplied experience, skills, and achievements. Do not invent qualifications or metrics.",
    }
    length_rules = {
        "short": "Keep the result brief.",
        "medium": "Write at a normal useful length.",
        "long": "Write a detailed response with enough supporting detail.",
    }
    return (
        "You are a professional content writer. "
        f"Create this content type: {payload.content_type}. "
        f"{format_rules[payload.content_type]} "
        f"Tone: {payload.tone}. "
        f"Language: {payload.language.strip()}. "
        f"{length_rules[payload.length]} "
        "Do not invent facts, names, prices, dates, or statistics. "
        "Return only the finished content, without explanations or markdown labels. "
        f"\n\nUser instructions:\n{payload.instructions.strip()}"
    )


@router.post("", response_model=GenerateResponse)
def generate(
    payload: GenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> GenerateResponse:
    enforce_rate_limit(f"generator:{current_user.id}")
    instructions = payload.instructions.strip()
    language = payload.language.strip()
    if not instructions:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Instructions cannot be blank",
        )
    if not language:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Language cannot be blank",
        )

    try:
        client = GeminiClient()
        generated = client.generate(build_prompt(payload))
        if not isinstance(generated, str):
            raise GeminiError("Gemini returned an invalid response")
        content = generated.strip()
        if not content:
            raise GeminiError("Gemini returned an empty response")
    except GeminiConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except GeminiBlockedError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except GeminiError as exc:
        message = str(exc)
        if "429" in message:
            message = "Gemini rate limit or free-tier quota reached. Try again later."
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=message,
        ) from exc

    tokens_used = client.last_usage_tokens or 0
    record_ai_request(
        db,
        current_user.id,
        "generator",
        tokens_used=tokens_used,
        details={
            "content_type": payload.content_type,
            "tone": payload.tone,
            "language": language,
            "length": payload.length,
        },
    )
    db.commit()

    return GenerateResponse(
        content=content,
        content_type=payload.content_type,
        tone=payload.tone,
        language=language,
        length=payload.length,
        tokens_used=tokens_used,
    )
