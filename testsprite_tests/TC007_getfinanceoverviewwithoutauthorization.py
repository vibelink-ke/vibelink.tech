import requests

BASE_URL = "http://localhost:5173"
TIMEOUT = 30

def test_get_finance_overview_without_authorization():
    finance_url = f"{BASE_URL}/finance"
    login_url = f"{BASE_URL}/login"
    
    try:
        # Step 1: Attempt to access /finance without Authorization header
        finance_response = requests.get(finance_url, timeout=TIMEOUT)
        
        # Assert it returns 401 Unauthorized
        assert finance_response.status_code == 401, \
            f"Expected 401 Unauthorized from /finance but got {finance_response.status_code}"
        
        # Step 2: Access /login page and expect 200 OK with login page
        login_response = requests.get(login_url, timeout=TIMEOUT)
        assert login_response.status_code == 200, \
            f"Expected 200 OK from /login but got {login_response.status_code}"
        
        # Basic check for login form presence (checking keyword in text)
        assert "login" in login_response.text.lower() or "sign in" in login_response.text.lower(), \
            "Login page does not appear to contain login form content."
            
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

test_get_finance_overview_without_authorization()