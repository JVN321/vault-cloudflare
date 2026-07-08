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

base_url = "https://api-us.faceplusplus.com/facepp/v3"
resp = requests.post(f"{base_url}/faceset/train", data={
    "api_key": api_key,
    "api_secret": api_secret,
    "outer_id": "VAULT_FACESET"
})
print(resp.json())
