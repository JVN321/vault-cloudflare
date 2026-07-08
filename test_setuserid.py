import requests

env_vars = {}
with open(".dev.vars", "r") as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#"):
            parts = line.split("=", 1)
            if len(parts) == 2:
                env_vars[parts[0]] = parts[1].strip('"').strip("'")

api_key = env_vars.get("FACEPLUSPLUS_API_KEY")
api_secret = env_vars.get("FACEPLUSPLUS_API_SECRET")

# Test getting face details to verify API is active
base_url = "https://api-us.faceplusplus.com/facepp/v3"
resp = requests.post(f"{base_url}/face/setuserid", data={
    "api_key": api_key,
    "api_secret": api_secret,
    "face_token": "bdb7a5a171b890842e52f4a19e3abab7",
    "user_id": "test_id"
})
print(resp.json())
