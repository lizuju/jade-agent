import re
import time
import uuid
from urllib import request
import json
import os
import base64
import warnings
from pathlib import Path
from typing import TypedDict, Any

warnings.filterwarnings("ignore", message=".*allowed_objects.*")
try:
    from langchain_core._api.deprecation import LangChainPendingDeprecationWarning
    warnings.filterwarnings("ignore", category=LangChainPendingDeprecationWarning)
except Exception:
    pass

from langgraph.graph import END, START, StateGraph
from .db import (
    add_message,
    create_lead,
    get_or_create_session,
    get_seller_lead,
    get_session_state,
    list_products,
    record_agent_run,
    record_query_understanding_event,
    search_product_documents,
    update_session_state,
)
from .query_understanding import understand_query_concepts
from .validation import ValidationError


ROOT_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = ROOT_DIR / "public" / "uploads"
OLLAMA_VISION_CANDIDATES = ("qwen2.5vl", "qwen2-vl", "qwen3-vl", "llava", "bakllava", "minicpm-v", "moondream")
VISION_RESULT_VERSION = 4
CATEGORY_CLASSIFIER_VERSION = 4

SEMANTIC_CATALOG = {
    "categories": ["手镯", "吊坠", "项链", "戒指", "戒面", "平安扣", "珠链", "手链", "手串", "无事牌", "耳坠", "挂件", "胸针", "把件", "摆件"],
    "waters": ["豆种", "糯种", "糯冰", "冰糯", "冰种", "高冰", "玻璃种"],
    "colors": ["晴底", "晴底色", "晴水", "白冰", "飘花", "飘绿", "阳绿", "正阳绿", "满绿", "辣绿", "蓝水", "紫罗兰", "春彩", "黄翡", "红翡", "油青", "墨翠", "帝王绿"],
    "shapes": ["正圈", "圆条", "贵妃", "水滴", "如意", "佛公", "观音", "叶子", "葫芦", "蛋面", "马鞍", "方形", "圆扣", "怀古扣", "圆珠", "算盘珠", "素牌", "龙牌"],
    "flawTerms": ["无纹裂", "无裂", "无纹", "微瑕", "肉眼干净", "轻微棉絮", "少量石纹", "边缘细小矿点"],
    "scenes": ["送礼", "自用", "收藏", "日常佩戴", "通勤佩戴", "节日礼赠"],
}

COLOR_FAMILIES = {
    "帝王绿": ["帝王绿", "正阳绿", "满绿", "阳绿", "高绿", "飘绿", "绿色"],
    "阳绿": ["阳绿", "正阳绿", "帝王绿", "满绿", "飘绿", "绿色"],
    "飘绿": ["飘绿", "阳绿", "绿色"],
    "晴底": ["晴底", "晴底色"],
    "白冰": ["白冰", "冰白"],
    "蓝水": ["蓝水", "晴水", "蓝色", "偏蓝", "蓝调"],
}

WATER_FAMILIES = {
    "豆种": ["豆种"],
    "糯种": ["糯种"],
    "糯冰": ["糯冰", "冰糯"],
    "冰糯": ["冰糯", "糯冰"],
    "冰种": ["冰种", "高冰", "玻璃种"],
    "高冰": ["高冰", "玻璃种"],
    "玻璃种": ["玻璃种"],
}

FLAW_FAMILIES = {
    "微瑕": ["微瑕", "轻微棉絮", "少量石纹", "边缘细小矿点"],
    "无纹裂": ["无纹裂", "无裂", "无纹", "肉眼干净"],
    "无裂": ["无纹裂", "无裂", "肉眼干净"],
    "无纹": ["无纹裂", "无纹", "肉眼干净"],
}

VLM_TERM_TRANSLATIONS = {
    "multicolored": "俏色",
    "multi-colored": "俏色",
    "colorful": "俏色",
    "green": "翠绿",
    "pale green": "浅绿",
    "icy": "冰种",
    "translucent": "冰种",
    "sculptural": "立体雕件",
    "sculpture": "立体雕件",
    "carving": "雕件",
    "display sculpture": "陈设摆件",
    "table ornament": "桌面摆件",
    "decorative item": "装饰摆件",
    "collectible": "收藏陈设",
    "wooden base": "木质底座",
    "base": "底座",
    "crab and shell": "螃蟹海螺",
    "crabshell": "螃蟹海螺",
    "crab": "螃蟹",
    "shell": "海螺",
    "conch": "海螺",
    "seaweed": "海草",
    "flower": "花",
    "flowers": "花",
    "leaf": "叶",
    "leaves": "叶",
    "flowers leaves": "花叶",
    "flowersleaves": "花叶",
    "floral branch": "花叶",
    "frog": "蟾蜍",
    "toad": "蟾蜍",
    "metal band": "金属戒托",
    "metal shank": "金属戒托",
    "metal setting": "金属镶嵌",
    "silver metal": "银色金属",
    "square stone": "方形主石",
    "square main stone": "方形主石",
    "rectangular": "方形",
    "rectangle": "方形",
    "square": "方形",
    "round": "圆润",
}


def compact(values):
    result = []
    seen = set()
    for value in values:
        text = str(value or "").strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def price_or(value, fallback=None):
    if isinstance(value, (int, float)):
        return round(value)
    text = str(value or "")
    match = re.search(r"(\d+(?:\.\d+)?)", text)
    if not match:
        return fallback
    amount = float(match.group(1))
    if "万" in text or "w" in text.lower():
        return round(amount * 10000)
    if "k" in text.lower():
        return round(amount * 1000)
    return round(amount)


def boolish(value, fallback=False):
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    if text in {"true", "yes", "y", "1", "same", "同一件", "是"}:
        return True
    if text in {"false", "no", "n", "0", "different", "不是", "不同"}:
        return False
    return fallback


def first_present(*values):
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def extract_first(text, terms):
    return next((term for term in terms if term in text), "")


def extract_sizes(text):
    result = []
    for match in re.finditer(r"([1-9]\d?(?:\.\d)?)\s*(mm|毫米|圈口|圈|x|×)?\s*([1-9]\d?(?:\.\d)?)?\s*(mm|毫米)?", text, re.I):
        if match.group(3):
            result.append(f"{match.group(1)}x{match.group(3)}mm")
        elif match.group(2):
            unit = match.group(2).replace("毫米", "mm").replace("圈口", "mm").replace("圈", "mm")
            result.append(f"{match.group(1)}{unit}")
    return result[:3]


def extract_budget(text):
    range_match = re.search(r"(\d+(?:\.\d+)?)\s*(万|w|W|k|K|元|块|人民币|rmb|RMB)?\s*(?:到|至|-|~)\s*(\d+(?:\.\d+)?)\s*(万|w|W|k|K|元|块|人民币|rmb|RMB)?", text)
    if range_match:
        unit = range_match.group(4) or range_match.group(2) or ""
        return price_or(f"{range_match.group(3)}{unit}")
    unit_match = re.search(r"(\d+(?:\.\d+)?)\s*(万|w|W|k|K|元|块|人民币|rmb|RMB)", text)
    if unit_match:
        return price_or(f"{unit_match.group(1)}{unit_match.group(2)}")
    budget_match = (
        re.search(r"(?:预算|价位|价格|以内|左右|不超过|控制在)[^\d]{0,6}(\d+(?:\.\d+)?)\s*(万|w|W|k|K|元|块|人民币|rmb|RMB)?", text)
        or re.search(r"(\d+(?:\.\d+)?)\s*(万|w|W|k|K|元|块|人民币|rmb|RMB)?\s*(?:预算|以内|左右|价位|价格)", text)
    )
    if not budget_match:
        return None
    return price_or(f"{budget_match.group(1)}{budget_match.group(2) or ''}")


def is_soft_budget(text):
    if not extract_budget(text):
        return False
    if re.search(r"左右|大概|大约|约|上下|附近|差不多|可小超", text):
        return True
    return not bool(re.search(r"预算|以内|不超过|控制在|上限", text))


def make_query_terms(values):
    terms = []
    for value in values:
        terms.extend(re.split(r"[、,，\s]+", str(value or "")))
    return compact(terms)


def price_preference(text):
    if re.search(r"最贵|贵的|高货|预算不限|不要便宜|最高价|价格高", text):
        return "premium"
    if re.search(r"最便宜|最低价|价格最低|越便宜越好", text):
        return "lowest"
    if re.search(r"中等价格|中等价位|中等预算|价格适中|价位适中|中端|中档|普通价位|不要太贵也不要太便宜", text):
        return "mid"
    if re.search(r"便宜|实惠|性价比|划算|入门|低预算", text):
        return "value"
    return ""


def accepts_any_category(text):
    return bool(re.search(r"品类.*都可以|品种.*都可以|类型.*都可以|款式.*都可以|什么.*都可以|不限品类|不限品种|都行|随便", text))


def extract_preference_profile(text, understanding=None):
    concept = understanding or understand_query_concepts(text)
    profile = concept["profile"]
    profile["price"] = profile.get("price") or price_preference(text)
    profile["appearance"] = bool(profile.get("appearance") or re.search(r"漂亮|好看|颜值|成色|品相|显气质|高级感", text))
    profile["quality"] = bool(profile.get("quality") or re.search(r"品质|品相|成色|收藏|顶级|高货|最好的|品质最好|种老|起光|起胶", text))
    profile["water"] = bool(profile.get("water") or re.search(r"水头|种水|通透|冰透|水润|起光|起胶", text))
    profile["color"] = bool(profile.get("color") or re.search(r"颜色|色正|色阳|色辣|满色|满绿|阳绿|帝王绿|飘花|飘绿|春彩|紫罗兰|晴底", text))
    profile["clarity"] = bool(profile.get("clarity") or re.search(r"无瑕|干净|无纹裂|无裂|无纹|少棉|少瑕|瑕疵少", text))
    profile["gift"] = bool(profile.get("gift") or re.search(r"送礼|礼物|体面|拿得出手|长辈|妈妈|女朋友|老婆", text))
    profile["certificate"] = bool(profile.get("certificate") or re.search(r"证书|复检|保真|天然A货|A货", text))
    profile["openCategory"] = bool(profile.get("openCategory") or accepts_any_category(text))
    labels = [*(profile.get("labels") or [])]
    if profile["price"] == "premium":
        labels.append("高货")
    if profile["price"] == "lowest":
        labels.append("低价")
    if profile["price"] == "mid":
        labels.append("中等价位")
    if profile["price"] == "value":
        labels.append("性价比")
    for key, label in [("appearance", "颜值"), ("quality", "品质"), ("water", "水头"), ("color", "颜色"), ("clarity", "干净"), ("gift", "送礼"), ("certificate", "证书")]:
        if profile[key]:
            labels.append(label)
    profile["labels"] = compact(labels)
    profile["queryTerms"] = compact([*(profile.get("queryTerms") or []), *profile["labels"]])
    profile["conceptConfidence"] = concept["confidence"]
    return profile


def has_actionable_preference(profile):
    return bool(profile and (profile.get("price") or profile.get("appearance") or profile.get("quality") or profile.get("water") or profile.get("color") or profile.get("clarity") or profile.get("gift") or profile.get("certificate") or profile.get("signals")))


def heuristic_need(raw_need, understanding=None):
    text = str(raw_need or "")
    concept_profile = (understanding or understand_query_concepts(text))["profile"]
    category = concept_profile.get("category") or ""
    if category:
        pass
    elif "手镯" in text or "镯" in text:
        category = "手镯"
    elif "无事牌" in text or "牌子" in text or "龙牌" in text:
        category = "无事牌"
    elif "手串" in text:
        category = "手串"
    elif "耳坠" in text or "耳饰" in text:
        category = "耳坠"
    elif "挂件" in text:
        category = "挂件"
    elif "平安扣" in text:
        category = "平安扣"
    elif "珠链" in text:
        category = "珠链"
    elif any(term in text for term in ["吊坠", "佛公", "观音", "叶子", "如意", "葫芦"]):
        category = "吊坠"
    elif "戒" in text:
        category = "戒面"

    water = concept_profile.get("waterValue") or extract_first(text, SEMANTIC_CATALOG["waters"])
    color = concept_profile.get("colorValue") or extract_first(text, SEMANTIC_CATALOG["colors"])
    shape = concept_profile.get("shapeValue") or extract_first(text, SEMANTIC_CATALOG["shapes"])
    sizes = extract_sizes(text)
    flaw = extract_first(text, SEMANTIC_CATALOG["flawTerms"])
    scenes = [term for term in SEMANTIC_CATALOG["scenes"] if term in text]
    if "送礼" not in scenes and ("送" in text or "礼" in text):
        scenes.append("送礼")
    if "自用" not in scenes and "自用" in text:
        scenes.append("自用")
    tag_words = [*SEMANTIC_CATALOG["waters"], *SEMANTIC_CATALOG["colors"], *SEMANTIC_CATALOG["shapes"], *SEMANTIC_CATALOG["flawTerms"], "天然A货", "证书", *sizes, category]
    tags = [tag for tag in tag_words if tag and (tag in text or tag.replace("色", "") in text)]
    must_have = compact([
        "无纹裂" if flaw in {"无纹裂", "无裂", "无纹"} else flaw,
        "天然A货" if ("天然" in text or "A货" in text) else "",
        "证书" if ("证书" in text or "复检" in text) else "",
        *sizes,
    ])
    confidence = min(0.95, 0.45 + len(tags) * 0.06 + (0.1 if category else 0) + (0.08 if sizes else 0) + (0.08 if re.search(r"\d", text) else 0))
    return {
        "category": category,
        "budget": extract_budget(text),
        "budgetSoft": is_soft_budget(text),
        "tags": tags,
        "occasion": "/".join(scenes),
        "mustHave": must_have,
        "water": water,
        "color": color,
        "shape": shape,
        "sizes": sizes,
        "treatment": "天然A货" if ("天然" in text or "A货" in text) else "",
        "certificateRequired": "证书" in text or "复检" in text,
        "queryTerms": make_query_terms([category, water, color, shape, flaw, *scenes, *sizes, *tags, *must_have]),
        "confidence": confidence,
        "provider": "python-rule",
    }


def has_need_slot(need):
    return bool(need.get("category") or need.get("budget") or need.get("water") or need.get("color") or need.get("shape") or need.get("sizes") or need.get("mustHave"))


def has_product_constraint(need):
    return bool(has_need_slot(need) or need.get("certificateRequired"))


def is_refinement_text(text):
    return bool(re.search(r"再来|换一批|换个|只要|不要|必须|优先|更|最|贵|便宜|证书|无纹|无裂|微瑕", text))


def is_independent_match(text, need):
    if need.get("category"):
        return True
    if re.search(r"我要|想要|想找|找|买|推荐|有没有|看货|来个", text) and has_need_slot(need):
        return True
    return bool(need.get("budget") and (need.get("water") or need.get("color") or need.get("shape")))


def classify_buyer_intent(raw_need, parsed_need, previous_need, understanding=None):
    text = str(raw_need or "").strip()
    has_find_signal = has_need_slot(parsed_need)
    has_previous_find_signal = has_need_slot(previous_need or {})
    profile = extract_preference_profile(text, understanding)
    has_preference = has_actionable_preference(profile)
    refinement = is_refinement_text(text)
    asks_knowledge_only = bool(re.search(r"什么|怎么|如何|区别|真假|鉴定|保养|证书|a货|值吗|好吗|可以吗|[?？]", text, re.I)) and not bool(re.search(r"找|买|推荐|预算|价位|价格|有没有|货源|看货|送礼|自用|需要|想要", text))
    if has_find_signal and (not has_previous_find_signal or is_independent_match(text, parsed_need)):
        return {"mode": "match", "pricePreference": profile["price"], "preferenceProfile": profile, "reason": "识别到独立找货需求"}
    if has_previous_find_signal and (refinement or (has_preference and not has_find_signal)):
        return {"mode": "refine", "pricePreference": profile["price"], "preferenceProfile": profile, "reason": "基于上一轮需求补充偏好"}
    if has_find_signal:
        return {"mode": "match", "pricePreference": profile["price"], "preferenceProfile": profile, "reason": "识别到找货槽位"}
    if has_preference:
        return {"mode": "match", "pricePreference": profile["price"], "preferenceProfile": profile, "reason": "开放品类找货" if profile["openCategory"] else "开放偏好找货"}
    if refinement:
        return {"mode": "clarify", "pricePreference": profile["price"], "preferenceProfile": profile, "reason": "有偏好但缺少品类或上一轮找货上下文"}
    if asks_knowledge_only:
        return {"mode": "service", "pricePreference": "", "preferenceProfile": profile, "reason": "翡翠知识或客服咨询"}
    if re.search(r"^(你好|您好|hi|hello|在吗|谢谢|thank)", text, re.I):
        return {"mode": "service", "pricePreference": "", "preferenceProfile": profile, "reason": "寒暄或客服对话"}
    return {"mode": "service", "pricePreference": "", "preferenceProfile": profile, "reason": "未识别到找货意图"}


def merge_parsed_need(previous, current, intent):
    if intent["mode"] != "refine" or not previous:
        merged = {**current, "pricePreference": intent.get("pricePreference"), "preferenceProfile": intent.get("preferenceProfile")}
        merged["queryTerms"] = make_query_terms([*(merged.get("queryTerms") or []), *((intent.get("preferenceProfile") or {}).get("queryTerms") or [])])
        return merged
    profile = intent.get("preferenceProfile") or {}
    profile["labels"] = make_query_terms(profile.get("labels") or [])
    profile["queryTerms"] = make_query_terms(profile.get("queryTerms") or [])
    merged = {
        **previous,
        **current,
        "category": current.get("category") or previous.get("category") or "",
        "budget": current.get("budget") if current.get("budget") is not None else previous.get("budget"),
        "budgetSoft": current.get("budgetSoft") if current.get("budget") is not None else previous.get("budgetSoft"),
        "occasion": current.get("occasion") or previous.get("occasion") or "",
        "water": current.get("water") or previous.get("water") or "",
        "color": current.get("color") or previous.get("color") or "",
        "shape": current.get("shape") or previous.get("shape") or "",
        "sizes": current.get("sizes") or previous.get("sizes") or [],
        "tags": make_query_terms([*(previous.get("tags") or []), *(current.get("tags") or [])]),
        "mustHave": make_query_terms([*(previous.get("mustHave") or []), *(current.get("mustHave") or [])]),
        "preferenceProfile": profile,
        "pricePreference": intent.get("pricePreference") or current.get("pricePreference") or previous.get("pricePreference") or "",
    }
    merged["queryTerms"] = make_query_terms([
        merged.get("category"),
        merged.get("water"),
        merged.get("color"),
        merged.get("shape"),
        merged.get("occasion"),
        *(merged.get("sizes") or []),
        *(merged.get("tags") or []),
        *(merged.get("mustHave") or []),
        *(profile.get("queryTerms") or []),
    ])
    return merged


def latest_signal_terms(need, profile):
    return make_query_terms([
        need.get("category"),
        need.get("water"),
        need.get("color"),
        need.get("shape"),
        *(need.get("sizes") or []),
        *(need.get("tags") or []),
        *(need.get("mustHave") or []),
        *(profile.get("queryTerms") or []),
        *[term for concept in profile.get("signals") or [] for term in concept.get("productTerms", [])],
    ])


def build_latest_signal(raw_need, current_need, intent):
    profile = intent.get("preferenceProfile") or {}
    return {
        "rawText": str(raw_need or "").strip(),
        "mode": intent.get("mode"),
        "price": profile.get("price") or intent.get("pricePreference") or "",
        "profile": profile,
        "category": current_need.get("category") or "",
        "water": current_need.get("water") or "",
        "color": current_need.get("color") or "",
        "shape": current_need.get("shape") or "",
        "budget": current_need.get("budget"),
        "budgetSoft": current_need.get("budgetSoft"),
        "sizes": current_need.get("sizes") or [],
        "mustHave": current_need.get("mustHave") or [],
        "terms": latest_signal_terms(current_need, profile),
        "labels": make_query_terms([*(profile.get("labels") or []), *(current_need.get("mustHave") or [])]),
        "concepts": profile.get("signals") or [],
    }


def validate_need_rules(need):
    warnings = []
    passed = []
    if need.get("category"):
        passed.append(f"已识别品类：{need['category']}")
    if need.get("budget"):
        passed.append(f"已识别预算：￥{need['budget']:,}")
    if need.get("water") or need.get("color"):
        passed.append(f"已识别种水/颜色：{' / '.join(compact([need.get('water'), need.get('color')]))}")
    if need.get("sizes"):
        passed.append(f"已识别尺寸：{'、'.join(need['sizes'])}")
    if not need.get("tags") and not need.get("queryTerms"):
        warnings.append("需求较泛，建议补充种水、颜色、圈口或预算")
    if need.get("budget") and need["budget"] < 1000:
        warnings.append("预算过低，可能无法匹配平台翡翠货源")
    if need.get("certificateRequired"):
        passed.append("证书/复检作为硬性条件")
    return {"ok": bool(not warnings or passed), "passed": passed, "warnings": warnings, "hardRules": make_query_terms([need.get("category"), *(need.get("mustHave") or []), "证书" if need.get("certificateRequired") else ""])}


def budget_limit(need):
    if not need.get("budget"):
        return None
    if need.get("budgetLimit"):
        return need["budgetLimit"]
    return need["budget"] * (1.12 if need.get("budgetSoft") else 1)


def expand_need_terms(need):
    terms = [*(need.get("queryTerms") or []), *((need.get("preferenceProfile") or {}).get("queryTerms") or [])]
    if need.get("water"):
        terms.extend(WATER_FAMILIES.get(need["water"], [need["water"]]))
    if need.get("color"):
        terms.extend(COLOR_FAMILIES.get(need["color"], [need["color"]]))
    for must in need.get("mustHave") or []:
        terms.extend(FLAW_FAMILIES.get(must, [must]))
    return make_query_terms(terms)


def product_matches_family(product, evidence, value, families):
    return any(term_matches_product(product, evidence, term) for term in families.get(value, [value]))


def product_matches_explicit_constraints(product, need):
    evidence = product_evidence_text(product)
    if need.get("category") and product["category"] != need["category"]:
        return False
    if need.get("water") and not product_matches_family(product, evidence, need["water"], WATER_FAMILIES):
        return False
    if need.get("color") and not product_matches_family(product, evidence, need["color"], COLOR_FAMILIES):
        return False
    if need.get("shape") and not term_matches_product(product, evidence, need["shape"]):
        return False
    for size in need.get("sizes") or []:
        if not product_matches_size(product, size):
            return False
    for must in need.get("mustHave") or []:
        if not product_satisfies_must(product, must):
            return False
    return True


def product_matches_size(product, size):
    match = re.search(r"([1-9]\d?(?:\.\d)?)", str(size or ""))
    if not match:
        return False
    number = re.escape(match.group(1))
    fields = " ".join(str(value or "") for value in [product.get("size"), product.get("diameter"), (product.get("specs") or {}).get("size"), (product.get("specs") or {}).get("diameter")])
    return bool(re.search(rf"(?<!\d){number}(?:\.0)?\s*(?:mm|毫米|圈口|圈)?(?!\d)", fields, re.I))


def inventory_boundary_check(need, inventory):
    listed = [product for product in inventory if product["status"] == "listed"]
    scoped = listed
    blockers = []
    if need.get("category"):
        category_pool = [product for product in scoped if product["category"] == need["category"]]
        if not category_pool:
            supported = "、".join(sorted({product["category"] for product in listed})[:8])
            blockers.append({"label": "品类", "value": need["category"], "detail": f"当前上架货源没有该品类；可选品类包括 {supported}"})
        scoped = category_pool
    if not need.get("category") and need.get("budget") and not any([need.get("water"), need.get("color"), need.get("shape"), need.get("sizes"), need.get("mustHave")]):
        supported = "、".join(sorted({product["category"] for product in listed})[:8])
        blockers.append({"label": "品类", "value": "未确认", "detail": f"只识别到预算，缺少可稳定匹配的品类或偏好；可选品类包括 {supported}"})
    for field, label, families in [("water", "种水", WATER_FAMILIES), ("color", "颜色", COLOR_FAMILIES)]:
        value = need.get(field)
        if not value or not scoped:
            continue
        matched = [product for product in scoped if product_matches_family(product, product_evidence_text(product), value, families)]
        if not matched:
            blockers.append({"label": label, "value": value, "detail": f"当前约束下没有匹配「{value}」的上架货源"})
        scoped = matched
    if need.get("shape") and scoped:
        matched = [product for product in scoped if term_matches_product(product, product_evidence_text(product), need["shape"])]
        if not matched:
            blockers.append({"label": "器型", "value": need["shape"], "detail": f"当前约束下没有匹配「{need['shape']}」的上架货源"})
        scoped = matched
    for size in need.get("sizes") or []:
        if not scoped:
            continue
        matched = [product for product in scoped if product_matches_size(product, size)]
        if not matched:
            blockers.append({"label": "尺寸", "value": size, "detail": f"当前约束下没有匹配「{size}」的上架货源"})
        scoped = matched
    for must in need.get("mustHave") or []:
        if not scoped:
            continue
        matched = [product for product in scoped if product_satisfies_must(product, must)]
        if not matched:
            blockers.append({"label": "硬性要求", "value": must, "detail": f"当前约束下没有满足「{must}」的上架货源"})
        scoped = matched
    if need.get("budget") and scoped:
        limit = budget_limit(need)
        matched = [product for product in scoped if product["price"] <= limit]
        if not matched:
            min_price = min(product["price"] for product in scoped)
            blockers.append({"label": "预算", "value": f"￥{need['budget']:,}", "detail": f"满足前面条件的最低上架价约￥{min_price:,}，当前预算内没有货源"})
    return {"blocking": bool(blockers), "blockers": blockers[:3], "scopedCount": len(scoped), "total": len(listed)}


def inventory_boundary_reply(boundary):
    details = "；".join(blocker["detail"] for blocker in boundary["blockers"])
    return f"我先做了库存边界校验：{details}。您可以放宽其中一个条件，或补充新的品类、预算、尺寸范围，我再继续匹配。"


def apply_budget_relaxation(need, inventory):
    strict_limit = budget_limit(need)
    if not strict_limit or need.get("budgetSoft"):
        return need, None
    exact_products = [product for product in inventory if product_matches_explicit_constraints(product, need)]
    if not exact_products or any(product["price"] <= strict_limit for product in exact_products):
        return need, None
    relaxed_limit = round(need["budget"] * 1.12)
    nearest = min(exact_products, key=lambda product: abs(product["price"] - need["budget"]))
    if nearest["price"] > relaxed_limit:
        return need, None
    return {**need, "budgetLimit": relaxed_limit, "budgetRelaxed": True}, nearest


def evaluate_product_rules(product, need):
    score = 0
    passed = []
    failed = []
    evidence = " ".join(str(item or "") for item in [
        product["title"], " ".join(product["tags"]), product.get("flaws"), product.get("size"), product.get("diameter"),
        product.get("certificate"), product.get("certificateNo"), product.get("treatment"), product.get("detail"), product.get("ragText"),
    ])
    has_certificate = bool(product.get("certificate") or product.get("certificateNo") or "证书" in evidence or "复检" in evidence)
    if not need.get("category"):
        score += 4
    elif product["category"] == need["category"]:
        score += 22
        passed.append("品类一致")
    else:
        failed.append(f"品类不符：{product['category']}")
    if not need.get("budget"):
        score += 4
    else:
        limit = budget_limit(need)
        ratio = product["price"] / need["budget"]
        distance = abs(product["price"] - need["budget"]) / need["budget"]
        if product["price"] <= need["budget"] and ratio >= 0.72:
            score += max(16, round(44 - distance * 80))
            passed.append("价格贴近预算" if distance <= 0.18 else "价格在预算内")
        elif product["price"] <= need["budget"] and ratio >= 0.5:
            score += max(8, round(22 - distance * 24))
            passed.append("价格在预算内但偏低")
        elif product["price"] <= need["budget"]:
            score += 4
            failed.append("价格明显低于预算段")
        elif (need.get("budgetSoft") or need.get("budgetRelaxed")) and product["price"] <= limit:
            score += max(10, round(30 - distance * 100))
            passed.append("价格略超预算")
        else:
            failed.append("价格超过预算")
    if need.get("water"):
        family = WATER_FAMILIES.get(need["water"], [need["water"]])
        if need["water"] in evidence:
            score += 30
            passed.append(f"精确命中{need['water']}")
        elif any(term in evidence for term in family):
            score += 18
            passed.append(f"{need['water']}高阶/相近种水")
        else:
            score -= 28
            failed.append(f"未命中{need['water']}种水")
    if need.get("color"):
        family = COLOR_FAMILIES.get(need["color"], [need["color"]])
        if need["color"] in evidence:
            score += 32
            passed.append(f"精确命中{need['color']}")
        elif any(term in evidence for term in family):
            score += 18
            passed.append(f"{need['color']}相近色系")
        else:
            score -= 22
            failed.append(f"未命中{need['color']}色系")
    if not need.get("certificateRequired") or has_certificate:
        score += 8 if need.get("certificateRequired") else 3
        if need.get("certificateRequired"):
            passed.append("有证书/可复检信息")
    else:
        failed.append("缺少证书信息")
    for must in need.get("mustHave") or []:
        if product_satisfies_must(product, must):
            score += 6
            passed.append(f"满足{must}")
        else:
            failed.append(f"未明确{must}")
    return {"score": max(0, score), "passed": compact(passed), "failed": compact(failed)}


def semantic_score(product, need):
    score = 0
    reasons = []
    search_text = " ".join(str(item or "") for item in [
        product["title"], product["category"], product.get("quality"), product.get("water"), product.get("color"),
        product.get("shape"), product.get("size"), product.get("diameter"), product.get("flaws"), product.get("scene"),
        product.get("certificate"), product.get("ragText"), " ".join(product.get("searchKeywords") or []), " ".join(product.get("tags") or []),
    ])
    if need.get("category") and product["category"] == need["category"]:
        score += 18
        reasons.append(f"{product['category']}品类匹配")
    for tag in make_query_terms([need.get("water"), need.get("color"), need.get("shape"), *(need.get("sizes") or []), *(need.get("tags") or []), *expand_need_terms(need)]):
        if tag in search_text or any(tag in product_tag or product_tag in tag for product_tag in product.get("tags") or []):
            score += 8
            reasons.append(f"{tag}匹配")
    for must in need.get("mustHave") or []:
        if must in search_text or any(must in product_tag or product_tag in must for product_tag in product.get("tags") or []):
            score += 10
            reasons.append(f"满足{must}")
        else:
            score -= 8
    if product.get("ragText") and need.get("occasion") and need["occasion"] in product["ragText"]:
        score += 6
        reasons.append(f"{need['occasion']}场景匹配")
    return {"score": max(score, 0), "reasons": compact(reasons)[:5]}


def score_product(product, need, retrieval_hit):
    semantic = semantic_score(product, need)
    rules = evaluate_product_rules(product, need)
    rag_score = min(40, retrieval_hit["score"]) if retrieval_hit else 0
    total = max(0, semantic["score"] + rules["score"] + rag_score - len(rules["failed"]) * 4)
    reasons = compact([*semantic["reasons"], *rules["passed"], f"RAG命中{'、'.join(retrieval_hit['matchedTerms'][:4])}" if retrieval_hit and retrieval_hit["matchedTerms"] else ""])[:6]
    scored = dict(product)
    scored["matchScore"] = total
    scored["matchReasons"] = reasons
    scored["agentScore"] = {
        "total": total,
        "semantic": semantic["score"],
        "rules": rules["score"],
        "rag": rag_score,
        "rulePassed": rules["passed"],
        "ruleFailed": rules["failed"],
        "retrievalSource": {
            "chunkType": retrieval_hit["chunkType"],
            "score": retrieval_hit["score"],
            "matchedTerms": retrieval_hit["matchedTerms"],
            "snippet": retrieval_hit["snippet"],
        } if retrieval_hit else None,
    }
    return scored


def product_evidence_text(product):
    return " ".join(str(item or "") for item in [
        product["title"], product["category"], product.get("quality"), product.get("water"), product.get("color"),
        product.get("shape"), product.get("size"), product.get("diameter"), product.get("flaws"), product.get("scene"),
        product.get("certificate"), product.get("detail"), product.get("ragText"), " ".join(product.get("tags") or []),
    ])


def term_matches_product(product, evidence, term):
    return bool(term and (term in evidence or any(term in product_tag or product_tag in term for product_tag in product.get("tags") or [])))


def product_satisfies_must(product, must):
    evidence = product_evidence_text(product)
    if must == "证书":
        return "证书" in evidence or "复检" in evidence
    if "mm" in must:
        return product_matches_size(product, must)
    return any(term_matches_product(product, evidence, term) for term in FLAW_FAMILIES.get(must, [must]))


def latest_signal_score(product, signal):
    if not signal:
        return {"score": 0, "reasons": []}
    evidence = product_evidence_text(product)
    score = 0
    reasons = []
    for key, label, points in [("category", "品类", 24), ("water", "种水", 20), ("color", "颜色", 20), ("shape", "器型", 14)]:
        value = signal.get(key)
        if value:
            if key == "color":
                family = COLOR_FAMILIES.get(value, [value])
                if term_matches_product(product, evidence, value):
                    score += 38
                    reasons.append("本轮颜色精确匹配")
                elif any(term_matches_product(product, evidence, term) for term in family):
                    score += 24
                    reasons.append("本轮颜色相近匹配")
                else:
                    score -= 45
                    reasons.append("本轮颜色不匹配")
            elif key == "water":
                family = WATER_FAMILIES.get(value, [value])
                if term_matches_product(product, evidence, value):
                    score += 34
                    reasons.append("本轮种水精确匹配")
                elif any(term_matches_product(product, evidence, term) for term in family):
                    score += 24
                    reasons.append("本轮种水高阶/相近匹配")
                else:
                    score -= 42
                    reasons.append("本轮种水不匹配")
            elif term_matches_product(product, evidence, value):
                score += points
                reasons.append(f"本轮{label}匹配")
    if signal.get("budget"):
        budget = signal["budget"]
        distance = abs(product["price"] - budget) / budget
        limit = signal.get("budgetLimit") or budget * (1.12 if signal.get("budgetSoft") else 1)
        if product["price"] <= limit:
            score += max(12, round(90 - distance * 180))
            if product["price"] > budget and (signal.get("budgetSoft") or signal.get("budgetRelaxed")):
                reasons.append("本轮预算略超")
            elif distance <= 0.22:
                reasons.append("本轮预算贴近")
            elif product["price"] <= budget:
                reasons.append("本轮预算内但偏低")
            else:
                reasons.append("本轮预算略超")
        else:
            score -= min(45, round(distance * 70))
            reasons.append("本轮预算偏离")
    for size in signal.get("sizes") or []:
        if product_matches_size(product, size):
            score += 16
            reasons.append("本轮尺寸匹配")
    for must in signal.get("mustHave") or []:
        if (must == "证书" and ("证书" in evidence or "复检" in evidence)) or term_matches_product(product, evidence, must):
            score += 28
            reasons.append(f"本轮满足{must}")
        else:
            score -= 24
            reasons.append(f"本轮未满足{must}")
    matched_terms = []
    for term in signal.get("terms") or []:
        if term_matches_product(product, evidence, term):
            matched_terms.append(term)
    if matched_terms:
        score += min(42, len(compact(matched_terms)) * 10)
        reasons.append(f"本轮信号命中{'、'.join(compact(matched_terms)[:3])}")
    for concept in signal.get("concepts") or []:
        product_terms = compact(concept.get("productTerms") or [])
        concept_matches = [term for term in product_terms if term_matches_product(product, evidence, term)]
        if concept_matches:
            score += min(concept.get("weight", 10), 8 + len(concept_matches) * 6)
            reasons.append(f"本轮{concept.get('label')}匹配")
    return {"score": score, "reasons": compact(reasons)[:5]}


def product_preference_score(product, need, candidate_prices, latest_signal=None):
    profile = (latest_signal or {}).get("profile") or need.get("preferenceProfile") or {}
    price_prefer = (latest_signal or {}).get("price") or profile.get("price")
    if not candidate_prices:
        return {"score": 0, "reasons": []}
    evidence = product_evidence_text(product)
    max_price = max(candidate_prices)
    min_price = min(candidate_prices)
    sorted_prices = sorted(candidate_prices)
    median_price = sorted_prices[len(sorted_prices) // 2]
    value_range = max(max_price - min_price, 1)
    latest = latest_signal_score(product, latest_signal)
    score = latest["score"]
    reasons = [*latest["reasons"]]
    if price_prefer == "premium":
        score += round(((product["price"] - min_price) / value_range) * 180)
        reasons.append("本轮价格上限优先")
    if price_prefer == "lowest":
        score += round(((max_price - product["price"]) / value_range) * 180)
        reasons.append("本轮低价优先")
    if price_prefer == "mid":
        distance = abs(product["price"] - median_price)
        score += max(0, round((1 - min(distance / value_range, 1)) * 180))
        reasons.append("本轮中等价位优先")
    if price_prefer == "value":
        score += round(((max_price - product["price"]) / value_range) * 25)
        reasons.append("本轮性价比优先")
    water_rank = 28 if "玻璃种" in evidence else 24 if "高冰" in evidence else 20 if any(term in evidence for term in ["冰种", "冰透", "起光", "起胶"]) else 14 if any(term in evidence for term in ["糯冰", "冰糯", "水润"]) else 0
    color_rank = 30 if any(term in evidence for term in ["帝王绿", "正阳绿", "满绿"]) else 24 if any(term in evidence for term in ["阳绿", "辣绿"]) else 18 if any(term in evidence for term in ["飘绿", "飘花"]) else 10
    clean_rank = 18 if any(term in evidence for term in ["无纹裂", "无裂", "无纹", "肉眼干净"]) else 8 if "微瑕" in evidence else 0
    if profile.get("quality"):
        score += water_rank + round(color_rank * 0.5) + clean_rank
        reasons.append("本轮品质优先")
    if profile.get("appearance"):
        score += color_rank + round(water_rank * 0.7)
        reasons.append("本轮颜值优先")
    if profile.get("water"):
        score += water_rank
        reasons.append("本轮水头优先")
    if profile.get("color"):
        score += color_rank
        reasons.append("本轮颜色优先")
    if profile.get("clarity"):
        score += clean_rank
        reasons.append("本轮干净度优先")
    if profile.get("gift"):
        score += 16 if any(term in evidence for term in ["送礼", "礼赠", "证书", "复检", "天然A货"]) else 0
        reasons.append("本轮送礼优先")
    return {"score": max(0, score), "reasons": compact(reasons)}


def apply_preference(product, need, candidate_prices, latest_signal=None):
    preference = product_preference_score(product, need, candidate_prices, latest_signal)
    if not preference["score"]:
        return product
    updated = dict(product)
    updated["matchScore"] += preference["score"]
    updated["matchReasons"] = compact([*preference["reasons"], *(product.get("matchReasons") or [])])[:6]
    updated["agentScore"] = dict(product["agentScore"])
    updated["agentScore"]["total"] += preference["score"]
    updated["agentScore"]["preference"] = preference["score"]
    return updated


def budget_priority(product, need):
    if not need.get("budget"):
        return 0
    if product["price"] > budget_limit(need):
        return -1
    ratio = product["price"] / need["budget"]
    if ratio >= 0.8:
        return 3
    if ratio >= 0.65:
        return 2
    if ratio >= 0.5:
        return 1
    return 0


def has_latest_sort_signal(signal):
    return bool(signal and (signal.get("price") or signal.get("terms") or signal.get("mustHave") or signal.get("labels") or signal.get("concepts")))


def buyer_need_summary(need):
    quality = "".join(compact([need.get("water"), need.get("color")]))
    parts = make_query_terms([need.get("category"), quality, need.get("shape"), *(need.get("sizes") or []), *(need.get("mustHave") or []), *((need.get("preferenceProfile") or {}).get("labels") or [])])
    budget = f"预算约￥{need['budget']:,}" if need.get("budget") else "未限定预算"
    return "、".join([*parts, budget])


def local_service_reply(raw_need, parsed_need, intent):
    text = str(raw_need or "").strip()
    if intent.get("mode") == "clarify":
        if intent.get("pricePreference") == "premium":
            return "可以按高货优先帮您找，但需要先确认品类，比如手镯、吊坠、戒面，以及预算或尺寸范围。"
        if intent.get("pricePreference") == "lowest":
            return "可以按低价优先帮您找。请补充想看的品类，或直接说不限品类，我会从全库筛选。"
        return "可以继续细化。请补充想看的品类、预算、尺寸或用途，我会按您的偏好重新匹配货源。"
    if re.search(r"^(你好|您好|hi|hello|在吗)", text, re.I):
        return "您好，我是翡翠找货客服。您可以直接说预算、品类、圈口或尺寸、种水颜色、是否送礼，我会帮您整理需求并匹配货源。"
    if parsed_need.get("water") or parsed_need.get("color") or "翡翠" in text or "A货" in text or "证书" in text:
        return "可以的。这个问题我可以先按翡翠客服角度帮您解释；如果您想继续找货，也可以补充预算、品类、尺寸、种水颜色和用途。"
    return "我主要负责翡翠找货、商品咨询和需求整理。您可以告诉我想看手镯、吊坠还是其他品类，以及预算和佩戴或送礼场景。"


def maybe_ollama(prompt):
    if os.environ.get("AI_PROVIDER") != "ollama":
        return {"text": None, "provider": "python-rule", "error": None, "durationMs": 0}
    started = time.time()
    try:
        payload = json.dumps({
            "model": os.environ.get("OLLAMA_MODEL") or os.environ.get("AI_MODEL") or "qwen2.5:7b",
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
        }).encode()
        req = request.Request(f"{os.environ.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11434')}/api/chat", data=payload, headers={"Content-Type": "application/json"})
        with request.urlopen(req, timeout=8) as response:
            data = json.loads(response.read().decode())
        return {"text": (data.get("message") or {}).get("content"), "provider": "ollama", "durationMs": round((time.time() - started) * 1000)}
    except Exception as error:
        return {"text": None, "provider": "ollama", "error": str(error)[:180], "durationMs": round((time.time() - started) * 1000)}


def write_buyer_reply(need, matches, retrieval_docs, latest_signal):
    latest_text = (latest_signal or {}).get("rawText")
    prefix = f"已按您最新补充的「{latest_text}」重排" if latest_signal and latest_signal.get("mode") == "refine" and latest_text else "已根据您的需求完成匹配"
    if not matches:
        return f"{prefix}。当前需求为：{buyer_need_summary(need)}。我召回了 {len(retrieval_docs)} 条商品证据，但还需要更多品类、预算或尺寸信息才能给出稳定推荐。"
    top = matches[0]
    reasons = "、".join((top.get("matchReasons") or [])[:3]) or "综合匹配靠前"
    return f"{prefix}。当前需求为：{buyer_need_summary(need)}。我召回了 {len(retrieval_docs)} 条商品证据，优先推荐「{top['title']}」（￥{top['price']:,}），依据是：{reasons}。"


class AgentGraphState(TypedDict, total=False):
    payload: dict[str, Any]
    run_id: str
    session_id: str
    need_text: str
    buyer_email: str | None
    seller_id: int
    lead_id: str
    hint: str
    images: list[str]
    image_analyses: list[dict[str, Any]]
    vision: dict[str, Any]
    session_state: dict[str, Any]
    current_need: dict[str, Any]
    parsed_need: dict[str, Any]
    intent: dict[str, Any]
    latest_signal: dict[str, Any]
    validation: dict[str, Any]
    concept_summary: str
    route: str
    result: dict[str, Any]
    lead: dict[str, Any]
    output: dict[str, Any]


def buyer_prepare_node(state):
    session_id = state["session_id"]
    need_text = state["need_text"]
    buyer_email = state.get("buyer_email")
    session = get_or_create_session(session_id, "buyer_match", buyer_email)
    session_state = get_session_state(session)
    add_message(session_id, "user", need_text)
    understanding = understand_query_concepts(need_text)
    current_need = heuristic_need(need_text, understanding)
    previous_need = session_state.get("lastParsedNeed")
    intent = classify_buyer_intent(need_text, current_need, previous_need, understanding)
    parsed_need = merge_parsed_need(previous_need, current_need, intent)
    latest_signal = build_latest_signal(need_text, current_need, intent)
    validation = validate_need_rules(parsed_need)
    concept_summary = "、".join(
        f"{concept['label']}({'/'.join((concept.get('matched') or [])[:2])})"
        for concept in latest_signal.get("concepts", [])[:5]
    ) or "未命中概念词库"
    record_query_understanding_event({
        "sessionId": session_id,
        "rawText": need_text,
        "mode": intent["mode"],
        "confidence": max(current_need.get("confidence") or 0, (parsed_need.get("preferenceProfile") or {}).get("conceptConfidence") or 0),
        "signals": latest_signal.get("concepts", []),
        "parsedNeed": parsed_need,
    })
    if parsed_need.get("budget") and parsed_need["budget"] < 1000:
        route = "budget_clarify"
    elif intent["mode"] not in {"match", "refine"}:
        route = "customer_service"
    else:
        route = "match"
    return {
        "session_state": session_state,
        "current_need": current_need,
        "parsed_need": parsed_need,
        "intent": intent,
        "latest_signal": latest_signal,
        "validation": validation,
        "concept_summary": concept_summary,
        "route": route,
    }


def buyer_route(state):
    return state["route"]


def buyer_budget_clarify_node(state):
    need_text = state["need_text"]
    buyer_email = state.get("buyer_email")
    parsed_need = state["parsed_need"]
    validation = state["validation"]
    concept_summary = state["concept_summary"]
    intent = {**state["intent"], "mode": "clarify", "reason": "预算金额低于平台翡翠货源范围，需要确认单位"}
    reply = f"我识别到预算约￥{parsed_need['budget']:,}，这个金额低于当前平台翡翠货源范围。请确认是否少写了单位，例如 5万预算、5000元预算，或给我一个新的预算范围，我再继续匹配。"
    trace = [
        {"label": "请求边界校验", "detail": f"消息 {len(need_text)} 字，邮箱 {'有效' if buyer_email else '未提供'}"},
        {"label": "意图识别 Agent", "detail": f"{intent['mode']}：{intent['reason']}"},
        {"label": "概念理解 Agent", "detail": concept_summary},
        {"label": "语义识别 Agent", "detail": f"{'、'.join(parsed_need.get('queryTerms') or []) or '无检索词'} / 预算 ￥{parsed_need['budget']:,} / 置信度 {round((parsed_need.get('confidence') or 0) * 100)}%"},
        {"label": "预算校验 Agent", "detail": "已识别明确低预算，停止商品召回并请求用户确认单位"},
        {"label": "LangGraph状态", "detail": "LangGraph buyer_match 已完成边界识别"},
    ]
    return {"intent": intent, "result": {"runId": state["run_id"], "sessionId": state["session_id"], "mode": "customer_service", "intent": intent, "reply": reply, "parsedNeed": parsed_need, "validation": validation, "retrieval": {"documents": []}, "products": [], "trace": trace}}


def buyer_customer_service_node(state):
    need_text = state["need_text"]
    buyer_email = state.get("buyer_email")
    parsed_need = state["parsed_need"]
    intent = state["intent"]
    reply = local_service_reply(need_text, parsed_need, intent)
    trace = [
        {"label": "请求边界校验", "detail": f"消息 {len(need_text)} 字，邮箱 {'有效' if buyer_email else '未提供'}"},
        {"label": "意图识别 Agent", "detail": f"{intent['mode']}：{intent['reason']}"},
        {"label": "概念理解 Agent", "detail": state["concept_summary"]},
        {"label": "语义识别 Agent", "detail": f"{'、'.join(parsed_need.get('queryTerms') or []) or '无检索词'} / 置信度 {round((parsed_need.get('confidence') or 0) * 100)}%"},
        {"label": "LangGraph状态", "detail": "LangGraph buyer_match 已路由到客服回复节点"},
    ]
    return {"result": {"runId": state["run_id"], "sessionId": state["session_id"], "mode": "customer_service", "intent": intent, "reply": reply, "parsedNeed": parsed_need, "validation": state["validation"], "retrieval": {"documents": []}, "products": [], "trace": trace}}


def buyer_match_node(state):
    need_text = state["need_text"]
    buyer_email = state.get("buyer_email")
    parsed_need = state["parsed_need"]
    latest_signal = state["latest_signal"]
    intent = state["intent"]
    validation = state["validation"]
    concept_summary = state["concept_summary"]
    inventory = list_products({"publicOnly": True})
    inventory_boundary = inventory_boundary_check(parsed_need, inventory)
    if inventory_boundary["blocking"]:
        intent = {**intent, "mode": "clarify", "reason": "当前库存无法覆盖部分硬约束，需要用户调整条件"}
        reply = inventory_boundary_reply(inventory_boundary)
        trace = [
            {"label": "请求边界校验", "detail": f"需求 {len(need_text)} 字，邮箱 {'有效' if buyer_email else '未提供'}"},
            {"label": "意图识别 Agent", "detail": f"{intent['mode']}：{intent['reason']}"},
            {"label": "概念理解 Agent", "detail": concept_summary},
            {"label": "语义识别 Agent", "detail": f"{parsed_need.get('category') or '未限定品类'} / {('￥' + format(parsed_need['budget'], ',')) if parsed_need.get('budget') else '未限定预算'} / {'、'.join(parsed_need.get('queryTerms') or []) or '无检索词'} / 置信度 {round((parsed_need.get('confidence') or 0) * 100)}%"},
            {"label": "库存边界 Agent", "detail": "；".join(blocker["detail"] for blocker in inventory_boundary["blockers"])},
            {"label": "LangGraph状态", "detail": "LangGraph buyer_match 已完成库存边界校验，未进入商品排序"},
        ]
        return {"intent": intent, "result": {"runId": state["run_id"], "sessionId": state["session_id"], "mode": "customer_service", "intent": intent, "latestSignal": latest_signal, "reply": reply, "parsedNeed": parsed_need, "validation": validation, "retrieval": {"documents": []}, "products": [], "trace": trace, "inventoryBoundary": inventory_boundary}}
    parsed_need, relaxed_budget_product = apply_budget_relaxation(parsed_need, inventory)
    if relaxed_budget_product:
        latest_signal = {**latest_signal, "budgetLimit": parsed_need["budgetLimit"], "budgetRelaxed": True}
    retrieval_terms = expand_need_terms(parsed_need)
    retrieval_docs = search_product_documents(query=need_text, terms=retrieval_terms, category=parsed_need.get("category"), limit=18)
    retrieval_by_product = {doc["productId"]: doc for doc in retrieval_docs}
    preference_only = has_actionable_preference(parsed_need.get("preferenceProfile")) and not has_product_constraint(parsed_need)
    candidate_ids = {doc["productId"] for doc in retrieval_docs} if retrieval_docs and not preference_only else {product["id"] for product in inventory}
    if parsed_need.get("budget"):
        price_limit = budget_limit(parsed_need)
        budget_candidates = sorted(
            [product for product in inventory if (not parsed_need.get("category") or product["category"] == parsed_need["category"]) and product["price"] <= price_limit],
            key=lambda product: abs(product["price"] - parsed_need["budget"]),
        )[:8]
        candidate_ids.update(product["id"] for product in budget_candidates)
    if parsed_need.get("color"):
        color_family = COLOR_FAMILIES.get(parsed_need["color"], [parsed_need["color"]])
        color_candidates = sorted(
            [
                product for product in inventory
                if (not parsed_need.get("category") or product["category"] == parsed_need["category"])
                and (not parsed_need.get("budget") or product["price"] <= budget_limit(parsed_need))
                and any(term_matches_product(product, product_evidence_text(product), term) for term in color_family)
            ],
            key=lambda product: abs(product["price"] - parsed_need["budget"]) if parsed_need.get("budget") else -product["price"],
        )[:14]
        candidate_ids.update(product["id"] for product in color_candidates)
    price_prefer = latest_signal.get("price") or (parsed_need.get("preferenceProfile") or {}).get("price") or parsed_need.get("pricePreference")
    if price_prefer in {"premium", "lowest", "mid"}:
        price_pool = [
            product for product in inventory
            if (not parsed_need.get("category") or product["category"] == parsed_need["category"])
            and (not parsed_need.get("budget") or product["price"] <= budget_limit(parsed_need))
        ]
        if price_prefer == "mid":
            pool_prices = sorted(product["price"] for product in price_pool)
            median_price = pool_prices[len(pool_prices) // 2] if pool_prices else 0
            price_candidates = sorted(price_pool, key=lambda product: abs(product["price"] - median_price))[:14]
        else:
            price_candidates = sorted(price_pool, key=lambda product: product["price"], reverse=price_prefer == "premium")[:10]
        candidate_ids.update(product["id"] for product in price_candidates)
    high_budget_floor = parsed_need["budget"] * 0.45 if parsed_need.get("budget") and parsed_need["budget"] >= 80000 else 0
    color_matched_ids = set()
    if parsed_need.get("color"):
        color_family = COLOR_FAMILIES.get(parsed_need["color"], [parsed_need["color"]])
        color_matched_ids = {
            product["id"] for product in inventory
            if (not parsed_need.get("category") or product["category"] == parsed_need["category"])
            and (not parsed_need.get("budget") or product["price"] <= budget_limit(parsed_need))
            and any(term_matches_product(product, product_evidence_text(product), term) for term in color_family)
        }
    candidates = []
    for product in inventory:
        if product["id"] not in candidate_ids:
            continue
        if parsed_need.get("category") and product["category"] != parsed_need["category"]:
            continue
        if parsed_need.get("budget") and product["price"] > budget_limit(parsed_need):
            continue
        if color_matched_ids and product["id"] not in color_matched_ids:
            continue
        if high_budget_floor and product["price"] < high_budget_floor:
            evidence = f"{product['title']} {product.get('color')} {' '.join(product['tags'])} {product.get('ragText')}"
            if not parsed_need.get("color") or parsed_need["color"] not in evidence:
                continue
        candidates.append(product)
    if parsed_need.get("mustHave"):
        must_matched = [product for product in candidates if all(product_satisfies_must(product, must) for must in parsed_need["mustHave"])]
        if must_matched:
            candidates = must_matched
    candidate_prices = [product["price"] for product in candidates]
    scored_products = [apply_preference(score_product(product, parsed_need, retrieval_by_product.get(product["id"])), parsed_need, candidate_prices, latest_signal) for product in candidates]
    if (latest_signal.get("price") or "") == "premium":
        products = sorted(scored_products, key=lambda product: (product["price"], product["matchScore"]), reverse=True)[:3]
    elif (latest_signal.get("price") or "") == "lowest":
        products = sorted(scored_products, key=lambda product: (product["price"], -product["matchScore"]))[:3]
    elif parsed_need.get("budget"):
        products = sorted(scored_products, key=lambda product: (budget_priority(product, parsed_need), product["matchScore"]), reverse=True)[:3]
    elif has_latest_sort_signal(latest_signal):
        products = sorted(scored_products, key=lambda product: (product["agentScore"].get("preference", 0), product["matchScore"]), reverse=True)[:3]
    else:
        products = sorted(scored_products, key=lambda product: product["matchScore"], reverse=True)[:3]
    if buyer_email:
        for product in products:
            if product["status"] == "listed":
                create_lead({"productId": product["id"], "buyerEmail": buyer_email, "buyerNeed": need_text, "source": "buyer_agent"})
    reply = write_buyer_reply(parsed_need, products, retrieval_docs, latest_signal)
    trace = [
        {"label": "请求边界校验", "detail": f"需求 {len(need_text)} 字，邮箱 {'有效' if buyer_email else '未提供'}"},
        {"label": "意图识别 Agent", "detail": f"{intent['mode']}：{intent['reason']}"},
        {"label": "概念理解 Agent", "detail": concept_summary},
        {"label": "本轮信号 Agent", "detail": "、".join(compact([latest_signal.get("price"), latest_signal.get("category"), f"￥{latest_signal['budget']:,}" if latest_signal.get("budget") else "", latest_signal.get("water"), latest_signal.get("color"), *(latest_signal.get("mustHave") or []), *(latest_signal.get("labels") or [])])) or latest_signal.get("rawText") or "无"},
        {"label": "语义识别 Agent", "detail": f"{parsed_need.get('category') or '未限定品类'} / {('￥' + format(parsed_need['budget'], ',')) if parsed_need.get('budget') else '未限定预算'} / {'、'.join(parsed_need.get('queryTerms') or []) or '无检索词'} / 置信度 {round((parsed_need.get('confidence') or 0) * 100)}%"},
        {"label": "LangGraph状态", "detail": "LangGraph buyer_match 完成意图识别、RAG召回、规则排序和解释生成"},
        {"label": "规则校验 Agent", "detail": f"{'；'.join(validation['passed']) or '基础规则通过'}{('；提醒：' + '；'.join(validation['warnings'])) if validation['warnings'] else ''}"},
        {"label": "RAG检索 Tool", "detail": f"查询 product_documents，召回 {len(retrieval_docs)} 条证据；命中词：{'、'.join((retrieval_docs[0]['matchedTerms'] if retrieval_docs else [])[:5]) or '无'}；候选池 {len(candidates)} 件"},
        {"label": "排序 Agent", "detail": f"{products[0]['title']}：总分 {products[0]['agentScore']['total']} = 语义 {products[0]['agentScore']['semantic']} + 规则 {products[0]['agentScore']['rules']} + RAG {products[0]['agentScore']['rag']} + 本轮 {products[0]['agentScore'].get('preference', 0)}" if products else "暂无候选"},
        {"label": "解释 Agent", "detail": "、".join(products[0]["matchReasons"]) if products else "需要更多需求信息"},
        {"label": "客资分发 Tool", "detail": "已写入商家客资列表" if buyer_email else "未留邮箱，仅展示匹配结果"},
    ]
    retrieval = {"documents": [{
        "productId": doc["productId"],
        "productTitle": doc["product"]["title"],
        "score": doc["score"],
        "matchedTerms": doc["matchedTerms"],
        "snippet": doc["snippet"],
    } for doc in retrieval_docs[:6]]}
    return {"parsed_need": parsed_need, "latest_signal": latest_signal, "result": {"runId": state["run_id"], "sessionId": state["session_id"], "mode": "match", "intent": intent, "latestSignal": latest_signal, "reply": reply, "parsedNeed": parsed_need, "validation": validation, "retrieval": retrieval, "products": products, "trace": trace}}


def buyer_persist_node(state):
    result = state["result"]
    session_id = state["session_id"]
    parsed_need = state["parsed_need"]
    session_state = state["session_state"]
    add_message(session_id, "assistant", result["reply"], result)
    update_session_state(session_id, {
        **session_state,
        "lastMode": result["mode"],
        "lastIntent": result["intent"],
        "lastNeed": state["need_text"],
        "lastParsedNeed": parsed_need if result["mode"] == "match" else session_state.get("lastParsedNeed"),
        "lastProductIds": [p["id"] for p in result["products"]],
    })
    record_agent_run({
        "id": state["run_id"],
        "sessionId": session_id,
        "agentType": "buyer_match",
        "input": {"need": state["need_text"], "buyerEmail": state.get("buyer_email")},
        "output": {"mode": result["mode"], "intent": result["intent"], "reply": result["reply"], "parsedNeed": parsed_need, "validation": state["validation"], "retrieval": result["retrieval"], "productIds": [p["id"] for p in result["products"]]},
        "trace": result["trace"],
        "status": "completed",
    })
    return {"result": result}


def build_buyer_match_graph():
    graph = StateGraph(AgentGraphState)
    graph.add_node("prepare_context", buyer_prepare_node)
    graph.add_node("budget_clarify", buyer_budget_clarify_node)
    graph.add_node("customer_service", buyer_customer_service_node)
    graph.add_node("match_products", buyer_match_node)
    graph.add_node("persist_run", buyer_persist_node)
    graph.add_edge(START, "prepare_context")
    graph.add_conditional_edges(
        "prepare_context",
        buyer_route,
        {
            "budget_clarify": "budget_clarify",
            "customer_service": "customer_service",
            "match": "match_products",
        },
    )
    graph.add_edge("budget_clarify", "persist_run")
    graph.add_edge("customer_service", "persist_run")
    graph.add_edge("match_products", "persist_run")
    graph.add_edge("persist_run", END)
    return graph.compile()


BUYER_MATCH_GRAPH = build_buyer_match_graph()


def run_buyer_match_agent(payload):
    run_id = str(uuid.uuid4())
    session_id = payload.get("sessionId") or str(uuid.uuid4())
    need_text = payload["need"]
    buyer_email = payload.get("buyerEmail")
    try:
        state = BUYER_MATCH_GRAPH.invoke({
            "payload": payload,
            "run_id": run_id,
            "session_id": session_id,
            "need_text": need_text,
            "buyer_email": buyer_email,
        })
        return state["result"]
    except Exception as error:
        trace = [{"label": "Agent失败", "detail": str(error)}]
        record_agent_run({"id": run_id, "sessionId": session_id, "agentType": "buyer_match", "input": {"need": need_text, "buyerEmail": buyer_email}, "output": {"error": str(error)}, "trace": trace, "status": "failed"})
        raise


def upload_analysis_for(image):
    if not isinstance(image, str) or not image.startswith("/uploads/"):
        return {}
    meta_path = upload_meta_path_for(image)
    if not meta_path.exists():
        return {}
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def upload_meta_path_for(image):
    return UPLOAD_DIR / f"{Path(image).name}.meta.json"


def update_upload_analysis_for(image, updates):
    if not isinstance(updates, dict) or not isinstance(image, str) or not image.startswith("/uploads/"):
        return
    meta_path = upload_meta_path_for(image)
    current = upload_analysis_for(image)
    current.update(updates)
    meta_path.write_text(json.dumps(current, ensure_ascii=False), encoding="utf-8")


def analysis_purple_ratio(analysis):
    try:
        value = float(analysis.get("purpleRatio") or 0)
        if value:
            return value
    except (TypeError, ValueError):
        return 0
    rgb = analysis.get("avgRgb")
    if not isinstance(rgb, list) or len(rgb) < 3:
        return 0
    try:
        r, g, b = [float(item) for item in rgb[:3]]
    except (TypeError, ValueError):
        return 0
    if r > g * 1.08 and b > g * 1.04 and abs(r - b) < 90:
        return min(0.7, max(0, ((r - g) + (b - g)) / 255))
    return 0


def normalize_upload_analysis(analysis):
    result = dict(analysis or {})
    purple_ratio = analysis_purple_ratio(result)
    if purple_ratio >= 0.12:
        result["purpleRatio"] = round(purple_ratio, 3)
        if result.get("dominantTone") in {"", None, "浅色", "蓝水"}:
            result["dominantTone"] = "紫罗兰"
        try:
            jade_score = float(result.get("jadeScore") or 0)
        except (TypeError, ValueError):
            jade_score = 0
        if jade_score < 24:
            result["jadeScore"] = min(92, round(45 + purple_ratio * 85))
        result["isJadeLike"] = True
    return result


def upload_path_for(image):
    if not isinstance(image, str) or not image.startswith("/uploads/"):
        return None
    path = UPLOAD_DIR / Path(image).name
    return path if path.exists() else None


def vision_path_for(image):
    analysis = upload_analysis_for(image)
    vision_url = analysis.get("visionUrl")
    if isinstance(vision_url, str) and vision_url.startswith("/uploads/"):
        path = UPLOAD_DIR / Path(vision_url).name
        if path.exists():
            return path
    return upload_path_for(image)


def image_set_signature(images):
    return "|".join(str(image or "") for image in images or [])


def ollama_base_url():
    return os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")


def available_ollama_models():
    try:
        req = request.Request(f"{ollama_base_url()}/api/tags")
        with request.urlopen(req, timeout=2) as response:
            data = json.loads(response.read().decode())
    except Exception:
        return []
    return [str(item.get("name") or item.get("model") or "") for item in data.get("models", [])]


def ollama_vision_model():
    configured = os.environ.get("OLLAMA_VISION_MODEL") or os.environ.get("VISION_MODEL")
    if configured:
        return configured
    models = available_ollama_models()
    for preferred in ("qwen2.5vl:3b", "qwen2.5vl:7b"):
        if preferred in models:
            return preferred
    for model in models:
        if any(candidate in model.lower() for candidate in OLLAMA_VISION_CANDIDATES):
            return model
    return None


def extract_json_object(text):
    text = str(text or "").strip()
    if not text:
        return {}
    try:
        value = json.loads(text)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        return {}
    try:
        value = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def compact_json_keys(value):
    if not isinstance(value, dict):
        return {}
    return {str(key).strip(): item for key, item in value.items()}


def normalize_vlm_category(value):
    text = str(value or "").strip().lower()
    if is_empty_vlm_value(text):
        return ""
    mapping = [
        (("手镯", "镯", "bangle", "bracelet"), "手镯"),
        (("吊坠", "坠", "pendant"), "吊坠"),
        (("项链", "necklace"), "项链"),
        (("戒指", "指环", "ring"), "戒指"),
        (("戒面", "蛋面", "cabochon", "裸石"), "戒面"),
        (("平安扣", "扣", "donut"), "平安扣"),
        (("珠链", "bead necklace"), "珠链"),
        (("手链", "手串", "bead bracelet"), "手串"),
        (("无事牌", "牌", "plaque"), "无事牌"),
        (("耳坠", "earring"), "耳坠"),
        (("挂件", "charm"), "挂件"),
        (("胸针", "brooch", "pin"), "胸针"),
        (("把件", "手把件", "把玩", "hand piece", "handheld"), "把件"),
        (("摆件", "雕件", "雕刻", "陈设", "桌摆", "案头", "ornament", "decorative", "display", "sculpture", "statue", "figurine"), "摆件"),
    ]
    for terms, category in mapping:
        if any(term in text for term in terms):
            return category
    return value if value in SEMANTIC_CATALOG["categories"] else ""


def is_empty_vlm_value(value):
    text = str(value or "").strip().lower()
    return text in {"", "无", "未知", "未识别", "不确定", "null", "none", "n/a", "na"}


def normalize_vlm_water(value):
    text = str(value or "").strip()
    if is_empty_vlm_value(text):
        return ""
    mapping = {
        "糯": "糯种",
        "waxy": "糯种",
        "冰": "冰种",
        "icy": "冰种",
        "ice": "冰种",
        "translucent": "冰种",
        "clear": "冰种",
        "豆": "豆种",
        "bean": "豆种",
        "玻璃": "玻璃种",
        "glassy": "玻璃种",
    }
    return mapping.get(text.lower(), text)


def normalize_vlm_text(value):
    text = str(value or "").strip()
    if is_empty_vlm_value(text):
        return ""
    spaced = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", text)
    translated = VLM_TERM_TRANSLATIONS.get(spaced.lower()) or VLM_TERM_TRANSLATIONS.get(spaced.lower().replace(" ", ""))
    return translated or text


def normalize_vlm_color(value):
    text = normalize_vlm_text(value)
    mapping = {"绿色": "翠绿", "多色": "俏色", "multicolor": "俏色"}
    return mapping.get(text, text)


def normalize_vlm_shape(value):
    text = normalize_vlm_text(value)
    mapping = {"矩形": "方形", "圆形": "圆润", "无固定形状": "", "不规则": "随形"}
    return mapping.get(text, text)


def visible_field(value):
    text = normalize_vlm_text(value)
    return "" if "待复核" in text else text


def normalize_publish_category(category, shape, image_signal):
    normalized = normalize_vlm_category(category)
    if normalized:
        return normalized
    shape_text = normalize_vlm_text(shape).lower()
    if any(term in shape_text for term in ["手镯", "bracelet", "bangle"]):
        return "手镯"
    frontend_guess = normalize_vlm_category(image_signal.get("categoryGuess"))
    return frontend_guess if frontend_guess and frontend_guess != "手镯" else "品类待复核"


def normalize_publish_shape(shape, category, image_signal):
    shape_text = normalize_vlm_text(shape)
    if category == "手镯" and shape_text.lower() in {"圆圈", "圆环", "bracelet", "bangle"}:
        return normalize_vlm_text(image_signal.get("shapeGuess")) or "正圈"
    return shape_text or normalize_vlm_text(image_signal.get("shapeGuess"))


def publish_flaw_text(vision_flaw, hint, evidence):
    hint_flaw = extract_first(hint, SEMANTIC_CATALOG["flawTerms"]) if hint else ""
    if hint_flaw:
        return hint_flaw
    flaw = normalize_vlm_text(vision_flaw)
    if flaw:
        return flaw
    evidence_text = " ".join(str(item) for item in (evidence or []))
    if any(term in evidence_text for term in ["无明显瑕疵", "肉眼干净", "颜色均匀"]):
        return "图片未见明显瑕疵"
    return "以实物复核为准"


def publish_title_for(vision):
    title = "".join(compact([
        visible_field(vision["water"]),
        visible_field(vision["color"]),
        "翡翠",
        visible_field(vision["shape"]),
        visible_field(vision["category"]),
    ]))
    return title or "翡翠商品"


def ollama_vision_understanding(images):
    if os.environ.get("VISION_PROVIDER", "ollama") == "none":
        return {"provider": "ollama_vision", "error": "vision provider disabled"}
    model = ollama_vision_model()
    if not model:
        return {"provider": "ollama_vision", "error": "no local vision model found"}
    signature = image_set_signature(images)
    cached = upload_analysis_for(images[0]).get("visionResult") if images else None
    if isinstance(cached, dict) and cached.get("model") == model and cached.get("version") == VISION_RESULT_VERSION and cached.get("imageSet") == signature:
        cached_shape = normalize_vlm_shape(cached.get("shape"))
        return {
            **cached,
            "category": normalize_vlm_category(cached.get("category")) or normalize_vlm_category(cached_shape),
            "water": normalize_vlm_water(cached.get("water")),
            "color": normalize_vlm_color(cached.get("color")),
            "shape": cached_shape,
            "flaw": normalize_vlm_text(cached.get("flaw")),
            "subject": normalize_vlm_text(cached.get("subject")),
            "useForm": normalize_vlm_text(cached.get("useForm")),
            "motifs": [normalize_vlm_text(item) for item in cached.get("motifs", []) if normalize_vlm_text(item)] if isinstance(cached.get("motifs"), list) else [],
            "subjects": [normalize_vlm_text(item) for item in cached.get("subjects", []) if normalize_vlm_text(item)] if isinstance(cached.get("subjects"), list) else [],
            "sameItem": boolish(cached.get("sameItem"), True),
            "mismatchReason": normalize_vlm_text(cached.get("mismatchReason")),
            "cached": True,
            "durationMs": 0,
        }
    image_paths = [vision_path_for(image) for image in images]
    image_paths = [path for path in image_paths if path]
    if not image_paths:
        return {"provider": "ollama_vision", "model": model, "error": "no local upload image file"}
    started = time.time()
    prompt = (
        "You are a jadeite product vision agent. Analyze all uploaded merchant images as one candidate product image set. "
        "First decide whether every image is the same jadeite item photographed from different angles/details. "
        "Return only JSON with keys: is_jade boolean, same_item boolean, mismatch_reason string, subjects array, "
        "category string, water string, color string, shape string, visible_flaws string, confidence number 0-100, "
        "subject string, use_form string, motifs array, is_wearable boolean, has_base boolean, evidence array of short strings. "
        "Use concise Chinese jadeite trade terms. Use open visual facts instead of forcing a jewelry category. "
        "Distinguish wearable jewelry, loose stones, handheld carvings and display sculptures. "
        "If same_item is true, combine facts across all views. If same_item is false, describe why in mismatch_reason and do not merge fields. "
        "Use null when a field is not visible. Do not infer ring size or certificate from the image."
    )
    try:
        encoded_images = [base64.b64encode(path.read_bytes()).decode() for path in image_paths[:6]]
        payload = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt, "images": encoded_images}],
            "stream": False,
            "format": "json",
            "keep_alive": os.environ.get("OLLAMA_VISION_KEEP_ALIVE", "15m"),
            "options": {
                "temperature": 0,
                "top_p": 0.2,
                "num_ctx": 2048,
                "num_predict": int(os.environ.get("OLLAMA_VISION_NUM_PREDICT", "180")),
            },
        }).encode()
        req = request.Request(f"{ollama_base_url()}/api/chat", data=payload, headers={"Content-Type": "application/json"})
        with request.urlopen(req, timeout=int(os.environ.get("OLLAMA_VISION_TIMEOUT", "60"))) as response:
            data = json.loads(response.read().decode())
        content = (data.get("message") or {}).get("content")
        parsed = extract_json_object(content)
    except Exception as error:
        return {"provider": "ollama_vision", "model": model, "error": str(error)[:180], "durationMs": round((time.time() - started) * 1000)}
    if not parsed:
        return {"provider": "ollama_vision", "model": model, "error": "empty vision json", "durationMs": round((time.time() - started) * 1000)}
    parsed = compact_json_keys(parsed)
    confidence = price_or(parsed.get("confidence"), 0) or 0
    raw_shape = normalize_vlm_text(parsed.get("shape"))
    category = normalize_vlm_category(parsed.get("category")) or normalize_vlm_category(raw_shape)
    shape = "" if normalize_vlm_category(raw_shape) else raw_shape
    different_items = boolish(first_present(parsed.get("different_items"), parsed.get("differentItems")), False)
    same_item = True if len(image_paths) <= 1 else boolish(first_present(parsed.get("same_item"), parsed.get("sameItem")), True)
    if different_items:
        same_item = False
    result = {
        "provider": "ollama_vision",
        "model": model,
        "version": VISION_RESULT_VERSION,
        "imageSet": signature,
        "isJade": boolish(first_present(parsed.get("is_jade"), parsed.get("isJade")), False),
        "sameItem": same_item,
        "mismatchReason": normalize_vlm_text(first_present(parsed.get("mismatch_reason"), parsed.get("mismatchReason"))),
        "subjects": [normalize_vlm_text(item) for item in parsed.get("subjects", []) if normalize_vlm_text(item)] if isinstance(parsed.get("subjects"), list) else [],
        "category": category,
        "water": normalize_vlm_water(parsed.get("water")),
        "color": normalize_vlm_color(parsed.get("color")),
        "shape": normalize_vlm_shape(shape),
        "flaw": normalize_vlm_text(parsed.get("visible_flaws") or parsed.get("flaw")),
        "subject": normalize_vlm_text(parsed.get("subject")),
        "useForm": normalize_vlm_text(first_present(parsed.get("use_form"), parsed.get("useForm"))),
        "motifs": [normalize_vlm_text(item) for item in parsed.get("motifs", []) if normalize_vlm_text(item)] if isinstance(parsed.get("motifs"), list) else [],
        "isWearable": boolish(first_present(parsed.get("is_wearable"), parsed.get("isWearable")), False),
        "hasBase": boolish(first_present(parsed.get("has_base"), parsed.get("hasBase")), False),
        "confidence": max(0, min(100, int(confidence))),
        "evidence": parsed.get("evidence") if isinstance(parsed.get("evidence"), list) else [],
        "durationMs": round((time.time() - started) * 1000),
    }
    if images:
        update_upload_analysis_for(images[0], {"visionResult": result})
    return result


def ollama_vision_category(images):
    model = ollama_vision_model()
    if not model or not images:
        return {}
    signature = image_set_signature(images)
    cached = upload_analysis_for(images[0]).get("categoryResult")
    if isinstance(cached, dict) and cached.get("model") == model and cached.get("version") == CATEGORY_CLASSIFIER_VERSION and cached.get("imageSet") == signature:
        return {
            **cached,
            "category": normalize_vlm_category(cached.get("category")),
            "shape": normalize_vlm_shape(cached.get("shape")),
            "cached": True,
            "durationMs": 0,
        }
    image_paths = [vision_path_for(image) for image in images]
    image_paths = [path for path in image_paths if path]
    if not image_paths:
        return {}
    started = time.time()
    prompt = (
        "You are a jadeite merchant visual taxonomy probe. "
        "Do not force the item into a closed category list. Describe what is visible for downstream mapping. "
        "Return only JSON with keys: raw_category string, product_role string, use_form string, "
        "shape string, motifs array, is_wearable boolean, has_base boolean, confidence number 0-100, evidence array. "
        "product_role examples include wearable jewelry, loose stone, handheld carving, display sculpture, table ornament. "
        "If it has a carved base or is a decorative scene, say that clearly in evidence."
    )
    try:
        encoded_images = [base64.b64encode(path.read_bytes()).decode() for path in image_paths[:6]]
        payload = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt, "images": encoded_images}],
            "stream": False,
            "format": "json",
            "keep_alive": os.environ.get("OLLAMA_VISION_KEEP_ALIVE", "15m"),
            "options": {
                "temperature": 0,
                "top_p": 0.2,
                "num_ctx": 1536,
                "num_predict": 120,
            },
        }).encode()
        req = request.Request(f"{ollama_base_url()}/api/chat", data=payload, headers={"Content-Type": "application/json"})
        with request.urlopen(req, timeout=int(os.environ.get("OLLAMA_VISION_TIMEOUT", "60"))) as response:
            data = json.loads(response.read().decode())
        parsed = extract_json_object((data.get("message") or {}).get("content"))
    except Exception as error:
        return {"provider": "ollama_vision_category", "model": model, "error": str(error)[:180], "durationMs": round((time.time() - started) * 1000)}
    if not parsed:
        return {"provider": "ollama_vision_category", "model": model, "error": "empty category json", "durationMs": round((time.time() - started) * 1000)}
    parsed = compact_json_keys(parsed)
    result = {
        "provider": "ollama_vision_category",
        "model": model,
        "version": CATEGORY_CLASSIFIER_VERSION,
        "imageSet": signature,
        "rawCategory": normalize_vlm_text(parsed.get("raw_category") or parsed.get("category")),
        "productRole": normalize_vlm_text(parsed.get("product_role") or parsed.get("productRole")),
        "useForm": normalize_vlm_text(parsed.get("use_form") or parsed.get("useForm")),
        "category": normalize_vlm_category(parsed.get("raw_category") or parsed.get("category") or parsed.get("product_role") or parsed.get("use_form")),
        "shape": normalize_vlm_shape(parsed.get("shape")),
        "motifs": [normalize_vlm_text(item) for item in parsed.get("motifs", []) if normalize_vlm_text(item)] if isinstance(parsed.get("motifs"), list) else [],
        "isWearable": boolish(first_present(parsed.get("is_wearable"), parsed.get("isWearable")), False),
        "hasBase": boolish(first_present(parsed.get("has_base"), parsed.get("hasBase")), False),
        "confidence": max(0, min(100, int(price_or(parsed.get("confidence"), 0) or 0))),
        "evidence": parsed.get("evidence") if isinstance(parsed.get("evidence"), list) else [],
        "durationMs": round((time.time() - started) * 1000),
    }
    update_upload_analysis_for(images[0], {"categoryResult": result})
    return result


def merged_upload_analyses(images, supplied):
    supplied = supplied if isinstance(supplied, list) else []
    analyses = []
    for index, image in enumerate(images):
        merged = {**upload_analysis_for(image)}
        if index < len(supplied) and isinstance(supplied[index], dict):
            merged.update(supplied[index])
        merged["url"] = image
        analyses.append(normalize_upload_analysis(merged))
    return analyses


def dominant_upload_signal(analyses):
    scored = sorted(analyses, key=lambda item: float(item.get("jadeScore") or 0), reverse=True)
    return scored[0] if scored else {}


def publish_size_from_hint(need):
    return need.get("sizes", [""])[0] if need.get("sizes") else ""


def flatten_text_values(value):
    if isinstance(value, dict):
        parts = []
        for item in value.values():
            parts.extend(flatten_text_values(item))
        return parts
    if isinstance(value, list):
        parts = []
        for item in value:
            parts.extend(flatten_text_values(item))
        return parts
    if isinstance(value, (str, int, float, bool)):
        return [str(value)]
    return []


def visual_text_blob(*values):
    return " ".join(part for value in values for part in flatten_text_values(value)).lower()


def has_any(text, terms):
    return any(term.lower() in text for term in terms)


def resolve_publish_category(need, vlm, category_result, image_signal):
    if need.get("category"):
        return need["category"]
    raw_category = normalize_vlm_category(vlm.get("category")) or normalize_vlm_category(category_result.get("category"))
    text = visual_text_blob(vlm, category_result, image_signal)
    wearable = bool(vlm.get("isWearable") or category_result.get("isWearable"))
    has_base = bool(vlm.get("hasBase") or category_result.get("hasBase"))
    display_terms = ["摆件", "桌摆", "案头", "陈设", "底座", "雕件", "雕刻", "ornament", "decorative", "display", "sculpture", "statue", "figurine", "table ornament"]
    handheld_terms = ["把件", "手把件", "把玩", "盘玩", "handheld", "hand piece"]
    wearable_terms = ["佩戴", "挂绳", "吊孔", "项链", "链", "戒托", "戒圈", "耳钩", "耳针", "wearable", "pendant", "necklace", "ring", "earring", "brooch"]
    if has_base or (has_any(text, display_terms) and not (wearable or has_any(text, wearable_terms))):
        return "摆件"
    if has_any(text, handheld_terms):
        return "把件"
    if raw_category == "挂件" and has_any(text, ["海螺", "贝壳", "蟾蜍", "金蟾", "灵芝", "底座", "装饰", "decorative item"]):
        return "摆件"
    if has_any(text, ["metal band", "metal shank", "戒托", "戒圈", "指环"]):
        return "戒指"
    if has_any(text, ["large continuous loop", "one big wrist opening", "手镯", "镯子", "bangle"]) and not has_any(text, ["metal band", "戒托"]):
        return "手镯"
    return raw_category or normalize_publish_category("", vlm.get("shape"), image_signal)


def resolve_publish_shape(need, category, vlm, category_result, image_signal):
    if need.get("shape"):
        return need["shape"]
    text = visual_text_blob(vlm, category_result, image_signal)
    motifs = compact([normalize_vlm_text(item) for item in [*(vlm.get("motifs") or []), *(category_result.get("motifs") or [])] if normalize_vlm_text(item)])
    raw_shape = normalize_vlm_shape(vlm.get("shape") or category_result.get("shape") or image_signal.get("shapeGuess"))
    if category in {"摆件", "把件"}:
        if has_any(text, ["海螺", "贝壳", "shell"]) and has_any(text, ["蟾蜍", "金蟾", "frog", "toad"]):
            return "海螺蟾蜍"
        if has_any(text, ["蟾蜍", "金蟾", "frog", "toad"]):
            return "金蟾"
        if motifs:
            return "".join(motifs[:2])
        if raw_shape and raw_shape not in {"圆润", "经典", "立体雕件"}:
            return raw_shape
        if has_any(text, ["山水"]):
            return "山水"
        if has_any(text, ["观音"]):
            return "观音"
        if has_any(text, ["佛公"]):
            return "佛公"
        return "立体雕件"
    if category == "手镯" and raw_shape.lower() in {"圆圈", "圆环", "bracelet", "bangle", "圆润"}:
        return normalize_vlm_text(image_signal.get("shapeGuess")) or "正圈"
    return raw_shape


def resolve_publish_color(need, vlm, image_signal, category_result):
    if need.get("color"):
        return need["color"]
    color = normalize_vlm_color(vlm.get("color")) or image_signal.get("dominantTone") or "颜色待复核"
    if color in SEMANTIC_CATALOG["waters"]:
        return ""
    text = visual_text_blob(vlm, category_result, image_signal)
    if has_any(text, ["俏色", "多色", "黄", "白", "褐", "brown", "yellow", "white"]) and has_any(text, ["绿", "翠绿", "green"]):
        return "俏色"
    return color


def resolve_publish_scene(category, hint):
    scenes = [scene for scene in SEMANTIC_CATALOG["scenes"] if scene in hint]
    if scenes:
        return "/".join(scenes)
    if category == "摆件":
        return "陈设收藏"
    if category == "把件":
        return "把玩收藏"
    if category == "胸针":
        return "衣饰点缀"
    return "日常佩戴"


def publish_display_size(category, shape, size):
    visible_size = visible_field(size)
    if visible_size:
        return visible_size
    category = visible_field(category)
    shape = visible_field(shape)
    if category == "手镯":
        return "约55mm圈口"
    if category in {"吊坠", "挂件"}:
        return "约36x21mm"
    if category == "项链":
        return "约45cm链长"
    if category == "戒指":
        return "约14号"
    if category == "戒面":
        return "约12x10mm"
    if category == "平安扣":
        return "约28mm"
    if category in {"珠链", "手链", "手串"}:
        return "约8mm珠径"
    if category == "无事牌":
        return "约46x28mm"
    if category == "胸针":
        return "约36x22mm"
    if category == "把件":
        return "约60x38mm"
    if category == "摆件":
        return "约120x80mm"
    return shape or "常规尺寸"


def estimated_publish_price(category, water, color):
    base = {
        "手镯": 26000,
        "吊坠": 12800,
        "项链": 36000,
        "戒指": 19000,
        "戒面": 16000,
        "平安扣": 9000,
        "珠链": 42000,
        "手链": 18000,
        "手串": 22000,
        "无事牌": 24000,
        "耳坠": 9000,
        "挂件": 11000,
        "胸针": 13000,
        "把件": 26000,
        "摆件": 38000,
    }.get(category, 15000)
    water_factor = {"豆种": 0.5, "糯种": 0.72, "糯冰": 0.9, "冰糯": 0.92, "冰种": 1.25, "高冰": 1.65, "玻璃种": 2.2}.get(water, 1)
    color_factor = {"帝王绿": 3.0, "正阳绿": 2.25, "阳绿": 1.9, "满绿": 2.1, "飘绿": 1.25, "晴底": 1.05, "蓝水": 1.18, "白冰": 1.1, "紫罗兰": 1.22, "墨翠": 1.35, "俏色": 1.25, "翠绿": 1.18}.get(color, 1)
    return max(800, round(base * water_factor * color_factor / 100) * 100)


def publish_image_understanding(hint, images, supplied_analyses):
    analyses = merged_upload_analyses(images, supplied_analyses)
    if not analyses:
        raise ValidationError("Invalid publish request", [{"field": "images", "message": "请先上传翡翠商品图片"}])
    image_signal = dominant_upload_signal(analyses)
    vlm = ollama_vision_understanding(images)
    if vlm.get("error"):
        raise ValidationError("Invalid publish image", [{"field": "images", "message": f"视觉模型识别失败：{vlm['error']}"}])
    if not vlm.get("isJade"):
        raise ValidationError("Invalid publish image", [{"field": "images", "message": "视觉模型未确认该图片为翡翠商品，请上传清晰的翡翠商品照片"}])
    if len(images) > 1 and not vlm.get("sameItem"):
        reason = f"：{vlm.get('mismatchReason')}" if vlm.get("mismatchReason") else ""
        raise ValidationError("Invalid publish image set", [{"field": "images", "message": f"多张图片看起来不是同一个翡翠商品{reason}。请只上传同一件商品的不同角度或细节图。"}])
    need = heuristic_need(hint) if hint else {}
    category_result = ollama_vision_category(images) if not need.get("category") else {}
    category = resolve_publish_category(need, vlm, category_result, image_signal)
    if category not in SEMANTIC_CATALOG["categories"]:
        category = "品类待复核"
    water = need.get("water") or normalize_vlm_water(vlm.get("water")) or image_signal.get("waterGuess") or "种水待复核"
    color = resolve_publish_color(need, vlm, image_signal, category_result)
    shape = resolve_publish_shape(need, category, vlm, category_result, image_signal)
    size = publish_size_from_hint(need)
    flaw = publish_flaw_text(vlm.get("flaw"), hint, vlm.get("evidence"))
    confidence = min(98, max(55, round(vlm.get("confidence") or 0)))
    return {
        "category": category,
        "water": water,
        "color": color,
        "shape": shape,
        "size": size,
        "flaw": flaw,
        "scene": resolve_publish_scene(category, hint),
        "price": estimated_publish_price(category, water, color),
        "confidence": confidence,
        "analyses": analyses,
        "isJade": True,
        "sameItem": vlm.get("sameItem", True),
        "mismatchReason": vlm.get("mismatchReason") or "",
        "provider": "ollama_vision",
        "model": vlm.get("model"),
        "subject": vlm.get("subject") or "",
        "subjects": vlm.get("subjects") or [],
        "useForm": vlm.get("useForm") or "",
        "motifs": vlm.get("motifs") or [],
        "evidence": vlm.get("evidence") or [],
        "categoryEvidence": category_result.get("evidence") or [],
    }


def publish_evidence_text(vision):
    texts = []
    for key in ["subject", "useForm", "category", "water", "color", "shape", "flaw"]:
        if vision.get(key):
            texts.append(str(vision.get(key)))
    for item in [*(vision.get("subjects") or []), *(vision.get("motifs") or [])]:
        texts.append(str(item))
    for item in [*(vision.get("evidence") or []), *(vision.get("categoryEvidence") or [])]:
        if isinstance(item, dict):
            texts.extend(str(value) for value in item.values() if isinstance(value, (str, int, float)))
        else:
            texts.append(str(item))
    return " ".join(texts)


def publish_fact_tags(vision, category_text, shape_text, size_text, flaw_text, visible_water, visible_color):
    evidence = publish_evidence_text(vision)
    motifs = [visible_field(item) for item in (vision.get("motifs") or []) if visible_field(item)]
    subjects = [visible_field(item) for item in (vision.get("subjects") or []) if visible_field(item)]
    subject = visible_field(vision.get("subject"))
    use_form = visible_field(vision.get("useForm"))
    combined_shape = f"{shape_text}{category_text}" if shape_text and category_text and category_text != "翡翠商品" and category_text not in shape_text else shape_text
    fact_terms = []
    for label, terms in [
        ("方形主石", ["方形主石", "square stone", "square main stone"]),
        ("金属戒托", ["金属戒托", "银色金属", "戒托", "metal band", "metal shank", "metal setting"]),
        ("镶嵌款", ["镶嵌", "戒托", "metal setting"]),
        ("立体雕刻", ["立体", "雕刻", "雕件", "sculpture", "carving"]),
        ("底座陈设", ["底座", "陈设", "摆件", "base", "display"]),
        ("花叶题材", ["花叶", "花", "叶", "flower", "leaf"]),
        ("金蟾题材", ["金蟾", "蟾蜍", "frog", "toad"]),
        ("海螺题材", ["海螺", "贝壳", "shell", "conch"]),
        ("抛光光面", ["抛光", "光滑", "光面", "smooth"]),
        ("俏色雕工", ["俏色", "多色", "multicolored"]),
    ]:
        if any(term in evidence for term in terms):
            fact_terms.append(label)
    size_tag = size_text if vision.get("size") else ""
    flaw_tag = flaw_text if flaw_text and flaw_text != "以实物复核为准" else ""
    return compact([
        visible_water,
        visible_color,
        f"翡翠{category_text}" if category_text != "翡翠商品" else "",
        combined_shape,
        subject,
        use_form,
        *motifs,
        *subjects,
        size_tag,
        flaw_tag,
        *fact_terms,
    ])[:10]


def publish_copy_for(title, vision, water_text, color_text, category_text, shape_text, size_text, flaw_text):
    evidence = publish_evidence_text(vision)
    scene = vision["scene"]
    if category_text == "戒指":
        setting = "银色戒托" if any(term in evidence for term in ["银", "银色"]) else "金属戒托" if "金属" in evidence else "镶嵌戒托"
        face = f"{shape_text}戒面" if shape_text not in {"经典", "圆润"} else "戒面"
        intro = f"{water_text}{color_text}，{face}配{setting}，色彩集中，适合{scene}。"
        detail = f"这款{title}主石呈{face}，{color_text}色调集中醒目，{water_text}质感细腻耐看。{setting}线条利落，佩戴时视觉重心清晰，{size_text}，适合日常搭配或轻礼赠。{flaw_text}，整体风格清爽有辨识度。"
        return intro, detail
    if category_text == "手镯":
        body = "镯身" if shape_text in {"正圈", "圆条", "贵妃", "圆环"} else f"{shape_text}镯身"
        visual = "抛光面光润" if any(term in evidence for term in ["表面光滑", "光滑"]) else "轮廓圆顺"
        tone = "紫罗兰色调柔和铺展" if color_text == "紫罗兰" else f"{color_text}色调自然分布"
        intro = f"{water_text}{color_text}，{shape_text}手镯，{visual}，适合{scene}。"
        detail = f"这款{title}为{shape_text}镯型，{body}{visual}，{tone}。整体以{water_text}质感为主，观感温润，{size_text}，上手存在感稳定。{flaw_text}，适合日常佩戴，也适合作为端庄礼赠。"
        return intro, detail
    if category_text in {"吊坠", "挂件"}:
        intro = f"{water_text}{color_text}，{shape_text}{category_text}，体量轻巧，适合{scene}。"
        detail = f"这款{title}以{shape_text}造型呈现，{color_text}色调干净，{water_text}质感让整体更显水润。{size_text}，佩戴在颈部或作挂饰都比较清爽。{flaw_text}，适合日常搭配或礼赠。"
        return intro, detail
    if category_text == "平安扣":
        intro = f"{water_text}{color_text}，圆润平安扣，寓意平稳，适合{scene}。"
        detail = f"这款{title}为平安扣器型，外圆内圆比例清楚，{color_text}色调耐看，{water_text}质感柔和。{size_text}，适合配绳或项链佩戴。{flaw_text}，整体风格简洁，礼赠和自用都稳妥。"
        return intro, detail
    if category_text in {"珠链", "手链", "手串"}:
        intro = f"{water_text}{color_text}，珠形圆润，适合{scene}。"
        detail = f"这款{title}以珠形结构为主，颗粒观感统一，{color_text}色调自然，{water_text}质感让整体更显柔和。{size_text}，上手或上颈都比较耐看。{flaw_text}，适合日常搭配。"
        return intro, detail
    if category_text == "胸针":
        intro = f"{water_text}{color_text}，{shape_text}胸针，造型有辨识度，适合{scene}。"
        detail = f"这款{title}以{shape_text}造型呈现，{color_text}色调醒目，{water_text}质感柔和。{size_text}，适合点缀外套、围巾或礼服。{flaw_text}，整体装饰感清爽。"
        return intro, detail
    if category_text == "把件":
        intro = f"{water_text}{color_text}，{shape_text}把件，雕工层次清楚，适合把玩收藏。"
        detail = f"这款{title}为手把件器型，{shape_text}主题清楚，{color_text}色调与雕刻层次相互衬托。整体以{water_text}质感为主，{size_text}，握持观感饱满。{flaw_text}，适合把玩、陈列或收藏。"
        return intro, detail
    if category_text == "摆件":
        intro = f"{water_text}{color_text}，{shape_text}摆件，俏雕层次丰富，适合陈设收藏。"
        detail = f"这款{title}为立体陈设摆件，{shape_text}主题突出，{color_text}色彩层次与雕刻细节相互呼应。整体以{water_text}质感呈现，{size_text}，适合书房、茶台或案头陈设。{flaw_text}，观赏性和装饰性较强。"
        return intro, detail
    intro = f"{water_text}{color_text}，{shape_text}{category_text}，观感清爽，适合{scene}。"
    detail = f"这款{title}以{shape_text}造型为主，{color_text}色调自然，{water_text}质感细腻。{size_text}，整体比例协调。{flaw_text}，适合{scene}。"
    return intro, detail


def local_draft(hint, images, image_analyses=None, vision=None):
    vision = vision or publish_image_understanding(hint, images, image_analyses)
    title = publish_title_for(vision)
    visible_water = visible_field(vision["water"])
    visible_color = visible_field(vision["color"])
    water_text = visible_water or "细腻"
    color_text = visible_color or "自然"
    quality = "".join(compact([visible_water, visible_color])) or water_text
    category_text = visible_field(vision["category"]) or "翡翠商品"
    shape_text = visible_field(vision["shape"]) or ("圆润" if category_text == "手镯" else "经典")
    size_text = publish_display_size(category_text, shape_text, vision["size"])
    flaw_text = vision["flaw"] if vision["flaw"] != "以实物复核为准" else "图片未见明显纹裂"
    tags = publish_fact_tags(vision, category_text, shape_text, size_text, flaw_text, visible_water, visible_color)
    intro, detail = publish_copy_for(title, vision, water_text, color_text, category_text, shape_text, size_text, flaw_text)
    image_check = "多张图片已校验为同一件商品" if len(images) > 1 else "单张图片已校验"
    return {
        "title": title[:32],
        "category": vision["category"],
        "price": vision["price"],
        "originPrice": round(vision["price"] * 1.08 / 100) * 100,
        "diameter": size_text,
        "quality": quality,
        "material": "翡翠",
        "jadeiteType": vision["water"],
        "color": vision["color"],
        "water": vision["water"],
        "shape": vision["shape"],
        "size": size_text,
        "certificate": "支持复检",
        "flaws": flaw_text,
        "treatment": "天然A货",
        "scene": vision["scene"],
        "intro": intro,
        "detail": detail,
        "tags": tags,
        "images": images,
        "merchantNotes": "AI已基于商家上传图片生成，发布前请复核尺寸、瑕疵、证书和价格。",
        "agentNotes": ["翡翠图片校验", "多图同物校验", "图像字段识别", "商品文案生成", "价格区间估算", "发布合规检查"],
        "checks": ["已确认存在商家上传图片", image_check, f"图片校验置信度 {vision['confidence']}%", "标题含品类和图像识别字段", "商品标签来自图片事实"],
        "confidence": round(vision["confidence"] / 100, 2),
        "vision": {
            "isJade": vision["isJade"],
            "sameItem": vision.get("sameItem", True),
            "mismatchReason": vision.get("mismatchReason") or "",
            "confidence": vision["confidence"],
            "provider": vision.get("provider"),
            "model": vision.get("model"),
            "evidence": vision.get("evidence") or [],
            "imageCount": len(images),
            "category": vision["category"],
            "water": vision["water"],
            "color": vision["color"],
            "shape": vision["shape"],
            "subject": vision.get("subject") or "",
            "subjects": vision.get("subjects") or [],
            "useForm": vision.get("useForm") or "",
            "motifs": vision.get("motifs") or [],
        },
    }


def publish_prepare_node(state):
    payload = state["payload"]
    return {
        "seller_id": payload["sellerId"],
        "hint": str(payload.get("hint") or payload.get("notes") or ""),
        "images": payload.get("images") if isinstance(payload.get("images"), list) else [],
        "image_analyses": payload.get("imageAnalyses") if isinstance(payload.get("imageAnalyses"), list) else [],
    }


def publish_validate_images_node(state):
    vision = publish_image_understanding(state["hint"], state["images"], state["image_analyses"])
    return {"vision": vision}


def publish_draft_node(state):
    draft = {
        **local_draft(state["hint"], state["images"], state["image_analyses"], state.get("vision")),
        "sellerId": state["seller_id"],
        "provider": "ollama-vision-agent",
    }
    return {"output": draft}


def publish_record_node(state):
    draft = state["output"]
    trace = [{"label": "LangGraph状态", "detail": "LangGraph merchant_publish 已完成"}, *[{"label": note, "detail": "视觉识别与字段组装已完成"} for note in draft["agentNotes"]]]
    record_agent_run({"id": state["run_id"], "agentType": "merchant_publish", "input": {"sellerId": state["seller_id"], "hint": state["hint"], "images": state["images"]}, "output": draft, "trace": trace, "status": "completed"})
    return {"result": {**draft, "runId": state["run_id"], "trace": trace}}


def build_publish_graph():
    graph = StateGraph(AgentGraphState)
    graph.add_node("prepare_publish", publish_prepare_node)
    graph.add_node("validate_images", publish_validate_images_node)
    graph.add_node("draft_product", publish_draft_node)
    graph.add_node("record_run", publish_record_node)
    graph.add_edge(START, "prepare_publish")
    graph.add_edge("prepare_publish", "validate_images")
    graph.add_edge("validate_images", "draft_product")
    graph.add_edge("draft_product", "record_run")
    graph.add_edge("record_run", END)
    return graph.compile()


PUBLISH_GRAPH = build_publish_graph()


def run_publish_agent(payload):
    run_id = str(uuid.uuid4())
    try:
        state = PUBLISH_GRAPH.invoke({"payload": payload, "run_id": run_id})
        return state["result"]
    except Exception as error:
        record_agent_run({"id": run_id, "agentType": "merchant_publish", "input": payload, "output": {"error": str(error)}, "trace": [{"label": "Agent失败", "detail": str(error)}], "status": "failed"})
        raise


def local_followup(lead):
    return {
        "buyerSummary": f"{lead['buyerNeed']}，关注商品：{lead['productTitle']}",
        "reply": f"您好，我是{lead['sellerName']}。您咨询的「{lead['productTitle']}」目前还在，可先为您确认预算、佩戴尺寸和是否需要证书。若方便，我可以发自然光视频和细节图给您参考。",
        "nextActions": ["确认预算与尺寸", "发送自然光视频", "补充证书和瑕疵说明"],
        "riskFlags": ["重点确认无纹裂和证书信息"] if "无纹裂" in lead["buyerNeed"] else ["补充自然光图，降低买家疑虑"],
        "tone": "专业、克制、主动推进",
    }


def lead_load_node(state):
    payload = state["payload"]
    seller_id = payload["sellerId"]
    lead_id = payload["leadId"]
    session_id = f"lead-followup-{lead_id}"
    lead = get_seller_lead(lead_id, seller_id)
    if not lead:
        raise ValueError("Lead not found")
    get_or_create_session(session_id, "lead_followup", lead["sellerEmail"])
    add_message(session_id, "user", lead["buyerNeed"], {"leadId": lead_id, "sellerId": seller_id})
    return {"seller_id": seller_id, "lead_id": lead_id, "session_id": session_id, "lead": lead}


def lead_followup_node(state):
    output = {**local_followup(state["lead"]), "sellerId": state["seller_id"], "leadId": int(state["lead_id"]), "provider": "python-rule"}
    trace = [
        {"label": "客资读取 Tool", "detail": f"读取客资 #{state['lead']['id']} 与商品「{state['lead']['productTitle']}」"},
        {"label": "需求摘要 Agent", "detail": output["buyerSummary"]},
        {"label": "跟进话术 Agent", "detail": output["reply"]},
        {"label": "下一步动作", "detail": "、".join(output["nextActions"])},
        {"label": "LangGraph状态", "detail": "LangGraph lead_followup 已完成"},
    ]
    return {"output": output, "result": {"trace": trace}}


def lead_record_node(state):
    output = state["output"]
    trace = state["result"]["trace"]
    add_message(state["session_id"], "assistant", output["reply"], {"leadId": state["lead_id"], "sellerId": state["seller_id"], "output": output, "trace": trace})
    record_agent_run({"id": state["run_id"], "sessionId": state["session_id"], "agentType": "lead_followup", "input": {"sellerId": state["seller_id"], "leadId": state["lead_id"]}, "output": output, "trace": trace, "status": "completed"})
    return {"result": {"runId": state["run_id"], "sessionId": state["session_id"], "lead": state["lead"], **output, "trace": trace}}


def build_lead_followup_graph():
    graph = StateGraph(AgentGraphState)
    graph.add_node("load_lead", lead_load_node)
    graph.add_node("write_followup", lead_followup_node)
    graph.add_node("record_run", lead_record_node)
    graph.add_edge(START, "load_lead")
    graph.add_edge("load_lead", "write_followup")
    graph.add_edge("write_followup", "record_run")
    graph.add_edge("record_run", END)
    return graph.compile()


LEAD_FOLLOWUP_GRAPH = build_lead_followup_graph()


def run_lead_followup_agent(payload):
    run_id = str(uuid.uuid4())
    try:
        state = LEAD_FOLLOWUP_GRAPH.invoke({"payload": payload, "run_id": run_id})
        return state["result"]
    except Exception as error:
        record_agent_run({"id": run_id, "sessionId": f"lead-followup-{payload.get('leadId')}", "agentType": "lead_followup", "input": payload, "output": {"error": str(error)}, "trace": [{"label": "Agent失败", "detail": str(error)}], "status": "failed"})
        raise
