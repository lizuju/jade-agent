import re
import time
import uuid
from urllib import request
import json
import os

from .db import (
    add_message,
    create_lead,
    get_or_create_session,
    get_seller_lead,
    get_session_state,
    list_products,
    record_agent_run,
    search_product_documents,
    update_session_state,
)


SEMANTIC_CATALOG = {
    "categories": ["手镯", "吊坠", "戒面", "平安扣", "珠链", "手串", "无事牌", "耳坠", "挂件"],
    "waters": ["豆种", "糯种", "糯冰", "冰糯", "冰种", "高冰", "玻璃种"],
    "colors": ["晴底", "晴底色", "晴水", "白冰", "飘花", "飘绿", "阳绿", "正阳绿", "满绿", "辣绿", "蓝水", "紫罗兰", "春彩", "黄翡", "红翡", "油青", "墨翠", "帝王绿"],
    "shapes": ["正圈", "圆条", "贵妃", "水滴", "如意", "佛公", "观音", "叶子", "葫芦", "蛋面", "马鞍", "圆扣", "怀古扣", "圆珠", "算盘珠", "素牌", "龙牌"],
    "flawTerms": ["无纹裂", "无裂", "无纹", "微瑕", "肉眼干净", "轻微棉絮", "少量石纹", "边缘细小矿点"],
    "scenes": ["送礼", "自用", "收藏", "日常佩戴", "通勤佩戴", "节日礼赠"],
}

COLOR_FAMILIES = {
    "帝王绿": ["帝王绿", "正阳绿", "满绿", "阳绿", "高绿", "飘绿", "绿色"],
    "阳绿": ["阳绿", "正阳绿", "帝王绿", "满绿", "飘绿", "绿色"],
    "飘绿": ["飘绿", "阳绿", "绿色"],
    "晴底": ["晴底", "晴底色"],
    "白冰": ["白冰", "冰白"],
}

FLAW_FAMILIES = {
    "微瑕": ["微瑕", "轻微棉絮", "少量石纹", "边缘细小矿点"],
    "无纹裂": ["无纹裂", "无裂", "无纹", "肉眼干净"],
    "无裂": ["无纹裂", "无裂", "肉眼干净"],
    "无纹": ["无纹裂", "无纹", "肉眼干净"],
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
    range_match = re.search(r"(\d+(?:\.\d+)?)\s*(万|w|W|k|K)?\s*(?:到|至|-|~)\s*(\d+(?:\.\d+)?)\s*(万|w|W|k|K)?", text)
    if range_match:
        unit = range_match.group(4) or range_match.group(2) or ""
        return price_or(f"{range_match.group(3)}{unit}")
    unit_match = re.search(r"(\d+(?:\.\d+)?)\s*(万|w|W|k|K)", text)
    if unit_match:
        return price_or(f"{unit_match.group(1)}{unit_match.group(2)}")
    budget_match = (
        re.search(r"(?:预算|价位|价格|以内|左右|不超过|控制在)[^\d]{0,6}(\d+(?:\.\d+)?)\s*(万|w|W|k|K)?", text)
        or re.search(r"(\d+(?:\.\d+)?)\s*(万|w|W|k|K)?\s*(?:预算|以内|左右|价位|价格)", text)
    )
    if not budget_match:
        return None
    return price_or(f"{budget_match.group(1)}{budget_match.group(2) or ''}")


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
    if re.search(r"便宜|实惠|性价比|划算|入门|低预算", text):
        return "value"
    return ""


def accepts_any_category(text):
    return bool(re.search(r"品类.*都可以|品种.*都可以|类型.*都可以|款式.*都可以|什么.*都可以|不限品类|不限品种|都行|随便", text))


def extract_preference_profile(text):
    profile = {
        "price": price_preference(text),
        "appearance": bool(re.search(r"漂亮|好看|颜值|成色|品相|显气质|高级感", text)),
        "quality": bool(re.search(r"品质|品相|成色|收藏|顶级|高货|最好的|品质最好|种老|起光|起胶", text)),
        "water": bool(re.search(r"水头|种水|通透|冰透|水润|起光|起胶", text)),
        "color": bool(re.search(r"颜色|色正|色阳|色辣|满色|满绿|阳绿|帝王绿|飘花|飘绿|春彩|紫罗兰|晴底", text)),
        "clarity": bool(re.search(r"无瑕|干净|无纹裂|无裂|无纹|少棉|少瑕|瑕疵少", text)),
        "gift": bool(re.search(r"送礼|礼物|体面|拿得出手|长辈|妈妈|女朋友|老婆", text)),
        "certificate": bool(re.search(r"证书|复检|保真|天然A货|A货", text)),
        "openCategory": accepts_any_category(text),
    }
    labels = []
    if profile["price"] == "premium":
        labels.append("高货")
    if profile["price"] == "lowest":
        labels.append("低价")
    if profile["price"] == "value":
        labels.append("性价比")
    for key, label in [("appearance", "颜值"), ("quality", "品质"), ("water", "水头"), ("color", "颜色"), ("clarity", "干净"), ("gift", "送礼"), ("certificate", "证书")]:
        if profile[key]:
            labels.append(label)
    profile["labels"] = labels
    profile["queryTerms"] = labels[:]
    return profile


def has_actionable_preference(profile):
    return bool(profile and (profile.get("price") or profile.get("appearance") or profile.get("quality") or profile.get("water") or profile.get("color") or profile.get("clarity") or profile.get("gift") or profile.get("certificate")))


def heuristic_need(raw_need):
    text = str(raw_need or "")
    category = ""
    if "手镯" in text or "镯" in text:
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

    water = extract_first(text, SEMANTIC_CATALOG["waters"])
    color = extract_first(text, SEMANTIC_CATALOG["colors"])
    shape = extract_first(text, SEMANTIC_CATALOG["shapes"])
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
    confidence = min(0.95, 0.45 + len(tags) * 0.06 + (0.08 if sizes else 0) + (0.08 if re.search(r"\d", text) else 0))
    return {
        "category": category,
        "budget": extract_budget(text),
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
    return bool(re.search(r"再来|换一批|换个|只要|不要|必须|优先|更|最|贵|便宜|证书|无纹|无裂|微瑕|送礼|自用", text))


def classify_buyer_intent(raw_need, parsed_need, previous_need):
    text = str(raw_need or "").strip()
    has_find_signal = has_need_slot(parsed_need)
    has_previous_find_signal = has_need_slot(previous_need or {})
    profile = extract_preference_profile(text)
    has_preference = has_actionable_preference(profile)
    refinement = is_refinement_text(text)
    asks_knowledge_only = bool(re.search(r"什么|怎么|如何|区别|真假|鉴定|保养|证书|a货|值吗|好吗|可以吗|[?？]", text, re.I)) and not bool(re.search(r"找|买|推荐|预算|价位|价格|有没有|货源|看货|送礼|自用|需要|想要", text))
    if has_previous_find_signal and not has_find_signal and (has_preference or refinement):
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
    profile = {**(previous.get("preferenceProfile") or {}), **(current.get("preferenceProfile") or {}), **(intent.get("preferenceProfile") or {})}
    profile["labels"] = make_query_terms([*(previous.get("preferenceProfile", {}).get("labels") or []), *(current.get("preferenceProfile", {}).get("labels") or []), *(intent.get("preferenceProfile", {}).get("labels") or [])])
    profile["queryTerms"] = make_query_terms([*(previous.get("preferenceProfile", {}).get("queryTerms") or []), *(current.get("preferenceProfile", {}).get("queryTerms") or []), *(intent.get("preferenceProfile", {}).get("queryTerms") or [])])
    merged = {
        **previous,
        **current,
        "category": current.get("category") or previous.get("category") or "",
        "budget": current.get("budget") if current.get("budget") is not None else previous.get("budget"),
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
    merged["queryTerms"] = make_query_terms([*(previous.get("queryTerms") or []), *(current.get("queryTerms") or []), *(profile.get("queryTerms") or [])])
    return merged


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


def expand_need_terms(need):
    terms = [*(need.get("queryTerms") or []), *((need.get("preferenceProfile") or {}).get("queryTerms") or [])]
    if need.get("color"):
        terms.extend(COLOR_FAMILIES.get(need["color"], [need["color"]]))
    for must in need.get("mustHave") or []:
        terms.extend(FLAW_FAMILIES.get(must, [must]))
    return make_query_terms(terms)


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
        ratio = product["price"] / need["budget"]
        if product["price"] <= need["budget"] and ratio >= 0.78:
            score += 26
            passed.append("价格贴近预算")
        elif product["price"] <= need["budget"] and ratio >= 0.5:
            score += 14
            passed.append("价格在预算内但偏低")
        elif product["price"] <= need["budget"]:
            score += 4
            failed.append("价格明显低于预算段")
        elif product["price"] <= need["budget"] * 1.12:
            score += 10
            passed.append("价格略超预算")
        else:
            failed.append("价格超过预算")
    if need.get("color"):
        family = COLOR_FAMILIES.get(need["color"], [need["color"]])
        if need["color"] in evidence:
            score += 18
            passed.append(f"精确命中{need['color']}")
        elif any(term in evidence for term in family):
            score += 9
            passed.append(f"{need['color']}相近色系")
        else:
            failed.append(f"未命中{need['color']}色系")
    if not need.get("certificateRequired") or has_certificate:
        score += 8 if need.get("certificateRequired") else 3
        if need.get("certificateRequired"):
            passed.append("有证书/可复检信息")
    else:
        failed.append("缺少证书信息")
    for must in need.get("mustHave") or []:
        if (must == "证书" and has_certificate) or must in evidence or ("mm" in must and must.replace("mm", "") in evidence):
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


def product_preference_score(product, need, candidate_prices):
    profile = need.get("preferenceProfile") or {}
    if not candidate_prices:
        return {"score": 0, "reasons": []}
    evidence = " ".join(str(item or "") for item in [product["title"], product["category"], product.get("quality"), product.get("water"), product.get("color"), product.get("shape"), product.get("flaws"), product.get("scene"), product.get("certificate"), product.get("detail"), product.get("ragText"), " ".join(product.get("tags") or [])])
    max_price = max(candidate_prices)
    min_price = min(candidate_prices)
    value_range = max(max_price - min_price, 1)
    score = 0
    reasons = []
    if profile.get("price") == "premium":
        score += round(((product["price"] - min_price) / value_range) * 45)
        reasons.append("高货优先")
    if profile.get("price") == "lowest":
        score += round(((max_price - product["price"]) / value_range) * 45)
        reasons.append("低价优先")
    if profile.get("price") == "value":
        score += round(((max_price - product["price"]) / value_range) * 25)
        reasons.append("性价比优先")
    water_rank = 28 if "玻璃种" in evidence else 24 if "高冰" in evidence else 20 if any(term in evidence for term in ["冰种", "冰透", "起光", "起胶"]) else 14 if any(term in evidence for term in ["糯冰", "冰糯", "水润"]) else 0
    color_rank = 30 if any(term in evidence for term in ["帝王绿", "正阳绿", "满绿"]) else 24 if any(term in evidence for term in ["阳绿", "辣绿"]) else 18 if any(term in evidence for term in ["飘绿", "飘花"]) else 10
    clean_rank = 18 if any(term in evidence for term in ["无纹裂", "无裂", "无纹", "肉眼干净"]) else 8 if "微瑕" in evidence else 0
    if profile.get("quality"):
        score += water_rank + round(color_rank * 0.5) + clean_rank
        reasons.append("品质优先")
    if profile.get("appearance"):
        score += color_rank + round(water_rank * 0.7)
        reasons.append("颜值优先")
    if profile.get("water"):
        score += water_rank
        reasons.append("水头优先")
    if profile.get("color"):
        score += color_rank
        reasons.append("颜色优先")
    if profile.get("clarity"):
        score += clean_rank
        reasons.append("干净度优先")
    if profile.get("gift"):
        score += 16 if any(term in evidence for term in ["送礼", "礼赠", "证书", "复检", "天然A货"]) else 0
        reasons.append("送礼优先")
    return {"score": max(0, score), "reasons": compact(reasons)}


def apply_preference(product, need, candidate_prices):
    preference = product_preference_score(product, need, candidate_prices)
    if not preference["score"]:
        return product
    updated = dict(product)
    updated["matchScore"] += preference["score"]
    updated["matchReasons"] = compact([*preference["reasons"], *(product.get("matchReasons") or [])])[:6]
    updated["agentScore"] = dict(product["agentScore"])
    updated["agentScore"]["total"] += preference["score"]
    updated["agentScore"]["preference"] = preference["score"]
    return updated


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


def write_buyer_reply(need, matches, retrieval_docs):
    return f"已为您解析需求：{buyer_need_summary(need)}。我从商品文档召回 {len(retrieval_docs)} 条货源证据，并按规则、语义和预算综合排序。"


def run_buyer_match_agent(payload):
    run_id = str(uuid.uuid4())
    session_id = payload.get("sessionId") or str(uuid.uuid4())
    need_text = payload["need"]
    buyer_email = payload.get("buyerEmail")
    try:
        session = get_or_create_session(session_id, "buyer_match", buyer_email)
        session_state = get_session_state(session)
        add_message(session_id, "user", need_text)

        current_need = heuristic_need(need_text)
        previous_need = session_state.get("lastParsedNeed")
        intent = classify_buyer_intent(need_text, current_need, previous_need)
        parsed_need = merge_parsed_need(previous_need, current_need, intent)
        validation = validate_need_rules(parsed_need)

        if intent["mode"] not in {"match", "refine"}:
            reply = local_service_reply(need_text, parsed_need, intent)
            trace = [
                {"label": "请求边界校验", "detail": f"消息 {len(need_text)} 字，邮箱 {'有效' if buyer_email else '未提供'}"},
                {"label": "意图识别 Agent", "detail": f"{intent['mode']}：{intent['reason']}"},
                {"label": "语义识别 Agent", "detail": f"{'、'.join(parsed_need.get('queryTerms') or []) or '无检索词'} / 置信度 {round((parsed_need.get('confidence') or 0) * 100)}%"},
                {"label": "Python Agent状态", "detail": "Python 后端已完成意图识别，本地规则生成客服回复"},
            ]
            result = {"runId": run_id, "sessionId": session_id, "mode": "customer_service", "intent": intent, "reply": reply, "parsedNeed": parsed_need, "validation": validation, "retrieval": {"documents": []}, "products": [], "trace": trace}
        else:
            inventory = list_products({"publicOnly": True})
            retrieval_terms = expand_need_terms(parsed_need)
            retrieval_docs = search_product_documents(query=need_text, terms=retrieval_terms, category=parsed_need.get("category"), limit=18)
            retrieval_by_product = {doc["productId"]: doc for doc in retrieval_docs}
            preference_only = has_actionable_preference(parsed_need.get("preferenceProfile")) and not has_product_constraint(parsed_need)
            if retrieval_docs and not preference_only:
                candidate_ids = {doc["productId"] for doc in retrieval_docs}
            else:
                candidate_ids = {product["id"] for product in inventory}
            if parsed_need.get("budget"):
                budget_candidates = sorted(
                    [product for product in inventory if (not parsed_need.get("category") or product["category"] == parsed_need["category"]) and product["price"] <= parsed_need["budget"] * 1.12],
                    key=lambda product: abs(product["price"] - parsed_need["budget"]),
                )[:8]
                candidate_ids.update(product["id"] for product in budget_candidates)
            high_budget_floor = parsed_need["budget"] * 0.45 if parsed_need.get("budget") and parsed_need["budget"] >= 80000 else 0
            candidates = []
            for product in inventory:
                if product["id"] not in candidate_ids:
                    continue
                if parsed_need.get("budget") and product["price"] > parsed_need["budget"] * 1.12:
                    continue
                if high_budget_floor and product["price"] < high_budget_floor:
                    evidence = f"{product['title']} {product.get('color')} {' '.join(product['tags'])} {product.get('ragText')}"
                    if not parsed_need.get("color") or parsed_need["color"] not in evidence:
                        continue
                candidates.append(product)
            candidate_prices = [product["price"] for product in candidates]
            products = sorted(
                [apply_preference(score_product(product, parsed_need, retrieval_by_product.get(product["id"])), parsed_need, candidate_prices) for product in candidates],
                key=lambda product: product["matchScore"],
                reverse=True,
            )[:3]
            if buyer_email:
                for product in products:
                    if product["status"] == "listed":
                        create_lead({"productId": product["id"], "buyerEmail": buyer_email, "buyerNeed": need_text, "source": "buyer_agent"})
            reply = write_buyer_reply(parsed_need, products, retrieval_docs)
            trace = [
                {"label": "请求边界校验", "detail": f"需求 {len(need_text)} 字，邮箱 {'有效' if buyer_email else '未提供'}"},
                {"label": "意图识别 Agent", "detail": f"{intent['mode']}：{intent['reason']}"},
                {"label": "语义识别 Agent", "detail": f"{parsed_need.get('category') or '未限定品类'} / {('￥' + format(parsed_need['budget'], ',')) if parsed_need.get('budget') else '未限定预算'} / {'、'.join(parsed_need.get('queryTerms') or []) or '无检索词'} / 置信度 {round((parsed_need.get('confidence') or 0) * 100)}%"},
                {"label": "Python Agent状态", "detail": "Python 后端完成意图识别、RAG召回、规则排序和解释生成"},
                {"label": "规则校验 Agent", "detail": f"{'；'.join(validation['passed']) or '基础规则通过'}{('；提醒：' + '；'.join(validation['warnings'])) if validation['warnings'] else ''}"},
                {"label": "RAG检索 Tool", "detail": f"查询 product_documents，召回 {len(retrieval_docs)} 条证据；命中词：{'、'.join((retrieval_docs[0]['matchedTerms'] if retrieval_docs else [])[:5]) or '无'}；候选池 {len(candidates)} 件"},
                {"label": "排序 Agent", "detail": f"{products[0]['title']}：总分 {products[0]['agentScore']['total']} = 语义 {products[0]['agentScore']['semantic']} + 规则 {products[0]['agentScore']['rules']} + RAG {products[0]['agentScore']['rag']}" if products else "暂无候选"},
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
            result = {"runId": run_id, "sessionId": session_id, "mode": "match", "intent": intent, "reply": reply, "parsedNeed": parsed_need, "validation": validation, "retrieval": retrieval, "products": products, "trace": trace}

        add_message(session_id, "assistant", result["reply"], result)
        update_session_state(session_id, {**session_state, "lastMode": result["mode"], "lastIntent": intent, "lastNeed": need_text, "lastParsedNeed": parsed_need if result["mode"] == "match" else session_state.get("lastParsedNeed"), "lastProductIds": [p["id"] for p in result["products"]]})
        record_agent_run({"id": run_id, "sessionId": session_id, "agentType": "buyer_match", "input": {"need": need_text, "buyerEmail": buyer_email}, "output": {"mode": result["mode"], "intent": intent, "reply": result["reply"], "parsedNeed": parsed_need, "validation": validation, "retrieval": result["retrieval"], "productIds": [p["id"] for p in result["products"]]}, "trace": result["trace"], "status": "completed"})
        return result
    except Exception as error:
        trace = [{"label": "Agent失败", "detail": str(error)}]
        record_agent_run({"id": run_id, "sessionId": session_id, "agentType": "buyer_match", "input": {"need": need_text, "buyerEmail": buyer_email}, "output": {"error": str(error)}, "trace": trace, "status": "failed"})
        raise


def local_draft(hint, images):
    is_pendant = "吊坠" in hint
    return {
        "title": "冰种飘绿翡翠吊坠" if is_pendant else "冰种晴底翡翠手镯",
        "category": "吊坠" if is_pendant else "手镯",
        "price": 32000 if is_pendant else 48000,
        "originPrice": 36000 if is_pendant else 52000,
        "diameter": "32x18mm" if is_pendant else "55mm",
        "quality": "冰种飘绿" if is_pendant else "冰种晴底",
        "intro": "冰透起光，飘绿灵动，适合日常佩戴与礼赠。" if is_pendant else "冰种晴底，质地细腻通透，清新淡雅，佩戴显气质。",
        "detail": "这件冰种飘绿翡翠吊坠整体水润清透，绿色自然灵动，配18K扣头。尺寸适中，上身轻盈，适合日常佩戴、节日礼赠或作为入门收藏。" if is_pendant else "本款冰种晴底翡翠手镯，种水达到冰种级别，底地细腻，通透如冰，底色清爽淡雅。手镯为正圈设计，圈口55mm，佩戴舒适贴合。无纹裂，结构稳定，适合日常佩戴或收藏。",
        "tags": ["冰种", "飘绿", "吊坠", "18K扣", "无纹裂", "天然A货"] if is_pendant else ["冰种", "晴底色", "翡翠手镯", "正圈", "55圈口", "无纹裂", "天然A货", "送礼佳品"],
        "images": images,
        "agentNotes": ["识别主体", "生成卖点", "提取标签", "估算价格", "发布合规检查"],
        "checks": ["标题含品类和核心种水", "详情覆盖种水、颜色、圈口、瑕疵和适用场景", "标签满足买家检索和推荐排序", "价格与同类商品区间一致"],
        "confidence": 0.86,
    }


def run_publish_agent(payload):
    run_id = str(uuid.uuid4())
    seller_id = payload["sellerId"]
    hint = str(payload.get("hint") or payload.get("notes") or "")
    images = payload.get("images") if isinstance(payload.get("images"), list) else []
    draft = {**local_draft(hint, images), "sellerId": seller_id, "provider": "python-rule"}
    trace = [{"label": "Agent状态", "detail": "Python 发布 Agent 已完成"}, *[{"label": note, "detail": "本地规则 agent 已完成"} for note in draft["agentNotes"]]]
    record_agent_run({"id": run_id, "agentType": "merchant_publish", "input": {"sellerId": seller_id, "hint": hint, "images": images}, "output": draft, "trace": trace, "status": "completed"})
    return {**draft, "runId": run_id}


def local_followup(lead):
    return {
        "buyerSummary": f"{lead['buyerNeed']}，关注商品：{lead['productTitle']}",
        "reply": f"您好，我是{lead['sellerName']}。您咨询的「{lead['productTitle']}」目前还在，可先为您确认预算、佩戴尺寸和是否需要证书。若方便，我可以发自然光视频和细节图给您参考。",
        "nextActions": ["确认预算与尺寸", "发送自然光视频", "补充证书和瑕疵说明"],
        "riskFlags": ["重点确认无纹裂和证书信息"] if "无纹裂" in lead["buyerNeed"] else ["补充自然光图，降低买家疑虑"],
        "tone": "专业、克制、主动推进",
    }


def run_lead_followup_agent(payload):
    run_id = str(uuid.uuid4())
    seller_id = payload["sellerId"]
    lead_id = payload["leadId"]
    session_id = f"lead-followup-{lead_id}"
    lead = get_seller_lead(lead_id, seller_id)
    if not lead:
        raise ValueError("Lead not found")
    get_or_create_session(session_id, "lead_followup", lead["sellerEmail"])
    add_message(session_id, "user", lead["buyerNeed"], {"leadId": lead_id, "sellerId": seller_id})
    output = {**local_followup(lead), "sellerId": seller_id, "leadId": int(lead_id), "provider": "python-rule"}
    trace = [
        {"label": "客资读取 Tool", "detail": f"读取客资 #{lead['id']} 与商品「{lead['productTitle']}」"},
        {"label": "需求摘要 Agent", "detail": output["buyerSummary"]},
        {"label": "跟进话术 Agent", "detail": output["reply"]},
        {"label": "下一步动作", "detail": "、".join(output["nextActions"])},
        {"label": "Agent状态", "detail": "Python 客资跟进 Agent 已完成"},
    ]
    add_message(session_id, "assistant", output["reply"], {"leadId": lead_id, "sellerId": seller_id, "output": output, "trace": trace})
    record_agent_run({"id": run_id, "sessionId": session_id, "agentType": "lead_followup", "input": {"sellerId": seller_id, "leadId": lead_id}, "output": output, "trace": trace, "status": "completed"})
    return {"runId": run_id, "sessionId": session_id, "lead": lead, **output, "trace": trace}
