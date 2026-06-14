import { randomUUID } from "node:crypto";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { completeText, completeTextResult } from "./llm.js";
import {
  addMessage,
  createLead,
  getSellerLead,
  getOrCreateSession,
  listProducts,
  recordAgentRun,
  searchProductDocuments
} from "./db.js";

function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    try {
      return JSON.parse(match[0]);
    } catch {
      return fallback;
    }
  }
}

function textOr(value, fallback) {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const text = String(value ?? "").trim();
  return text || fallback;
}

function priceOr(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "");
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return fallback;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallback;
  if (text.includes("万")) return Math.round(amount * 10000);
  if (text.toLowerCase().includes("k")) return Math.round(amount * 1000);
  return Math.round(amount);
}

function arrayOr(value, fallback) {
  const itemText = (item) => {
    if (typeof item === "string" || typeof item === "number") return String(item).trim();
    if (!item || typeof item !== "object") return "";
    return String(item.action ?? item.flag ?? item.description ?? item.text ?? item.title ?? "").trim();
  };
  if (Array.isArray(value)) return value.map(itemText).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[、,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return fallback;
}

function publicError(error) {
  return String(error.message ?? error)
    .replace(/sk-[A-Za-z0-9_*.-]+/g, "[REDACTED_SECRET]")
    .replace(/[A-Za-z0-9_-]{4}\*{4,}[A-Za-z0-9_-]{3,}/g, "[REDACTED_SECRET]");
}

const semanticCatalog = {
  categories: ["手镯", "吊坠", "戒面", "平安扣", "珠链", "手串", "无事牌", "耳坠", "挂件"],
  waters: ["豆种", "糯种", "糯冰", "冰糯", "冰种", "高冰", "玻璃种"],
  colors: ["晴底", "晴底色", "晴水", "白冰", "飘花", "飘绿", "阳绿", "正阳绿", "满绿", "辣绿", "蓝水", "紫罗兰", "春彩", "黄翡", "红翡", "油青", "墨翠", "帝王绿"],
  shapes: ["正圈", "圆条", "贵妃", "水滴", "如意", "佛公", "观音", "叶子", "葫芦", "蛋面", "马鞍", "圆扣", "怀古扣", "圆珠", "算盘珠", "素牌", "龙牌"],
  flawTerms: ["无纹裂", "无裂", "无纹", "微瑕", "肉眼干净", "轻微棉絮", "少量石纹", "边缘细小矿点"],
  scenes: ["送礼", "自用", "收藏", "日常佩戴", "通勤佩戴", "节日礼赠"]
};

const colorFamilies = {
  帝王绿: ["帝王绿", "正阳绿", "满绿", "阳绿", "高绿", "飘绿", "绿色"],
  阳绿: ["阳绿", "正阳绿", "帝王绿", "满绿", "飘绿", "绿色"],
  飘绿: ["飘绿", "阳绿", "绿色"],
  晴底: ["晴底", "晴底色"],
  白冰: ["白冰", "冰白"]
};

const flawFamilies = {
  微瑕: ["微瑕", "轻微棉絮", "少量石纹", "边缘细小矿点"],
  无纹裂: ["无纹裂", "无裂", "无纹", "肉眼干净"],
  无裂: ["无纹裂", "无裂", "肉眼干净"],
  无纹: ["无纹裂", "无纹", "肉眼干净"]
};

function extractFirst(text, terms) {
  return terms.find((term) => text.includes(term)) ?? "";
}

function extractSizes(text) {
  return Array.from(text.matchAll(/([1-9]\d?(?:\.\d)?)\s*(mm|毫米|圈口|圈|x|×)?\s*([1-9]\d?(?:\.\d)?)?\s*(mm|毫米)?/gi))
    .map((match) => {
      if (match[3]) return `${match[1]}x${match[3]}mm`;
      if (match[2]) return `${match[1]}${match[2].replace("毫米", "mm").replace("圈口", "mm").replace("圈", "mm")}`;
      return "";
    })
    .filter(Boolean)
    .slice(0, 3);
}

function extractBudget(text) {
  const range = text.match(/(\d+(?:\.\d+)?)\s*(万|w|W|k|K)?\s*(?:到|至|-|~)\s*(\d+(?:\.\d+)?)\s*(万|w|W|k|K)?/);
  if (range) {
    const unit = range[4] ?? range[2];
    return priceOr(`${range[3]}${unit ?? ""}`, null);
  }
  const unitBudget = text.match(/(\d+(?:\.\d+)?)\s*(万|w|W|k|K)/);
  if (unitBudget) return priceOr(`${unitBudget[1]}${unitBudget[2]}`, null);
  const budgetMatch =
    text.match(/(?:预算|价位|价格|以内|左右|不超过|控制在)[^\d]{0,6}(\d+(?:\.\d+)?)\s*(万|w|W|k|K)?/) ??
    text.match(/(\d+(?:\.\d+)?)\s*(万|w|W|k|K)?\s*(?:预算|以内|左右|价位|价格)/);
  if (!budgetMatch) return null;
  return priceOr(`${budgetMatch[1]}${budgetMatch[2] ?? ""}`, null);
}

function makeQueryTerms(value) {
  return Array.from(new Set(value.filter(Boolean).flatMap((item) => String(item).split(/[、,，\s]+/)).map((item) => item.trim()).filter(Boolean)));
}

function expandNeedTerms(need) {
  return makeQueryTerms([
    ...(need.queryTerms ?? []),
    ...(need.color ? colorFamilies[need.color] ?? [need.color] : []),
    ...((need.mustHave ?? []).flatMap((term) => flawFamilies[term] ?? [term]))
  ]);
}

function heuristicNeed(need) {
  const text = String(need ?? "");
  let category = "";
  if (text.includes("手镯") || text.includes("镯")) category = "手镯";
  else if (text.includes("无事牌") || text.includes("牌子") || text.includes("龙牌")) category = "无事牌";
  else if (text.includes("手串")) category = "手串";
  else if (text.includes("耳坠") || text.includes("耳饰")) category = "耳坠";
  else if (text.includes("挂件")) category = "挂件";
  else if (text.includes("平安扣")) category = "平安扣";
  else if (text.includes("珠链")) category = "珠链";
  else if (text.includes("吊坠") || text.includes("佛公") || text.includes("观音") || text.includes("叶子") || text.includes("如意") || text.includes("葫芦")) category = "吊坠";
  else if (text.includes("戒")) category = "戒面";
  const water = extractFirst(text, semanticCatalog.waters);
  const color = extractFirst(text, semanticCatalog.colors);
  const shape = extractFirst(text, semanticCatalog.shapes);
  const sizes = extractSizes(text);
  const flaw = extractFirst(text, semanticCatalog.flawTerms);
  const scenes = makeQueryTerms(semanticCatalog.scenes.filter((term) => text.includes(term)));
  if (!scenes.includes("送礼") && (text.includes("送") || text.includes("礼"))) scenes.push("送礼");
  if (!scenes.includes("自用") && text.includes("自用")) scenes.push("自用");
  const scene = scenes.join("/");
  const tagWords = [...semanticCatalog.waters, ...semanticCatalog.colors, ...semanticCatalog.shapes, ...semanticCatalog.flawTerms, "天然A货", "证书", ...sizes, category];
  const tags = tagWords.filter((tag) => text.includes(tag.replace("色", "")) || text.includes(tag));
  const mustHave = makeQueryTerms([
    flaw && ["无纹裂", "无裂", "无纹"].includes(flaw) ? "无纹裂" : flaw,
    text.includes("天然") || text.includes("A货") ? "天然A货" : "",
    text.includes("证书") || text.includes("复检") ? "证书" : "",
    ...sizes
  ]);
  return {
    category,
    budget: extractBudget(text),
    tags,
    occasion: scene,
    mustHave,
    water,
    color,
    shape,
    sizes,
    treatment: text.includes("天然") || text.includes("A货") ? "天然A货" : "",
    certificateRequired: text.includes("证书") || text.includes("复检"),
    queryTerms: makeQueryTerms([category, water, color, shape, flaw, ...scenes, ...sizes, ...tags, ...mustHave]),
    confidence: Math.min(0.95, 0.45 + tags.length * 0.06 + (sizes.length ? 0.08 : 0) + (text.match(/\d/) ? 0.08 : 0))
  };
}

async function analyzeNeed(need) {
  const fallback = heuristicNeed(need);

  const prompt = `你是翡翠找货需求分析 agent。请从买家需求里抽取商品品类、预算、种水、颜色、器型、尺寸、标签、场景、硬性条件。只返回 JSON。
需求：${need}
JSON 字段：category, budget, tags, occasion, mustHave, water, color, shape, sizes, treatment, certificateRequired, queryTerms, confidence。没有明确传入的字段必须返回空字符串、空数组或 null；budget 使用人民币数字，没有明确预算时返回 null；sizes 是数组。`;

  const result = await completeTextResult(prompt, { json: true });
  if (!result.text) {
    return { ...fallback, provider: "local-rule", providerError: result.error, providerDurationMs: result.durationMs };
  }
  const generated = safeJson(result.text, fallback);
  return {
    ...fallback,
    ...generated,
    budget: fallback.budget == null ? null : priceOr(generated.budget, fallback.budget),
    tags: arrayOr(generated.tags, fallback.tags),
    mustHave: arrayOr(generated.mustHave, fallback.mustHave),
    category: fallback.category ? textOr(generated.category, fallback.category) : "",
    occasion: fallback.occasion ? textOr(generated.occasion, fallback.occasion) : "",
    water: fallback.water ? textOr(generated.water, fallback.water) : "",
    color: fallback.color ? textOr(generated.color, fallback.color) : "",
    shape: fallback.shape ? textOr(generated.shape, fallback.shape) : "",
    sizes: arrayOr(generated.sizes, fallback.sizes),
    treatment: fallback.treatment ? textOr(generated.treatment, fallback.treatment) : "",
    certificateRequired: fallback.certificateRequired ? Boolean(generated.certificateRequired ?? fallback.certificateRequired) : false,
    queryTerms: makeQueryTerms(arrayOr(generated.queryTerms, fallback.queryTerms)),
    confidence: Number.isFinite(Number(generated.confidence)) ? Number(generated.confidence) : fallback.confidence,
    provider: result.provider,
    providerDurationMs: result.durationMs
  };
}

function validateNeedRules(need) {
  const warnings = [];
  const passed = [];
  if (need.category) passed.push(`已识别品类：${need.category}`);
  if (need.budget && need.budget > 0) passed.push(`已识别预算：￥${Math.round(need.budget).toLocaleString("zh-CN")}`);
  if (need.water || need.color) passed.push(`已识别种水/颜色：${[need.water, need.color].filter(Boolean).join(" / ")}`);
  if (need.sizes?.length) passed.push(`已识别尺寸：${need.sizes.join("、")}`);
  if (!need.tags?.length && !need.queryTerms?.length) warnings.push("需求较泛，建议补充种水、颜色、圈口或预算");
  if (need.budget && need.budget < 1000) warnings.push("预算过低，可能无法匹配平台翡翠货源");
  if (need.certificateRequired) passed.push("证书/复检作为硬性条件");
  return {
    ok: warnings.length === 0 || passed.length > 0,
    passed,
    warnings,
    hardRules: makeQueryTerms([need.category, ...need.mustHave, need.certificateRequired ? "证书" : ""])
  };
}

function evaluateProductRules(product, need) {
  let score = 0;
  const passed = [];
  const failed = [];
  const evidenceText = `${product.title} ${product.tags.join(" ")} ${product.flaws} ${product.size} ${product.diameter} ${product.certificate} ${product.certificateNo} ${product.treatment} ${product.detail} ${product.ragText}`;
  const hasCertificateEvidence = Boolean(product.certificate || product.certificateNo || evidenceText.includes("证书") || evidenceText.includes("复检"));

  if (!need.category) {
    score += 4;
  } else if (product.category === need.category) {
    score += 22;
    passed.push("品类一致");
  } else {
    failed.push(`品类不符：${product.category}`);
  }

  const budgetRatio = need.budget ? product.price / need.budget : 0;
  if (!need.budget) {
    score += 4;
  } else if (product.price <= need.budget && budgetRatio >= 0.78) {
    score += 26;
    passed.push("价格贴近预算");
  } else if (product.price <= need.budget && budgetRatio >= 0.5) {
    score += 14;
    passed.push("价格在预算内但偏低");
  } else if (product.price <= need.budget) {
    score += 4;
    failed.push("价格明显低于预算段");
  } else if (product.price <= need.budget * 1.12) {
    score += 10;
    passed.push("价格略超预算");
  } else {
    failed.push("价格超过预算");
  }

  if (need.color) {
    const family = colorFamilies[need.color] ?? [need.color];
    if (evidenceText.includes(need.color)) {
      score += 18;
      passed.push(`精确命中${need.color}`);
    } else if (family.some((term) => evidenceText.includes(term))) {
      score += 9;
      passed.push(`${need.color}相近色系`);
    } else {
      failed.push(`未命中${need.color}色系`);
    }
  }

  if (!need.certificateRequired || hasCertificateEvidence) {
    if (need.certificateRequired) passed.push("有证书/可复检信息");
    score += need.certificateRequired ? 8 : 3;
  } else {
    failed.push("缺少证书信息");
  }

  if (!need.treatment || product.treatment?.includes("天然")) {
    if (need.treatment) passed.push("满足天然A货要求");
    score += need.treatment ? 8 : 3;
  } else {
    failed.push("处理方式不符合要求");
  }

  for (const must of need.mustHave ?? []) {
    if (
      (must === "证书" && hasCertificateEvidence) ||
      evidenceText.includes(must) ||
      (must.includes("mm") && evidenceText.includes(must.replace("mm", "")))
    ) {
      score += 6;
      passed.push(`满足${must}`);
    } else {
      failed.push(`未明确${must}`);
    }
  }

  return { score: Math.max(0, score), passed: [...new Set(passed)], failed: [...new Set(failed)] };
}

function semanticScore(product, need) {
  let score = 0;
  const reasons = [];
  const searchText = [
    product.title,
    product.category,
    product.quality,
    product.water,
    product.color,
    product.shape,
    product.size,
    product.diameter,
    product.flaws,
    product.scene,
    product.certificate,
    product.ragText,
    ...(product.searchKeywords ?? []),
    ...(product.tags ?? [])
  ].filter(Boolean).join(" ");

  if (need.category && product.category === need.category) {
    score += 18;
    reasons.push(`${product.category}品类匹配`);
  }

  for (const tag of makeQueryTerms([need.water, need.color, need.shape, ...(need.sizes ?? []), ...(need.tags ?? []), ...expandNeedTerms(need)])) {
    if (searchText.includes(tag) || product.tags.some((productTag) => productTag.includes(tag) || tag.includes(productTag))) {
      score += 8;
      reasons.push(`${tag}匹配`);
    }
  }

  for (const must of need.mustHave ?? []) {
    if (searchText.includes(must) || product.tags.some((productTag) => productTag.includes(must) || must.includes(productTag))) {
      score += 10;
      reasons.push(`满足${must}`);
    } else {
      score -= 8;
    }
  }

  if (product.ragText && need.occasion && product.ragText.includes(need.occasion)) {
    score += 6;
    reasons.push(`${need.occasion}场景匹配`);
  }

  return { score: Math.max(score, 0), reasons: [...new Set(reasons)].slice(0, 5) };
}

function scoreProduct(product, need, retrievalHit) {
  const semantic = semanticScore(product, need);
  const rules = evaluateProductRules(product, need);
  const ragScore = retrievalHit ? Math.min(40, retrievalHit.score) : 0;
  const total = Math.max(0, semantic.score + rules.score + ragScore - rules.failed.length * 4);
  const reasons = [...semantic.reasons, ...rules.passed, ...(retrievalHit?.matchedTerms?.length ? [`RAG命中${retrievalHit.matchedTerms.slice(0, 4).join("、")}`] : [])];
  return {
    ...product,
    matchScore: total,
    matchReasons: [...new Set(reasons)].slice(0, 6),
    agentScore: {
      total,
      semantic: semantic.score,
      rules: rules.score,
      rag: ragScore,
      rulePassed: rules.passed,
      ruleFailed: rules.failed,
      retrievalSource: retrievalHit
        ? {
            chunkType: retrievalHit.chunkType,
            score: retrievalHit.score,
            matchedTerms: retrievalHit.matchedTerms,
            snippet: retrievalHit.snippet
          }
        : null
    }
  };
}

function buyerNeedSummary(need) {
  const quality = [need.water, need.color].filter(Boolean).join("");
  const parts = makeQueryTerms([
    need.category,
    quality,
    need.shape,
    ...(need.sizes ?? []),
    ...(need.mustHave ?? [])
  ]);
  const scene = need.occasion ? `适用场景：${need.occasion}` : "";
  const budget = need.budget ? `预算约￥${Math.round(need.budget).toLocaleString("zh-CN")}` : "未限定预算";
  return [...parts, scene, budget].filter(Boolean).join("、");
}

function isCustomerServiceTurn(rawNeed, parsedNeed) {
  const text = String(rawNeed ?? "").trim();
  const lower = text.toLowerCase();
  const hasFindSignal = Boolean(
    parsedNeed.category ||
    parsedNeed.budget ||
    parsedNeed.water ||
    parsedNeed.color ||
    parsedNeed.shape ||
    parsedNeed.sizes?.length ||
    parsedNeed.mustHave?.length
  );
  const asksKnowledgeOnly = /什么|怎么|如何|区别|真假|鉴定|保养|证书|a货|值吗|好吗|可以吗|[?？]/i.test(text) &&
    !/找|买|推荐|预算|价位|价格|有没有|货源|看货|送礼|自用|需要|想要/.test(text);

  if (!hasFindSignal) return true;
  if (asksKnowledgeOnly && !parsedNeed.category && !parsedNeed.budget) return true;
  if (/^(你好|您好|hi|hello|在吗|谢谢|thank)/i.test(lower) && !hasFindSignal) return true;
  return false;
}

function localBuyerServiceReply(rawNeed, parsedNeed) {
  const text = String(rawNeed ?? "").trim();
  if (/^(你好|您好|hi|hello|在吗)/i.test(text)) {
    return "您好，我是翡翠找货客服。您可以直接说预算、品类、圈口或尺寸、种水颜色、是否送礼，我会帮您整理需求并匹配货源。";
  }
  if (parsedNeed.water || parsedNeed.color || text.includes("翡翠") || text.includes("A货") || text.includes("证书")) {
    return "可以的。这个问题我可以先按翡翠客服角度帮您解释；如果您想继续找货，也可以补充预算、品类、尺寸、种水颜色和用途。";
  }
  return "我主要负责翡翠找货、商品咨询和需求整理。您可以告诉我想看手镯、吊坠还是其他品类，以及预算和佩戴或送礼场景。";
}

async function writeBuyerServiceReply(rawNeed, parsedNeed) {
  const fallback = localBuyerServiceReply(rawNeed, parsedNeed);
  const result = await completeTextResult(`你是翡翠平台的买家客服和找货顾问。用户输入可能是寒暄、不相关内容、翡翠知识问题，或信息不足的找货需求。请自然回应，不要虚构库存、价格或证书。
如果用户不是在明确找货，先以客服人格回答或承接，再引导用户补充预算、品类、圈口/尺寸、种水颜色、瑕疵要求、用途。
如果用户问到非翡翠话题，可以简短回应并把对话自然带回翡翠咨询。中文回复，80字以内，不要固定模板。
用户输入：${rawNeed}
已识别信息：${JSON.stringify(parsedNeed)}`);
  const reply = textOr(result.text, fallback).replace(/\s+/g, " ").trim();
  return {
    reply: reply.length > 180 ? `${reply.slice(0, 177)}...` : reply,
    provider: result.provider,
    providerError: result.error,
    providerDurationMs: result.durationMs
  };
}

async function writeBuyerReply(need, matches, retrievalDocs) {
  const top = matches.slice(0, 3);
  const sourceText = retrievalDocs.slice(0, 3).map((doc) => `#${doc.productId}:${doc.matchedTerms.join("/")}`).join("；");
  const sortText = need.budget ? "规则、语义和预算" : "规则和语义";
  const fallback = `已为您解析需求：${buyerNeedSummary(need)}。我从商品文档召回 ${retrievalDocs.length} 条货源证据，并按${sortText}综合排序。`;
  const text = await completeText(`你是翡翠买手 agent。基于需求和候选商品，用中文给买家一段简短回复，不超过90字。
回复规则：如果需求 budget 为 null，必须写“未限定预算”，不要编造预算金额。
需求：${JSON.stringify(need)}
候选：${JSON.stringify(top.map((item) => ({ title: item.title, price: item.price, tags: item.tags, reasons: item.matchReasons, score: item.agentScore })))}
RAG来源：${sourceText}`);
  return text || fallback;
}

function semanticEngineDetail(result) {
  if (result.provider === "local" || result.provider === "local-rule") return "LangGraph 已完成编排，本地规则完成语义解析";
  if (result.providerError) return "LangGraph 已完成编排，模型增强未启用，已使用本地规则";
  return `LangGraph 已完成编排，${result.provider} 语义增强耗时 ${result.providerDurationMs}ms`;
}

function agentEngineDetail(result) {
  if (result.provider === "local" || result.provider === "local-rule" || result.providerError) return "本地规则 Agent 已完成";
  return `${result.provider} Agent 已完成，耗时 ${result.providerDurationMs ?? result.durationMs}ms`;
}

const BuyerMatchGraphState = Annotation.Root({
  buyerEmail: Annotation(),
  candidates: Annotation(),
  inventory: Annotation(),
  mode: Annotation(),
  need: Annotation(),
  parsedNeed: Annotation(),
  products: Annotation(),
  reply: Annotation(),
  retrieval: Annotation(),
  retrievalByProduct: Annotation(),
  retrievalDocs: Annotation(),
  retrievalTerms: Annotation(),
  service: Annotation(),
  trace: Annotation(),
  validation: Annotation()
});

async function parseBuyerNeedNode(state) {
  const parsedNeed = await analyzeNeed(state.need);
  return {
    parsedNeed,
    validation: validateNeedRules(parsedNeed)
  };
}

function routeBuyerNeed(state) {
  return isCustomerServiceTurn(state.need, state.parsedNeed) ? "service" : "retrieve";
}

async function buyerServiceNode(state) {
  const service = await writeBuyerServiceReply(state.need, state.parsedNeed);
  const trace = [
    { label: "请求边界校验", detail: `消息 ${String(state.need).length} 字，邮箱 ${state.buyerEmail ? "有效" : "未提供"}` },
    { label: "意图识别 Agent", detail: "客服对话 / 信息不足，未进入商品 RAG 检索" },
    { label: "语义识别 Agent", detail: `${state.parsedNeed.queryTerms.join("、") || "无检索词"} / 置信度 ${Math.round((state.parsedNeed.confidence ?? 0) * 100)}%` },
    { label: "LangGraph状态", detail: semanticEngineDetail(state.parsedNeed) },
    { label: "客服回复 Agent", detail: service.providerError ? `${service.provider} 暂不可用，已使用本地客服兜底` : `${service.provider} 生成回复，耗时 ${service.providerDurationMs}ms` }
  ];
  return {
    mode: "customer_service",
    products: [],
    reply: service.reply,
    retrieval: { documents: [] },
    service,
    trace
  };
}

function retrieveBuyerProductsNode(state) {
  const inventory = listProducts({ publicOnly: true });
  const retrievalTerms = expandNeedTerms(state.parsedNeed);
  const retrievalDocs = searchProductDocuments({
    query: state.need,
    terms: retrievalTerms,
    category: state.parsedNeed.category,
    limit: 18
  });
  const retrievalByProduct = new Map(retrievalDocs.map((doc) => [doc.productId, doc]));
  const budgetCandidateIds = state.parsedNeed.budget
    ? inventory
      .filter((product) => !state.parsedNeed.category || product.category === state.parsedNeed.category)
      .filter((product) => product.price <= state.parsedNeed.budget * 1.12)
      .filter((product) => state.parsedNeed.budget < 80000 || product.price >= state.parsedNeed.budget * 0.45)
      .sort((a, b) => Math.abs(a.price - state.parsedNeed.budget) - Math.abs(b.price - state.parsedNeed.budget))
      .slice(0, 8)
      .map((product) => product.id)
    : [];
  const candidateIds = new Set([
    ...(retrievalDocs.length ? retrievalDocs.map((doc) => doc.productId) : inventory.map((product) => product.id)),
    ...budgetCandidateIds
  ]);
  const highBudgetFloor = state.parsedNeed.budget >= 80000 ? state.parsedNeed.budget * 0.45 : 0;
  const candidates = inventory
    .filter((product) => candidateIds.has(product.id))
    .filter((product) => !state.parsedNeed.budget || product.price <= state.parsedNeed.budget * 1.12)
    .filter((product) => {
      if (!highBudgetFloor || product.price >= highBudgetFloor) return true;
      return state.parsedNeed.color && `${product.title} ${product.color} ${product.tags.join(" ")} ${product.ragText}`.includes(state.parsedNeed.color);
    });
  return { candidates, inventory, retrievalByProduct, retrievalDocs, retrievalTerms };
}

function rankBuyerProductsNode(state) {
  return {
    products: state.candidates
      .map((product) => scoreProduct(product, state.parsedNeed, state.retrievalByProduct.get(product.id)))
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 3)
  };
}

async function writeBuyerMatchReplyNode(state) {
  const reply = await writeBuyerReply(state.parsedNeed, state.products, state.retrievalDocs);
  if (state.buyerEmail) {
    for (const product of state.products.filter((item) => item.status === "listed")) {
      createLead({
        productId: product.id,
        buyerEmail: state.buyerEmail,
        buyerNeed: state.need,
        source: "buyer_agent"
      });
    }
  }
  const trace = [
    { label: "请求边界校验", detail: `需求 ${String(state.need).length} 字，邮箱 ${state.buyerEmail ? "有效" : "未提供"}` },
    { label: "语义识别 Agent", detail: `${state.parsedNeed.category || "未限定品类"} / ${state.parsedNeed.budget ? `￥${Math.round(state.parsedNeed.budget).toLocaleString("zh-CN")}` : "未限定预算"} / ${state.parsedNeed.queryTerms.join("、") || "无检索词"} / 置信度 ${Math.round((state.parsedNeed.confidence ?? 0) * 100)}%` },
    { label: "LangGraph状态", detail: semanticEngineDetail(state.parsedNeed) },
    { label: "规则校验 Agent", detail: `${state.validation.passed.join("；") || "基础规则通过"}${state.validation.warnings.length ? `；提醒：${state.validation.warnings.join("；")}` : ""}` },
    { label: "RAG检索 Tool", detail: `查询 product_documents，召回 ${state.retrievalDocs.length} 条证据；命中词：${state.retrievalDocs[0]?.matchedTerms?.slice(0, 5).join("、") || "无"}；候选池 ${state.candidates.length} 件` },
    { label: "排序 Agent", detail: state.products[0] ? `${state.products[0].title}：总分 ${state.products[0].agentScore.total} = 语义 ${state.products[0].agentScore.semantic} + 规则 ${state.products[0].agentScore.rules} + RAG ${state.products[0].agentScore.rag}` : "暂无候选" },
    { label: "解释 Agent", detail: state.products[0] ? state.products[0].matchReasons.join("、") : "需要更多需求信息" },
    { label: "客资分发 Tool", detail: state.buyerEmail ? "已写入商家客资列表" : "未留邮箱，仅展示匹配结果" },
    { label: "商机质量评分", detail: state.products[0]?.matchScore ? `最高匹配分 ${state.products[0].matchScore}` : "暂无评分" }
  ];
  const retrieval = {
    documents: state.retrievalDocs.slice(0, 6).map((doc) => ({
      productId: doc.productId,
      productTitle: doc.product.title,
      score: doc.score,
      matchedTerms: doc.matchedTerms,
      snippet: doc.snippet
    }))
  };
  return { mode: "match", reply, retrieval, trace };
}

const buyerMatchGraph = new StateGraph(BuyerMatchGraphState)
  .addNode("parse_need", parseBuyerNeedNode)
  .addNode("customer_service", buyerServiceNode)
  .addNode("retrieve_products", retrieveBuyerProductsNode)
  .addNode("rank_products", rankBuyerProductsNode)
  .addNode("write_reply", writeBuyerMatchReplyNode)
  .addEdge(START, "parse_need")
  .addConditionalEdges("parse_need", routeBuyerNeed, {
    service: "customer_service",
    retrieve: "retrieve_products"
  })
  .addEdge("customer_service", END)
  .addEdge("retrieve_products", "rank_products")
  .addEdge("rank_products", "write_reply")
  .addEdge("write_reply", END)
  .compile();

export async function runBuyerMatchAgent({ sessionId, need, buyerEmail }) {
  const runId = randomUUID();
  const id = sessionId || randomUUID();
  try {
    getOrCreateSession(id, "buyer_match", buyerEmail);
    addMessage(id, "user", need);

    const result = await buyerMatchGraph.invoke({ buyerEmail, need });
    const products = result.products ?? [];
    const metadata = {
      mode: result.mode,
      parsedNeed: result.parsedNeed,
      validation: result.validation,
      retrieval: result.retrieval,
      productIds: products.map((product) => product.id),
      trace: result.trace
    };

    addMessage(id, "assistant", result.reply, metadata);
    recordAgentRun({
      id: runId,
      sessionId: id,
      agentType: "buyer_match",
      input: { need, buyerEmail },
      output: { mode: result.mode, reply: result.reply, parsedNeed: result.parsedNeed, validation: result.validation, retrieval: result.retrieval, productIds: metadata.productIds },
      trace: result.trace,
      status: "completed"
    });

    return { runId, sessionId: id, mode: result.mode, reply: result.reply, parsedNeed: result.parsedNeed, validation: result.validation, retrieval: result.retrieval, products, trace: result.trace };
  } catch (error) {
    const trace = [{ label: "Agent失败", detail: publicError(error) }];
    recordAgentRun({
      id: runId,
      sessionId: id,
      agentType: "buyer_match",
      input: { need, buyerEmail },
      output: { error: publicError(error) },
      trace,
      status: "failed"
    });
    throw error;
  }
}

function localDraft(hint, images) {
  const isPendant = hint.includes("吊坠");
  return {
    title: isPendant ? "冰种飘绿翡翠吊坠" : "冰种晴底翡翠手镯",
    category: isPendant ? "吊坠" : "手镯",
    price: isPendant ? 32000 : 48000,
    originPrice: isPendant ? 36000 : 52000,
    diameter: isPendant ? "32x18mm" : "55mm",
    quality: isPendant ? "冰种飘绿" : "冰种晴底",
    intro: isPendant
      ? "冰透起光，飘绿灵动，适合日常佩戴与礼赠。"
      : "冰种晴底，质地细腻通透，清新淡雅，佩戴显气质。",
    detail: isPendant
      ? "这件冰种飘绿翡翠吊坠整体水润清透，绿色自然灵动，配18K扣头。尺寸适中，上身轻盈，适合日常佩戴、节日礼赠或作为入门收藏。"
      : "本款冰种晴底翡翠手镯，种水达到冰种级别，底地细腻，通透如冰，底色清爽淡雅。手镯为正圈设计，圈口55mm，佩戴舒适贴合。无纹裂，结构稳定，适合日常佩戴或收藏。",
    tags: isPendant
      ? ["冰种", "飘绿", "吊坠", "18K扣", "无纹裂", "天然A货"]
      : ["冰种", "晴底色", "翡翠手镯", "正圈", "55圈口", "无纹裂", "天然A货", "送礼佳品"],
    images,
    agentNotes: ["识别主体", "生成卖点", "提取标签", "估算价格", "发布合规检查"],
    checks: [
      "标题含品类和核心种水",
      "详情覆盖种水、颜色、圈口、瑕疵和适用场景",
      "标签满足买家检索和推荐排序",
      "价格与同类商品区间一致"
    ],
    confidence: 0.86
  };
}

export async function runPublishAgent({ sellerId, hint, notes, images }) {
  const runId = randomUUID();
  const normalizedHint = String(hint ?? notes ?? "");
  const normalizedImages = Array.isArray(images) ? images : [];
  try {
    const fallback = localDraft(normalizedHint, normalizedImages);
    const result = await completeTextResult(`你是翡翠商家发布商品 agent。根据商家描述和图片路径，生成商品发布草稿。只返回 JSON。
商家描述：${normalizedHint}
图片：${JSON.stringify(normalizedImages)}
字段：title, category, price, originPrice, diameter, quality, intro, detail, tags, agentNotes。`, { json: true });

    if (!result.text) {
      const output = { ...fallback, sellerId, provider: "local-rule", providerError: result.error };
      recordAgentRun({
        id: runId,
        agentType: "merchant_publish",
        input: { sellerId, hint: normalizedHint, images: normalizedImages },
        output,
        trace: [
          { label: "Agent状态", detail: agentEngineDetail(output) },
          ...fallback.agentNotes.map((note) => ({ label: note, detail: "本地规则 agent 已完成" }))
        ],
        status: "completed"
      });
      return { ...output, runId };
    }

    const generated = safeJson(result.text, fallback);
    const draft = {
      ...fallback,
      ...generated,
      sellerId,
      images: normalizedImages,
      provider: result.provider,
      providerDurationMs: result.durationMs,
      title: textOr(generated.title, fallback.title),
      category: textOr(generated.category, fallback.category),
      price: priceOr(generated.price, fallback.price),
      originPrice: priceOr(generated.originPrice, fallback.originPrice),
      diameter: textOr(generated.diameter, fallback.diameter),
      quality: textOr(generated.quality, fallback.quality),
      intro: textOr(generated.intro, fallback.intro),
      detail: textOr(generated.detail, fallback.detail),
      tags: arrayOr(generated.tags, fallback.tags),
      agentNotes: arrayOr(generated.agentNotes, fallback.agentNotes)
    };
    recordAgentRun({
      id: runId,
      agentType: "merchant_publish",
      input: { sellerId, hint: normalizedHint, images: normalizedImages },
      output: draft,
      trace: [
        { label: "Agent状态", detail: agentEngineDetail(result) },
        ...draft.agentNotes.map((note) => ({ label: note, detail: `${result.provider} agent 已完成` }))
      ],
      status: "completed"
    });
    return { ...draft, runId };
  } catch (error) {
    const trace = [{ label: "Agent失败", detail: publicError(error) }];
    recordAgentRun({
      id: runId,
      agentType: "merchant_publish",
      input: { sellerId, hint: normalizedHint, images: normalizedImages },
      output: { error: publicError(error) },
      trace,
      status: "failed"
    });
    throw error;
  }
}

function localFollowup(lead) {
  return {
    buyerSummary: `${lead.buyerNeed}，关注商品：${lead.productTitle}`,
    reply: `您好，我是${lead.sellerName}。您咨询的「${lead.productTitle}」目前还在，可先为您确认预算、佩戴尺寸和是否需要证书。若方便，我可以发自然光视频和细节图给您参考。`,
    nextActions: ["确认预算与尺寸", "发送自然光视频", "补充证书和瑕疵说明"],
    riskFlags: lead.buyerNeed.includes("无纹裂") ? ["重点确认无纹裂和证书信息"] : ["补充自然光图，降低买家疑虑"],
    tone: "专业、克制、主动推进"
  };
}

export async function runLeadFollowupAgent({ sellerId, leadId }) {
  const runId = randomUUID();
  const sessionId = `lead-followup-${leadId}`;
  const lead = getSellerLead(leadId, sellerId);
  if (!lead) {
    throw new Error("Lead not found");
  }

  try {
    getOrCreateSession(sessionId, "lead_followup", lead.sellerEmail);
    addMessage(sessionId, "user", lead.buyerNeed, { leadId, sellerId });

    const fallback = localFollowup(lead);
    const result = await completeTextResult(`你是翡翠商家的客资跟进 agent。请根据买家需求和商品信息生成销售跟进建议，只返回 JSON。
买家需求：${lead.buyerNeed}
买家邮箱：${lead.buyerEmail}
商品：${lead.productTitle}
价格：${lead.productPrice}
商家：${lead.sellerName}
JSON 字段：buyerSummary, reply, nextActions, riskFlags, tone。reply 要像商家可直接发送给买家的中文消息，80到140字。`, { json: true });

    const generated = result.text ? safeJson(result.text, fallback) : fallback;
    const output = {
      ...fallback,
      ...generated,
      sellerId,
      leadId: Number(leadId),
      nextActions: arrayOr(generated.nextActions, fallback.nextActions).slice(0, 4),
      riskFlags: arrayOr(generated.riskFlags, fallback.riskFlags).slice(0, 3),
      buyerSummary: textOr(generated.buyerSummary, fallback.buyerSummary),
      reply: textOr(generated.reply, fallback.reply),
      tone: textOr(generated.tone, fallback.tone),
      provider: result.text ? result.provider : "local-rule",
      providerError: result.text ? undefined : result.error,
      providerDurationMs: result.durationMs
    };

    const trace = [
      { label: "客资读取 Tool", detail: `读取客资 #${lead.id} 与商品「${lead.productTitle}」` },
      { label: "需求摘要 Agent", detail: output.buyerSummary },
      { label: "跟进话术 Agent", detail: output.reply },
      { label: "下一步动作", detail: output.nextActions.join("、") },
      { label: "Agent状态", detail: agentEngineDetail(output) }
    ];

    addMessage(sessionId, "assistant", output.reply, { leadId, sellerId, output, trace });
    recordAgentRun({
      id: runId,
      sessionId,
      agentType: "lead_followup",
      input: { sellerId, leadId },
      output,
      trace,
      status: "completed"
    });

    return { runId, sessionId, lead, ...output, trace };
  } catch (error) {
    const trace = [{ label: "Agent失败", detail: publicError(error) }];
    recordAgentRun({
      id: runId,
      sessionId,
      agentType: "lead_followup",
      input: { sellerId, leadId },
      output: { sellerId, leadId, error: publicError(error) },
      trace,
      status: "failed"
    });
    throw error;
  }
}
