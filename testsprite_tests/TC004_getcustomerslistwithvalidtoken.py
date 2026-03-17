import requests

BASE_URL = "http://localhost:5173"
TIMEOUT = 30

def test_get_customers_list_with_valid_token():
    # Placeholder for a valid token; replace with a real token when running tests
    valid_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ValidTokenPlaceholder"

    url = f"{BASE_URL}/customers"
    headers = {
        "Authorization": f"Bearer {valid_token}"
    }

    try:
        response = requests.get(url, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

    assert response.status_code == 200, f"Expected status code 200, got {response.status_code}"

    content_type = response.headers.get('Content-Type', '')
    assert 'application/json' in content_type.lower(), f"Expected 'application/json' content type, got '{content_type}'"

    try:
        data = response.json()
    except ValueError:
        assert False, "Response is not valid JSON"

    # Accepting either a list (old test) or a dict containing a list of customers
    if isinstance(data, list):
        # Old behavior, directly a list
        assert all(isinstance(cust, dict) for cust in data), "Not all items in the customers list are dicts"
    elif isinstance(data, dict):
        # Expecting a key 'customers' with a list
        assert 'customers' in data, "Response JSON object missing 'customers' key"
        assert isinstance(data['customers'], list), f"Expected 'customers' to be a list, got {type(data['customers'])}"
    else:
        assert False, f"Unexpected response JSON type: {type(data)}"


test_get_customers_list_with_valid_token()