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

function seedCatalogProducts(sellerId) {
  const imageSets = [
    ["/assets/jade-bangle-main.jpg", "/assets/jade-upload-bangle.jpg", "/assets/jade-bangle-1.jpg"],
    ["/assets/jade-bangle-2.jpg", "/assets/jade-bangle-3.jpg", "/assets/jade-list-bangle.jpg"],
    ["/assets/jade-dark-bangle.jpg", "/assets/jade-bangle-1.jpg"],
    ["/assets/jade-pendant.jpg", "/assets/jade-pendant-small.jpg", "/assets/jade-list-pendant.jpg"],
    ["/assets/jade-list-pendant.jpg", "/assets/jade-pendant.jpg"],
    ["/assets/jade-ring.jpg", "/assets/jade-bangle-3.jpg"],
    ["/assets/jade-pendant-small.jpg", "/assets/jade-list-pendant.jpg"],
    ["/assets/jade-upload-bangle.jpg", "/assets/jade-bangle-main.jpg"]
  ];
  const categories = [
    { category: "手镯", shapes: ["正圈", "圆条", "贵妃"], sizes: ["53mm", "54mm", "55mm", "56mm", "57mm", "58mm"], base: 28000, images: [0, 1, 2, 7] },
    { category: "吊坠", shapes: ["水滴", "如意", "佛公", "叶子"], sizes: ["28x16mm", "32x18mm", "36x21mm", "42x24mm"], base: 12000, images: [3, 4, 6] },
    { category: "戒面", shapes: ["蛋面", "马鞍", "随形"], sizes: ["10x8mm", "12x10mm", "14x11mm"], base: 18000, images: [5] },
    { category: "平安扣", shapes: ["圆扣", "怀古扣"], sizes: ["22mm", "26mm", "30mm"], base: 9000, images: [3, 4] },
    { category: "珠链", shapes: ["圆珠", "算盘珠"], sizes: ["7mm珠", "8mm珠", "9mm珠"], base: 22000, images: [6, 4] }
  ];
  const waters = ["糯种", "糯冰", "冰种", "高冰", "玻璃种"];
  const colors = ["晴底", "白冰", "飘绿", "阳绿", "蓝水", "紫罗兰", "黄翡", "油青"];
  const certificates = ["NGTC国检证书", "GIC证书", "省检证书", "商家复检报告"];
  const flaws = ["无纹裂", "轻微棉絮", "少量石纹", "边缘细小矿点", "肉眼干净"];
  const scenes = ["送礼", "日常佩戴", "收藏", "通勤佩戴", "节日礼赠"];
  const waterPrice = { 糯种: 0.7, 糯冰: 0.9, 冰种: 1.25, 高冰: 1.75, 玻璃种: 2.4 };
  const colorPrice = { 晴底: 1.1, 白冰: 1.05, 飘绿: 1.3, 阳绿: 1.9, 蓝水: 1.25, 紫罗兰: 1.35, 黄翡: 1.15, 油青: 0.8 };

  return Array.from({ length: 50 }, (_, index) => {
    const category = categories[index % categories.length];
    const water = waters[(index + Math.floor(index / 5)) % waters.length];
    const color = colors[(index * 3 + 1) % colors.length];
    const shape = category.shapes[index % category.shapes.length];
    const size = category.sizes[(index + 2) % category.sizes.length];
    const flaw = flaws[(index + 3) % flaws.length];
    const scene = scenes[(index + 1) % scenes.length];
    const price = Math.round(category.base * waterPrice[water] * colorPrice[color] / 100) * 100 + (index % 4) * 800;
    const sku = `JDAI-${String(index + 1).padStart(4, "0")}`;
    const title = `${water}${color}翡翠${shape}${category.category}`;
    const tags = compact([
      water,
      color,
      `翡翠${category.category}`,
      shape,
      size,
      flaw,
      "天然A货",
      scene === "送礼" || scene === "节日礼赠" ? "送礼佳品" : "自用",
      price <= 30000 ? "高性价比" : "精品货源"
    ]);
    const images = imageSets[category.images[index % category.images.length]];
    const intro = `${water}${color}，${shape}${category.category}，${flaw}，适合${scene}。`;
    const detail = `${title}由商家手动上传，实物主图和细节图已入库。整体为${water}质地，${color}色调，${shape}器型，尺寸${size}。瑕疵说明：${flaw}；处理方式为天然A货，支持复检。适合${scene}，可用于后续 RAG 检索、预算匹配、标签召回和 Agent 推荐解释。`;
    return enrichProduct({
      sellerId,
      sku,
      title,
      category: category.category,
      price,
      originPrice: Math.round(price * 1.08 / 100) * 100,
      status: "listed",
      images,
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
      weight: category.category === "手镯" ? `${48 + (index % 9)}g` : `${3 + (index % 8)}g`,
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
        source: "seeded_merchant_inventory"
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
      encode([
        "/assets/jade-bangle-main.jpg",
        "/assets/jade-upload-bangle.jpg",
        "/assets/jade-bangle-1.jpg"
      ]),
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
      encode(["/assets/jade-pendant.jpg", "/assets/jade-pendant-small.jpg"]),
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
      encode(["/assets/jade-ring.jpg", "/assets/jade-bangle-3.jpg"]),
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
      encode(["/assets/jade-dark-bangle.jpg", "/assets/jade-bangle-2.jpg"]),
      encode(["糯冰", "手镯", "正圈", "56圈口", "天然A货"]),
      "糯冰质地，颜色沉稳，预算友好。",
      "适合入门佩戴，结构稳定，圈口56mm，整体质感清爽耐看。",
      "56mm",
      "糯冰"
    );
  }

  for (const product of seedCatalogProducts(sellerId)) {
    const existing = db.prepare("SELECT id FROM products WHERE sku = ?").get(product.sku);
    if (!existing) insertProduct(product);
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

export function deleteProduct(id, sellerId) {
  const result = db.prepare(
    "UPDATE products SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND seller_id = ?"
  ).run(id, sellerId);
  if (result.changes === 0) return null;
  const deleted = getProduct(id);
  if (deleted) upsertProductDocument(deleted);
  return deleted;
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

export function recordImageJob(job) {
  db.prepare(
    "INSERT INTO image_jobs (id, seller_id, prompt, status, image_url, provider) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(job.id, job.sellerId ?? null, job.prompt, job.status, job.imageUrl ?? null, job.provider);
}

export function listImageJobs(filter = {}) {
  const rows = db
    .prepare(
      `SELECT id, seller_id, prompt, status, image_url, provider, created_at
       FROM image_jobs
       WHERE (? IS NULL OR seller_id = ?)
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(filter.sellerId ?? null, filter.sellerId ?? null, filter.limit ?? 20);
  return rows.map((row) => ({
    id: row.id,
    sellerId: row.seller_id,
    prompt: row.prompt,
    status: row.status,
    imageUrl: row.image_url,
    provider: row.provider,
    createdAt: row.created_at
  }));
}

seedDatabase();
