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
        "VECTOR_STORE": "sqlite",
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


def test_vector_embedding_is_stable():
    from backend.vector_store import hash_embedding

    first = hash_embedding("冰种晴底翡翠手镯", dim=32)
    second = hash_embedding("冰种晴底翡翠手镯", dim=32)
    assert len(first) == 32
    assert first == second
    assert sum(abs(value) for value in first) > 0


def test_product_document_search_merges_vector_hits(monkeypatch):
    from backend import db as dbm

    monkeypatch.setenv("VECTOR_STORE", "sqlite")
    dbm.seed_database()
    product = next(item for item in dbm.list_products({"publicOnly": True}) if item["category"] == "手镯")
    monkeypatch.setattr(dbm, "search_product_vectors", lambda **kwargs: [{
        "productId": product["id"],
        "chunkType": "catalog_card",
        "content": product["ragText"],
        "metadata": {"status": "listed", "category": product["category"]},
        "vectorScore": 0.91,
    }])

    docs = dbm.search_product_documents(query=product["title"], terms=product["searchKeywords"], category=product["category"], limit=3)

    assert docs[0]["productId"] == product["id"]
    assert docs[0]["source"] == "milvus_hybrid"
    assert docs[0]["vectorScore"] == 0.91


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


def test_publish_rejects_mixed_image_set(monkeypatch):
    from backend import agent
    from backend.validation import ValidationError

    monkeypatch.setattr(agent, "ollama_vision_understanding", lambda images: {
        "isJade": True,
        "sameItem": False,
        "mismatchReason": "一张是手镯，另一张是吊坠",
        "confidence": 88,
    })

    with pytest.raises(ValidationError) as error:
        agent.publish_image_understanding("", ["/uploads/a.jpg", "/uploads/b.jpg"], [{}, {}])

    assert error.value.details[0]["field"] == "images"
    assert "不是同一个翡翠商品" in error.value.details[0]["message"]


def test_publish_tags_use_image_facts(monkeypatch):
    from backend import agent

    monkeypatch.setattr(agent, "ollama_vision_understanding", lambda images: {
        "isJade": True,
        "sameItem": True,
        "category": "戒指",
        "water": "糯种",
        "color": "翠绿",
        "shape": "方形",
        "visible_flaws": "图片未见明显瑕疵",
        "flaw": "图片未见明显瑕疵",
        "confidence": 92,
        "subject": "方形主石",
        "useForm": "镶嵌戒指",
        "motifs": [],
        "isWearable": True,
        "hasBase": False,
        "evidence": ["方形翠绿主石", "银色金属戒托", "镶嵌结构"],
        "model": "fake-vlm",
    })
    monkeypatch.setattr(agent, "ollama_vision_category", lambda images: {
        "category": "戒指",
        "shape": "方形",
        "evidence": ["金属戒托"],
    })

    vision = agent.publish_image_understanding("", ["/uploads/ring.jpg", "/uploads/ring-detail.jpg"], [{}, {}])
    draft = agent.local_draft("", ["/uploads/ring.jpg", "/uploads/ring-detail.jpg"], [{}, {}], vision)

    assert draft["vision"]["sameItem"] is True
    assert "翡翠戒指" in draft["tags"]
    assert "方形主石" in draft["tags"]
    assert "金属戒托" in draft["tags"]
    assert "天然A货" not in draft["tags"]
    assert "支持复检" not in draft["tags"]
