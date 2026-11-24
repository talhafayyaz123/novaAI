from typing import Literal
from pydantic import BaseModel, Field


StudyKind = Literal["summary", "notes", "quiz"]


class StudyGenerateRequest(BaseModel):
    document_id: int = Field(gt=0)
    kind: StudyKind
    question_count: int = Field(default=5, ge=1, le=10)


class StudyCitation(BaseModel):
    id: str
    page_number: int | None
    content: str


class StudyQuestionResponse(BaseModel):
    id: int
    question: str
    options: list[str]
    citations: list[StudyCitation]


class StudyGenerateResponse(BaseModel):
    session_id: int
    kind: StudyKind
    content: str | None = None
    citations: list[StudyCitation] = Field(default_factory=list)
    questions: list[StudyQuestionResponse] = Field(default_factory=list)


class StudyAnswerRequest(BaseModel):
    selected_option: int = Field(ge=0, le=3)


class StudyAnswerResponse(BaseModel):
    is_correct: bool
    correct_option: int | None = None
    correct_answer: str | None = None
    explanation: str | None = None
