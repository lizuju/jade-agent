export function validateBuyerNeedText(text) {
  const value = text.trim();
  if (value.length > 240) return "请把消息控制在 240 字以内。";
  return "";
}

export function validateProductDraft(draft) {
  if (!draft?.title || draft.title.trim().length < 4) return "商品标题至少需要 4 个字。";
  if (!draft.category) return "请选择或生成商品品类。";
  if (!Number.isFinite(Number(draft.price)) || Number(draft.price) < 100) return "商品价格需要大于 100 元。";
  if (!draft.images?.length) return "至少需要 1 张商品图片。";
  if (!draft.tags?.length) return "至少需要 1 个商品标签。";
  if (!draft.intro || draft.intro.trim().length < 8) return "商品简介至少需要 8 个字。";
  if (!draft.detail || draft.detail.trim().length < 20) return "商品详情至少需要 20 个字。";
  return "";
}
