def test_register_and_login(client):
    res = client.post(
        "/api/auth/register",
        json={"email": "a@b.com", "full_name": "A B", "password": "password123"},
    )
    assert res.status_code == 201
    assert res.json()["access_token"]

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
