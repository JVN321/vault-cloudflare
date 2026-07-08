import os
import requests
import time

def parse_env_file(filepath):
    env_vars = {}
    with open(filepath, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                parts = line.split('=', 1)
                if len(parts) == 2:
                    env_vars[parts[0]] = parts[1].strip('"').strip("'")
    return env_vars

def main():
    env = parse_env_file('.dev.vars')
    api_key = env.get('FACEPLUSPLUS_API_KEY')
    api_secret = env.get('FACEPLUSPLUS_API_SECRET')
    
    if not api_key or not api_secret:
        print("Error: FACEPLUSPLUS_API_KEY or FACEPLUSPLUS_API_SECRET not found in .dev.vars")
        return

    base_url = "https://api-us.faceplusplus.com/facepp/v3"
    
    print("Fetching facesets...")
    resp = requests.post(f"{base_url}/faceset/getfacesets", data={
        "api_key": api_key,
        "api_secret": api_secret
    })
    
    data = resp.json()
    if 'error_message' in data:
        print("Error fetching facesets:", data['error_message'])
        return
        
    facesets = data.get('facesets', [])
    print(f"Found {len(facesets)} facesets.")
    
    for fs in facesets:
        outer_id = fs.get('outer_id')
        faceset_token = fs.get('faceset_token')
        print(f"\nFaceset: {outer_id or faceset_token} (Display Name: {fs.get('display_name', 'N/A')})")
        
        time.sleep(1.5)
        detail_resp = requests.post(f"{base_url}/faceset/getdetail", data={
            "api_key": api_key,
            "api_secret": api_secret,
            "faceset_token": faceset_token
        })
        
        detail_data = detail_resp.json()
        if 'error_message' in detail_data:
            print(f"  Error fetching details: {detail_data['error_message']}")
            continue
            
        face_tokens = detail_data.get('face_tokens', [])
        print(f"  Total faces: {detail_data.get('face_count', 0)}")
        for token in face_tokens:
            time.sleep(1.5)
            face_detail = requests.post(f"{base_url}/face/getdetail", data={
                "api_key": api_key,
                "api_secret": api_secret,
                "face_token": token
            }).json()
            user_id = face_detail.get('user_id', '')
            print(f"  - Face Token: {token} (user_id: '{user_id}')")

if __name__ == '__main__':
    main()
