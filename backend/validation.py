import re


EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PRODUCT_STATUSES = {"listed", "draft", "unlisted"}
LIFECYCLE_STATUSES = {"listed", "draft", "unlisted", "deleted"}
CATEGORIES = {"手镯", "吊坠", "戒面", "平安扣", "珠链", "手串", "无事牌", "耳坠", "挂件"}
LEAD_STATUSES = {"new", "contacted"}


class ValidationError(Exception):
    status = 400

    def __init__(self, message, details=None):
        super().__init__(message)
        self.details = details or []


def clean_text(value):
    return str(value or "").strip()


def normalize_email(value, label="email"):
    email = clean_text(value).lower()
    if not EMAIL_PATTERN.match(email):
        raise ValidationError(f"Invalid {label}", [{"field": label, "message": "请输入有效邮箱地址"}])
    return email


def validate_buyer_match_payload(body):
    need = clean_text(body.get("need"))
    details = []
    if not need:
        details.append({"field": "need", "message": "请输入要咨询的内容"})
    if len(need) > 240:
        details.append({"field": "need", "message": "需求不能超过 240 个字"})
    if details:
        raise ValidationError("Invalid buyer need", details)
    return {
        "sessionId": clean_text(body.get("sessionId")) or None,
        "need": need,
        "buyerEmail": normalize_email(body.get("buyerEmail"), "buyerEmail") if body.get("buyerEmail") else None,
    }


def validate_product_payload(body):
    title = clean_text(body.get("title"))
    category = clean_text(body.get("category"))
    try:
        price = int(float(body.get("price")))
    except (TypeError, ValueError):
        price = 0
    images = [clean_text(item) for item in body.get("images", []) if clean_text(item)] if isinstance(body.get("images"), list) else []
    tags = [clean_text(item) for item in body.get("tags", []) if clean_text(item)][:12] if isinstance(body.get("tags"), list) else []
    intro = clean_text(body.get("intro"))
    detail = clean_text(body.get("detail"))
    status = clean_text(body.get("status") or "listed")
    details = []

    if len(title) < 4 or len(title) > 80:
        details.append({"field": "title", "message": "商品标题需要 4 到 80 个字"})
    if category not in CATEGORIES:
        details.append({"field": "category", "message": "商品品类必须是手镯、吊坠、戒面、平安扣、珠链、手串、无事牌、耳坠或挂件"})
    if price < 100 or price > 5_000_000:
        details.append({"field": "price", "message": "价格需要在 100 到 5,000,000 元之间"})
    if status not in PRODUCT_STATUSES:
        details.append({"field": "status", "message": "商品状态不合法"})
    if not images:
        details.append({"field": "images", "message": "至少需要 1 张商品图片"})
    if len(images) > 6:
        details.append({"field": "images", "message": "商品图片最多 6 张"})
    if len(intro) < 8 or len(intro) > 160:
        details.append({"field": "intro", "message": "商品简介需要 8 到 160 个字"})
    if len(detail) < 20 or len(detail) > 1200:
        details.append({"field": "detail", "message": "商品详情需要 20 到 1200 个字"})
    if not tags:
        details.append({"field": "tags", "message": "至少需要 1 个检索标签"})
    if details:
        raise ValidationError("Invalid product", details)

    payload = dict(body)
    payload.update({"title": title, "category": category, "price": price, "images": images, "tags": tags, "intro": intro, "detail": detail, "status": status})
    return payload


def validate_product_status_payload(body):
    status = clean_text(body.get("status"))
    if status not in LIFECYCLE_STATUSES:
        raise ValidationError("Invalid product status", [{"field": "status", "message": "商品状态必须是已上架、草稿、已下架或已删除"}])
    return {"status": status}


def validate_lead_payload(body):
    try:
        product_id = int(body.get("productId"))
    except (TypeError, ValueError):
        product_id = 0
    buyer_need = clean_text(body.get("buyerNeed"))
    details = []
    if product_id <= 0:
        details.append({"field": "productId", "message": "商品 ID 不合法"})
    if len(buyer_need) < 4 or len(buyer_need) > 240:
        details.append({"field": "buyerNeed", "message": "咨询需求需要 4 到 240 个字"})
    if details:
        raise ValidationError("Invalid lead", details)
    return {
        "productId": product_id,
        "buyerEmail": normalize_email(body.get("buyerEmail"), "buyerEmail"),
        "buyerNeed": buyer_need,
        "source": clean_text(body.get("source")) or "product_detail",
    }


def validate_publish_payload(body):
    hint = clean_text(body.get("hint") or body.get("notes"))
    images = [clean_text(item) for item in body.get("images", []) if clean_text(item)] if isinstance(body.get("images"), list) else []
    details = []
    if len(hint) < 6 or len(hint) > 300:
        details.append({"field": "hint", "message": "发布描述需要 6 到 300 个字"})
    if not images:
        details.append({"field": "images", "message": "发布商品至少需要 1 张商家上传图片"})
    if details:
        raise ValidationError("Invalid publish request", details)
    payload = dict(body)
    payload.update({"hint": hint, "images": images})
    return payload


def validate_lead_status(value):
    if not value:
        return None
    status = clean_text(value)
    if status not in LEAD_STATUSES:
        raise ValidationError("Invalid lead status", [{"field": "status", "message": "客资状态不合法"}])
    return status


def validate_limit(value, fallback=20):
    try:
        limit = int(value or fallback)
    except (TypeError, ValueError):
        limit = fallback
    return min(max(limit, 1), 100)
