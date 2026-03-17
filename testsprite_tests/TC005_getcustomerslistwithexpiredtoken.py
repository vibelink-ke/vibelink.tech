import requests

BASE_URL = "http://localhost:5173"
EXPIRED_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.expiredsignature"  # Example expired JWT token placeholder
TIMEOUT = 30

def test_getcustomerslistwithexpiredtoken():
    headers = {
        "Authorization": f"Bearer {EXPIRED_TOKEN}"
    }
    # Request /customers with expired token, expect 401 Unauthorized
    response = requests.get(f"{BASE_URL}/customers", headers=headers, timeout=TIMEOUT)
    try:
        assert response.status_code == 401, f"Expected 401 Unauthorized but got {response.status_code}"
    except AssertionError:
        # Sometimes APIs may return 403 or other codes for expired tokens - but according to PRD 401 expected
        raise

    # Then request /login to confirm redirect page returns 200 with login page
    login_response = requests.get(f"{BASE_URL}/login", timeout=TIMEOUT)
    assert login_response.status_code == 200, f"Expected 200 OK on /login but got {login_response.status_code}"
    # Optionally, verify page content contains login form indications
    # For example, check presence of <form> tag or string "login"
    login_content = login_response.text.lower()
    assert ("login" in login_content or "<form" in login_content), "Login page content does not appear correct"

test_getcustomerslistwithexpiredtoken()