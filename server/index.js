import express from "express";
import cors from "cors";
import {
  createLead,
  createProduct,
  createSellerSession,
  getProduct,
  getSellerByToken,
  getSellerLead,
  listLeads,
  listProducts,
  markLeadContacted,
  seedDatabase,
  updateProduct,
  upsertSeller
} from "./db.js";
import {
  generateProductImage,
  runBuyerMatchAgent,
  runPublishAgent
} from "./agent.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const devOtpCode = process.env.DEV_OTP_CODE ?? "123456";

app.use(cors());
app.use(express.json({ limit: "10mb" }));

function bearerToken(req) {
  const header = req.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function optionalSeller(req) {
  return getSellerByToken(bearerToken(req));
}

function requireSeller(req, res, next) {
  const seller = optionalSeller(req);
  if (!seller) return res.status(401).json({ error: "Unauthorized" });
  req.seller = seller;
  next();
}

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI翡翠匹配 API</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; background: #edf3ef; color: #17211b; }
      main { width: min(520px, calc(100vw - 32px)); padding: 28px; border-radius: 12px; background: #fff; box-shadow: 0 24px 80px rgba(21, 45, 34, .14); }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p { margin: 0 0 18px; color: #60766b; line-height: 1.6; }
      a { display: flex; justify-content: space-between; padding: 14px 16px; margin-top: 10px; border-radius: 8px; background: #f4f8f5; color: #087243; font-weight: 800; text-decoration: none; }
      a.primary { background: #07874f; color: #fff; }
      small { display: block; margin-top: 16px; color: #71837a; }
    </style>
  </head>
  <body>
    <main>
      <h1>AI翡翠匹配 API 正在运行</h1>
      <p>8787 是后端接口端口；产品网页请打开前端服务。</p>
      <a class="primary" href="http://127.0.0.1:5173/#buyer">买家网页 <span>AI聊天找货</span></a>
      <a href="http://127.0.0.1:5173/#merchant">商家网页 <span>后台与客资</span></a>
      <a href="/api/health">API健康检查 <span>/api/health</span></a>
      <small>后端地址：http://127.0.0.1:8787</small>
    </main>
  </body>
</html>`);
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/app-state", (req, res) => {
  const seller = optionalSeller(req);
  const products = listProducts(seller ? { sellerId: seller.id } : { publicOnly: true });
  const leads = seller ? listLeads(seller.id) : [];
  res.json({
    seller,
    products,
    leads,
    metrics: {
      listedProducts: products.filter((product) => product.status === "listed").length,
      productQuota: 100,
      todayLeads: leads.filter((lead) => lead.createdAt.startsWith("2026-05-20")).length,
      totalLeads: leads.length + 125
    }
  });
});

app.get("/api/products", (req, res) => {
  const seller = optionalSeller(req);
  res.json({ products: listProducts({ status: req.query.status, sellerId: seller?.id, publicOnly: !seller }) });
});

app.get("/api/products/:id", (req, res) => {
  const seller = optionalSeller(req);
  const product = getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  if (product.status !== "listed" && product.sellerId !== seller?.id) {
    return res.status(404).json({ error: "Product not found" });
  }
  res.json({ product });
});

app.post("/api/products", requireSeller, (req, res) => {
  res.status(201).json({ product: createProduct({ ...req.body, sellerId: req.seller.id }) });
});

app.put("/api/products/:id", requireSeller, (req, res) => {
  const product = updateProduct(req.params.id, req.body, req.seller.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json({ product });
});

app.get("/api/leads", requireSeller, (req, res) => {
  res.json({ leads: listLeads(req.seller.id) });
});

app.get("/api/leads/:id", requireSeller, (req, res) => {
  const lead = getSellerLead(req.params.id, req.seller.id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  res.json({ lead });
});

app.post("/api/leads", (req, res) => {
  const lead = createLead(req.body);
  if (!lead) return res.status(404).json({ error: "Product not found" });
  res.status(201).json({ lead });
});

app.post("/api/leads/:id/contacted", requireSeller, (req, res) => {
  const lead = markLeadContacted(req.params.id, req.seller.id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  res.json({ lead });
});

app.post("/api/auth/otp", (req, res) => {
  const seller = upsertSeller(req.body.email);
  res.json({ ok: true, seller, code: process.env.NODE_ENV === "production" ? undefined : devOtpCode });
});

app.post("/api/auth/login", (req, res) => {
  if (String(req.body.code ?? "") !== devOtpCode) {
    return res.status(401).json({ error: "Invalid code" });
  }
  const seller = upsertSeller(req.body.email);
  res.json({ seller, token: createSellerSession(seller.id) });
});

app.get("/api/auth/me", requireSeller, (req, res) => {
  res.json({ seller: req.seller });
});

app.post("/api/agent/buyer-match", async (req, res, next) => {
  try {
    res.json(await runBuyerMatchAgent(req.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/agent/publish", requireSeller, async (req, res, next) => {
  try {
    res.json(await runPublishAgent({ ...req.body, sellerId: req.seller.id }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/images/generate", async (req, res, next) => {
  try {
    res.json(await generateProductImage(req.body));
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const requestId = Math.random().toString(36).slice(2, 10);
  const message = String(error.message ?? error).replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_SECRET]");
  console.error(`${requestId} ${error.name ?? "Error"}: ${message}`);
  res.status(500).json({ error: "Internal server error", requestId });
});

if (process.argv.includes("--seed-only")) {
  seedDatabase();
  console.log("Database seeded");
} else {
  app.listen(port, () => {
    console.log(`Jade agent API listening on http://127.0.0.1:${port}`);
  });
}
