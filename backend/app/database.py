"""SQLAlchemy engine, session factory and declarative base."""
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

# Some hosts (Render, Heroku) hand out legacy "postgres://" URLs, which
# SQLAlchemy 2.0 no longer accepts. Normalize to the psycopg2 dialect.
database_url = settings.database_url
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql+psycopg2://", 1)

connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}

engine = create_engine(database_url, connect_args=connect_args, pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app import models  # noqa: F401  (register mappers)

    Base.metadata.create_all(bind=engine)
    _apply_lightweight_migrations()


# Columns added after the first release. create_all() only creates missing
# tables, not new columns on existing ones, so we add them idempotently here.
# (A full app would use Alembic; this keeps the single-file deploy self-healing.)
_ADDITIVE_COLUMNS = {
    "users": [
        ("is_verified", "BOOLEAN NOT NULL DEFAULT FALSE"),
        ("verification_token", "VARCHAR(255)"),
        ("token_expires", "TIMESTAMPTZ"),
    ],
}


def _apply_lightweight_migrations() -> None:
    from sqlalchemy import inspect, text

    if engine.dialect.name != "postgresql":
        return  # SQLite dev/test DBs are always created fresh with all columns
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, columns in _ADDITIVE_COLUMNS.items():
            if not inspector.has_table(table):
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl in columns:
                if name not in existing:
                    conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {ddl}'))
