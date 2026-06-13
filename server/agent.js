import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { completeText, completeTextResult, getTextProvider } from "./llm.js";
import {
  addMessage,
  createLead,
  getSellerLead,
  getOrCreateSession,
  listProducts,
  recordAgentRun,
  recordImageJob
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const generatedDir = path.join(rootDir, "public", "generated");
fs.mkdirSync(generatedDir, { recursive: true });

const imageClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const imageModel = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";

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
  return String(error.message ?? error).replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_SECRET]");
}

function heuristicNeed(need) {
  const budgetMatch = need.match(/(\d+(?:\.\d+)?)\s*(万|w|W|k|K)?/);
  const amount = budgetMatch ? Number(budgetMatch[1]) : null;
  const unit = budgetMatch?.[2];
  const budget =
    amount == null ? 50000 : unit === "万" || unit?.toLowerCase() === "w" ? amount * 10000 : unit?.toLowerCase() === "k" ? amount * 1000 : amount;
  const tagWords = [
    "冰种",
    "糯冰",
    "晴底",
    "晴底色",
    "飘绿",
    "阳绿",
    "正圈",
    "无纹裂",
    "天然A货",
    "送礼",
    "收藏",
    "55圈口",
    "56圈口",
    "手镯",
    "吊坠",
    "戒面"
  ];
  const tags = tagWords.filter((tag) => need.includes(tag.replace("色", "")) || need.includes(tag));
  const category = need.includes("吊坠")
    ? "吊坠"
    : need.includes("戒")
      ? "戒面"
      : "手镯";
  return {
    category,
    budget,
    tags,
    occasion: need.includes("送") || need.includes("礼") ? "送礼" : "自用",
    mustHave: tags.filter((tag) => ["无纹裂", "天然A货", "55圈口", "56圈口"].includes(tag))
  };
}

async function analyzeNeed(need) {
  const fallback = heuristicNeed(need);

  const prompt = `你是翡翠找货需求分析 agent。请从买家需求里抽取商品品类、预算、标签、场景、硬性条件。只返回 JSON。
需求：${need}
JSON 字段：category, budget, tags, occasion, mustHave。budget 使用人民币数字。`;

  const result = await completeTextResult(prompt, { json: true });
  if (!result.text) {
    return { ...fallback, provider: "local-rule", providerError: result.error, providerDurationMs: result.durationMs };
  }
  const generated = safeJson(result.text, fallback);
  return {
    ...fallback,
    ...generated,
    budget: priceOr(generated.budget, fallback.budget),
    tags: arrayOr(generated.tags, fallback.tags),
    mustHave: arrayOr(generated.mustHave, fallback.mustHave),
    category: textOr(generated.category, fallback.category),
    occasion: textOr(generated.occasion, fallback.occasion),
    provider: result.provider,
    providerDurationMs: result.durationMs
  };
}

function scoreProduct(product, need) {
  let score = 0;
  const reasons = [];

  if (product.category === need.category) {
    score += 30;
    reasons.push(`${product.category}品类匹配`);
  }
  if (product.price <= need.budget) {
    score += 25;
    reasons.push(`价格在预算内`);
  } else if (product.price <= need.budget * 1.12) {
    score += 12;
    reasons.push(`略超预算但品质接近`);
  }

  for (const tag of need.tags ?? []) {
    if (product.tags.some((productTag) => productTag.includes(tag) || tag.includes(productTag))) {
      score += 8;
      reasons.push(`${tag}匹配`);
    }
  }

  for (const must of need.mustHave ?? []) {
    if (product.tags.some((productTag) => productTag.includes(must) || must.includes(productTag))) {
      score += 10;
      reasons.push(`满足${must}`);
    } else {
      score -= 8;
    }
  }

  if (product.status !== "listed") score -= 25;
  return { ...product, matchScore: Math.max(score, 0), matchReasons: [...new Set(reasons)].slice(0, 4) };
}

async function writeBuyerReply(need, matches) {
  const top = matches.slice(0, 3);
  const fallback = `已为您解析需求：${need.category}、预算约￥${Math.round(need.budget).toLocaleString("zh-CN")}、${need.tags.join("、") || "高性价比"}。我优先匹配了 ${top.length} 件商品，第一件综合匹配度最高，适合${need.occasion}。`;
  const text = await completeText(`你是翡翠买手 agent。基于需求和候选商品，用中文给买家一段简短回复，不超过90字。
需求：${JSON.stringify(need)}
候选：${JSON.stringify(top.map((item) => ({ title: item.title, price: item.price, tags: item.tags, reasons: item.matchReasons })))}`);
  return text || fallback;
}

export async function runBuyerMatchAgent({ sessionId, need, buyerEmail }) {
  const runId = randomUUID();
  const id = sessionId || randomUUID();
  try {
    getOrCreateSession(id, "buyer_match", buyerEmail);
    addMessage(id, "user", need);

    const parsedNeed = await analyzeNeed(need);
    const inventory = listProducts({ publicOnly: true });
    const products = inventory
      .map((product) => scoreProduct(product, parsedNeed))
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 3);
    const reply = await writeBuyerReply(parsedNeed, products);

    if (buyerEmail) {
      for (const product of products.filter((item) => item.status === "listed")) {
        createLead({
          productId: product.id,
          buyerEmail,
          buyerNeed: need,
          source: "buyer_agent"
        });
      }
    }

    const trace = [
      { label: "需求解析 Agent", detail: `${parsedNeed.category} / ￥${Math.round(parsedNeed.budget).toLocaleString("zh-CN")} / ${parsedNeed.tags.join("、") || "无标签"}` },
      { label: "模型状态", detail: parsedNeed.providerError ? `${getTextProvider()} 失败，已使用本地规则：${parsedNeed.providerError}` : `${parsedNeed.provider} 正常，耗时 ${parsedNeed.providerDurationMs}ms` },
      { label: "库存检索 Tool", detail: `扫描 ${inventory.length} 件商品，保留 ${products.length} 件候选` },
      { label: "排序解释", detail: products[0] ? `${products[0].title}：${products[0].matchReasons.join("、")}` : "暂无候选" },
      { label: "客资分发 Tool", detail: buyerEmail ? "已写入商家客资列表" : "未留邮箱，仅展示匹配结果" },
      { label: "商机质量评分", detail: products[0]?.matchScore ? `最高匹配分 ${products[0].matchScore}` : "暂无评分" }
    ];

    addMessage(id, "assistant", reply, { parsedNeed, productIds: products.map((product) => product.id), trace });
    recordAgentRun({
      id: runId,
      sessionId: id,
      agentType: "buyer_match",
      input: { need, buyerEmail },
      output: { reply, parsedNeed, productIds: products.map((product) => product.id) },
      trace,
      status: "completed"
    });

    return { runId, sessionId: id, reply, parsedNeed, products, trace };
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
          { label: "模型状态", detail: `${getTextProvider()} 失败，已使用本地规则：${result.error}` },
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
        { label: "模型状态", detail: `${result.provider} 正常，耗时 ${result.durationMs}ms` },
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
      { label: "模型状态", detail: output.providerError ? `${getTextProvider()} 失败，已使用本地规则：${output.providerError}` : `${output.provider} 正常，耗时 ${output.providerDurationMs}ms` }
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

function localImageForPrompt(prompt) {
  if (prompt.includes("吊坠")) return "/assets/jade-pendant-small.jpg";
  if (prompt.includes("戒")) return "/assets/jade-ring.jpg";
  return "/assets/jade-bangle-main.jpg";
}

function recordImageAgentRun({ runId, sellerId, prompt, imageUrl, status, provider, detail }) {
  recordAgentRun({
    id: runId,
    agentType: "image_generate",
    input: { sellerId, prompt },
    output: { sellerId, imageUrl, status, provider },
    trace: [
      { label: "图片提示词 Agent", detail: prompt },
      { label: "图片生成 Tool", detail },
      { label: "素材入库", detail: `写入 image_jobs：${status}` }
    ],
    status: "completed"
  });
}

export async function generateProductImage({ sellerId, prompt }) {
  const id = randomUUID();
  const runId = randomUUID();
  const normalizedPrompt = textOr(prompt, "冰种晴底翡翠手镯，黑色岩石背景，商业珠宝摄影，真实自然光");
  if (!imageClient) {
    const imageUrl = localImageForPrompt(normalizedPrompt);
    recordImageJob({ id, sellerId, prompt: normalizedPrompt, status: "fallback", imageUrl, provider: "local-asset" });
    recordImageAgentRun({
      runId,
      sellerId,
      prompt: normalizedPrompt,
      imageUrl,
      status: "fallback",
      provider: "local-asset",
      detail: "未配置 OPENAI_API_KEY，使用本地商品素材"
    });
    return { id, runId, imageUrl, status: "fallback", provider: "local-asset" };
  }

  try {
    const response = await imageClient.responses.create({
      model: process.env.OPENAI_IMAGE_ORCHESTRATOR_MODEL ?? "gpt-5.5",
      input: normalizedPrompt,
      tools: [{ type: "image_generation", model: imageModel }]
    });

    const imageCall = (response.output ?? []).find((item) => item.type === "image_generation_call");
    const imageData = imageCall?.result;
    if (!imageData) throw new Error("OpenAI image generation returned no image data");

    const filename = `${id}.png`;
    fs.writeFileSync(path.join(generatedDir, filename), Buffer.from(imageData, "base64"));
    const imageUrl = `/generated/${filename}`;
    recordImageJob({ id, sellerId, prompt: normalizedPrompt, status: "completed", imageUrl, provider: "openai" });
    recordImageAgentRun({
      runId,
      sellerId,
      prompt: normalizedPrompt,
      imageUrl,
      status: "completed",
      provider: "openai",
      detail: `${imageModel} 已生成商品素材`
    });
    return { id, runId, imageUrl, status: "completed", provider: "openai" };
  } catch {
    const imageUrl = localImageForPrompt(normalizedPrompt);
    recordImageJob({ id, sellerId, prompt: normalizedPrompt, status: "fallback", imageUrl, provider: "local-asset" });
    recordImageAgentRun({
      runId,
      sellerId,
      prompt: normalizedPrompt,
      imageUrl,
      status: "fallback",
      provider: "local-asset",
      detail: `${imageModel} 生成失败，使用本地商品素材`
    });
    return { id, runId, imageUrl, status: "fallback", provider: "local-asset" };
  }
}
