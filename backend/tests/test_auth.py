def test_register_and_login(client):
    res = client.post(
        "/api/auth/register",
        json={"email": "a@b.com", "full_name": "A B", "password": "password123"},
    )
    assert res.status_code == 201
    assert "access_token" not in res.json()
    assert "successful" in res.json()["message"]

    res = client.post("/api/auth/login", json={"email": "a@b.com", "password": "password123"})
    assert res.status_code == 200


def test_duplicate_email_rejected(client):
    body = {"email": "a@b.com", "full_name": "A B", "password": "password123"}
    assert client.post("/api/auth/register", json=body).status_code == 201
    assert client.post("/api/auth/register", json=body).status_code == 409


def test_wrong_password_rejected(client):
    client.post(
        "/api/auth/register",
        json={"email": "a@b.com", "full_name": "A B", "password": "password123"},
    )
    res = client.post("/api/auth/login", json={"email": "a@b.com", "password": "wrongpass99"})
    assert res.status_code == 401


def test_short_password_rejected(client):
    res = client.post(
        "/api/auth/register", json={"email": "a@b.com", "full_name": "A B", "password": "short"}
    )
    assert res.status_code == 422


def test_protected_route_requires_token(client):
    assert client.get("/api/meetings").status_code == 401


def test_me(client, auth_headers):
    res = client.get("/api/auth/me", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["email"] == "test@example.com"


def test_new_user_starts_unverified(client, auth_headers):
    assert client.get("/api/auth/me", headers=auth_headers).json()["is_verified"] is False


def test_email_verification_flow(client, db_session=None):
    from app.database import SessionLocal
    from app.models import User

    client.post(
        "/api/auth/register",
        json={"email": "v@example.com", "full_name": "V", "password": "password123"},
    )
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == "v@example.com").one()
        token = user.verification_token
        assert token  # token generated on register

    res = client.post("/api/auth/verify", json={"token": token})
    assert res.status_code == 200
    assert res.json()["is_verified"] is True

    # token is single-use
    assert client.post("/api/auth/verify", json={"token": token}).status_code == 400


def test_verify_bad_token(client):
    assert client.post("/api/auth/verify", json={"token": "nope"}).status_code == 400


def test_resend_verification_always_202(client):
    assert client.post("/api/auth/resend-verification", json={"email": "nobody@x.com"}).status_code == 202
