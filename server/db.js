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
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  image_url TEXT,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const encode = (value) => JSON.stringify(value);
const decode = (value, fallback) => {
  try {
    return JSON.parse(value);
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
  return {
    id: row.id,
    sellerId: row.seller_id,
    sellerEmail: row.seller_email,
    sellerName: row.seller_name,
    vipUntil: row.vip_until,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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
  const result = db
    .prepare(
      `INSERT INTO products (
        seller_id, title, category, price, origin_price, status, images_json,
        tags_json, intro, detail, diameter, quality
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.sellerId,
      input.title,
      input.category,
      input.price,
      input.originPrice ?? input.price,
      input.status ?? "listed",
      encode(input.images),
      encode(input.tags),
      input.intro,
      input.detail,
      input.diameter,
      input.quality
    );
  return getProduct(result.lastInsertRowid);
}

export function updateProduct(id, input, sellerId) {
  const result = db.prepare(
    `UPDATE products
     SET title = ?, category = ?, price = ?, origin_price = ?, status = ?,
         images_json = ?, tags_json = ?, intro = ?, detail = ?, diameter = ?,
         quality = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND seller_id = ?`
  ).run(
    input.title,
    input.category,
    input.price,
    input.originPrice ?? input.price,
    input.status,
    encode(input.images),
    encode(input.tags),
    input.intro,
    input.detail,
    input.diameter,
    input.quality,
    id,
    sellerId
  );
  if (result.changes === 0) return null;
  return getProduct(id);
}

export function listLeads(sellerId) {
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
  return rows.map((row) => ({
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
    "INSERT INTO image_jobs (id, prompt, status, image_url, provider) VALUES (?, ?, ?, ?, ?)"
  ).run(job.id, job.prompt, job.status, job.imageUrl ?? null, job.provider);
}

seedDatabase();
