const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const statuses = new Set(["listed", "draft", "unlisted"]);
const lifecycleStatuses = new Set(["listed", "draft", "unlisted", "deleted"]);
const categories = new Set(["手镯", "吊坠", "戒面", "平安扣", "珠链", "手串", "无事牌", "耳坠", "挂件"]);
const leadStatuses = new Set(["new", "contacted"]);
export class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
    this.details = details;
  }
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function ensure(condition, message, details) {
  if (!condition) throw new ValidationError(message, details);
}

export function normalizeEmail(value, label = "email") {
  const email = cleanText(value).toLowerCase();
  ensure(emailPattern.test(email), `Invalid ${label}`, [{ field: label, message: "请输入有效邮箱地址" }]);
  return email;
}

export function validateBuyerMatchPayload(body) {
  const need = cleanText(body.need);
  const details = [];
  if (!need) details.push({ field: "need", message: "请输入要咨询的内容" });
  if (need.length > 240) details.push({ field: "need", message: "需求不能超过 240 个字" });
  if (details.length) throw new ValidationError("Invalid buyer need", details);
  return {
    sessionId: cleanText(body.sessionId) || undefined,
    need,
    buyerEmail: body.buyerEmail ? normalizeEmail(body.buyerEmail, "buyerEmail") : undefined
  };
}

export function validateProductPayload(body) {
  const title = cleanText(body.title);
  const category = cleanText(body.category);
  const price = Number(body.price);
  const images = Array.isArray(body.images) ? body.images.map(cleanText).filter(Boolean) : [];
  const tags = Array.isArray(body.tags) ? body.tags.map(cleanText).filter(Boolean).slice(0, 12) : [];
  const intro = cleanText(body.intro);
  const detail = cleanText(body.detail);
  const status = cleanText(body.status || "listed");
  const details = [];

  if (title.length < 4 || title.length > 80) details.push({ field: "title", message: "商品标题需要 4 到 80 个字" });
  if (!categories.has(category)) details.push({ field: "category", message: "商品品类必须是手镯、吊坠、戒面、平安扣、珠链、手串、无事牌、耳坠或挂件" });
  if (!Number.isFinite(price) || price < 100 || price > 5000000) details.push({ field: "price", message: "价格需要在 100 到 5,000,000 元之间" });
  if (!statuses.has(status)) details.push({ field: "status", message: "商品状态不合法" });
  if (!images.length) details.push({ field: "images", message: "至少需要 1 张商品图片" });
  if (images.length > 6) details.push({ field: "images", message: "商品图片最多 6 张" });
  if (intro.length < 8 || intro.length > 160) details.push({ field: "intro", message: "商品简介需要 8 到 160 个字" });
  if (detail.length < 20 || detail.length > 1200) details.push({ field: "detail", message: "商品详情需要 20 到 1200 个字" });
  if (!tags.length) details.push({ field: "tags", message: "至少需要 1 个检索标签" });

  if (details.length) throw new ValidationError("Invalid product", details);
  return { ...body, title, category, price, images, tags, intro, detail, status };
}

export function validateProductStatusPayload(body) {
  const status = cleanText(body.status);
  ensure(lifecycleStatuses.has(status), "Invalid product status", [{ field: "status", message: "商品状态必须是已上架、草稿、已下架或已删除" }]);
  return { status };
}

export function validateLeadPayload(body) {
  const productId = Number(body.productId);
  const buyerNeed = cleanText(body.buyerNeed);
  const details = [];
  if (!Number.isInteger(productId) || productId <= 0) details.push({ field: "productId", message: "商品 ID 不合法" });
  if (buyerNeed.length < 4 || buyerNeed.length > 240) details.push({ field: "buyerNeed", message: "咨询需求需要 4 到 240 个字" });
  if (details.length) throw new ValidationError("Invalid lead", details);
  return {
    productId,
    buyerEmail: normalizeEmail(body.buyerEmail, "buyerEmail"),
    buyerNeed,
    source: cleanText(body.source) || "product_detail"
  };
}

export function validatePublishPayload(body) {
  const hint = cleanText(body.hint ?? body.notes);
  const images = Array.isArray(body.images) ? body.images.map(cleanText).filter(Boolean) : [];
  const details = [];
  if (hint.length < 6 || hint.length > 300) details.push({ field: "hint", message: "发布描述需要 6 到 300 个字" });
  if (!images.length) details.push({ field: "images", message: "发布商品至少需要 1 张商家上传图片" });
  if (details.length) throw new ValidationError("Invalid publish request", details);
  return { ...body, hint, images };
}

export function validateLeadStatus(value) {
  if (!value) return undefined;
  const status = cleanText(value);
  ensure(leadStatuses.has(status), "Invalid lead status", [{ field: "status", message: "客资状态不合法" }]);
  return status;
}

export function validateLimit(value, fallback = 20) {
  const limit = Number(value ?? fallback);
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), 100);
}
