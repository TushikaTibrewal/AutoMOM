import os
import tempfile

os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.gettempdir(), "automom_test.db")
os.environ["AI_PROVIDER"] = "mock"
os.environ["JWT_SECRET_KEY"] = "test-secret"
os.environ["RATE_LIMIT_GENERATE"] = "1000/minute"
os.environ["RATE_LIMIT_AUTH"] = "1000/minute"
os.environ["RATE_LIMIT_DEFAULT"] = "10000/minute"

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_headers(client):
    res = client.post(
        "/api/auth/register",
        json={"email": "test@example.com", "full_name": "Test User", "password": "password123"},
    )
    assert res.status_code == 201, res.text
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


SAMPLE_TRANSCRIPT = """Agenda: Budget review
We discussed the lab equipment costs in detail.
Decided to approve the new lab equipment purchase.
Ravi will prepare the cost sheet by Friday.
Agenda: Sports day planning
The venue options were compared.
Priya will book the ground by next Monday.
"""


@pytest.fixture
def sample_payload():
    return {
        "meeting": {
            "title": "Monthly Review",
            "meeting_date": "2026-07-18",
            "meeting_time": "10:00",
            "venue": "Room 4",
            "organization": "ABC Institute",
            "meeting_type": "Committee",
            "prepared_by": "Secretary",
            "approved_by": "Chairperson",
        },
        "attendees": [
            {"name": "Dr. Rao", "role": "Chair", "department": "Admin", "present": True, "group": "chairperson"},
            {"name": "Ravi", "role": "Member", "department": "Physics", "present": True, "group": "member"},
            {"name": "Priya", "role": "Coordinator", "department": "Sports", "present": False, "group": "core_team"},
        ],
        "transcript": SAMPLE_TRANSCRIPT,
        "template_slug": "classic",
    }
