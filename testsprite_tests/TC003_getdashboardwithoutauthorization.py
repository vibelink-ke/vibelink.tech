import requests

BASE_URL = "http://localhost:5173"
TIMEOUT = 30

def test_getdashboardwithoutauthorization():
    session = requests.Session()
    try:
        # Step 1: GET / without Authorization header, expect 401 Unauthorized
        response_dashboard = session.get(f"{BASE_URL}/", timeout=TIMEOUT)
        assert response_dashboard.status_code == 401, f"Expected 401 Unauthorized but got {response_dashboard.status_code}"

        # Step 2: GET /login page, expect 200 OK with login form
        response_login = session.get(f"{BASE_URL}/login", timeout=TIMEOUT)
        assert response_login.status_code == 200, f"Expected 200 OK on /login but got {response_login.status_code}"
        assert "login" in response_login.text.lower(), "Login page content does not indicate a login form"
    finally:
        session.close()

test_getdashboardwithoutauthorization()
