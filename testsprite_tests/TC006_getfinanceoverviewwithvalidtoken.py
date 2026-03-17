import requests

BASE_URL = "http://localhost:5173"
FINANCE_ENDPOINT = "/finance"
TIMEOUT = 30

# Replace this with a valid token for testing
VALID_BEARER_TOKEN = "your_valid_token_here"

def test_get_finance_overview_with_valid_token():
    url = BASE_URL + FINANCE_ENDPOINT
    headers = {
        "Authorization": f"Bearer {VALID_BEARER_TOKEN}"
    }
    try:
        response = requests.get(url, headers=headers, timeout=TIMEOUT)
        assert response.status_code == 200, f"Expected status code 200, got {response.status_code}"
        content = response.content
        assert content, "Response content is empty"
        content_type = response.headers.get('Content-Type', '')
        assert 'application/json' in content_type, f"Expected 'application/json' content type, got {content_type}"
        try:
            data = response.json()
        except ValueError as e:
            assert False, f"Response content is not valid JSON: {e}"
        # Validate that finance overview data includes balances and dueAmounts
        assert "balances" in data, "Response JSON does not contain 'balances'"
        assert "dueAmounts" in data, "Response JSON does not contain 'dueAmounts'"
        balances = data.get("balances")
        due_amounts = data.get("dueAmounts")
        assert isinstance(balances, dict), "'balances' is not a dict"
        assert isinstance(due_amounts, dict), "'dueAmounts' is not a dict"
    except requests.RequestException as e:
        assert False, f"Request to {url} failed with exception: {e}"

test_get_finance_overview_with_valid_token()
