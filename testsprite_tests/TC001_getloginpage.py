import requests

BASE_URL = "http://localhost:5173"
TIMEOUT = 30

def test_getloginpage():
    url = f"{BASE_URL}/login"
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
    }
    try:
        response = requests.get(url, headers=headers, timeout=TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Request to {url} failed: {e}"

    # Assert status code 200 OK
    assert response.status_code == 200, f"Expected status code 200, got {response.status_code}"

    content_type = response.headers.get("Content-Type", "")
    # Assert content type includes HTML
    assert "text/html" in content_type, f"Expected Content-Type to include 'text/html', got '{content_type}'"

    html = response.text.lower()

    # Assert presence of login form elements by checking for form tag and input with type password
    assert "<form" in html, "Login form <form> tag not found in response body"
    # Check for password input field more robustly
    assert 'type="password"' in html or "type='password'" in html, "Password input field not found in login form"


test_getloginpage()