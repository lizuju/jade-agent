import uuid
from typing import Any

from langgraph.graph import END, START, StateGraph

from backend.agent import (
    AgentGraphState,
    buyer_budget_clarify_node,
    buyer_customer_service_node,
    buyer_match_node,
    buyer_persist_node,
    buyer_prepare_node,
    buyer_route,
    lead_followup_node,
    lead_load_node,
    lead_record_node,
    publish_draft_node,
    publish_prepare_node,
    publish_record_node,
    publish_validate_images_node,
)
from backend.db import get_seller, list_leads


class StudioBuyerState(AgentGraphState, total=False):
    need: str
    buyerEmail: str
    sessionId: str


class StudioPublishState(AgentGraphState, total=False):
    sellerId: int
    hint: str
    images: list[str]
    imageAnalyses: list[dict[str, Any]]


class StudioLeadState(AgentGraphState, total=False):
    sellerId: int
    leadId: int


def default_seller_id():
    seller = get_seller("seller@email.com")
    return seller["id"] if seller else 1


def studio_buyer_input_node(state):
    payload = dict(state.get("payload") or {})
    need = str(state.get("need") or payload.get("need") or "10万预算 帝王绿手镯 55圈口 微瑕").strip()
    buyer_email = state.get("buyerEmail") or payload.get("buyerEmail") or "buyer1@email.com"
    session_id = state.get("sessionId") or payload.get("sessionId") or f"studio-buyer-{uuid.uuid4()}"
    return {
        "payload": {**payload, "need": need, "buyerEmail": buyer_email, "sessionId": session_id},
        "run_id": state.get("run_id") or str(uuid.uuid4()),
        "session_id": session_id,
        "need_text": need,
        "buyer_email": buyer_email,
    }


def studio_publish_input_node(state):
    payload = dict(state.get("payload") or {})
    seller_id = int(state.get("sellerId") or payload.get("sellerId") or default_seller_id())
    images = state.get("images") if isinstance(state.get("images"), list) else payload.get("images")
    image_analyses = state.get("imageAnalyses") if isinstance(state.get("imageAnalyses"), list) else payload.get("imageAnalyses")
    return {
        "payload": {
            **payload,
            "sellerId": seller_id,
            "hint": str(state.get("hint") or payload.get("hint") or ""),
            "images": images if isinstance(images, list) else [],
            "imageAnalyses": image_analyses if isinstance(image_analyses, list) else [],
        },
        "run_id": state.get("run_id") or str(uuid.uuid4()),
    }


def studio_lead_input_node(state):
    payload = dict(state.get("payload") or {})
    seller_id = int(state.get("sellerId") or payload.get("sellerId") or default_seller_id())
    leads = list_leads(seller_id)
    lead_id = state.get("leadId") or payload.get("leadId") or (leads[0]["id"] if leads else 1)
    return {
        "payload": {**payload, "sellerId": seller_id, "leadId": str(lead_id)},
        "run_id": state.get("run_id") or str(uuid.uuid4()),
    }


def build_studio_buyer_graph():
    graph = StateGraph(StudioBuyerState)
    graph.add_node("studio_input", studio_buyer_input_node)
    graph.add_node("prepare_context", buyer_prepare_node)
    graph.add_node("budget_clarify", buyer_budget_clarify_node)
    graph.add_node("customer_service", buyer_customer_service_node)
    graph.add_node("match_products", buyer_match_node)
    graph.add_node("persist_run", buyer_persist_node)
    graph.add_edge(START, "studio_input")
    graph.add_edge("studio_input", "prepare_context")
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


def build_studio_publish_graph():
    graph = StateGraph(StudioPublishState)
    graph.add_node("studio_input", studio_publish_input_node)
    graph.add_node("prepare_publish", publish_prepare_node)
    graph.add_node("validate_images", publish_validate_images_node)
    graph.add_node("draft_product", publish_draft_node)
    graph.add_node("record_run", publish_record_node)
    graph.add_edge(START, "studio_input")
    graph.add_edge("studio_input", "prepare_publish")
    graph.add_edge("prepare_publish", "validate_images")
    graph.add_edge("validate_images", "draft_product")
    graph.add_edge("draft_product", "record_run")
    graph.add_edge("record_run", END)
    return graph.compile()


def build_studio_lead_graph():
    graph = StateGraph(StudioLeadState)
    graph.add_node("studio_input", studio_lead_input_node)
    graph.add_node("load_lead", lead_load_node)
    graph.add_node("write_followup", lead_followup_node)
    graph.add_node("record_run", lead_record_node)
    graph.add_edge(START, "studio_input")
    graph.add_edge("studio_input", "load_lead")
    graph.add_edge("load_lead", "write_followup")
    graph.add_edge("write_followup", "record_run")
    graph.add_edge("record_run", END)
    return graph.compile()


buyer_match = build_studio_buyer_graph()
merchant_publish = build_studio_publish_graph()
lead_followup = build_studio_lead_graph()
