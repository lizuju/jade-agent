import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "http://127.0.0.1:8877"


def request_json(method, path, body=None, token=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(f"{BASE_URL}{path}", data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=20) as response:
            payload = response.read().decode("utf-8")
            return response.status, json.loads(payload or "{}")
    except HTTPError as error:
        payload = error.read().decode("utf-8")
        return error.code, json.loads(payload or "{}")


@pytest.fixture(scope="session")
def api_server():
    env = os.environ.copy()
    env.update({
        "PORT": "8877",
        "NODE_ENV": "test",
        "DEV_OTP_CODE": "123456",
        "QUERY_UNDERSTANDING_PROVIDER": "off",
        "OLLAMA_VISION_MODEL": "",
    })
    python = ROOT / ".venv" / "bin" / "python"
    cmd = [str(python if python.exists() else sys.executable), "-u", "-m", "backend.app"]
    proc = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                status, payload = request_json("GET", "/api/health")
                if status == 200 and payload.get("ok"):
                    break
            except Exception:
                time.sleep(0.2)
        else:
            out, err = proc.communicate(timeout=1)
            raise RuntimeError(f"API server did not start\nSTDOUT:\n{out}\nSTDERR:\n{err}")
        yield
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def login_token(email="seller@email.com"):
    status, payload = request_json("POST", "/api/auth/otp", {"email": email})
    assert status == 200
    assert payload["code"] == "123456"
    status, payload = request_json("POST", "/api/auth/login", {"email": email, "code": "123456"})
    assert status == 200
    return payload["token"]


def test_health_and_public_state(api_server):
    status, payload = request_json("GET", "/api/health")
    assert status == 200
    assert payload == {"ok": True, "runtime": "python"}

    status, payload = request_json("GET", "/api/app-state")
    assert status == 200
    assert payload["seller"] is None
    assert payload["metrics"]["productQuota"] == 1000
    assert payload["metrics"]["listedProducts"] > 0


def test_buyer_match_uses_agent_retrieval(api_server):
    status, payload = request_json("POST", "/api/agent/buyer-match", {
        "need": "冰种平安扣 预算2万 无纹无裂",
        "buyerEmail": "buyer1@email.com",
        "sessionId": "pytest-buyer-match",
    })
    assert status == 200
    assert payload["mode"] == "match"
    assert payload["parsedNeed"]["category"] == "平安扣"
    assert payload["parsedNeed"]["budget"] == 20000
    assert payload["products"]
    assert payload["products"][0]["category"] == "平安扣"


def test_general_chat_routes_to_customer_service(api_server):
    status, payload = request_json("POST", "/api/agent/buyer-match", {
        "need": "你好",
        "buyerEmail": "buyer1@email.com",
        "sessionId": "pytest-customer-service",
    })
    assert status == 200
    assert payload["mode"] == "customer_service"
    assert payload["products"] == []
    assert "翡翠" in payload["reply"]


def test_auth_and_publish_boundaries(api_server):
    status, payload = request_json("POST", "/api/agent/publish", {"images": []})
    assert status == 401
    assert payload["error"] == "Unauthorized"

    token = login_token()
    status, payload = request_json("POST", "/api/agent/publish", {"images": []}, token=token)
    assert status == 400
    assert payload["details"][0]["field"] == "images"
