import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "jade-agent.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS sellers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  vip_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seller_sessions (
  token TEXT PRIMARY KEY,
  seller_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL,
  sku TEXT UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL,
  origin_price INTEGER,
  status TEXT NOT NULL,
  images_json TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  intro TEXT NOT NULL,
  detail TEXT NOT NULL,
  diameter TEXT,
  quality TEXT,
  material TEXT,
  jadeite_type TEXT,
  color TEXT,
  water TEXT,
  shape TEXT,
  size TEXT,
  weight TEXT,
  certificate TEXT,
  certificate_no TEXT,
  flaws TEXT,
  origin TEXT,
  treatment TEXT,
  inventory_count INTEGER DEFAULT 1,
  negotiable INTEGER DEFAULT 1,
  scene TEXT,
  upload_source TEXT,
  merchant_notes TEXT,
  search_keywords_json TEXT,
  specs_json TEXT,
  rag_text TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_need TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  contacted_at TEXT,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  user_email TEXT,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  agent_type TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT NOT NULL,
  trace_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
);

CREATE TABLE IF NOT EXISTS image_jobs (
  id TEXT PRIMARY KEY,
  seller_id INTEGER,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  image_url TEXT,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);

CREATE TABLE IF NOT EXISTS product_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  chunk_type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  embedding_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, chunk_type),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
`);

const productColumnDefs = {
  sku: "TEXT",
  material: "TEXT",
  jadeite_type: "TEXT",
  color: "TEXT",
  water: "TEXT",
  shape: "TEXT",
  size: "TEXT",
  weight: "TEXT",
  certificate: "TEXT",
  certificate_no: "TEXT",
  flaws: "TEXT",
  origin: "TEXT",
  treatment: "TEXT",
  inventory_count: "INTEGER DEFAULT 1",
  negotiable: "INTEGER DEFAULT 1",
  scene: "TEXT",
  upload_source: "TEXT",
  merchant_notes: "TEXT",
  search_keywords_json: "TEXT",
  specs_json: "TEXT",
  rag_text: "TEXT",
  deleted_at: "TEXT"
};
const productColumns = db.prepare("PRAGMA table_info(products)").all().map((column) => column.name);
for (const [name, type] of Object.entries(productColumnDefs)) {
  if (!productColumns.includes(name)) {
    db.prepare(`ALTER TABLE products ADD COLUMN ${name} ${type}`).run();
  }
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS products_sku_idx ON products(sku) WHERE sku IS NOT NULL");

const imageJobColumns = db.prepare("PRAGMA table_info(image_jobs)").all().map((column) => column.name);
if (!imageJobColumns.includes("seller_id")) {
  db.prepare("ALTER TABLE image_jobs ADD COLUMN seller_id INTEGER").run();
}

const encode = (value) => JSON.stringify(value);
const decode = (value, fallback) => {
  if (value == null) return fallback;
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
};

const productSelect = `
SELECT p.*, s.email AS seller_email, s.name AS seller_name, s.vip_until
FROM products p
JOIN sellers s ON s.id = p.seller_id
`;

export function normalizeProduct(row) {
  const product = {
    id: row.id,
    sellerId: row.seller_id,
    sellerEmail: row.seller_email,
    sellerName: row.seller_name,
    vipUntil: row.vip_until,
    sku: row.sku,
    title: row.title,
    category: row.category,
    price: row.price,
    originPrice: row.origin_price,
    status: row.status,
    images: decode(row.images_json, []),
    tags: decode(row.tags_json, []),
    intro: row.intro,
    detail: row.detail,
    diameter: row.diameter,
    quality: row.quality,
    material: row.material,
    jadeiteType: row.jadeite_type,
    color: row.color,
    water: row.water,
    shape: row.shape,
    size: row.size,
    weight: row.weight,
    certificate: row.certificate,
    certificateNo: row.certificate_no,
    flaws: row.flaws,
    origin: row.origin,
    treatment: row.treatment,
    inventoryCount: row.inventory_count,
    negotiable: Boolean(row.negotiable),
    scene: row.scene,
    uploadSource: row.upload_source,
    merchantNotes: row.merchant_notes,
    searchKeywords: decode(row.search_keywords_json, []),
    specs: decode(row.specs_json, {}),
    ragText: row.rag_text,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (!product.searchKeywords.length) product.searchKeywords = productKeywords(product);
  if (!product.ragText) product.ragText = productRagText(product);
  return product;
}

function compact(value) {
  return Array.from(new Set(value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean)));
}

function productKeywords(product) {
  return compact([
    product.title,
    product.category,
    product.quality,
    product.water,
    product.color,
    product.shape,
    product.size,
    product.diameter,
    product.material,
    product.treatment,
    product.scene,
    product.certificate,
    product.flaws,
    ...(product.tags ?? [])
  ]);
}

function productRagText(product) {
  return [
    `商品：${product.title}`,
    `SKU：${product.sku ?? "未设置"}`,
    `品类：${product.category}`,
    `价格：${product.price}元，原价：${product.originPrice ?? product.price}元`,
    `材质：${product.material ?? "翡翠"}，处理方式：${product.treatment ?? "天然A货"}`,
    `种水：${product.water ?? product.quality ?? ""}，颜色：${product.color ?? ""}，器型：${product.shape ?? ""}`,
    `尺寸：${product.size ?? product.diameter ?? ""}，重量：${product.weight ?? "未称重"}`,
    `瑕疵：${product.flaws ?? "以实物复检为准"}，证书：${product.certificate ?? "可复检"}`,
    `适用场景：${product.scene ?? "自用、送礼"}`,
    `标签：${(product.tags ?? []).join("、")}`,
    `简介：${product.intro}`,
    `详情：${product.detail}`,
    `商家备注：${product.merchantNotes ?? ""}`
  ].filter((line) => !line.endsWith("：")).join("\n");
}

function enrichProduct(input) {
  const tags = Array.isArray(input.tags) ? input.tags : [];
  const product = {
    sellerId: input.sellerId,
    sku: input.sku ?? null,
    title: input.title,
    category: input.category,
    price: input.price,
    originPrice: input.originPrice ?? input.price,
    status: input.status ?? "listed",
    images: Array.isArray(input.images) ? input.images : [],
    tags,
    intro: input.intro,
    detail: input.detail,
    diameter: input.diameter ?? input.size ?? null,
    quality: input.quality ?? input.water ?? null,
    material: input.material ?? "翡翠",
    jadeiteType: input.jadeiteType ?? "缅甸翡翠",
    color: input.color ?? input.quality ?? null,
    water: input.water ?? input.quality ?? null,
    shape: input.shape ?? input.category,
    size: input.size ?? input.diameter ?? null,
    weight: input.weight ?? null,
    certificate: input.certificate ?? "支持复检",
    certificateNo: input.certificateNo ?? null,
    flaws: input.flaws ?? (tags.includes("无纹裂") ? "无纹裂" : "以实物复检为准"),
    origin: input.origin ?? "云南瑞丽",
    treatment: input.treatment ?? "天然A货",
    inventoryCount: input.inventoryCount ?? 1,
    negotiable: input.negotiable ?? true,
    scene: input.scene ?? (tags.includes("送礼佳品") ? "送礼" : "自用/送礼"),
    uploadSource: input.uploadSource ?? "merchant_manual",
    merchantNotes: input.merchantNotes ?? "",
    specs: input.specs ?? {}
  };
  product.searchKeywords = input.searchKeywords ?? productKeywords(product);
  product.ragText = input.ragText ?? productRagText(product);
  return product;
}

function insertProduct(product) {
  return db.prepare(`
    INSERT INTO products (
      seller_id, sku, title, category, price, origin_price, status, images_json,
      tags_json, intro, detail, diameter, quality, material, jadeite_type, color,
      water, shape, size, weight, certificate, certificate_no, flaws, origin,
      treatment, inventory_count, negotiable, scene, upload_source, merchant_notes,
      search_keywords_json, specs_json, rag_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    product.sellerId,
    product.sku,
    product.title,
    product.category,
    product.price,
    product.originPrice,
    product.status,
    encode(product.images),
    encode(product.tags),
    product.intro,
    product.detail,
    product.diameter,
    product.quality,
    product.material,
    product.jadeiteType,
    product.color,
    product.water,
    product.shape,
    product.size,
    product.weight,
    product.certificate,
    product.certificateNo,
    product.flaws,
    product.origin,
    product.treatment,
    product.inventoryCount,
    product.negotiable ? 1 : 0,
    product.scene,
    product.uploadSource,
    product.merchantNotes,
    encode(product.searchKeywords),
    encode(product.specs),
    product.ragText
  );
}

function upsertProductDocument(product) {
  db.prepare(`
    INSERT INTO product_documents (product_id, chunk_type, content, metadata_json)
    VALUES (?, 'catalog_card', ?, ?)
    ON CONFLICT(product_id, chunk_type) DO UPDATE SET
      content = excluded.content,
      metadata_json = excluded.metadata_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(product.id, product.ragText, encode({
    sku: product.sku,
    title: product.title,
    category: product.category,
    price: product.price,
    tags: product.tags,
    keywords: product.searchKeywords,
    status: product.status
  }));
}

function syncProductDocuments() {
  for (const product of listProducts()) {
    upsertProductDocument(product);
  }
}

function searchTermsFromText(text) {
  const source = String(text ?? "").toLowerCase();
  const domainTerms = [
    "手镯",
    "吊坠",
    "戒面",
    "平安扣",
    "珠链",
    "手串",
    "无事牌",
    "耳坠",
    "挂件",
    "豆种",
    "冰种",
    "冰糯",
    "糯冰",
    "糯种",
    "高冰",
    "玻璃种",
    "晴底",
    "晴水",
    "白冰",
    "飘花",
    "飘绿",
    "阳绿",
    "正阳绿",
    "满绿",
    "辣绿",
    "帝王绿",
    "蓝水",
    "紫罗兰",
    "春彩",
    "黄翡",
    "红翡",
    "油青",
    "墨翠",
    "正圈",
    "圆条",
    "贵妃",
    "佛公",
    "观音",
    "叶子",
    "葫芦",
    "蛋面",
    "素牌",
    "龙牌",
    "圆珠",
    "算盘珠",
    "无纹裂",
    "微瑕",
    "轻微棉絮",
    "少量石纹",
    "天然A货",
    "证书",
    "送礼",
    "自用",
    "收藏"
  ];
  const terms = domainTerms.filter((term) => source.includes(term.toLowerCase()));
  for (const match of source.matchAll(/[a-z0-9]+|[1-9]\d?(?:\.\d)?\s*(?:mm|圈口|圈)?/gi)) {
    const term = match[0].replace(/\s+/g, "");
    if (/^\d+$/.test(term)) continue;
    terms.push(term.replace("圈口", "mm").replace("圈", "mm"));
  }
  return compact(terms);
}

function snippetFor(content, matchedTerms) {
  const text = String(content ?? "").replace(/\s+/g, " ");
  const first = matchedTerms.find((term) => text.includes(term));
  if (!first) return text.slice(0, 96);
  const index = Math.max(0, text.indexOf(first) - 28);
  return text.slice(index, index + 118);
}

function seedCatalogProducts(sellerId, count = 299) {
  const categories = [
    { category: "手镯", shapes: ["正圈", "圆条", "贵妃"], sizes: ["52mm", "53mm", "54mm", "55mm", "56mm", "57mm", "58mm", "59mm"], base: 28000 },
    { category: "吊坠", shapes: ["水滴", "如意", "佛公", "观音", "叶子", "葫芦"], sizes: ["24x14mm", "28x16mm", "32x18mm", "36x21mm", "42x24mm"], base: 10000 },
    { category: "戒面", shapes: ["蛋面", "马鞍", "随形"], sizes: ["8x6mm", "10x8mm", "12x10mm", "14x11mm", "16x12mm"], base: 16000 },
    { category: "平安扣", shapes: ["圆扣", "怀古扣"], sizes: ["18mm", "22mm", "26mm", "30mm", "34mm"], base: 9000 },
    { category: "珠链", shapes: ["圆珠", "算盘珠"], sizes: ["6mm珠", "7mm珠", "8mm珠", "9mm珠", "10mm珠"], base: 24000 },
    { category: "手串", shapes: ["圆珠", "算盘珠"], sizes: ["6mm珠", "7mm珠", "8mm珠", "9mm珠", "10mm珠"], base: 12000 },
    { category: "无事牌", shapes: ["素牌", "龙牌", "山水牌"], sizes: ["32x18mm", "38x22mm", "45x25mm", "52x31mm"], base: 18000 },
    { category: "耳坠", shapes: ["水滴", "葫芦", "蛋面"], sizes: ["8x6mm", "10x8mm", "12x9mm", "15x10mm"], base: 7000 },
    { category: "挂件", shapes: ["佛公", "观音", "如意", "叶子", "葫芦"], sizes: ["26x15mm", "32x18mm", "38x22mm", "45x26mm"], base: 11000 }
  ];
  const waters = ["豆种", "糯种", "糯冰", "冰糯", "冰种", "高冰", "玻璃种"];
  const colors = ["晴底", "晴水", "白冰", "飘花", "飘绿", "阳绿", "正阳绿", "满绿", "辣绿", "帝王绿", "蓝水", "紫罗兰", "春彩", "黄翡", "红翡", "油青", "墨翠"];
  const certificates = ["NGTC国检证书", "GIC证书", "省检证书", "商家复检报告"];
  const flaws = ["无纹裂", "微瑕", "轻微棉絮", "少量石纹", "边缘细小矿点", "肉眼干净"];
  const scenes = ["送礼", "自用", "日常佩戴", "收藏", "通勤佩戴", "节日礼赠", "婚庆礼赠", "商务礼赠"];
  const waterPrice = { 豆种: 0.45, 糯种: 0.7, 糯冰: 0.95, 冰糯: 1.05, 冰种: 1.35, 高冰: 2.05, 玻璃种: 3.15 };
  const colorPrice = { 晴底: 1.08, 晴水: 1.12, 白冰: 1.05, 飘花: 1.2, 飘绿: 1.35, 阳绿: 1.9, 正阳绿: 2.6, 满绿: 3.2, 辣绿: 2.35, 帝王绿: 4.2, 蓝水: 1.3, 紫罗兰: 1.45, 春彩: 1.55, 黄翡: 1.18, 红翡: 1.28, 油青: 0.78, 墨翠: 1.75 };
  const flawPrice = { 无纹裂: 1.15, 肉眼干净: 1.1, 微瑕: 0.98, 轻微棉絮: 0.92, 少量石纹: 0.82, 边缘细小矿点: 0.88 };
  const curatedProducts = {
    295: { sku: "JDAI-0295", title: "糯冰紫罗兰翡翠蛋面耳坠", category: "耳坠", price: 9800, water: "糯冰", color: "紫罗兰", shape: "蛋面", size: "10x8mm", flaw: "微瑕", scene: "日常佩戴" },
    296: { sku: "JDAI-0296", title: "冰种晴水翡翠圆扣平安扣", category: "平安扣", price: 8800, water: "冰种", color: "晴水", shape: "圆扣", size: "26mm", flaw: "无纹裂", scene: "送礼" },
    297: { sku: "JDAI-0297", title: "高冰墨翠翡翠素牌无事牌", category: "无事牌", price: 118000, water: "高冰", color: "墨翠", shape: "素牌", size: "45x25mm", flaw: "肉眼干净", scene: "收藏" },
    298: { sku: "JDAI-0298", title: "糯种白冰翡翠圆珠手串", category: "手串", price: 6800, water: "糯种", color: "白冰", shape: "圆珠", size: "7mm珠", flaw: "轻微棉絮", scene: "自用" },
    299: { sku: "JDAI-0299", title: "冰种阳绿翡翠佛公吊坠", category: "吊坠", price: 46800, water: "冰种", color: "阳绿", shape: "佛公", size: "32x18mm", flaw: "无纹裂", scene: "商务礼赠" }
  };

  return Array.from({ length: count }, (_, index) => {
    const curated = curatedProducts[index + 1];
    if (curated) {
      const tags = compact([
        curated.water,
        curated.color,
        `翡翠${curated.category}`,
        curated.shape,
        curated.size,
        curated.flaw,
        "天然A货",
        curated.scene.includes("礼") ? "送礼佳品" : "自用",
        curated.price <= 10000 ? "万元内" : curated.price <= 50000 ? "5万内" : curated.price <= 100000 ? "10万内" : "高端收藏",
        "精准覆盖货源"
      ]);
      return enrichProduct({
        sellerId,
        sku: curated.sku,
        title: curated.title,
        category: curated.category,
        price: curated.price,
        originPrice: Math.round(curated.price * 1.08 / 100) * 100,
        status: "listed",
        images: [],
        tags,
        intro: `${curated.water}${curated.color}，${curated.shape}${curated.category}，${curated.flaw}，适合${curated.scene}。`,
        detail: `${curated.title}由商家手动录入，图片字段暂留空，等待真实商家上传。整体为${curated.water}质地，${curated.color}色调，${curated.shape}器型，尺寸${curated.size}。瑕疵说明：${curated.flaw}；处理方式为天然A货，支持复检。适合${curated.scene}，用于覆盖高频买家需求和 RAG 精确召回。`,
        diameter: curated.category === "手镯" ? curated.size : null,
        quality: `${curated.water}${curated.color}`,
        material: "翡翠",
        jadeiteType: "缅甸翡翠",
        color: curated.color,
        water: curated.water,
        shape: curated.shape,
        size: curated.size,
        weight: curated.category === "手串" ? "24g" : "6g",
        certificate: certificates[index % certificates.length],
        certificateNo: `CERT-${String(202606000 + index + 1)}`,
        flaws: curated.flaw,
        origin: ["云南瑞丽", "广东四会", "平洲玉器街", "揭阳工坊"][index % 4],
        treatment: "天然A货",
        inventoryCount: 1,
        negotiable: true,
        scene: curated.scene,
        uploadSource: "merchant_manual_simulated",
        merchantNotes: `模拟商家手动上传货源 ${curated.sku}，用于覆盖高频需求：${curated.title}。`,
        specs: {
          light: "自然光",
          videoAvailable: true,
          certificateChecked: true,
          source: "seeded_merchant_inventory",
          imagePending: true,
          curatedCoverage: true
        }
      });
    }

    const category = categories[index % categories.length];
    const water = waters[(index + Math.floor(index / categories.length)) % waters.length];
    const color = colors[(index * 5 + Math.floor(index / 7)) % colors.length];
    const shape = category.shapes[index % category.shapes.length];
    const size = category.sizes[(index + 2) % category.sizes.length];
    const flaw = flaws[(index + 3) % flaws.length];
    const scene = scenes[(index + 1) % scenes.length];
    const price = Math.max(
      1800,
      Math.round(category.base * waterPrice[water] * colorPrice[color] * flawPrice[flaw] / 100) * 100 + (index % 7) * 300
    );
    const sku = `JDAI-${String(index + 1).padStart(4, "0")}`;
    const title = `${water}${color}翡翠${shape}${category.category}`;
    const budgetTag = price <= 10000 ? "万元内" : price <= 30000 ? "3万内" : price <= 50000 ? "5万内" : price <= 100000 ? "10万内" : "高端收藏";
    const tags = compact([
      water,
      color,
      `翡翠${category.category}`,
      shape,
      size,
      flaw,
      "天然A货",
      scene === "送礼" || scene === "节日礼赠" ? "送礼佳品" : "自用",
      budgetTag,
      price <= 30000 ? "高性价比" : "精品货源"
    ]);
    const intro = `${water}${color}，${shape}${category.category}，${flaw}，适合${scene}。`;
    const detail = `${title}由商家手动录入，图片字段暂留空，等待真实商家上传。整体为${water}质地，${color}色调，${shape}器型，尺寸${size}。瑕疵说明：${flaw}；处理方式为天然A货，支持复检。适合${scene}，可用于后续 RAG 检索、预算匹配、标签召回和 Agent 推荐解释。`;
    return enrichProduct({
      sellerId,
      sku,
      title,
      category: category.category,
      price,
      originPrice: Math.round(price * 1.08 / 100) * 100,
      status: "listed",
      images: [],
      tags,
      intro,
      detail,
      diameter: category.category === "手镯" ? size : null,
      quality: `${water}${color}`,
      material: "翡翠",
      jadeiteType: "缅甸翡翠",
      color,
      water,
      shape,
      size,
      weight: category.category === "手镯" ? `${48 + (index % 12)}g` : category.category === "珠链" ? `${35 + (index % 22)}g` : category.category === "手串" ? `${18 + (index % 16)}g` : `${3 + (index % 12)}g`,
      certificate: certificates[index % certificates.length],
      certificateNo: `CERT-${String(202606000 + index + 1)}`,
      flaws: flaw,
      origin: ["云南瑞丽", "广东四会", "平洲玉器街", "揭阳工坊"][index % 4],
      treatment: "天然A货",
      inventoryCount: 1 + (index % 3),
      negotiable: index % 5 !== 0,
      scene,
      uploadSource: "merchant_manual_simulated",
      merchantNotes: `模拟商家手动上传货源 ${sku}，已补充种水、颜色、尺寸、证书、瑕疵和推荐场景。`,
      specs: {
        light: index % 2 === 0 ? "自然光" : "室内柔光",
        videoAvailable: index % 3 !== 0,
        certificateChecked: true,
        source: "seeded_merchant_inventory",
        imagePending: true
      }
    });
  });
}

export function seedDatabase() {
  const seller = db
    .prepare("SELECT id FROM sellers WHERE email = ?")
    .get("seller@email.com");

  const sellerId =
    seller?.id ??
    db
      .prepare(
        "INSERT INTO sellers (email, name, vip_until) VALUES (?, ?, ?) RETURNING id"
      )
      .get("seller@email.com", "晴翠严选", "2026-05-20").id;

  const productCount = db.prepare("SELECT COUNT(*) AS count FROM products").get()
    .count;

  if (productCount === 0) {
    const insert = db.prepare(`
      INSERT INTO products (
        seller_id, title, category, price, origin_price, status, images_json,
        tags_json, intro, detail, diameter, quality
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      sellerId,
      "冰种晴底翡翠手镯",
      "手镯",
      48000,
      52000,
      "listed",
      encode([]),
      encode(["冰种", "晴底色", "翡翠手镯", "正圈", "55圈口", "无纹裂", "天然A货", "送礼佳品"]),
      "冰种晴底，质地细腻通透，清新淡雅，佩戴显气质。",
      "本款冰种晴底翡翠手镯，种水达到冰种级别，底地细腻，通透如冰，底色清爽淡雅。手镯为正圈设计，圈口55mm，佩戴舒适贴合。无纹裂，结构稳定，几乎无瑕疵，适合日常佩戴或收藏。润的大方的质感，彰显东方韵味与高端气质，是送礼自用的佳选。",
      "55mm",
      "冰种晴底"
    );

    insert.run(
      sellerId,
      "冰种飘绿翡翠吊坠",
      "吊坠",
      32000,
      36000,
      "listed",
      encode([]),
      encode(["冰种", "飘绿", "吊坠", "18K扣", "无纹裂", "天然A货"]),
      "冰透起光，飘绿灵动，适合日常佩戴与礼赠。",
      "吊坠整体水润透亮，绿色集中自然，配18K扣头，尺寸适中。适合搭配金链或绳链，日常、宴会和礼赠场景均适配。",
      "32x18mm",
      "冰种飘绿"
    );

    insert.run(
      sellerId,
      "冰种阳绿翡翠戒面",
      "戒面",
      46800,
      50000,
      "draft",
      encode([]),
      encode(["阳绿", "戒面", "收藏级", "无纹裂", "天然A货"]),
      "阳绿色辣，饱满起光，适合定制高端戒指。",
      "戒面颜色浓阳正匀，弧面饱满，起光明显，适合镶嵌为主石戒指或收藏裸石。",
      "12x10mm",
      "阳绿起光"
    );

    insert.run(
      sellerId,
      "糯冰种翡翠手镯",
      "手镯",
      18000,
      22000,
      "unlisted",
      encode([]),
      encode(["糯冰", "手镯", "正圈", "56圈口", "天然A货"]),
      "糯冰质地，颜色沉稳，预算友好。",
      "适合入门佩戴，结构稳定，圈口56mm，整体质感清爽耐看。",
      "56mm",
      "糯冰"
    );
  }

  db.prepare("UPDATE products SET images_json = ? WHERE sku IS NULL AND upload_source IS NULL").run(encode([]));

  for (const product of seedCatalogProducts(sellerId)) {
    const existing = db.prepare("SELECT id FROM products WHERE sku = ?").get(product.sku);
    if (existing) {
      updateProduct(existing.id, product, sellerId);
    } else {
      insertProduct(product);
    }
  }

  const premiumProduct = enrichProduct({
    sellerId,
    sku: "JDAI-PREMIUM-0001",
    title: "玻璃种帝王绿翡翠正圈手镯",
    category: "手镯",
    price: 98000,
    originPrice: 108000,
    status: "listed",
    images: [],
    tags: ["玻璃种", "帝王绿", "翡翠手镯", "正圈", "55mm", "微瑕", "天然A货", "精品货源", "收藏"],
    intro: "玻璃种帝王绿，正圈55mm，预算10万内的高端手镯货源。",
    detail: "商家手动上传的高端翡翠手镯货源。整体为玻璃种质地，帝王绿色调，正圈器型，圈口55mm。瑕疵说明为轻微棉絮，肉眼观感干净，处理方式为天然A货，支持复检。适合自用、收藏和高端礼赠，可用于 RAG 检索、预算贴近排序和 Agent 推荐解释。",
    diameter: "55mm",
    quality: "玻璃种帝王绿",
    material: "翡翠",
    jadeiteType: "缅甸翡翠",
    color: "帝王绿",
    water: "玻璃种",
    shape: "正圈",
    size: "55mm",
    weight: "53g",
    certificate: "NGTC国检证书",
    certificateNo: "CERT-202606999",
    flaws: "轻微棉絮",
    origin: "平洲玉器街",
    treatment: "天然A货",
    inventoryCount: 1,
    negotiable: true,
    scene: "自用/收藏/送礼",
    uploadSource: "merchant_manual_simulated",
    merchantNotes: "模拟商家手动上传的10万级帝王绿手镯，供买家高预算找货和RAG召回验证。",
    specs: {
      light: "自然光",
      videoAvailable: true,
      certificateChecked: true,
      source: "seeded_premium_inventory"
    }
  });
  const existingPremium = db.prepare("SELECT id FROM products WHERE sku = ?").get(premiumProduct.sku);
  if (existingPremium) {
    updateProduct(existingPremium.id, premiumProduct, sellerId);
  } else {
    insertProduct(premiumProduct);
  }

  syncProductDocuments();

  const leadCount = db.prepare("SELECT COUNT(*) AS count FROM leads").get()
    .count;
  if (leadCount === 0) {
    const products = listProducts();
    const insertLead = db.prepare(`
      INSERT INTO leads (product_id, seller_id, buyer_email, buyer_need, source, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertLead.run(
      products[0].id,
      sellerId,
      "buyer1@email.com",
      "预算5万左右，冰种手镯，55圈口，无纹裂，送长辈",
      "buyer_agent",
      "new",
      "2026-05-20 10:30:00"
    );
    insertLead.run(
      products[1].id,
      sellerId,
      "buyer2@email.com",
      "送礼用，冰种飘绿吊坠，希望带证书",
      "buyer_agent",
      "contacted",
      "2026-05-19 15:20:00"
    );
    insertLead.run(
      products[2].id,
      sellerId,
      "buyer3@email.com",
      "冰种阳绿戒面，预算2万到5万",
      "buyer_agent",
      "new",
      "2026-05-18 09:10:00"
    );
  }
}

export function listProducts(filter = {}) {
  const rows = db
    .prepare(`${productSelect} ORDER BY p.status = 'listed' DESC, p.updated_at DESC, p.id ASC`)
    .all();
  let products = rows.map(normalizeProduct);
  if (filter.sellerId) {
    products = products.filter((product) => product.sellerId === Number(filter.sellerId));
  }
  if (!filter.includeDeleted && filter.status !== "deleted") {
    products = products.filter((product) => product.status !== "deleted");
  }
  if (filter.publicOnly) {
    products = products.filter((product) => product.status === "listed");
  }
  if (filter.status) {
    products = products.filter((product) => product.status === filter.status);
  }
  return products;
}

export function searchProductDocuments({ query, terms = [], category, limit = 20 } = {}) {
  const queryTerms = compact([...searchTermsFromText(query), ...terms]);
  const products = new Map(listProducts({ publicOnly: true }).map((product) => [product.id, product]));
  const rows = db.prepare(
    `SELECT d.product_id, d.chunk_type, d.content, d.metadata_json, p.status
     FROM product_documents d
     JOIN products p ON p.id = d.product_id
     WHERE p.deleted_at IS NULL AND p.status = 'listed'`
  ).all();

  return rows
    .map((row) => {
      const product = products.get(row.product_id);
      if (!product) return null;
      const content = `${row.content}\n${JSON.stringify(decode(row.metadata_json, {}))}`.toLowerCase();
      const matchedTerms = queryTerms.filter((term) => content.includes(term.toLowerCase()));
      const categoryBoost = category && product.category === category ? 10 : 0;
      const tagBoost = (product.tags ?? []).filter((tag) => queryTerms.some((term) => tag.includes(term) || term.includes(tag))).length * 4;
      const keywordBoost = (product.searchKeywords ?? []).filter((keyword) => queryTerms.some((term) => keyword.includes(term) || term.includes(keyword))).length * 3;
      const score = matchedTerms.length * 9 + categoryBoost + tagBoost + keywordBoost;
      return {
        productId: product.id,
        chunkType: row.chunk_type,
        score,
        matchedTerms,
        snippet: snippetFor(row.content, matchedTerms),
        product
      };
    })
    .filter(Boolean)
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function getProduct(id) {
  const row = db.prepare(`${productSelect} WHERE p.id = ?`).get(id);
  return row ? normalizeProduct(row) : null;
}

export function createProduct(input) {
  const product = enrichProduct(input);
  const result = insertProduct(product);
  const created = getProduct(result.lastInsertRowid);
  upsertProductDocument(created);
  return created;
}

export function updateProduct(id, input, sellerId) {
  const product = enrichProduct({ ...input, sellerId });
  const result = db.prepare(
    `UPDATE products
     SET title = ?, category = ?, price = ?, origin_price = ?, status = ?,
         images_json = ?, tags_json = ?, intro = ?, detail = ?, diameter = ?,
         quality = ?, material = ?, jadeite_type = ?, color = ?, water = ?,
         shape = ?, size = ?, weight = ?, certificate = ?, certificate_no = ?,
         flaws = ?, origin = ?, treatment = ?, inventory_count = ?, negotiable = ?,
         scene = ?, upload_source = ?, merchant_notes = ?, search_keywords_json = ?,
         specs_json = ?, rag_text = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND seller_id = ?`
  ).run(
    product.title,
    product.category,
    product.price,
    product.originPrice,
    product.status,
    encode(product.images),
    encode(product.tags),
    product.intro,
    product.detail,
    product.diameter,
    product.quality,
    product.material,
    product.jadeiteType,
    product.color,
    product.water,
    product.shape,
    product.size,
    product.weight,
    product.certificate,
    product.certificateNo,
    product.flaws,
    product.origin,
    product.treatment,
    product.inventoryCount,
    product.negotiable ? 1 : 0,
    product.scene,
    product.uploadSource,
    product.merchantNotes,
    encode(product.searchKeywords),
    encode(product.specs),
    product.ragText,
    id,
    sellerId
  );
  if (result.changes === 0) return null;
  const updated = getProduct(id);
  upsertProductDocument(updated);
  return updated;
}

export function updateProductStatus(id, sellerId, status) {
  const result = db.prepare(
    `UPDATE products
     SET status = ?,
         deleted_at = CASE WHEN ? = 'deleted' THEN CURRENT_TIMESTAMP ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND seller_id = ?`
  ).run(status, status, id, sellerId);
  if (result.changes === 0) return null;
  const updated = getProduct(id);
  if (updated) upsertProductDocument(updated);
  return updated;
}

export function deleteProduct(id, sellerId) {
  return updateProductStatus(id, sellerId, "deleted");
}

export function listLeads(sellerId, filter = {}) {
  const rows = db
    .prepare(
      `SELECT l.*, p.title AS product_title, p.price AS product_price, p.images_json,
              s.email AS seller_email, s.name AS seller_name
       FROM leads l
       JOIN products p ON p.id = l.product_id
       JOIN sellers s ON s.id = l.seller_id
       WHERE (? IS NULL OR l.seller_id = ?)
       ORDER BY l.created_at DESC, l.id DESC`
    )
    .all(sellerId ?? null, sellerId ?? null);
  let leads = rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    sellerId: row.seller_id,
    buyerEmail: row.buyer_email,
    buyerNeed: row.buyer_need,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    contactedAt: row.contacted_at,
    productTitle: row.product_title,
    productPrice: row.product_price,
    productImage: decode(row.images_json, [])[0],
    sellerEmail: row.seller_email,
    sellerName: row.seller_name
  }));
  if (filter.status) {
    leads = leads.filter((lead) => lead.status === filter.status);
  }
  return leads;
}

export function createLead(input) {
  const product = getProduct(input.productId);
  if (!product || product.status !== "listed") return null;
  const existing = db
    .prepare(
      "SELECT id FROM leads WHERE product_id = ? AND buyer_email = ? AND buyer_need = ?"
    )
    .get(input.productId, input.buyerEmail, input.buyerNeed);
  if (existing) return getLead(existing.id);

  const result = db
    .prepare(
      `INSERT INTO leads (product_id, seller_id, buyer_email, buyer_need, source, status)
       VALUES (?, ?, ?, ?, ?, 'new')`
    )
    .run(
      input.productId,
      product.sellerId,
      input.buyerEmail,
      input.buyerNeed,
      input.source
    );
  return getLead(result.lastInsertRowid);
}

export function getLead(id) {
  return listLeads().find((lead) => lead.id === Number(id)) ?? null;
}

export function getSellerLead(id, sellerId) {
  return listLeads(sellerId).find((lead) => lead.id === Number(id)) ?? null;
}

export function markLeadContacted(id, sellerId) {
  const result = db.prepare(
    "UPDATE leads SET status = 'contacted', contacted_at = CURRENT_TIMESTAMP WHERE id = ? AND seller_id = ?"
  ).run(id, sellerId);
  if (result.changes === 0) return null;
  return getSellerLead(id, sellerId);
}

export function getSeller(email = "seller@email.com") {
  return db.prepare("SELECT * FROM sellers WHERE email = ?").get(email);
}

export function upsertSeller(email) {
  const existing = getSeller(email);
  if (existing) return existing;
  const id = db
    .prepare("INSERT INTO sellers (email, name) VALUES (?, ?) RETURNING id")
    .get(email, email.split("@")[0]).id;
  return db.prepare("SELECT * FROM sellers WHERE id = ?").get(id);
}

export function createSellerSession(sellerId) {
  const token = randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO seller_sessions (token, seller_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))"
  ).run(token, sellerId);
  return token;
}

export function getSellerByToken(token) {
  if (!token) return null;
  return db.prepare(
    `SELECT s.*
     FROM seller_sessions ss
     JOIN sellers s ON s.id = ss.seller_id
     WHERE ss.token = ? AND ss.expires_at > CURRENT_TIMESTAMP`
  ).get(token) ?? null;
}

export function getOrCreateSession(id, type, userEmail) {
  const existing = db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(id);
  if (existing) return existing;
  db.prepare(
    "INSERT INTO agent_sessions (id, type, user_email, state_json) VALUES (?, ?, ?, ?)"
  ).run(id, type, userEmail ?? null, encode({}));
  return db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(id);
}

export function getSessionState(session) {
  return decode(session?.state_json, {});
}

export function updateSessionState(id, state) {
  db.prepare("UPDATE agent_sessions SET state_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(encode(state), id);
}

export function addMessage(sessionId, role, content, metadata = {}) {
  db.prepare(
    "INSERT INTO messages (session_id, role, content, metadata_json) VALUES (?, ?, ?, ?)"
  ).run(sessionId, role, content, encode(metadata));
}

export function recordAgentRun(run) {
  db.prepare(
    `INSERT INTO agent_runs (
      id, session_id, agent_type, input_json, output_json, trace_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    run.id,
    run.sessionId ?? null,
    run.agentType,
    encode(run.input),
    encode(run.output),
    encode(run.trace),
    run.status
  );
}

export function listAgentRuns(filter = {}) {
  const rows = db
    .prepare("SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT ?")
    .all(filter.limit ?? 20);
  return rows
    .map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      agentType: row.agent_type,
      input: decode(row.input_json, {}),
      output: decode(row.output_json, {}),
      trace: decode(row.trace_json, []),
      status: row.status,
      createdAt: row.created_at
    }))
    .filter((run) => !filter.sellerId || Number(run.input.sellerId ?? run.output.sellerId) === Number(filter.sellerId))
    .filter((run) => !filter.agentType || run.agentType === filter.agentType);
}

seedDatabase();
