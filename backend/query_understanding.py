import re
import json
import os
import time
from urllib import request

from .db import list_products, list_query_concepts


def compact(values):
    result = []
    seen = set()
    for value in values:
        text = str(value or "").strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def normalize(text):
    return re.sub(r"[\s,，。.!！?？、；;：:（）()「」\"'“”]+", "", str(text or "").lower())


def grams(text):
    value = normalize(text)
    return {value[index:index + 2] for index in range(max(0, len(value) - 1))} | set(value)


def similarity(left, right):
    left_value = normalize(left)
    right_value = normalize(right)
    if not left_value or not right_value:
        return 0
    if left_value in right_value or right_value in left_value:
        return 1
    left_grams = grams(left_value)
    right_grams = grams(right_value)
    return len(left_grams & right_grams) / max(1, len(left_grams | right_grams))


def match_query_concepts(raw_text):
    text = str(raw_text or "")
    signals = []
    for concept in list_query_concepts():
        matched = []
        best = 0
        for synonym in concept["synonyms"]:
            if not synonym:
                continue
            score = 1 if synonym.lower() in text.lower() else similarity(text, synonym)
            if score >= 0.52:
                matched.append(synonym)
                best = max(best, score)
        if matched:
            signals.append({
                "type": concept["type"],
                "value": concept["value"],
                "label": concept["label"],
                "weight": concept["weight"],
                "matched": compact(matched),
                "productTerms": concept["productTerms"],
                "confidence": round(min(0.98, 0.6 + best * 0.35), 2),
                "source": "query_concepts",
            })
    return signals


def make_signal(type_name, value, label, weight, matched, product_terms, source, confidence=0.9):
    return {
        "type": type_name,
        "value": value,
        "label": label,
        "weight": weight,
        "matched": compact(matched),
        "productTerms": compact(product_terms),
        "confidence": confidence,
        "source": source,
    }


def catalog_facets():
    facets = {"category": {}, "water": {}, "color": {}, "shape": {}}
    products = list_products({"publicOnly": True})
    category_counts = {}
    for product in products:
        category_counts[product.get("category")] = category_counts.get(product.get("category"), 0) + 1
    for product in products:
        for field, key in [("category", "category"), ("water", "water"), ("color", "color"), ("shape", "shape")]:
            value = str(product.get(key) or "").strip()
            if not value:
                continue
            if field == "category" and category_counts.get(value, 0) < 2:
                continue
            bucket = facets[field].setdefault(value, set())
            bucket.add(value)
    return {field: {value: compact(terms) for value, terms in values.items()} for field, values in facets.items()}


COLOR_STEMS = {
    "蓝": ("蓝水", ["蓝水", "晴水", "蓝色"]),
    "紫": ("紫罗兰", ["紫罗兰", "春彩", "紫色"]),
    "绿": ("阳绿", ["阳绿", "正阳绿", "满绿", "辣绿", "飘绿", "帝王绿", "绿色"]),
    "白": ("白冰", ["白冰", "冰白", "无色", "白色"]),
    "黄": ("黄翡", ["黄翡", "黄色"]),
    "红": ("红翡", ["红翡", "红色"]),
    "黑": ("墨翠", ["墨翠", "黑色", "深色"]),
}


def stem_color_signals(raw_text, facets):
    text = str(raw_text or "")
    values = facets.get("color", {})
    signals = []
    for stem, (preferred, terms) in COLOR_STEMS.items():
        if stem not in text:
            continue
        available_terms = [term for term in terms if term in values or any(term in value or value in term for value in values)]
        if not available_terms:
            continue
        value = preferred if preferred in values else next((catalog_value for catalog_value in values if any(term in catalog_value or catalog_value in term for term in terms)), preferred)
        signals.append(make_signal("color", value, f"{stem}色系", 42, [stem], [*terms, *values.get(value, [])], "catalog_color_stem", 0.82))
    return signals


def facet_product_terms(field, value):
    if field == "color":
        return COLOR_STEMS.get(value[:1], (value, [value]))[1] if value[:1] in COLOR_STEMS else [value]
    return [value]


def match_catalog_facets(raw_text):
    text = str(raw_text or "")
    normalized = normalize(text)
    facets = catalog_facets()
    signals = []
    weights = {"category": 50, "color": 46, "water": 42, "shape": 36}
    for field, values in facets.items():
        for value, product_terms in values.items():
            candidates = compact([value, *product_terms])
            matched = []
            best = 0
            for term in candidates:
                term_value = normalize(term)
                if not term_value:
                    continue
                score = 1 if term_value in normalized else similarity(text, term)
                if term_value in normalized or (len(term_value) >= 3 and score >= 0.86):
                    matched.append(term)
                    best = max(best, score)
            if matched:
                signals.append(make_signal(field, value, value, weights[field], matched[:4], facet_product_terms(field, value), "catalog_facets", round(min(0.96, 0.56 + best * 0.36), 2)))
                break
    signals.extend(stem_color_signals(raw_text, facets))
    return signals


def parse_json_object(text):
    source = str(text or "").strip()
    if not source:
        return {}
    start = source.find("{")
    end = source.rfind("}")
    if start < 0 or end < start:
        return {}
    try:
        return json.loads(source[start:end + 1])
    except json.JSONDecodeError:
        return {}


def first_allowed(value, allowed_values):
    candidates = value if isinstance(value, list) else [value]
    for candidate in candidates:
        item = str(candidate or "").strip()
        if item in allowed_values:
            return item
    return ""


def has_category_cue(raw_text):
    return bool(re.search(r"手镯|镯|项链|颈链|脖子|挂坠|吊坠|挂件|耳|戒|指|牌|扣|珠链|手串|手链|手腕|戴脖子|脖子上戴|挂在", str(raw_text or "")))


def has_water_cue(raw_text):
    return bool(re.search(r"透明|通透|透|水润|水头|冰感|起光|起胶|种老|玻璃感", str(raw_text or "")))


def has_product_cue(raw_text):
    return bool(re.search(r"翡翠|预算|价格|价位|买|找|要|想要|推荐|戴|送|礼|自用|收藏|货", str(raw_text or "")))


def normalize_model_category(raw_text, value, allowed_categories):
    text = str(raw_text or "")
    if re.search(r"项链|颈链|链子", text) and "珠链" in allowed_categories:
        return "珠链"
    if re.search(r"脖子|颈|项坠|挂坠|戴脖子|脖子上戴", text) and "吊坠" in allowed_categories:
        return "吊坠"
    if re.search(r"手腕|手上戴|手链|手串", text) and value in {"挂件", "吊坠"} and "手串" in allowed_categories:
        return "手串"
    return value


def ollama_structured_signals(raw_text):
    provider = os.environ.get("QUERY_UNDERSTANDING_PROVIDER") or os.environ.get("AI_PROVIDER") or "auto"
    if provider == "off" or provider not in {"auto", "ollama"}:
        return []
    facets = catalog_facets()
    allowed = {field: sorted(values.keys()) for field, values in facets.items()}
    started = time.time()
    prompt = (
        "你是电商搜索 Query Understanding 模块。"
        "把用户翡翠需求归一到允许值，无法确定就留空。只返回 JSON。"
        f"允许品类={allowed['category']}；允许颜色={allowed['color']}；允许种水={allowed['water']}；允许器型={allowed['shape']}。"
        'JSON格式={"category":"","color":"","water":"","shape":"","terms":[]}'
        f"用户需求：{raw_text}"
    )
    try:
        payload = json.dumps({
            "model": os.environ.get("OLLAMA_MODEL") or os.environ.get("AI_MODEL") or "qwen2.5:7b",
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "format": "json",
        }).encode()
        req = request.Request(f"{os.environ.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11434')}/api/chat", data=payload, headers={"Content-Type": "application/json"})
        with request.urlopen(req, timeout=8) as response:
            data = json.loads(response.read().decode())
        parsed = parse_json_object((data.get("message") or {}).get("content"))
    except Exception:
        return []
    signals = []
    for field in ["category", "color", "water", "shape"]:
        value = first_allowed(parsed.get(field), allowed[field])
        if value:
            if field == "category" and not has_category_cue(raw_text):
                continue
            if field == "category":
                value = normalize_model_category(raw_text, value, allowed[field])
            signals.append(make_signal(field, value, value, 44, [value], facet_product_terms(field, value), "ollama_structured", round(min(0.92, 0.72 + max(0, 4 - (time.time() - started)) * 0.02), 2)))
    return signals


def dedupe_signals(signals):
    result = []
    seen = set()
    for signal in sorted(signals, key=lambda item: item.get("weight", 0), reverse=True):
        key = (signal["type"], signal["value"])
        if key in seen:
            continue
        seen.add(key)
        result.append(signal)
    return result


def concept_profile(signals):
    profile = {
        "category": "",
        "waterValue": "",
        "colorValue": "",
        "shapeValue": "",
        "price": "",
        "appearance": False,
        "quality": False,
        "water": False,
        "color": False,
        "clarity": False,
        "gift": False,
        "certificate": False,
        "openCategory": False,
        "labels": [],
        "queryTerms": [],
        "signals": signals,
    }
    for signal in signals:
        signal_type = signal["type"]
        value = signal["value"]
        label = signal["label"]
        if signal_type == "category" and not profile["category"]:
            profile["category"] = value
        if signal_type == "color" and not profile["colorValue"]:
            profile["colorValue"] = value
            profile["color"] = True
        if signal_type == "water" and not profile["waterValue"]:
            profile["waterValue"] = value
            profile["water"] = True
        if signal_type == "shape" and not profile["shapeValue"]:
            profile["shapeValue"] = value
        if signal_type == "price_tier" and not profile["price"]:
            profile["price"] = value
        if signal_type in {"style", "appearance"}:
            profile["appearance"] = True
        if signal_type in {"quality"} or value in {"collection", "collection_grade", "old_material"}:
            profile["quality"] = True
        if value in {"icy_translucent", "old_material"}:
            profile["water"] = True
        if value == "vivid_green":
            profile["color"] = True
        if value in {"clean_visual", "low_flaw"}:
            profile["clarity"] = True
        if signal_type == "occasion" and value not in {"daily_wear", "collection", "self_wear"}:
            profile["gift"] = True
        if value == "certified":
            profile["certificate"] = True
        profile["labels"].append(label)
        profile["queryTerms"].extend([label, *signal.get("productTerms", [])])
    profile["labels"] = compact(profile["labels"])
    profile["queryTerms"] = compact(profile["queryTerms"])
    return profile


def understand_query_concepts(raw_text):
    local_signals = dedupe_signals([
        *match_query_concepts(raw_text),
        *match_catalog_facets(raw_text),
    ])
    types = {signal["type"] for signal in local_signals}
    needs_model = (not local_signals and has_product_cue(raw_text)) or ("category" not in types and has_category_cue(raw_text)) or ("water" not in types and has_water_cue(raw_text))
    model_signals = ollama_structured_signals(raw_text) if needs_model or os.environ.get("QUERY_UNDERSTANDING_PROVIDER") == "ollama" else []
    signals = dedupe_signals([*local_signals, *model_signals])
    return {
        "signals": signals,
        "profile": concept_profile(signals),
        "terms": compact([item for signal in signals for item in [signal["label"], *signal.get("productTerms", [])]]),
        "confidence": round(max([signal["confidence"] for signal in signals] or [0]), 2),
    }
