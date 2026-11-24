"""Add account status and conversation summaries."""

from alembic import op
import sqlalchemy as sa


revision = "0003_account_status"
down_revision = "0002_add_embedding_384"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.add_column(
        "conversations",
        sa.Column("summary", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("conversations", "summary")
    op.drop_column("users", "is_active")
