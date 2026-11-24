from pydantic import BaseModel, Field


class DocumentQuery(BaseModel):
    document_id: int = Field(gt=0)
    question: str = Field(min_length=1, max_length=8000)
    k: int = Field(default=5, ge=1, le=8)
