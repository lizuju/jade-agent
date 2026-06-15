import json
import os
import secrets
import sqlite3
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "jade-agent.sqlite"


def connect():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


db = connect()


def encode(value):
    return json.dumps(value, ensure_ascii=False)


def decode(value, fallback):
    if value is None:
        return fallback
    try:
        parsed = json.loads(value)
        return fallback if parsed is None else parsed
    except (TypeError, json.JSONDecodeError):
        return fallback


def compact(values):
    result = []
    seen = set()
    for value in values:
        text = str(value or "").strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def execute_schema():
    db.executescript(
        """
CREATE TABLE IF NOT EXISTS sellers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  vip_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seller_sessions (
  token TEXT PRIMARY KEY,
  seller_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL,
  sku TEXT UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL,
  origin_price INTEGER,
  status TEXT NOT NULL,
  images_json TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  intro TEXT NOT NULL,
  detail TEXT NOT NULL,
  diameter TEXT,
  quality TEXT,
  material TEXT,
  jadeite_type TEXT,
  color TEXT,
  water TEXT,
  shape TEXT,
  size TEXT,
  weight TEXT,
  certificate TEXT,
  certificate_no TEXT,
  flaws TEXT,
  origin TEXT,
  treatment TEXT,
  inventory_count INTEGER DEFAULT 1,
  negotiable INTEGER DEFAULT 1,
  scene TEXT,
  upload_source TEXT,
  merchant_notes TEXT,
  search_keywords_json TEXT,
  specs_json TEXT,
  rag_text TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_need TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  contacted_at TEXT,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  user_email TEXT,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  agent_type TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT NOT NULL,
  trace_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
);

CREATE TABLE IF NOT EXISTS product_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  chunk_type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  embedding_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, chunk_type),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
CREATE TABLE IF NOT EXISTS query_concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 10,
  synonyms_json TEXT NOT NULL,
  product_terms_json TEXT NOT NULL,
  UNIQUE(type, value)
);
CREATE TABLE IF NOT EXISTS query_understanding_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  raw_text TEXT NOT NULL,
  mode TEXT NOT NULL,
  confidence REAL NOT NULL,
  signals_json TEXT NOT NULL,
  parsed_need_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_idx ON products(sku) WHERE sku IS NOT NULL;
"""
    )
    db.commit()


def product_keywords(product):
    return compact([
        product.get("title"),
        product.get("category"),
        product.get("quality"),
        product.get("water"),
        product.get("color"),
        product.get("shape"),
        product.get("size"),
        product.get("diameter"),
        product.get("material"),
        product.get("treatment"),
        product.get("scene"),
        product.get("certificate"),
        product.get("flaws"),
        *(product.get("tags") or []),
    ])


def product_rag_text(product):
    lines = [
        f"商品：{product.get('title')}",
        f"SKU：{product.get('sku') or '未设置'}",
        f"品类：{product.get('category')}",
        f"价格：{product.get('price')}元，原价：{product.get('originPrice') or product.get('price')}元",
        f"材质：{product.get('material') or '翡翠'}，处理方式：{product.get('treatment') or '天然A货'}",
        f"种水：{product.get('water') or product.get('quality') or ''}，颜色：{product.get('color') or ''}，器型：{product.get('shape') or ''}",
        f"尺寸：{product.get('size') or product.get('diameter') or ''}，重量：{product.get('weight') or '未称重'}",
        f"瑕疵：{product.get('flaws') or '以实物复检为准'}，证书：{product.get('certificate') or '可复检'}",
        f"适用场景：{product.get('scene') or '自用、送礼'}",
        f"标签：{'、'.join(product.get('tags') or [])}",
        f"简介：{product.get('intro')}",
        f"详情：{product.get('detail')}",
        f"商家备注：{product.get('merchantNotes') or ''}",
    ]
    return "\n".join(line for line in lines if not line.endswith("："))


def normalize_product(row):
    product = {
        "id": row["id"],
        "sellerId": row["seller_id"],
        "sellerEmail": row["seller_email"],
        "sellerName": row["seller_name"],
        "vipUntil": row["vip_until"],
        "sku": row["sku"],
        "title": row["title"],
        "category": row["category"],
        "price": row["price"],
        "originPrice": row["origin_price"],
        "status": row["status"],
        "images": decode(row["images_json"], []),
        "tags": decode(row["tags_json"], []),
        "intro": row["intro"],
        "detail": row["detail"],
        "diameter": row["diameter"],
        "quality": row["quality"],
        "material": row["material"],
        "jadeiteType": row["jadeite_type"],
        "color": row["color"],
        "water": row["water"],
        "shape": row["shape"],
        "size": row["size"],
        "weight": row["weight"],
        "certificate": row["certificate"],
        "certificateNo": row["certificate_no"],
        "flaws": row["flaws"],
        "origin": row["origin"],
        "treatment": row["treatment"],
        "inventoryCount": row["inventory_count"],
        "negotiable": bool(row["negotiable"]),
        "scene": row["scene"],
        "uploadSource": row["upload_source"],
        "merchantNotes": row["merchant_notes"],
        "searchKeywords": decode(row["search_keywords_json"], []),
        "specs": decode(row["specs_json"], {}),
        "ragText": row["rag_text"],
        "deletedAt": row["deleted_at"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }
    if not product["searchKeywords"]:
        product["searchKeywords"] = product_keywords(product)
    if not product["ragText"]:
        product["ragText"] = product_rag_text(product)
    return product


PRODUCT_SELECT = """
SELECT p.*, s.email AS seller_email, s.name AS seller_name, s.vip_until
FROM products p
JOIN sellers s ON s.id = p.seller_id
"""


def enrich_product(input_data):
    tags = input_data.get("tags") if isinstance(input_data.get("tags"), list) else []
    product = {
        "sellerId": input_data.get("sellerId"),
        "sku": input_data.get("sku"),
        "title": input_data.get("title"),
        "category": input_data.get("category"),
        "price": int(input_data.get("price")),
        "originPrice": int(input_data.get("originPrice") or input_data.get("price")),
        "status": input_data.get("status") or "listed",
        "images": input_data.get("images") if isinstance(input_data.get("images"), list) else [],
        "tags": tags,
        "intro": input_data.get("intro"),
        "detail": input_data.get("detail"),
        "diameter": input_data.get("diameter") or input_data.get("size"),
        "quality": input_data.get("quality") or input_data.get("water"),
        "material": input_data.get("material") or "翡翠",
        "jadeiteType": input_data.get("jadeiteType") or "缅甸翡翠",
        "color": input_data.get("color") or input_data.get("quality"),
        "water": input_data.get("water") or input_data.get("quality"),
        "shape": input_data.get("shape") or input_data.get("category"),
        "size": input_data.get("size") or input_data.get("diameter"),
        "weight": input_data.get("weight"),
        "certificate": input_data.get("certificate") or "支持复检",
        "certificateNo": input_data.get("certificateNo"),
        "flaws": input_data.get("flaws") or ("无纹裂" if "无纹裂" in tags else "以实物复检为准"),
        "origin": input_data.get("origin") or "云南瑞丽",
        "treatment": input_data.get("treatment") or "天然A货",
        "inventoryCount": input_data.get("inventoryCount") or 1,
        "negotiable": True if input_data.get("negotiable") is None else bool(input_data.get("negotiable")),
        "scene": input_data.get("scene") or ("送礼" if "送礼佳品" in tags else "自用/送礼"),
        "uploadSource": input_data.get("uploadSource") or "merchant_manual",
        "merchantNotes": input_data.get("merchantNotes") or "",
        "specs": input_data.get("specs") or {},
    }
    product["searchKeywords"] = input_data.get("searchKeywords") or product_keywords(product)
    product["ragText"] = input_data.get("ragText") or product_rag_text(product)
    return product


def insert_product(product):
    cur = db.execute(
        """
        INSERT INTO products (
          seller_id, sku, title, category, price, origin_price, status, images_json,
          tags_json, intro, detail, diameter, quality, material, jadeite_type, color,
          water, shape, size, weight, certificate, certificate_no, flaws, origin,
          treatment, inventory_count, negotiable, scene, upload_source, merchant_notes,
          search_keywords_json, specs_json, rag_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            product["sellerId"], product["sku"], product["title"], product["category"], product["price"], product["originPrice"],
            product["status"], encode(product["images"]), encode(product["tags"]), product["intro"], product["detail"],
            product["diameter"], product["quality"], product["material"], product["jadeiteType"], product["color"],
            product["water"], product["shape"], product["size"], product["weight"], product["certificate"],
            product["certificateNo"], product["flaws"], product["origin"], product["treatment"], product["inventoryCount"],
            1 if product["negotiable"] else 0, product["scene"], product["uploadSource"], product["merchantNotes"],
            encode(product["searchKeywords"]), encode(product["specs"]), product["ragText"],
        ),
    )
    db.commit()
    return cur.lastrowid


def upsert_product_document(product):
    db.execute(
        """
        INSERT INTO product_documents (product_id, chunk_type, content, metadata_json)
        VALUES (?, 'catalog_card', ?, ?)
        ON CONFLICT(product_id, chunk_type) DO UPDATE SET
          content = excluded.content,
          metadata_json = excluded.metadata_json,
          updated_at = CURRENT_TIMESTAMP
        """,
        (product["id"], product["ragText"], encode({
            "sku": product.get("sku"),
            "title": product["title"],
            "category": product["category"],
            "price": product["price"],
            "tags": product["tags"],
            "keywords": product["searchKeywords"],
            "status": product["status"],
        })),
    )
    db.commit()


def list_products(filter_data=None):
    filter_data = filter_data or {}
    rows = db.execute(f"{PRODUCT_SELECT} ORDER BY p.status = 'listed' DESC, p.updated_at DESC, p.id ASC").fetchall()
    products = [normalize_product(row) for row in rows]
    if filter_data.get("sellerId"):
        products = [p for p in products if p["sellerId"] == int(filter_data["sellerId"])]
    if not filter_data.get("includeDeleted") and filter_data.get("status") != "deleted":
        products = [p for p in products if p["status"] != "deleted"]
    if filter_data.get("publicOnly"):
        products = [p for p in products if p["status"] == "listed"]
    if filter_data.get("status"):
        products = [p for p in products if p["status"] == filter_data["status"]]
    return products


def get_product(product_id):
    row = db.execute(f"{PRODUCT_SELECT} WHERE p.id = ?", (product_id,)).fetchone()
    return normalize_product(row) if row else None


def create_product(input_data):
    product = enrich_product(input_data)
    product_id = insert_product(product)
    created = get_product(product_id)
    upsert_product_document(created)
    return created


def update_product(product_id, input_data, seller_id):
    product = enrich_product({**input_data, "sellerId": seller_id})
    cur = db.execute(
        """
        UPDATE products
        SET title = ?, category = ?, price = ?, origin_price = ?, status = ?,
            images_json = ?, tags_json = ?, intro = ?, detail = ?, diameter = ?,
            quality = ?, material = ?, jadeite_type = ?, color = ?, water = ?,
            shape = ?, size = ?, weight = ?, certificate = ?, certificate_no = ?,
            flaws = ?, origin = ?, treatment = ?, inventory_count = ?, negotiable = ?,
            scene = ?, upload_source = ?, merchant_notes = ?, search_keywords_json = ?,
            specs_json = ?, rag_text = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND seller_id = ?
        """,
        (
            product["title"], product["category"], product["price"], product["originPrice"], product["status"],
            encode(product["images"]), encode(product["tags"]), product["intro"], product["detail"], product["diameter"],
            product["quality"], product["material"], product["jadeiteType"], product["color"], product["water"],
            product["shape"], product["size"], product["weight"], product["certificate"], product["certificateNo"],
            product["flaws"], product["origin"], product["treatment"], product["inventoryCount"], 1 if product["negotiable"] else 0,
            product["scene"], product["uploadSource"], product["merchantNotes"], encode(product["searchKeywords"]),
            encode(product["specs"]), product["ragText"], product_id, seller_id,
        ),
    )
    db.commit()
    if cur.rowcount == 0:
        return None
    updated = get_product(product_id)
    upsert_product_document(updated)
    return updated


def update_product_status(product_id, seller_id, status):
    cur = db.execute(
        """
        UPDATE products
        SET status = ?,
            deleted_at = CASE WHEN ? = 'deleted' THEN CURRENT_TIMESTAMP ELSE NULL END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND seller_id = ?
        """,
        (status, status, product_id, seller_id),
    )
    db.commit()
    if cur.rowcount == 0:
        return None
    updated = get_product(product_id)
    if updated:
        upsert_product_document(updated)
    return updated


def delete_product(product_id, seller_id):
    return update_product_status(product_id, seller_id, "deleted")


def seller_json(row):
    if not row:
        return None
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "vip_until": row["vip_until"],
        "vipUntil": row["vip_until"],
        "created_at": row["created_at"],
        "createdAt": row["created_at"],
    }


def get_seller(email="seller@email.com"):
    row = db.execute("SELECT * FROM sellers WHERE email = ?", (email,)).fetchone()
    return seller_json(row)


def upsert_seller(email):
    existing = get_seller(email)
    if existing:
        return existing
    db.execute("INSERT INTO sellers (email, name) VALUES (?, ?)", (email, email.split("@")[0]))
    db.commit()
    return get_seller(email)


def create_seller_session(seller_id):
    token = secrets.token_hex(32)
    db.execute(
        "INSERT INTO seller_sessions (token, seller_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))",
        (token, seller_id),
    )
    db.commit()
    return token


def get_seller_by_token(token):
    if not token:
        return None
    row = db.execute(
        """
        SELECT s.*
        FROM seller_sessions ss
        JOIN sellers s ON s.id = ss.seller_id
        WHERE ss.token = ? AND ss.expires_at > CURRENT_TIMESTAMP
        """,
        (token,),
    ).fetchone()
    return seller_json(row)


def list_leads(seller_id=None, filter_data=None):
    filter_data = filter_data or {}
    rows = db.execute(
        """
        SELECT l.*, p.title AS product_title, p.price AS product_price, p.images_json,
               p.category AS product_category, p.status AS product_status, p.sku AS product_sku,
               p.intro AS product_intro,
               s.email AS seller_email, s.name AS seller_name
        FROM leads l
        JOIN products p ON p.id = l.product_id
        JOIN sellers s ON s.id = l.seller_id
        WHERE (? IS NULL OR l.seller_id = ?)
        ORDER BY l.created_at DESC, l.id DESC
        """,
        (seller_id, seller_id),
    ).fetchall()
    leads = [{
        "id": row["id"],
        "productId": row["product_id"],
        "sellerId": row["seller_id"],
        "buyerEmail": row["buyer_email"],
        "buyerNeed": row["buyer_need"],
        "source": row["source"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "contactedAt": row["contacted_at"],
        "productTitle": row["product_title"],
        "productPrice": row["product_price"],
        "productImage": (decode(row["images_json"], []) or [None])[0],
        "productCategory": row["product_category"],
        "productStatus": row["product_status"],
        "productSku": row["product_sku"],
        "productIntro": row["product_intro"],
        "sellerEmail": row["seller_email"],
        "sellerName": row["seller_name"],
    } for row in rows]
    if filter_data.get("status"):
        leads = [lead for lead in leads if lead["status"] == filter_data["status"]]
    return leads


def get_lead(lead_id):
    return next((lead for lead in list_leads() if lead["id"] == int(lead_id)), None)


def get_seller_lead(lead_id, seller_id):
    return next((lead for lead in list_leads(seller_id) if lead["id"] == int(lead_id)), None)


def create_lead(input_data):
    product = get_product(input_data["productId"])
    if not product or product["status"] != "listed":
        return None
    existing = db.execute(
        "SELECT id FROM leads WHERE product_id = ? AND buyer_email = ? AND buyer_need = ?",
        (input_data["productId"], input_data["buyerEmail"], input_data["buyerNeed"]),
    ).fetchone()
    if existing:
        return get_lead(existing["id"])
    cur = db.execute(
        "INSERT INTO leads (product_id, seller_id, buyer_email, buyer_need, source, status) VALUES (?, ?, ?, ?, ?, 'new')",
        (input_data["productId"], product["sellerId"], input_data["buyerEmail"], input_data["buyerNeed"], input_data["source"]),
    )
    db.commit()
    return get_lead(cur.lastrowid)


def mark_lead_contacted(lead_id, seller_id):
    cur = db.execute(
        "UPDATE leads SET status = 'contacted', contacted_at = CURRENT_TIMESTAMP WHERE id = ? AND seller_id = ?",
        (lead_id, seller_id),
    )
    db.commit()
    if cur.rowcount == 0:
        return None
    return get_seller_lead(lead_id, seller_id)


def search_terms_from_text(text):
    source = str(text or "").lower()
    domain_terms = [
        "翡翠",
        "手镯", "吊坠", "戒面", "平安扣", "珠链", "手串", "无事牌", "耳坠", "挂件",
        "豆种", "冰种", "冰糯", "糯冰", "糯种", "高冰", "玻璃种", "晴底", "晴水",
        "白冰", "飘花", "飘绿", "阳绿", "正阳绿", "满绿", "辣绿", "帝王绿", "蓝水",
        "紫罗兰", "春彩", "黄翡", "红翡", "油青", "墨翠", "正圈", "圆条", "贵妃",
        "佛公", "观音", "叶子", "葫芦", "蛋面", "素牌", "龙牌", "圆珠", "算盘珠",
        "无纹裂", "微瑕", "轻微棉絮", "少量石纹", "天然A货", "证书", "送礼", "自用", "收藏",
    ]
    terms = [term for term in domain_terms if term.lower() in source]
    for match in re_findall(r"[a-z0-9]+|[1-9]\d?(?:\.\d)?\s*(?:mm|圈口|圈)?", source):
        term = "".join(match.split())
        if not term.isdigit():
            terms.append(term.replace("圈口", "mm").replace("圈", "mm"))
    return compact(terms)


def re_findall(pattern, text):
    import re
    return re.findall(pattern, text, re.I)


def snippet_for(content, matched_terms):
    text = " ".join(str(content or "").split())
    first = next((term for term in matched_terms if term in text), None)
    if not first:
        return text[:96]
    index = max(0, text.find(first) - 28)
    return text[index:index + 118]


def search_product_documents(query="", terms=None, category=None, limit=20):
    query_terms = compact([*search_terms_from_text(query), *(terms or [])])
    products = {product["id"]: product for product in list_products({"publicOnly": True})}
    rows = db.execute(
        """
        SELECT d.product_id, d.chunk_type, d.content, d.metadata_json, p.status
        FROM product_documents d
        JOIN products p ON p.id = d.product_id
        WHERE p.deleted_at IS NULL AND p.status = 'listed'
        """
    ).fetchall()
    results = []
    for row in rows:
        product = products.get(row["product_id"])
        if not product:
            continue
        content = f"{row['content']}\n{row['metadata_json'] or '{}'}".lower()
        matched_terms = [term for term in query_terms if term.lower() in content]
        category_boost = 10 if category and product["category"] == category else 0
        tag_boost = len([tag for tag in product["tags"] if any(term in tag or tag in term for term in query_terms)]) * 4
        keyword_boost = len([kw for kw in product["searchKeywords"] if any(term in kw or kw in term for term in query_terms)]) * 3
        score = len(matched_terms) * 9 + category_boost + tag_boost + keyword_boost
        if score > 0:
            results.append({
                "productId": product["id"],
                "chunkType": row["chunk_type"],
                "score": score,
                "matchedTerms": matched_terms,
                "snippet": snippet_for(row["content"], matched_terms),
                "product": product,
            })
    return sorted(results, key=lambda item: item["score"], reverse=True)[:limit]


def get_or_create_session(session_id, type_name, user_email=None):
    row = db.execute("SELECT * FROM agent_sessions WHERE id = ?", (session_id,)).fetchone()
    if row:
        return row
    db.execute(
        "INSERT INTO agent_sessions (id, type, user_email, state_json) VALUES (?, ?, ?, ?)",
        (session_id, type_name, user_email, encode({})),
    )
    db.commit()
    return db.execute("SELECT * FROM agent_sessions WHERE id = ?", (session_id,)).fetchone()


def get_session_state(session):
    return decode(session["state_json"], {}) if session else {}


def update_session_state(session_id, state):
    db.execute("UPDATE agent_sessions SET state_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (encode(state), session_id))
    db.commit()


def add_message(session_id, role, content, metadata=None):
    db.execute(
        "INSERT INTO messages (session_id, role, content, metadata_json) VALUES (?, ?, ?, ?)",
        (session_id, role, content, encode(metadata or {})),
    )
    db.commit()


def record_agent_run(run):
    db.execute(
        """
        INSERT INTO agent_runs (id, session_id, agent_type, input_json, output_json, trace_json, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            run["id"], run.get("sessionId"), run["agentType"], encode(run.get("input", {})),
            encode(run.get("output", {})), encode(run.get("trace", [])), run["status"],
        ),
    )
    db.commit()


def list_agent_runs(filter_data=None):
    filter_data = filter_data or {}
    rows = db.execute("SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT ?", (filter_data.get("limit", 20),)).fetchall()
    runs = [{
        "id": row["id"],
        "sessionId": row["session_id"],
        "agentType": row["agent_type"],
        "input": decode(row["input_json"], {}),
        "output": decode(row["output_json"], {}),
        "trace": decode(row["trace_json"], []),
        "status": row["status"],
        "createdAt": row["created_at"],
    } for row in rows]
    if filter_data.get("sellerId"):
        seller_id = int(filter_data["sellerId"])
        runs = [run for run in runs if int(run["input"].get("sellerId") or run["output"].get("sellerId") or 0) == seller_id]
    return runs


def seed_query_concepts():
    concepts = [
        ("category", "手镯", "手镯", 50, ["手镯", "镯子", "玉镯", "翡翠镯", "翡翠手镯", "圆镯"], ["手镯", "正圈", "圆条", "贵妃"]),
        ("category", "吊坠", "吊坠", 50, ["吊坠", "坠子", "挂坠", "项坠", "链坠", "脖子上戴", "戴脖子", "脖子戴", "颈部佩戴", "佛公", "观音", "叶子", "如意", "葫芦"], ["吊坠", "水滴", "如意", "佛公", "观音", "叶子", "葫芦"]),
        ("category", "戒面", "戒面", 50, ["戒面", "戒指面", "蛋面", "裸石", "戒指主石", "戒指"], ["戒面", "蛋面", "马鞍", "随形"]),
        ("category", "平安扣", "平安扣", 50, ["平安扣", "怀古扣", "圆扣", "扣子"], ["平安扣", "圆扣", "怀古扣"]),
        ("category", "珠链", "珠链", 50, ["珠链", "项链", "翡翠项链", "颈链", "链子", "珠子项链"], ["珠链", "项链", "圆珠", "算盘珠"]),
        ("category", "手串", "手串", 50, ["手串", "手链", "串珠", "珠串", "手珠"], ["手串", "圆珠", "算盘珠"]),
        ("category", "无事牌", "无事牌", 50, ["无事牌", "牌子", "素牌", "山水牌", "龙牌"], ["无事牌", "素牌", "山水牌", "龙牌"]),
        ("category", "耳坠", "耳坠", 50, ["耳坠", "耳饰", "耳环", "耳钉"], ["耳坠", "水滴", "葫芦", "蛋面"]),
        ("category", "挂件", "挂件", 50, ["挂件", "挂饰", "车挂", "包挂"], ["挂件", "佛公", "观音", "如意", "叶子", "葫芦"]),
        ("color", "蓝水", "偏蓝色", 46, ["偏蓝色", "偏蓝", "蓝色", "蓝水", "蓝调", "冷色调", "蓝绿色", "蓝底"], ["蓝水", "蓝色", "晴水"]),
        ("color", "晴底", "晴底色", 44, ["晴底", "晴水", "晴底色", "淡晴", "晴色", "清爽底色"], ["晴底", "晴底色", "晴水"]),
        ("color", "白冰", "白冰", 42, ["白冰", "冰白", "白色", "无色", "干净白", "透明白"], ["白冰", "冰白", "玻璃种", "冰种"]),
        ("color", "飘绿", "飘绿", 42, ["飘绿", "带点绿", "一点绿", "有点绿", "绿花", "飘花带绿"], ["飘绿", "飘花", "阳绿"]),
        ("color", "阳绿", "阳绿", 44, ["阳绿", "绿色", "偏绿", "绿的", "鲜绿", "辣一点绿"], ["阳绿", "正阳绿", "满绿", "辣绿", "飘绿"]),
        ("color", "帝王绿", "帝王绿", 48, ["帝王绿", "顶级绿", "最好的绿", "浓绿", "满色高绿"], ["帝王绿", "正阳绿", "满绿"]),
        ("color", "紫罗兰", "紫罗兰", 40, ["紫罗兰", "紫色", "偏紫", "春色", "春彩"], ["紫罗兰", "春彩"]),
        ("color", "黄翡", "黄翡", 38, ["黄翡", "黄色", "偏黄", "金黄"], ["黄翡"]),
        ("color", "红翡", "红翡", 38, ["红翡", "红色", "偏红"], ["红翡"]),
        ("color", "墨翠", "墨翠", 38, ["墨翠", "黑色", "偏黑", "深色"], ["墨翠", "蓝水"]),
        ("water", "玻璃种", "玻璃种", 46, ["透明", "透明一点", "玻璃感", "很透", "特别透", "通透感强"], ["玻璃种", "高冰", "冰种"]),
        ("water", "高冰", "高冰", 44, ["高冰", "冰透", "冰感强", "透一点", "水头很好"], ["高冰", "冰种", "玻璃种"]),
        ("water", "冰种", "冰种", 42, ["冰种", "水润", "水头好", "通透", "清透", "有冰感"], ["冰种", "高冰", "玻璃种"]),
        ("price_tier", "premium", "高货", 42, ["最贵", "贵的", "高货", "预算不限", "不要便宜", "最高价", "价格高", "越贵越好"], ["玻璃种", "高冰", "帝王绿", "正阳绿", "满绿", "收藏", "精品货源", "起光", "起胶"]),
        ("price_tier", "lowest", "低价", 38, ["最便宜", "最低价", "价格最低", "越便宜越好", "便宜点"], ["豆种", "糯种", "入门", "自用"]),
        ("price_tier", "mid", "中等价位", 40, ["中等价格", "中等价位", "中等预算", "价格适中", "价位适中", "中端", "中档", "普通价位", "不要太贵也不要太便宜"], ["糯冰", "冰糯", "冰种", "日常佩戴", "自用"]),
        ("price_tier", "value", "性价比", 34, ["便宜", "实惠", "性价比", "划算", "入门", "低预算"], ["糯种", "糯冰", "自用", "入门"]),
        ("occasion", "elder_gift", "长辈送礼", 30, ["妈妈戴", "母亲戴", "长辈戴", "老人戴", "给老人", "送妈妈", "送母亲", "送长辈", "婆婆", "岳母"], ["送礼", "节日礼赠", "无纹裂", "证书", "复检", "天然A货", "正圈", "圆条"]),
        ("occasion", "gift", "送礼", 22, ["送礼", "礼物", "礼赠", "送人"], ["送礼", "节日礼赠", "证书", "复检", "天然A货"]),
        ("occasion", "self_wear", "自用", 16, ["自用", "自己戴", "自己佩戴", "日常自己戴"], ["自用", "日常佩戴", "通勤佩戴", "无纹裂"]),
        ("occasion", "partner_gift", "伴侣礼物", 24, ["送女朋友", "送老婆", "送太太", "纪念日", "生日礼物"], ["送礼", "节日礼赠", "冰种", "飘绿", "晴底", "水滴", "葫芦"]),
        ("occasion", "business_gift", "商务礼赠", 28, ["商务礼", "客户礼", "送客户", "体面", "拿得出手", "正式场合"], ["商务礼赠", "证书", "复检", "天然A货", "高冰", "玻璃种"]),
        ("occasion", "wedding_gift", "婚庆礼赠", 22, ["结婚", "婚礼", "订婚", "嫁妆", "婚庆"], ["婚庆礼赠", "春彩", "满绿", "正阳绿", "无纹裂"]),
        ("occasion", "daily_wear", "日常佩戴", 24, ["日常戴", "每天戴", "上班戴", "通勤", "百搭", "不挑衣服"], ["日常佩戴", "通勤佩戴", "自用", "正圈", "晴底", "白冰", "无纹裂"]),
        ("occasion", "collection", "收藏", 34, ["收藏", "传家", "保值", "升值", "藏品", "收藏级"], ["收藏", "玻璃种", "高冰", "帝王绿", "正阳绿", "满绿", "无纹裂"]),
        ("style", "understated", "低调耐看", 24, ["别太老气", "不要老气", "不老气", "别太张扬", "不要张扬", "低调", "素一点", "耐看"], ["晴底", "白冰", "蓝水", "素牌", "正圈", "日常佩戴"]),
        ("style", "young", "年轻清爽", 22, ["年轻", "显年轻", "清爽", "少女", "小清新"], ["晴底", "晴水", "白冰", "冰种", "水滴", "叶子", "葫芦"]),
        ("style", "elegant", "显气质", 24, ["气质", "优雅", "温润", "高级感", "显白"], ["冰种", "高冰", "晴底", "白冰", "飘花", "正圈"]),
        ("style", "bold", "存在感强", 18, ["大气", "显眼", "有存在感", "压得住场", "醒目"], ["满绿", "阳绿", "正阳绿", "帝王绿", "圆条", "商务礼赠"]),
        ("appearance", "clean_visual", "看起来干净", 30, ["干净一点", "看起来干净", "少棉", "少瑕疵", "不要脏", "底子干净", "清透"], ["无纹裂", "肉眼干净", "白冰", "晴底", "冰种", "高冰"]),
        ("appearance", "icy_translucent", "通透水润", 30, ["通透", "冰透", "水润", "水头好", "起光", "起胶", "透一点"], ["冰种", "高冰", "玻璃种", "起光", "起胶", "水润"]),
        ("appearance", "vivid_green", "绿色明显", 26, ["绿一点", "颜色明显", "色好", "色阳", "绿色多", "飘绿多"], ["飘绿", "阳绿", "正阳绿", "满绿", "帝王绿", "辣绿"]),
        ("appearance", "premium_look", "显贵", 32, ["显贵", "看着贵", "有档次", "高级", "贵气"], ["高冰", "玻璃种", "帝王绿", "正阳绿", "满绿", "起光", "收藏"]),
        ("appearance", "photogenic", "上镜", 18, ["拍照好看", "上镜", "直播好看", "视频好看"], ["冰种", "飘绿", "阳绿", "晴底", "水滴", "蛋面"]),
        ("quality", "low_flaw", "低瑕疵", 30, ["瑕疵少", "不能有裂", "不要裂", "不要纹", "只要无纹裂", "完美一点"], ["无纹裂", "无裂", "无纹", "肉眼干净", "证书"]),
        ("quality", "certified", "证书复检", 24, ["要证书", "带证书", "可复检", "保真", "天然A货", "a货"], ["证书", "复检", "天然A货"]),
        ("quality", "old_material", "种老", 18, ["种老", "老坑", "结构紧", "细腻"], ["高冰", "玻璃种", "冰种", "细腻", "起光"]),
    ]
    for concept in concepts:
        db.execute(
            """
            INSERT INTO query_concepts (type, value, label, weight, synonyms_json, product_terms_json)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(type, value) DO UPDATE SET
              label = excluded.label,
              weight = excluded.weight,
              synonyms_json = excluded.synonyms_json,
              product_terms_json = excluded.product_terms_json
            """,
            (concept[0], concept[1], concept[2], concept[3], encode(concept[4]), encode(concept[5])),
        )
    db.commit()


def list_query_concepts():
    rows = db.execute("SELECT * FROM query_concepts ORDER BY weight DESC, id ASC").fetchall()
    return [{
        "id": row["id"],
        "type": row["type"],
        "value": row["value"],
        "label": row["label"],
        "weight": row["weight"],
        "synonyms": decode(row["synonyms_json"], []),
        "productTerms": decode(row["product_terms_json"], []),
    } for row in rows]


def record_query_understanding_event(event):
    db.execute(
        """
        INSERT INTO query_understanding_events (session_id, raw_text, mode, confidence, signals_json, parsed_need_json)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            event.get("sessionId"),
            event["rawText"],
            event["mode"],
            float(event.get("confidence") or 0),
            encode(event.get("signals") or []),
            encode(event.get("parsedNeed") or {}),
        ),
    )
    db.commit()


def sync_product_documents():
    for product in list_products({}):
        upsert_product_document(product)


def seed_catalog_products(seller_id, count=299):
    categories = [
        ("手镯", ["正圈", "圆条", "贵妃"], ["52mm", "53mm", "54mm", "55mm", "56mm", "57mm", "58mm", "59mm"], 28000),
        ("吊坠", ["水滴", "如意", "佛公", "观音", "叶子", "葫芦"], ["24x14mm", "28x16mm", "32x18mm", "36x21mm", "42x24mm"], 10000),
        ("戒面", ["蛋面", "马鞍", "随形"], ["8x6mm", "10x8mm", "12x10mm", "14x11mm", "16x12mm"], 16000),
        ("平安扣", ["圆扣", "怀古扣"], ["18mm", "22mm", "26mm", "30mm", "34mm"], 9000),
        ("珠链", ["圆珠", "算盘珠"], ["6mm珠", "7mm珠", "8mm珠", "9mm珠", "10mm珠"], 24000),
        ("手串", ["圆珠", "算盘珠"], ["6mm珠", "7mm珠", "8mm珠", "9mm珠", "10mm珠"], 12000),
        ("无事牌", ["素牌", "龙牌", "山水牌"], ["32x18mm", "38x22mm", "45x25mm", "52x31mm"], 18000),
        ("耳坠", ["水滴", "葫芦", "蛋面"], ["8x6mm", "10x8mm", "12x9mm", "15x10mm"], 7000),
        ("挂件", ["佛公", "观音", "如意", "叶子", "葫芦"], ["26x15mm", "32x18mm", "38x22mm", "45x26mm"], 11000),
    ]
    waters = ["豆种", "糯种", "糯冰", "冰糯", "冰种", "高冰", "玻璃种"]
    colors = ["晴底", "晴水", "白冰", "飘花", "飘绿", "阳绿", "正阳绿", "满绿", "辣绿", "帝王绿", "蓝水", "紫罗兰", "春彩", "黄翡", "红翡", "油青", "墨翠"]
    flaws = ["无纹裂", "微瑕", "轻微棉絮", "少量石纹", "边缘细小矿点", "肉眼干净"]
    scenes = ["送礼", "自用", "日常佩戴", "收藏", "通勤佩戴", "节日礼赠", "婚庆礼赠", "商务礼赠"]
    water_price = {"豆种": 0.45, "糯种": 0.7, "糯冰": 0.95, "冰糯": 1.05, "冰种": 1.35, "高冰": 2.05, "玻璃种": 3.15}
    color_price = {"晴底": 1.08, "晴水": 1.12, "白冰": 1.05, "飘花": 1.2, "飘绿": 1.35, "阳绿": 1.9, "正阳绿": 2.6, "满绿": 3.2, "辣绿": 2.35, "帝王绿": 4.2, "蓝水": 1.3, "紫罗兰": 1.45, "春彩": 1.55, "黄翡": 1.18, "红翡": 1.28, "油青": 0.78, "墨翠": 1.75}
    flaw_price = {"无纹裂": 1.15, "肉眼干净": 1.1, "微瑕": 0.98, "轻微棉絮": 0.92, "少量石纹": 0.82, "边缘细小矿点": 0.88}
    products = []
    for index in range(count):
        category, shapes, sizes, base = categories[index % len(categories)]
        water = waters[(index + index // len(categories)) % len(waters)]
        color = colors[(index * 5 + index // 7) % len(colors)]
        shape = shapes[index % len(shapes)]
        size = sizes[(index + 2) % len(sizes)]
        flaw = flaws[(index + 3) % len(flaws)]
        scene = scenes[(index + 1) % len(scenes)]
        price = max(1800, round(base * water_price[water] * color_price[color] * flaw_price[flaw] / 100) * 100 + (index % 7) * 300)
        sku = f"JDAI-{index + 1:04d}"
        title = f"{water}{color}翡翠{shape}{category}"
        tags = compact([water, color, f"翡翠{category}", shape, size, flaw, "天然A货", "送礼佳品" if "礼" in scene else "自用"])
        products.append(enrich_product({
            "sellerId": seller_id,
            "sku": sku,
            "title": title,
            "category": category,
            "price": price,
            "originPrice": round(price * 1.08 / 100) * 100,
            "status": "listed",
            "images": [],
            "tags": tags,
            "intro": f"{water}{color}，{shape}{category}，{flaw}，适合{scene}。",
            "detail": f"{title}由商家手动录入，图片字段暂留空，等待真实商家上传。整体为{water}质地，{color}色调，{shape}器型，尺寸{size}。瑕疵说明：{flaw}；处理方式为天然A货，支持复检。适合{scene}，可用于后续 RAG 检索、预算匹配、标签召回和 Agent 推荐解释。",
            "diameter": size if category == "手镯" else None,
            "quality": f"{water}{color}",
            "color": color,
            "water": water,
            "shape": shape,
            "size": size,
            "flaws": flaw,
            "scene": scene,
            "uploadSource": "merchant_manual_simulated",
            "merchantNotes": f"模拟商家手动上传货源 {sku}。",
            "specs": {"source": "seeded_merchant_inventory", "imagePending": True},
        }))
    return products


def seed_database():
    execute_schema()
    seed_query_concepts()
    seller = get_seller("seller@email.com")
    if seller:
        seller_id = seller["id"]
    else:
        db.execute("INSERT INTO sellers (email, name, vip_until) VALUES (?, ?, ?)", ("seller@email.com", "晴翠严选", "2026-05-20"))
        db.commit()
        seller_id = get_seller("seller@email.com")["id"]

    count = db.execute("SELECT COUNT(*) AS count FROM products").fetchone()["count"]
    if count == 0:
        base_products = [
            ("冰种晴底翡翠手镯", "手镯", 48000, ["冰种", "晴底色", "翡翠手镯", "正圈", "55圈口", "无纹裂", "天然A货", "送礼佳品"], "冰种晴底，质地细腻通透，清新淡雅，佩戴显气质。", "本款冰种晴底翡翠手镯，种水达到冰种级别，底地细腻，通透如冰，底色清爽淡雅。手镯为正圈设计，圈口55mm，佩戴舒适贴合。无纹裂，结构稳定，适合日常佩戴或收藏。", "55mm", "冰种晴底", "listed"),
            ("冰种飘绿翡翠吊坠", "吊坠", 32000, ["冰种", "飘绿", "吊坠", "18K扣", "无纹裂", "天然A货"], "冰透起光，飘绿灵动，适合日常佩戴与礼赠。", "吊坠整体水润透亮，绿色集中自然，配18K扣头，尺寸适中。适合搭配金链或绳链，日常、宴会和礼赠场景均适配。", "32x18mm", "冰种飘绿", "listed"),
            ("冰种阳绿翡翠戒面", "戒面", 46800, ["阳绿", "戒面", "收藏级", "无纹裂", "天然A货"], "阳绿色辣，饱满起光，适合定制高端戒指。", "戒面颜色浓阳正匀，弧面饱满，起光明显，适合镶嵌为主石戒指或收藏裸石。", "12x10mm", "阳绿起光", "draft"),
            ("糯冰种翡翠手镯", "手镯", 18000, ["糯冰", "手镯", "正圈", "56圈口", "天然A货"], "糯冰质地，颜色沉稳，预算友好。", "适合入门佩戴，结构稳定，圈口56mm，整体质感清爽耐看。", "56mm", "糯冰", "unlisted"),
        ]
        for title, category, price, tags, intro, detail, diameter, quality, status in base_products:
            create_product({
                "sellerId": seller_id,
                "title": title,
                "category": category,
                "price": price,
                "originPrice": round(price * 1.08 / 100) * 100,
                "status": status,
                "images": [],
                "tags": tags,
                "intro": intro,
                "detail": detail,
                "diameter": diameter,
                "quality": quality,
            })

    for product in seed_catalog_products(seller_id):
        existing = db.execute("SELECT id FROM products WHERE sku = ?", (product["sku"],)).fetchone()
        if existing:
            update_product(existing["id"], product, seller_id)
        else:
            insert_product(product)

    premium = enrich_product({
        "sellerId": seller_id,
        "sku": "JDAI-PREMIUM-0001",
        "title": "玻璃种帝王绿翡翠正圈手镯",
        "category": "手镯",
        "price": 98000,
        "originPrice": 108000,
        "status": "listed",
        "images": [],
        "tags": ["玻璃种", "帝王绿", "翡翠手镯", "正圈", "55mm", "微瑕", "天然A货", "精品货源", "收藏"],
        "intro": "玻璃种帝王绿，正圈55mm，预算10万内的高端手镯货源。",
        "detail": "商家手动上传的高端翡翠手镯货源。整体为玻璃种质地，帝王绿色调，正圈器型，圈口55mm。瑕疵说明为轻微棉絮，肉眼观感干净，处理方式为天然A货，支持复检。适合自用、收藏和高端礼赠，可用于 RAG 检索、预算贴近排序和 Agent 推荐解释。",
        "diameter": "55mm",
        "quality": "玻璃种帝王绿",
        "color": "帝王绿",
        "water": "玻璃种",
        "shape": "正圈",
        "size": "55mm",
        "flaws": "轻微棉絮",
        "scene": "自用/收藏/送礼",
        "uploadSource": "merchant_manual_simulated",
        "merchantNotes": "模拟商家手动上传的10万级帝王绿手镯。",
    })
    existing_premium = db.execute("SELECT id FROM products WHERE sku = ?", (premium["sku"],)).fetchone()
    if existing_premium:
        update_product(existing_premium["id"], premium, seller_id)
    else:
        insert_product(premium)

    sync_product_documents()

    if db.execute("SELECT COUNT(*) AS count FROM leads").fetchone()["count"] == 0:
        products = list_products({})
        examples = [
            (products[0]["id"], "buyer1@email.com", "预算5万左右，冰种手镯，55圈口，无纹裂，送长辈", "new", "2026-05-20 10:30:00"),
            (products[1]["id"], "buyer2@email.com", "送礼用，冰种飘绿吊坠，希望带证书", "contacted", "2026-05-19 15:20:00"),
            (products[2]["id"], "buyer3@email.com", "冰种阳绿戒面，预算2万到5万", "new", "2026-05-18 09:10:00"),
        ]
        for product_id, email, need, status, created_at in examples:
            db.execute(
                "INSERT INTO leads (product_id, seller_id, buyer_email, buyer_need, source, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (product_id, seller_id, email, need, "buyer_agent", status, created_at),
            )
        db.commit()


execute_schema()
seed_database()
