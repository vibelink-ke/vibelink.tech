import requests

BASE_URL = "http://localhost:5173"
TIMEOUT = 30

def test_getdashboardwithvalidtoken():
    # NOTE: Replace this token with a valid token for the test environment
    valid_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."  

    headers = {
        "Authorization": f"Bearer {valid_token}"
    }

    try:
        response = requests.get(f"{BASE_URL}/", headers=headers, timeout=TIMEOUT)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        assert False, f"Request failed: {e}"

    assert response.status_code == 200, f"Expected status 200, got {response.status_code}"

    try:
        data = response.json()
    except ValueError:
        assert False, "Response is not valid JSON"

    # Validate expected keys in the dashboard response
    # Dashboard metrics check (example keys): "metrics", "links"
    assert "metrics" in data, "Response JSON missing 'metrics'"
    assert isinstance(data["metrics"], dict), "'metrics' should be a dictionary"

    assert "links" in data, "Response JSON missing 'links'"
    assert isinstance(data["links"], dict), "'links' should be a dictionary"

    links = data["links"]
    # Verify links to customer and finance sections exist and are non-empty strings
    assert "customer" in links, "'links' missing 'customer'"
    assert isinstance(links["customer"], str) and links["customer"], "'customer' link should be a non-empty string"
    assert "finance" in links, "'links' missing 'finance'"
    assert isinstance(links["finance"], str) and links["finance"], "'finance' link should be a non-empty string"

test_getdashboardwithvalidtoken()