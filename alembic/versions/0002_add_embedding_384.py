"""Add 384-dimensional embeddings for document RAG."""

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy


revision = "0002_add_embedding_384"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "document_chunks",
        sa.Column("embedding_384", pgvector.sqlalchemy.Vector(384), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("document_chunks", "embedding_384")
