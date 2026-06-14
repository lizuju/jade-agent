import base64
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .agent import run_buyer_match_agent, run_lead_followup_agent, run_publish_agent
from .db import (
    create_lead,
    create_product,
    create_seller_session,
    delete_product,
    get_product,
    get_seller_by_token,
    get_seller_lead,
    list_agent_runs,
    list_leads,
    list_products,
    mark_lead_contacted,
    seed_database,
    update_product,
    update_product_status,
    upsert_seller,
)
from .validation import (
    ValidationError,
    normalize_email,
    validate_buyer_match_payload,
    validate_lead_payload,
    validate_lead_status,
    validate_limit,
    validate_product_payload,
    validate_product_status_payload,
    validate_publish_payload,
)


ROOT_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = ROOT_DIR / "public" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DEV_OTP_CODE = os.environ.get("DEV_OTP_CODE", "123456")


def redact_error(error):
    return re.sub(r"sk-[A-Za-z0-9_*.-]+", "[REDACTED_SECRET]", str(error))[:300]


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "JadePythonAPI/0.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")

    def json_response(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def html_response(self, body, status=200):
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_cors()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def serve_upload(self, path):
        relative = path.removeprefix("/uploads/").strip("/")
        file_path = (UPLOAD_DIR / relative).resolve()
        if not str(file_path).startswith(str(UPLOAD_DIR.resolve())) or not file_path.exists():
            self.json_response({"error": "Not found"}, 404)
            return
        data = file_path.read_bytes()
        content_type = "image/png" if file_path.suffix == ".png" else "image/jpeg" if file_path.suffix in {".jpg", ".jpeg"} else "image/webp"
        self.send_response(200)
        self.send_cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or "0")
        if not length:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def bearer_token(self):
        header = self.headers.get("Authorization") or ""
        return header[7:] if header.startswith("Bearer ") else None

    def optional_seller(self):
        return get_seller_by_token(self.bearer_token())

    def require_seller(self):
        seller = self.optional_seller()
        if not seller:
            raise PermissionError("Unauthorized")
        return seller

    def handle_error(self, error):
        if isinstance(error, ValidationError):
            self.json_response({"error": str(error), "details": error.details}, error.status)
            return
        if isinstance(error, PermissionError):
            self.json_response({"error": "Unauthorized"}, 401)
            return
        if isinstance(error, ValueError) and str(error) == "Lead not found":
            self.json_response({"error": "Lead not found"}, 404)
            return
        request_id = hex(int(time.time() * 1000000))[2:]
        print(f"{request_id} {type(error).__name__}: {redact_error(error)}", file=sys.stderr)
        self.json_response({"error": "Internal server error", "requestId": request_id}, 500)

    def route(self, method):
        parsed = urlparse(self.path)
        path = parsed.path
        query = {key: values[-1] for key, values in parse_qs(parsed.query).items()}

        if method == "GET" and path.startswith("/uploads/"):
            self.serve_upload(path)
            return

        if method == "GET" and path == "/":
            self.html_response("""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI翡翠匹配 Python API</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; background: #edf3ef; color: #17211b; }
      main { width: min(520px, calc(100vw - 32px)); padding: 28px; border-radius: 12px; background: #fff; box-shadow: 0 24px 80px rgba(21, 45, 34, .14); }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p { margin: 0 0 18px; color: #60766b; line-height: 1.6; }
      a { display: flex; justify-content: space-between; padding: 14px 16px; margin-top: 10px; border-radius: 8px; background: #f4f8f5; color: #087243; font-weight: 800; text-decoration: none; }
      a.primary { background: #07874f; color: #fff; }
      small { display: block; margin-top: 16px; color: #71837a; }
    </style>
  </head>
  <body>
    <main>
      <h1>AI翡翠匹配 Python API 正在运行</h1>
      <p>8787 是 Python 后端接口端口；产品网页请打开前端服务。</p>
      <a class="primary" href="http://127.0.0.1:5173/#buyer">买家网页 <span>AI聊天找货</span></a>
      <a href="http://127.0.0.1:5173/#merchant">商家网页 <span>后台与客资</span></a>
      <a href="/api/health">API健康检查 <span>/api/health</span></a>
      <small>后端地址：http://127.0.0.1:8787</small>
    </main>
  </body>
</html>""")
            return

        if method == "GET" and path == "/api/health":
            self.json_response({"ok": True, "runtime": "python"})
            return

        if method == "GET" and path == "/api/app-state":
            seller = self.optional_seller()
            products = list_products({"sellerId": seller["id"], "includeDeleted": True} if seller else {"publicOnly": True})
            leads = list_leads(seller["id"]) if seller else []
            active_products = [product for product in products if product["status"] != "deleted"]
            self.json_response({
                "seller": seller,
                "products": products,
                "leads": leads,
                "metrics": {
                    "listedProducts": len([product for product in products if product["status"] == "listed"]),
                    "productQuota": 100,
                    "todayLeads": len([lead for lead in leads if str(lead["createdAt"]).startswith("2026-05-20")]),
                    "totalLeads": len(leads) + 125,
                    "managedProducts": len(active_products),
                    "deletedProducts": len(products) - len(active_products),
                },
            })
            return

        if method == "GET" and path == "/api/products":
            seller = self.optional_seller()
            self.json_response({"products": list_products({"status": query.get("status"), "sellerId": seller["id"] if seller else None, "publicOnly": not bool(seller)})})
            return

        product_match = re.match(r"^/api/products/(\d+)$", path)
        product_status_match = re.match(r"^/api/products/(\d+)/status$", path)
        if product_match and method == "GET":
            seller = self.optional_seller()
            product = get_product(product_match.group(1))
            if not product or (product["status"] != "listed" and product["sellerId"] != (seller or {}).get("id")):
                self.json_response({"error": "Product not found"}, 404)
                return
            self.json_response({"product": product})
            return

        if method == "POST" and path == "/api/products":
            seller = self.require_seller()
            product = create_product({**validate_product_payload(self.read_json()), "sellerId": seller["id"]})
            self.json_response({"product": product}, 201)
            return

        if method == "POST" and path == "/api/uploads/images":
            self.require_seller()
            files = self.read_json().get("files") or []
            if not files:
                raise ValidationError("Invalid upload", [{"field": "images", "message": "请选择要上传的商品图片"}])
            self.json_response({"images": [self.save_uploaded_image(file) for file in files[:6]]}, 201)
            return

        if product_match and method == "PUT":
            seller = self.require_seller()
            product = update_product(product_match.group(1), validate_product_payload(self.read_json()), seller["id"])
            if not product:
                self.json_response({"error": "Product not found"}, 404)
                return
            self.json_response({"product": product})
            return

        if product_status_match and method == "PATCH":
            seller = self.require_seller()
            status = validate_product_status_payload(self.read_json())["status"]
            product = update_product_status(product_status_match.group(1), seller["id"], status)
            if not product:
                self.json_response({"error": "Product not found"}, 404)
                return
            self.json_response({"product": product})
            return

        if product_match and method == "DELETE":
            seller = self.require_seller()
            product = delete_product(product_match.group(1), seller["id"])
            if not product:
                self.json_response({"error": "Product not found"}, 404)
                return
            self.json_response({"product": product})
            return

        if method == "GET" and path == "/api/leads":
            seller = self.require_seller()
            self.json_response({"leads": list_leads(seller["id"], {"status": validate_lead_status(query.get("status"))})})
            return

        lead_match = re.match(r"^/api/leads/(\d+)$", path)
        lead_contact_match = re.match(r"^/api/leads/(\d+)/contacted$", path)
        if lead_match and method == "GET":
            seller = self.require_seller()
            lead = get_seller_lead(lead_match.group(1), seller["id"])
            if not lead:
                self.json_response({"error": "Lead not found"}, 404)
                return
            self.json_response({"lead": lead})
            return

        if method == "POST" and path == "/api/leads":
            lead = create_lead(validate_lead_payload(self.read_json()))
            if not lead:
                self.json_response({"error": "Product not found"}, 404)
                return
            self.json_response({"lead": lead}, 201)
            return

        if lead_contact_match and method == "POST":
            seller = self.require_seller()
            lead = mark_lead_contacted(lead_contact_match.group(1), seller["id"])
            if not lead:
                self.json_response({"error": "Lead not found"}, 404)
                return
            self.json_response({"lead": lead})
            return

        if method == "POST" and path == "/api/auth/otp":
            email = normalize_email(self.read_json().get("email"))
            seller = upsert_seller(email)
            self.json_response({"ok": True, "seller": seller, "code": None if os.environ.get("NODE_ENV") == "production" else DEV_OTP_CODE})
            return

        if method == "POST" and path == "/api/auth/login":
            body = self.read_json()
            email = normalize_email(body.get("email"))
            if str(body.get("code") or "") != DEV_OTP_CODE:
                self.json_response({"error": "Invalid code"}, 401)
                return
            seller = upsert_seller(email)
            self.json_response({"seller": seller, "token": create_seller_session(seller["id"])})
            return

        if method == "GET" and path == "/api/auth/me":
            self.json_response({"seller": self.require_seller()})
            return

        if method == "GET" and path == "/api/agent/capabilities":
            self.json_response({
                "buyerMatch": ["frontend_need_validation", "backend_payload_validation", "python_agent_pipeline_orchestration", "deterministic_intent_routing", "session_context_refinement", "multi_dimensional_preference_profile", "semantic_need_recognition", "rule_validation", "product_documents_rag_retrieval", "semantic_rule_rag_ranking", "traceable_agent_runs"],
                "merchantPublish": ["frontend_product_validation", "backend_product_validation", "python_local_draft_generation", "merchant_uploaded_images", "product_document_indexing"],
                "leadFollowup": ["lead_authorization_check", "buyer_need_summary", "followup_copy_generation", "next_action_generation", "traceable_agent_runs"],
            })
            return

        if method == "POST" and path == "/api/account/renewal":
            seller = self.require_seller()
            self.json_response({"ok": True, "seller": seller, "message": "已提交续费咨询，运营将在1个工作日内联系您。"})
            return

        if method == "POST" and path == "/api/agent/buyer-match":
            self.json_response(run_buyer_match_agent(validate_buyer_match_payload(self.read_json())))
            return

        if method == "POST" and path == "/api/agent/publish":
            seller = self.require_seller()
            self.json_response(run_publish_agent({**validate_publish_payload(self.read_json()), "sellerId": seller["id"]}))
            return

        if method == "GET" and path == "/api/agent/runs":
            seller = self.require_seller()
            self.json_response({"runs": list_agent_runs({"sellerId": seller["id"], "limit": validate_limit(query.get("limit"), 20)})})
            return

        followup_match = re.match(r"^/api/agent/leads/(\d+)/followup$", path)
        if followup_match and method == "POST":
            seller = self.require_seller()
            self.json_response(run_lead_followup_agent({"sellerId": seller["id"], "leadId": followup_match.group(1)}))
            return

        self.json_response({"error": "Not found"}, 404)

    def save_uploaded_image(self, file):
        data_url = str(file.get("dataUrl") or "")
        match = re.match(r"^data:(image/(?:png|jpeg|jpg|webp));base64,(.+)$", data_url)
        if not match:
            raise ValidationError("Invalid upload", [{"field": "images", "message": "只支持 png、jpg、jpeg 或 webp 图片"}])
        ext = match.group(1).split("/")[1].replace("jpeg", "jpg")
        filename = f"{int(time.time() * 1000)}-{os.urandom(5).hex()}.{ext}"
        (UPLOAD_DIR / filename).write_bytes(base64.b64decode(match.group(2)))
        return f"/uploads/{filename}"

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        try:
            self.route("GET")
        except Exception as error:
            self.handle_error(error)

    def do_POST(self):
        try:
            self.route("POST")
        except Exception as error:
            self.handle_error(error)

    def do_PUT(self):
        try:
            self.route("PUT")
        except Exception as error:
            self.handle_error(error)

    def do_PATCH(self):
        try:
            self.route("PATCH")
        except Exception as error:
            self.handle_error(error)

    def do_DELETE(self):
        try:
            self.route("DELETE")
        except Exception as error:
            self.handle_error(error)


def main():
    if "--seed-only" in sys.argv:
        seed_database()
        print("Database seeded by Python backend")
        return
    port = int(os.environ.get("PORT") or "8787")
    server = ThreadingHTTPServer(("127.0.0.1", port), ApiHandler)
    print(f"Jade Python API listening on http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
