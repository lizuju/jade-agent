#!/usr/bin/env python3
import argparse
import json
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.agent import (  # noqa: E402
    estimated_publish_price,
    publish_copy_for,
    publish_display_size,
    publish_flaw_text,
    publish_title_for,
    resolve_publish_category,
    resolve_publish_color,
    resolve_publish_scene,
    resolve_publish_shape,
    normalize_vlm_water,
    run_buyer_match_agent,
    run_publish_agent,
)
from backend.db import seed_database  # noqa: E402


def compact(values):
    result = []
    seen = set()
    for value in values:
        text = str(value or "").strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def visible(value):
    text = str(value or "").strip()
    return "" if "待复核" in text else text


def draft_from_publish_signal(case):
    need = {}
    vlm = dict(case.get("vision") or {})
    category_result = dict(case.get("categoryResult") or {})
    image_signal = dict(case.get("imageSignal") or {})
    category = resolve_publish_category(need, vlm, category_result, image_signal)
    water = normalize_vlm_water(vlm.get("water")) or image_signal.get("waterGuess") or "种水待复核"
    color = resolve_publish_color(need, vlm, image_signal, category_result)
    shape = resolve_publish_shape(need, category, vlm, category_result, image_signal)
    flaw = publish_flaw_text(vlm.get("flaw"), case.get("hint", ""), vlm.get("evidence"))
    scene = resolve_publish_scene(category, case.get("hint", ""))
    vision = {
        "category": category,
        "water": water,
        "color": color,
        "shape": shape,
        "size": "",
        "flaw": flaw,
        "scene": scene,
        "price": estimated_publish_price(category, water, color),
        "confidence": vlm.get("confidence") or 0,
        "evidence": vlm.get("evidence") or [],
        "categoryEvidence": category_result.get("evidence") or [],
        "isJade": True,
    }
    title = publish_title_for(vision)
    visible_water = visible(water)
    visible_color = visible(color)
    water_text = visible_water or "细腻"
    color_text = visible_color or "自然"
    quality = "".join(compact([visible_water, visible_color])) or water_text
    category_text = visible(category) or "翡翠商品"
    shape_text = visible(shape) or ("圆润" if category_text == "手镯" else "经典")
    size_text = publish_display_size(category_text, shape_text, "")
    flaw_text = flaw if flaw != "以实物复核为准" else "图片未见明显纹裂"
    intro, detail = publish_copy_for(title, vision, water_text, color_text, category_text, shape_text, size_text, flaw_text)
    return {
        "title": title,
        "category": category,
        "water": water,
        "color": color,
        "shape": shape,
        "scene": scene,
        "quality": quality,
        "size": size_text,
        "intro": intro,
        "detail": detail,
    }


def check_equal(failures, label, actual, expected):
    if expected is not None and actual != expected:
        failures.append(f"{label}: expected {expected!r}, got {actual!r}")


def check_contains(failures, label, actual, expected_items):
    text = str(actual or "")
    for item in expected_items or []:
        if item not in text:
            failures.append(f"{label}: missing {item!r} in {text!r}")


def check_excludes(failures, label, actual, banned_items):
    text = str(actual or "")
    for item in banned_items or []:
        if item in text:
            failures.append(f"{label}: should not contain {item!r}")


def check_list_contains(failures, label, actual, expected_items):
    actual = actual or []
    for item in expected_items or []:
        if item not in actual:
            failures.append(f"{label}: missing {item!r} in {actual!r}")


def check_number_range(failures, label, actual, expected):
    if expected.get("minPrice") is not None and actual < expected["minPrice"]:
        failures.append(f"{label}: expected >= {expected['minPrice']}, got {actual}")
    if expected.get("maxPrice") is not None and actual > expected["maxPrice"]:
        failures.append(f"{label}: expected <= {expected['maxPrice']}, got {actual}")


def eval_buyer_case(case):
    result = run_buyer_match_agent({
        "need": case["need"],
        "buyerEmail": "",
        "sessionId": f"eval-{case['id']}-{uuid.uuid4()}",
    })
    expect = case.get("expect") or {}
    failures = []
    check_equal(failures, "mode", result.get("mode"), expect.get("mode"))
    if "productCount" in expect and len(result.get("products") or []) != expect["productCount"]:
        failures.append(f"products: expected {expect['productCount']}, got {len(result.get('products') or [])}")
    check_contains(failures, "reply", result.get("reply"), expect.get("replyContains"))
    parsed = result.get("parsedNeed") or {}
    for field, expected in (expect.get("parsed") or {}).items():
        if field == "sizesContains":
            check_list_contains(failures, "parsed.sizes", parsed.get("sizes"), expected)
        elif field == "mustHaveContains":
            check_list_contains(failures, "parsed.mustHave", parsed.get("mustHave"), expected)
        else:
            check_equal(failures, f"parsed.{field}", parsed.get(field), expected)
    top_expect = expect.get("topProduct")
    products = result.get("products") or []
    if top_expect:
        if not products:
            failures.append("topProduct: no products returned")
        else:
            top = products[0]
            check_equal(failures, "top.category", top.get("category"), top_expect.get("category"))
            check_contains(failures, "top.title", top.get("title"), top_expect.get("titleContains"))
            check_number_range(failures, "top.price", int(top.get("price") or 0), top_expect)
    return {
        "id": case["id"],
        "type": "buyerMatch",
        "ok": not failures,
        "failures": failures,
        "summary": {
            "mode": result.get("mode"),
            "parsed": parsed,
            "topProducts": [
                {"title": p.get("title"), "category": p.get("category"), "price": p.get("price")}
                for p in products[:3]
            ],
        },
    }


def eval_publish_case(case):
    draft = draft_from_publish_signal(case)
    expect = case.get("expect") or {}
    failures = []
    for field in ["category", "water", "color", "shape", "scene", "quality"]:
        check_equal(failures, field, draft.get(field), expect.get(field))
    for field in ["title", "intro", "detail"]:
        check_contains(failures, field, draft.get(field), expect.get(f"{field}Contains"))
        check_excludes(failures, field, draft.get(field), expect.get(f"{field}Excludes"))
    return {
        "id": case["id"],
        "type": "merchantPublish",
        "ok": not failures,
        "failures": failures,
        "summary": draft,
    }


def eval_publish_live_case(case):
    result = run_publish_agent({
        "sellerId": case.get("sellerId", 1),
        "hint": case.get("hint", ""),
        "images": case.get("images") or [],
        "imageAnalyses": case.get("imageAnalyses") or [],
    })
    expect = case.get("expect") or {}
    failures = []
    for field in ["category", "water", "color", "shape", "scene", "quality"]:
        check_equal(failures, field, result.get(field), expect.get(field))
    for field in ["title", "intro", "detail"]:
        check_contains(failures, field, result.get(field), expect.get(f"{field}Contains"))
        check_excludes(failures, field, result.get(field), expect.get(f"{field}Excludes"))
    return {
        "id": case["id"],
        "type": "merchantPublishLive",
        "ok": not failures,
        "failures": failures,
        "summary": {
            "title": result.get("title"),
            "category": result.get("category"),
            "water": result.get("water"),
            "color": result.get("color"),
            "shape": result.get("shape"),
            "scene": result.get("scene"),
            "model": (result.get("vision") or {}).get("model"),
        },
    }


def load_cases(path):
    with Path(path).open(encoding="utf-8") as file:
        return json.load(file)


def main():
    parser = argparse.ArgumentParser(description="Run Jade Agent regression evaluations.")
    parser.add_argument("--cases", default=str(ROOT / "evals" / "agent_regression_cases.json"))
    parser.add_argument("--section", choices=["all", "buyer", "publish"], default="all")
    parser.add_argument("--vision-live", action="store_true", help="Run live Ollama publish cases from merchantPublishLive.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args()

    seed_database()
    cases = load_cases(args.cases)
    results = []
    if args.section in {"all", "buyer"}:
        results.extend(eval_buyer_case(case) for case in cases.get("buyerMatch", []))
    if args.section in {"all", "publish"}:
        results.extend(eval_publish_case(case) for case in cases.get("merchantPublish", []))
        if args.vision_live:
            results.extend(eval_publish_live_case(case) for case in cases.get("merchantPublishLive", []))

    failed = [result for result in results if not result["ok"]]
    report = {"ok": not failed, "total": len(results), "failed": len(failed), "results": results}
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"Agent eval: {report['total'] - report['failed']}/{report['total']} passed")
        for result in results:
            mark = "PASS" if result["ok"] else "FAIL"
            print(f"[{mark}] {result['type']}::{result['id']}")
            for failure in result["failures"]:
                print(f"  - {failure}")
        if failed:
            print("\nUse --json for full summaries.")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
