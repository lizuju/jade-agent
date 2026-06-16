import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Box,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crown,
  Edit3,
  Home,
  ImagePlus,
  Inbox,
  LockKeyhole,
  Mail,
  Menu,
  MessageCircle,
  PackagePlus,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  User,
  Wand2
} from "lucide-react";
import { api, maskEmail, money } from "./api.js";

const sellerEmail = "seller@email.com";
const buyerEmail = "buyer1@email.com";
const initialBuyerMessages = [
  {
    id: "welcome",
    role: "assistant",
    text: "您好！请说出您的翡翠需求（预算、品类、尺寸、品相），我将为您精准匹配货源。",
    time: "10:30"
  }
];

const buyerRoutes = new Set(["buyer", "detail"]);
const merchantRoutes = new Set(["dashboard", "publish", "publishResult", "editInfo", "products", "editProduct", "leads", "leadDetail", "account", "profile"]);

const routeAliases = {
  merchant: "dashboard",
  "publish-result": "publishResult",
  "edit-publish": "editInfo"
};

function parseRoute(value) {
  const raw = routeAliases[value] ?? value;
  const [name, id] = raw.split("/");
  const numericId = Number(id);
  if (name === "product" && Number.isFinite(numericId)) {
    return { route: "detail", selectedProductId: numericId };
  }
  if (name === "edit-product" && Number.isFinite(numericId)) {
    return { route: "editProduct", selectedProductId: numericId };
  }
  if (name === "lead" && Number.isFinite(numericId)) {
    return { route: "leadDetail", selectedLeadId: numericId };
  }
  return { route: raw };
}

function useHashRoute() {
  const [routeInfo, setRouteInfo] = useState(() => parseRoute(window.location.hash.replace("#", "") || "buyer"));
  useEffect(() => {
    const onHash = () => setRouteInfo(parseRoute(window.location.hash.replace("#", "") || "buyer"));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = (key) => {
    window.location.hash = key;
    setRouteInfo(parseRoute(key));
  };
  return [routeInfo, go];
}

function PortalSwitch({ route, go }) {
  const buyerActive = buyerRoutes.has(route);
  return (
    <nav className="portal-switch" aria-label="端口切换">
      <button className={buyerActive ? "active" : ""} onClick={() => go("buyer")}>
        <Sparkles size={18} />
        <span>买家网页</span>
        <small>AI聊天找货</small>
      </button>
      <button className={!buyerActive ? "active" : ""} onClick={() => go("merchant")}>
        <Store size={18} />
        <span>商家网页</span>
        <small>后台与客资</small>
      </button>
    </nav>
  );
}

function Header({ title, left, right }) {
  return (
    <div className="topbar">
      <div className="topbar-side">{left}</div>
      <div className="topbar-title">{title}</div>
      <div className="topbar-side topbar-right">{right}</div>
    </div>
  );
}

function BackButton({ go, to = "dashboard" }) {
  return (
    <button className="icon-btn" onClick={() => go(to)} aria-label="返回">
      <ChevronLeft size={22} />
    </button>
  );
}

function Chip({ children, active }) {
  return <span className={active ? "chip active" : "chip"}>{children}</span>;
}

function BottomNav({ active, go }) {
  const items = [
    ["dashboard", Home, "首页"],
    ["products", Box, "商品"],
    ["leads", MessageCircle, "客资"],
    ["profile", User, "我的"]
  ];
  return (
    <div className="bottom-nav">
      {items.map(([key, Icon, label]) => (
        <button key={key} className={active === key ? "nav-item active" : "nav-item"} onClick={() => go(key)}>
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function agentLabel(type) {
  if (type === "buyer_match") return "买家匹配 Agent";
  if (type === "lead_followup") return "客资跟进 Agent";
  return "商品发布 Agent";
}

function assetUrl(value) {
  const raw = typeof value === "string" ? value : value?.url;
  const src = String(raw || "").trim();
  if (!src) return "";
  if (/^(https?:|data:|blob:)/.test(src)) return src;
  if (src.startsWith("/uploads/") && window.location.port === "5173") {
    return `${window.location.protocol}//${window.location.hostname}:8787${src}`;
  }
  return src;
}

function SafeImage({ src, alt, className }) {
  const [failed, setFailed] = useState(false);
  const resolved = assetUrl(src);
  if (!resolved || failed) {
    return <div className={className ? `image-fallback ${className}` : "image-fallback"}><Box size={24} /></div>;
  }
  return <img className={className} src={resolved} alt={alt} onError={() => setFailed(true)} />;
}

function ProductCard({ product, onOpen }) {
  return (
    <button className="product-card" onClick={onOpen}>
      <SafeImage src={product.images?.[0]} alt={product.title} />
      <div className="product-card-body">
        <strong>{product.title}</strong>
        <span>{product.tags.slice(0, 3).join(" · ")}</span>
        <div className="product-price">
          {money(product.price)}
          {product.vipUntil ? <small>VIP</small> : null}
        </div>
        {product.agentScore ? <em>匹配分 {product.agentScore.total} · {product.matchReasons?.[0]}</em> : null}
      </div>
    </button>
  );
}

function Field({ label, value, onChange, multiline }) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function validateBuyerNeedText(text) {
  const value = text.trim();
  if (value.length > 240) return "请把消息控制在 240 字以内。";
  return "";
}

function validateProductDraft(draft) {
  if (!draft?.title || draft.title.trim().length < 4) return "商品标题至少需要 4 个字。";
  if (!draft.category) return "请选择或生成商品品类。";
  if (!Number.isFinite(Number(draft.price)) || Number(draft.price) < 100) return "商品价格需要大于 100 元。";
  if (!draft.images?.length) return "至少需要 1 张商品图片。";
  if (!draft.tags?.length) return "至少需要 1 个商品标签。";
  if (!draft.intro || draft.intro.trim().length < 8) return "商品简介至少需要 8 个字。";
  if (!draft.detail || draft.detail.trim().length < 20) return "商品详情至少需要 20 个字。";
  return "";
}

function readImageForUpload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const image = new Image();
      image.onerror = () => reject(new Error("图片解析失败"));
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const size = 48;
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0, size, size);
        const data = context.getImageData(0, 0, size, size).data;
        let foreground = 0;
        let greenPixels = 0;
        let palePixels = 0;
        let bluePixels = 0;
        let purplePixels = 0;
        let totalR = 0;
        let totalG = 0;
        let totalB = 0;
        for (let index = 0; index < data.length; index += 4) {
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          const brightness = (r + g + b) / 3;
          if (brightness < 28) continue;
          foreground += 1;
          totalR += r;
          totalG += g;
          totalB += b;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const saturation = max ? (max - min) / max : 0;
          if (g > r * 1.04 && g > b * 1.02) greenPixels += 1;
          if (brightness > 118 && saturation < 0.34 && g >= r * 0.92) palePixels += 1;
          if (b > r * 1.05 && b >= g * 0.92) bluePixels += 1;
          if (r > g * 1.08 && b > g * 1.04 && Math.abs(r - b) < 80) purplePixels += 1;
        }
        const sampleCount = Math.max(foreground, 1);
        const greenRatio = greenPixels / sampleCount;
        const paleRatio = palePixels / sampleCount;
        const blueRatio = bluePixels / sampleCount;
        const purpleRatio = purplePixels / sampleCount;
        const avgR = totalR / sampleCount;
        const avgG = totalG / sampleCount;
        const avgB = totalB / sampleCount;
        const name = file.name.toLowerCase();
        const categoryGuess = name.includes("pendant") || name.includes("吊坠") || image.height > image.width * 1.18 ? "吊坠" : "手镯";
        const dominantTone = purpleRatio > 0.12 && greenRatio > 0.08 ? "春彩" : purpleRatio > 0.12 ? "紫罗兰" : blueRatio > 0.26 ? "蓝水" : greenRatio > 0.34 ? "飘绿" : paleRatio > 0.35 && avgG >= avgR ? "晴底" : paleRatio > 0.35 ? "白冰" : avgG > avgR && avgG > avgB ? "绿色系" : "浅色";
        const waterGuess = paleRatio > 0.42 ? "冰种" : paleRatio > 0.24 ? "糯冰" : "糯种";
        const jadeScore = Math.min(99, Math.round(greenRatio * 62 + paleRatio * 32 + blueRatio * 16 + purpleRatio * 70 + (avgG >= avgR && avgG >= avgB ? 14 : 0)));
        resolve({
          name: file.name,
          dataUrl,
          analysis: {
            width: image.width,
            height: image.height,
            aspectRatio: Number((image.width / Math.max(image.height, 1)).toFixed(2)),
            foregroundRatio: Number((foreground / (size * size)).toFixed(2)),
            greenRatio: Number(greenRatio.toFixed(3)),
            paleRatio: Number(paleRatio.toFixed(3)),
            blueRatio: Number(blueRatio.toFixed(3)),
            purpleRatio: Number(purpleRatio.toFixed(3)),
            avgRgb: [Math.round(avgR), Math.round(avgG), Math.round(avgB)],
            jadeScore,
            isJadeLike: jadeScore >= 24 || purpleRatio > 0.12,
            categoryGuess,
            dominantTone,
            waterGuess,
            shapeGuess: categoryGuess === "手镯" ? "正圈" : "水滴",
          }
        });
      };
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function AgentEvidence({ match }) {
  if (!match?.validation && !match?.retrieval) return null;
  return (
    <section className="agent-proof">
      <div>
        <strong>规则校验</strong>
        <span>{match.validation?.passed?.join("；") || "基础需求已通过"}</span>
        {match.validation?.warnings?.length ? <small>{match.validation.warnings.join("；")}</small> : null}
      </div>
      <div>
        <strong>RAG来源</strong>
        {(match.retrieval?.documents ?? []).slice(0, 3).map((doc) => (
          <span key={`${doc.productId}-${doc.score}`}>#{doc.productId} {doc.productTitle} · 命中 {doc.matchedTerms.slice(0, 4).join("、") || "商品文档"}</span>
        ))}
      </div>
    </section>
  );
}

function BuyerHome({ state, setState, go }) {
  const [loading, setLoading] = useState(false);
  const [thinkingDotCount, setThinkingDotCount] = useState(1);
  const [clientNotice, setClientNotice] = useState("");
  const need = state.buyerDraftNeed ?? "";
  const messages = state.buyerMessages?.length ? state.buyerMessages : initialBuyerMessages;
  const products = state.match?.products?.length ? state.match.products : [];
  const activeTrace = state.lastTrace?.length ? state.lastTrace : state.match?.trace;
  const [welcomeMessage, ...conversationMessages] = messages;
  const isThinking = loading || messages.some((message) => message.thinking);
  const thinkingText = `已为您解析需求，正在匹配优质翡翠货源${".".repeat(thinkingDotCount)}`;

  function setNeed(value) {
    setState((current) => ({
      ...current,
      buyerDraftNeed: typeof value === "function" ? value(current.buyerDraftNeed ?? "") : value
    }));
  }

  function setMessages(value) {
    setState((current) => ({
      ...current,
      buyerMessages: typeof value === "function" ? value(current.buyerMessages ?? initialBuyerMessages) : value
    }));
  }

  useEffect(() => {
    if (!isThinking) {
      setThinkingDotCount(1);
      return undefined;
    }

    const timer = window.setInterval(() => {
      setThinkingDotCount((count) => (count === 3 ? 1 : count + 1));
    }, 450);

    return () => window.clearInterval(timer);
  }, [isThinking]);

  async function match() {
    const text = need.trim();
    if (!text || isThinking) return;
    const validationMessage = validateBuyerNeedText(text);
    if (validationMessage) {
      setClientNotice(validationMessage);
      return;
    }

    setLoading(true);
    setClientNotice("");
    const pendingId = `assistant-${Date.now()}`;
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", text, time: "现在" },
      { id: pendingId, role: "assistant", text: "已为您解析需求，正在匹配优质翡翠货源.", time: "进行中", thinking: true }
    ]);
    setNeed("");

    try {
      const result = await api("/api/agent/buyer-match", {
        method: "POST",
        body: JSON.stringify({ sessionId: state.sessionId, need: text, buyerEmail })
      });
      setState((current) => ({
        ...current,
        sessionId: result.sessionId,
        buyerInteractionMode: result.mode,
        match: result.mode === "match" ? result : null,
        lastTrace: result.trace
      }));
      setMessages((current) => current.map((message) => (
        message.id === pendingId
          ? { ...message, text: result.reply ?? "已完成匹配，您可以继续补充预算、圈口或瑕疵要求。", time: "刚刚", thinking: false }
          : message
      )));
    } catch (error) {
      setMessages((current) => current.map((message) => (
        message.id === pendingId
          ? { ...message, text: `匹配失败：${error.message}`, thinking: false }
          : message
      )));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen buyer-screen">
      <div className="brandbar">
        <div className="brand">
          <span className="logo-mark">翠</span>
          <strong>AI翡翠匹配</strong>
        </div>
        <button className="pill-button" onClick={() => go("login")}>商家入驻</button>
      </div>

      <div className="buyer-scroll">
        <div className="chat">
          <div className="avatar bot"><Sparkles size={18} /></div>
          <div className="bubble">
            {welcomeMessage.text}
            <time>{welcomeMessage.time}</time>
          </div>
        </div>

        <div className="quick-tags">
          {["10万预算 帝王绿手镯 55圈口 微瑕", "冰种平安扣 预算2万 无纹无裂", "冰种晴底吊坠 送礼自用均可"].map((text) => (
            <button key={text} onClick={() => setNeed(text)}>{text}</button>
          ))}
        </div>

        {conversationMessages.map((message) => (
          message.role === "user" ? (
            <div className="chat user-chat" key={message.id}>
              <div className="bubble user">
                {message.text}
                <time>{message.time}</time>
              </div>
              <div className="avatar user"><User size={17} /></div>
            </div>
          ) : (
            <div className="chat" key={message.id}>
              <div className="avatar bot"><Sparkles size={18} /></div>
              <div className="bubble">
                {message.thinking ? thinkingText : message.text}
                <time>{message.time}</time>
              </div>
            </div>
          )
        ))}

        {products.length ? (
          <section className="card-section">
            <h3>为您找到以下优质货源（共{products.length}件）</h3>
            <div className="product-grid">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onOpen={() => {
                    setState((current) => ({ ...current, selectedProductId: product.id }));
                    go(`product/${product.id}`);
                  }}
                />
              ))}
            </div>
          </section>
        ) : null}

        {activeTrace ? (
          <section className="agent-trace">
            {activeTrace.map((step) => (
              <div key={step.label}>
                <CheckCircle2 size={15} />
                <span>{step.label}</span>
                <small>{step.detail}</small>
              </div>
            ))}
          </section>
        ) : null}
        <AgentEvidence match={state.match} />
      </div>

      <div className="input-dock">
        <input value={need} onChange={(event) => setNeed(event.target.value)} placeholder="请输入您的翡翠需求，支持中文、英文等语言" />
        <button onClick={match} disabled={isThinking}>
          <Send size={16} />
          {isThinking ? "思考中" : "AI匹配"}
        </button>
        {clientNotice ? <div className="input-notice">{clientNotice}</div> : null}
      </div>
    </div>
  );
}

function ProductDetail({ product, go, setState }) {
  const [email, setEmail] = useState(buyerEmail);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");

  async function shareProduct() {
    const link = `${window.location.origin}${window.location.pathname}#product/${product.id}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setShareLink("");
      setNotice("");
    } catch (error) {
      setCopied(false);
      setShareLink(link);
      setNotice("复制失败，请手动复制下方链接。");
    }
  }

  async function submitLead() {
    if (submitting || sent) return;
    if (!email.includes("@")) {
      setNotice("请输入有效邮箱，方便卖家联系您。");
      return;
    }
    setSubmitting(true);
    setNotice("");
    try {
      await api("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          productId: product.id,
          buyerEmail: email,
          buyerNeed: "从商品详情页咨询：" + product.title,
          source: "product_detail"
        })
      });
      const appState = await api("/api/app-state");
      setState((current) => ({ ...current, ...appState }));
      setSent(true);
    } catch (error) {
      setNotice(`提交失败：${error.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="screen">
      <Header title="商品详情" left={<BackButton go={go} to="buyer" />} right={<button className="icon-btn" onClick={shareProduct} aria-label="分享商品"><Share2 size={20} /></button>} />
      <div className="hero-image">
        <SafeImage src={product.images?.[0]} alt={product.title} />
        <span>1/{product.images?.length || 1}</span>
      </div>
      <section className="detail-body">
        <h1>{product.title}</h1>
        <div className="price-line">
          <strong>{money(product.price)}</strong>
          <span>预估价</span>
        </div>
        <div className="tags-row">{product.tags.slice(0, 5).map((tag) => <Chip key={tag}>{tag}</Chip>)}</div>
        <h3>AI简介（50字）</h3>
        <p>{product.intro}</p>
        <h3>AI详情（300字）</h3>
        <p>{product.detail}</p>
        <h3>商品标签（10个）</h3>
        <div className="tags-row wrap">{product.tags.map((tag) => <Chip key={tag}>{tag}</Chip>)}</div>
      </section>
      <div className="lead-box">
        <label>
          联系卖家（留下邮箱，卖家将主动联系您）
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <button className="primary-button" onClick={submitLead} disabled={submitting || sent}>{submitting ? "提交中..." : sent ? "已提交，等待商家联系" : "提交意向，等待卖家联系"}</button>
        {copied ? <small>商品链接已复制</small> : null}
        {notice ? <div className="notice-card error">{notice}</div> : null}
        {shareLink ? <div className="copy-link">{shareLink}</div> : null}
        <small>我们将严格保护隐私，仅用于卖家联系您</small>
      </div>
    </div>
  );
}

function LoginPage({ go, setState }) {
  const [email, setEmail] = useState(sellerEmail);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [notice, setNotice] = useState("");

  async function requestCode() {
    if (!email.includes("@")) {
      setNotice("请输入有效邮箱地址。");
      return;
    }
    setOtpLoading(true);
    setNotice("");
    try {
      const result = await api("/api/auth/otp", { method: "POST", body: JSON.stringify({ email }) });
      setCode(result.code ?? "");
      setSent(true);
    } catch (error) {
      setNotice(`验证码发送失败：${error.message}`);
    } finally {
      setOtpLoading(false);
    }
  }

  async function login() {
    if (!email.includes("@") || !code.trim()) {
      setNotice("请输入邮箱和验证码。");
      return;
    }
    setLoginLoading(true);
    setNotice("");
    try {
      const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, code }) });
      window.localStorage.setItem("sellerToken", result.token);
      const appState = await api("/api/app-state");
      const runs = await api("/api/agent/runs");
      setState((current) => ({ ...current, ...appState, agentRuns: runs.runs }));
      go("dashboard");
    } catch (error) {
      setNotice(`登录失败：${error.message}`);
    } finally {
      setLoginLoading(false);
    }
  }

  return (
    <div className="screen soft-screen">
      <Header title="" left={<BackButton go={go} to="buyer" />} />
      <div className="login-logo">
        <span className="logo-mark large">翠</span>
        <h1>商家入驻</h1>
        <p>加入翠聪网，获取精准买家线索</p>
      </div>
      <div className="login-form">
        <label><Mail size={18} /><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="请输入您的邮箱地址" /></label>
        <button className="primary-button" onClick={requestCode} disabled={otpLoading}>{otpLoading ? "发送中..." : sent ? "验证码已发送" : "获取验证码"}</button>
        <label><ShieldCheck size={18} /><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="请输入验证码" /></label>
        <button className="primary-button" onClick={login} disabled={loginLoading}>{loginLoading ? "登录中..." : "登录 / 注册"}</button>
        {notice ? <div className="notice-card error">{notice}</div> : null}
      </div>
      <div className="login-benefits">
        <span><Mail size={18} />优质商机</span>
        <span><MessageCircle size={18} />精准客资</span>
        <span><PackagePlus size={18} />快速入驻</span>
        <span><CheckCircle2 size={18} />免费试用</span>
      </div>
      <small className="policy">登录即表示同意《平台服务协议》与《隐私政策》</small>
    </div>
  );
}

function Dashboard({ state, setState, go }) {
  return (
    <div className="screen with-nav">
      <div className="nav-scroll">
        <Header title={<span>商家后台 <b className="vip-badge">VIP</b></span>} left={<button className="icon-btn" onClick={() => go("profile")} aria-label="个人中心"><Menu size={21} /></button>} right={<button className="icon-btn" onClick={() => go("leads")} aria-label="客资通知"><Bell size={20} /></button>} />
        <section className="metrics-card">
          <div><span>商品数量</span><strong>{state.metrics.listedProducts} / {state.metrics.productQuota}</strong><small>已上架 / 上限</small></div>
          <div><span>今日客资</span><strong>{state.metrics.todayLeads}</strong><small>条</small></div>
          <div><span>累计客资</span><strong>{state.metrics.totalLeads}</strong><small>条</small></div>
        </section>
        <section className="quick-actions">
          <button onClick={() => go("publish")}><PackagePlus size={22} /><span>发布商品</span></button>
          <button onClick={() => go("products")}><Box size={22} /><span>商品管理</span></button>
          <button onClick={() => go("leads")}><Inbox size={22} /><span>客资列表</span></button>
          <button onClick={() => go("account")}><Crown size={22} /><span>账户权限</span></button>
        </section>
        <section className="list-section">
          <div className="section-head"><h3>最近客资</h3><button onClick={() => go("leads")}>全部 <ChevronRight size={14} /></button></div>
          {state.leads.slice(0, 3).map((lead) => (
            <button className="lead-row" key={lead.id} onClick={() => {
              setState((current) => ({ ...current, selectedLeadId: lead.id }));
              go(`lead/${lead.id}`);
            }}>
              <span>{lead.createdAt.slice(5, 16)}</span>
              <div>
                <strong>{lead.buyerNeed}</strong>
                <small>{lead.productTitle}</small>
              </div>
              <em>{maskEmail(lead.buyerEmail)}</em>
            </button>
          ))}
        </section>
        {state.agentRuns?.length ? (
          <section className="agent-mini">
            <div className="section-head"><h3>Agent运行</h3><small>{state.agentRuns[0].createdAt}</small></div>
            <strong>{agentLabel(state.agentRuns[0].agentType)}</strong>
            <span>{state.agentRuns[0].trace?.[0]?.detail ?? "暂无运行详情"}</span>
          </section>
        ) : null}
      </div>
      <BottomNav active="dashboard" go={go} />
    </div>
  );
}

function PublishGuide({ state, setState, go }) {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [images, setImages] = useState(state.publishImages?.length ? state.publishImages : []);
  const [imageAnalyses, setImageAnalyses] = useState(state.publishImageAnalyses?.length ? state.publishImageAnalyses : []);

  async function uploadImages(event) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    setNotice("");
    try {
      const payload = await Promise.all(files.slice(0, 6).map(readImageForUpload));
      const result = await api("/api/uploads/images", {
        method: "POST",
        body: JSON.stringify({ files: payload })
      });
      const nextImages = [...images, ...result.images].slice(0, 6);
      const nextAnalyses = [...imageAnalyses, ...(result.analyses ?? payload.map((item) => item.analysis))].slice(0, 6);
      setImages(nextImages);
      setImageAnalyses(nextAnalyses);
      setState((current) => ({ ...current, publishImages: nextImages, publishImageAnalyses: nextAnalyses, draft: null }));
    } catch (error) {
      setNotice(`上传失败：${error.message}`);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function generateDraft() {
    if (loading || uploading) return;
    if (!images.length) {
      setNotice("请先上传清晰的翡翠商品图片。");
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      const draft = await api("/api/agent/publish", {
        method: "POST",
        body: JSON.stringify({
          hint: "",
          images,
          imageAnalyses
        })
      });
      const runs = await api("/api/agent/runs");
      setState((current) => ({ ...current, draft, agentRuns: runs.runs, lastTrace: draft.agentNotes.map((note) => ({ label: note, detail: "发布 agent 已完成" })) }));
      go("publishResult");
    } catch (error) {
      setNotice(`AI生成失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen">
      <Header title="发布商品" left={<BackButton go={go} />} right={<span className="saving">{loading ? "AI生成中" : uploading ? "上传中" : "AI辅助"}</span>} />
      <section className="upload-card">
        <div className="step-title"><span>1.</span><strong>上传商品图片</strong><small>上传清晰的翡翠图片，AI将先校验图片再生成商品文案</small></div>
        <div className="upload-grid">
          {images.map((image) => <SafeImage key={typeof image === "string" ? image : image?.url} src={image} alt="上传商品" />)}
          <label className="upload-add">
            <ImagePlus size={28} />
            <span>{uploading ? "上传中" : "上传图片"}</span>
            <input type="file" accept="image/*" multiple onChange={uploadImages} disabled={uploading} />
          </label>
        </div>
        {notice ? <div className="notice-card error">{notice}</div> : null}
      </section>
      <section className="steps-card">
        {[
          ["2.", "AI智能生成", loading ? "正在校验翡翠图片并识别字段..." : "点击按钮后生成标题、描述、标签和价格"],
          ["3.", "编辑商品信息", "可修改AI生成的标题、描述、标签和价格"],
          ["4.", "提交发布", "发布后商品将展示给平台买家"]
        ].map(([no, title, text]) => (
          <div className="step-line" key={title}>
            <CheckCircle2 size={18} />
            <div><strong>{no} {title}</strong><span>{text}</span></div>
          </div>
        ))}
      </section>
      <button className="primary-button publish-action" onClick={generateDraft} disabled={loading || uploading || !images.length}>
        <Wand2 size={18} />
        {loading ? "AI正在生成..." : uploading ? "图片上传中..." : images.length ? "AI生成商品信息" : "先上传图片"}
      </button>
      <small className="quota-text">当前商品额度 {state.metrics.listedProducts}/{state.metrics.productQuota} 件</small>
    </div>
  );
}

function PublishResult({ state, go }) {
  const draft = state.draft;
  return (
    <div className="screen">
      <Header title="AI智能生成结果" left={<BackButton go={go} to="publish" />} right={<button className="link-btn" onClick={() => go("publish")}>重新生成</button>} />
      {draft ? (
        <>
          <ProductEditorPreview draft={draft} />
          <div className="double-actions">
            <button className="secondary-button" onClick={() => go("publish")}>重新生成</button>
            <button className="primary-button" onClick={() => go("editInfo")}>进入编辑</button>
          </div>
        </>
      ) : (
        <section className="empty-state">
          <strong>还没有生成商品信息</strong>
          <span>请先上传商家实拍翡翠图片，再由 AI 生成商品信息。</span>
          <button className="primary-button" onClick={() => go("publish")}>去上传图片</button>
        </section>
      )}
    </div>
  );
}

function ProductEditorPreview({ draft }) {
  const vision = draft.vision;
  return (
    <section className="editor-preview">
      <div className="hero-image compact">
        <SafeImage src={draft.images?.[0]} alt={draft.title} />
        <span>1/{draft.images?.length || 1}</span>
      </div>
      {vision ? (
        <div className="agent-trace compact">
          <div><CheckCircle2 size={16} /><span>图片校验</span><small>{vision.isJade ? `翡翠图片通过，置信度 ${vision.confidence}%` : "未通过"}</small></div>
          <div><CheckCircle2 size={16} /><span>识别字段</span><small>{[vision.category, vision.water, vision.color, vision.shape].filter(Boolean).join(" / ")}</small></div>
          <div><CheckCircle2 size={16} /><span>识别来源</span><small>{vision.provider === "ollama_vision" ? `Ollama 视觉模型${vision.model ? `：${vision.model}` : ""}` : `本地图像特征兜底${vision.evidence?.[0] ? `：${vision.evidence[0]}` : ""}`}</small></div>
        </div>
      ) : null}
      <ReadOnlyField label="商品标题（10字以内）" value={draft.title} />
      <ReadOnlyField label="商品简介（50字以内）" value={draft.intro} />
      <ReadOnlyField label="商品详情（300字以内）" value={draft.detail} multiline />
      <div className="field readonly">
        <span>商品标签（10个）</span>
        <div className="tags-row wrap">{draft.tags.map((tag) => <Chip key={tag}>{tag}</Chip>)}</div>
      </div>
      <ReadOnlyField label="预估售价（元）" value={String(draft.price)} />
    </section>
  );
}

function ReadOnlyField({ label, value, multiline }) {
  return (
    <div className={multiline ? "field readonly tall" : "field readonly"}>
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

function EditInfo({ state, setState, go }) {
  const [draft, setDraft] = useState(state.draft);
  const [saving, setSaving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [notice, setNotice] = useState("");
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  if (!draft) {
    return (
      <div className="screen">
        <Header title="编辑商品信息" left={<BackButton go={go} to="publish" />} />
        <section className="empty-state">
          <strong>没有可编辑的商品草稿</strong>
          <span>请先上传图片并生成商品信息。</span>
          <button className="primary-button" onClick={() => go("publish")}>去上传图片</button>
        </section>
      </div>
    );
  }

  function addTag() {
    const tag = window.prompt("请输入商品标签");
    if (!tag) return;
    setDraft((current) => ({ ...current, tags: Array.from(new Set([...current.tags, tag.trim()].filter(Boolean))) }));
  }

  async function publish() {
    if (saving || savingDraft) return;
    const validationMessage = validateProductDraft(draft);
    if (validationMessage) {
      setNotice(validationMessage);
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const result = await api("/api/products", {
        method: "POST",
        body: JSON.stringify({ ...draft, status: "listed" })
      });
      const appState = await api("/api/app-state");
      setState((current) => ({ ...current, ...appState, selectedProductId: result.product.id }));
      go("products");
    } catch (error) {
      setNotice(`发布失败：${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    if (saving || savingDraft) return;
    const validationMessage = validateProductDraft(draft);
    if (validationMessage) {
      setNotice(validationMessage);
      return;
    }
    setSavingDraft(true);
    setNotice("");
    try {
      const result = await api("/api/products", {
        method: "POST",
        body: JSON.stringify({ ...draft, status: "draft" })
      });
      const appState = await api("/api/app-state");
      setState((current) => ({ ...current, ...appState, selectedProductId: result.product.id }));
      go("products");
    } catch (error) {
      setNotice(`保存草稿失败：${error.message}`);
    } finally {
      setSavingDraft(false);
    }
  }

  return (
    <div className="screen">
      <Header title="编辑商品信息" left={<BackButton go={go} to="publishResult" />} right={<button className="link-btn" onClick={publish} disabled={saving}>{saving ? "保存中" : "保存"}</button>} />
      <section className="edit-form">
        <Field label="商品标题" value={draft.title} onChange={(value) => set("title", value)} />
        <Field label="商品简介" value={draft.intro} onChange={(value) => set("intro", value)} />
        <Field label="商品详情" value={draft.detail} onChange={(value) => set("detail", value)} multiline />
        <label className="field"><span>商品标签</span><div className="tags-row wrap">{draft.tags.map((tag) => <Chip key={tag} active>{tag}</Chip>)}<button type="button" className="mini-add" onClick={addTag}>+ 添加标签</button></div></label>
        <Field label="预估售价（元）" value={String(draft.price)} onChange={(value) => set("price", Number(value) || 0)} />
        {notice ? <div className="notice-card error">{notice}</div> : null}
      </section>
      <div className="fixed-secondary-actions">
        <button type="button" onClick={saveDraft} disabled={saving || savingDraft}>{savingDraft ? "保存中..." : "保存草稿"}</button>
      </div>
      <button className="primary-button fixed-action" onClick={publish} disabled={saving || savingDraft}>{saving ? "发布中..." : "确认发布"}</button>
    </div>
  );
}

function ProductManagement({ state, setState, go }) {
  const [filter, setFilter] = useState("all");
  const [deletingId, setDeletingId] = useState(null);
  const [statusChangingId, setStatusChangingId] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [notice, setNotice] = useState("");
  const activeProducts = state.products.filter((product) => product.status !== "deleted");
  const counts = {
    all: activeProducts.length,
    listed: state.products.filter((product) => product.status === "listed").length,
    draft: state.products.filter((product) => product.status === "draft").length,
    unlisted: state.products.filter((product) => product.status === "unlisted").length,
    deleted: state.products.filter((product) => product.status === "deleted").length
  };
  const visibleProducts = filter === "all" ? activeProducts : state.products.filter((product) => product.status === filter);
  const tabs = [
    ["all", `全部(${counts.all})`],
    ["listed", `已上架(${counts.listed})`],
    ["draft", `草稿(${counts.draft})`],
    ["unlisted", `已下架(${counts.unlisted})`],
    ["deleted", `回收站(${counts.deleted})`]
  ];

  async function refreshProducts(selectedProductId) {
    const appState = await api("/api/app-state");
    setState((current) => ({
      ...current,
      ...appState,
      selectedProductId: selectedProductId ?? current.selectedProductId
    }));
  }

  async function changeStatus(product, status) {
    setStatusChangingId(product.id);
    setNotice("");
    try {
      await api(`/api/products/${product.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      await refreshProducts(product.id);
    } catch (error) {
      setNotice(`状态更新失败：${error.message}`);
    } finally {
      setStatusChangingId(null);
    }
  }

  async function removeProduct(product) {
    setDeletingId(product.id);
    setNotice("");
    try {
      await api(`/api/products/${product.id}`, { method: "DELETE" });
      await refreshProducts(activeProducts.find((item) => item.id !== product.id)?.id);
      setConfirmingDeleteId(null);
    } catch (error) {
      setNotice(`删除失败：${error.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="screen with-nav fixed-tabs-screen">
      <div className="fixed-list-head">
        <Header title="商品管理" left={<BackButton go={go} />} />
        <div className="tabs product-tabs">
          {tabs.map(([key, label]) => (
            <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="nav-scroll fixed-list-scroll">
        <section className="product-list">
          {visibleProducts.map((product) => (
            <div className="manage-row" key={product.id}>
              <SafeImage src={product.images?.[0]} alt={product.title} />
              <div>
                <strong>{product.title}</strong>
                <b>{money(product.price)}</b>
                <small>{product.createdAt.slice(5, 16)}</small>
              </div>
              <span className={product.status === "listed" ? "status listed" : "status"}>{product.status === "listed" ? "已上架" : product.status === "draft" ? "草稿" : product.status === "deleted" ? "已删除" : "已下架"}</span>
              <div className="row-actions">
                {product.status !== "deleted" ? (
                  <button onClick={() => {
                    setState((current) => ({ ...current, selectedProductId: product.id }));
                    go(`edit-product/${product.id}`);
                  }}><Edit3 size={14} />编辑</button>
                ) : null}
                {product.status === "listed" ? (
                  <button className="lifecycle" onClick={() => changeStatus(product, "unlisted")} disabled={statusChangingId === product.id}><Inbox size={14} />下架</button>
                ) : null}
                {["draft", "unlisted"].includes(product.status) ? (
                  <button className="lifecycle" onClick={() => changeStatus(product, "listed")} disabled={statusChangingId === product.id}><PackagePlus size={14} />上架</button>
                ) : null}
                {product.status === "deleted" ? (
                  <button className="lifecycle" onClick={() => changeStatus(product, "draft")} disabled={statusChangingId === product.id}><PackagePlus size={14} />恢复</button>
                ) : (
                  <button className="danger-action" onClick={() => setConfirmingDeleteId(product.id)} disabled={deletingId === product.id}><Trash2 size={14} />删除</button>
                )}
              </div>
              {confirmingDeleteId === product.id ? (
                <div className="row-confirm">
                  <span>删除后买家端不再展示该商品</span>
                  <button type="button" onClick={() => setConfirmingDeleteId(null)} disabled={deletingId === product.id}>取消</button>
                  <button type="button" onClick={() => removeProduct(product)} disabled={deletingId === product.id}>{deletingId === product.id ? "删除中" : "确认删除"}</button>
                </div>
              ) : null}
            </div>
          ))}
          {!visibleProducts.length ? <div className="empty-state">当前分类暂无商品</div> : null}
          {notice ? <div className="notice-card error">{notice}</div> : null}
        </section>
        <button className="primary-button list-action" onClick={() => go("publish")}>+ 发布新商品</button>
      </div>
      <BottomNav active="products" go={go} />
    </div>
  );
}

function EditProduct({ state, setState, go }) {
  const selected = state.products.find((product) => product.id === state.selectedProductId) ?? state.products[0];
  const [draft, setDraft] = useState(selected);
  const [saving, setSaving] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState("");
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (selected) setDraft(selected);
  }, [selected?.id, selected?.status]);

  async function save() {
    if (saving || statusChanging) return;
    const validationMessage = validateProductDraft(draft);
    if (validationMessage) {
      setNotice(validationMessage);
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      await api(`/api/products/${draft.id}`, { method: "PUT", body: JSON.stringify(draft) });
      const appState = await api("/api/app-state");
      setState((current) => ({ ...current, ...appState }));
      go("products");
    } catch (error) {
      setNotice(`保存失败：${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setNotice("");
    try {
      await api(`/api/products/${draft.id}`, { method: "DELETE" });
      const appState = await api("/api/app-state");
      const nextProduct = appState.products.find((product) => product.status !== "deleted");
      setState((current) => ({ ...current, ...appState, selectedProductId: nextProduct?.id }));
      go("products");
    } catch (error) {
      setNotice(`删除失败：${error.message}`);
    } finally {
      setDeleting(false);
    }
  }

  async function changeStatus(status) {
    setStatusChanging(true);
    setNotice("");
    try {
      const result = await api(`/api/products/${draft.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      const appState = await api("/api/app-state");
      setDraft(result.product);
      setState((current) => ({ ...current, ...appState, selectedProductId: result.product.id }));
    } catch (error) {
      setNotice(`状态更新失败：${error.message}`);
    } finally {
      setStatusChanging(false);
    }
  }

  if (!draft) {
    return (
      <div className="screen">
        <Header title="编辑商品" left={<BackButton go={go} to="products" />} />
        <div className="empty-state">暂无可编辑商品</div>
      </div>
    );
  }

  return (
    <div className="screen">
      <Header title="编辑商品" left={<BackButton go={go} to="products" />} right={<button className="danger-link" onClick={() => setConfirmingDelete(true)} disabled={deleting || statusChanging}>{deleting ? "删除中" : "删除"}</button>} />
      <div className="hero-image compact">
        <SafeImage src={draft.images?.[0]} alt={draft.title} />
        <span>1/{draft.images?.length || 1}</span>
      </div>
      {confirmingDelete ? (
        <section className="notice-card danger">
          <strong>确认删除该商品？</strong>
          <span>删除后买家端不再展示该商品，已有客资记录会保留。</span>
          <div className="confirm-actions">
            <button type="button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>取消</button>
            <button type="button" onClick={remove} disabled={deleting}>{deleting ? "删除中" : "确认删除"}</button>
          </div>
        </section>
      ) : null}
      <section className="lifecycle-card">
        <div>
          <span>当前状态</span>
          <strong>{draft.status === "listed" ? "已上架" : draft.status === "draft" ? "草稿" : "已下架"}</strong>
        </div>
        <div className="lifecycle-actions">
          {draft.status === "listed" ? (
            <button type="button" onClick={() => changeStatus("unlisted")} disabled={statusChanging || saving || deleting}>下架商品</button>
          ) : (
            <button type="button" onClick={() => changeStatus("listed")} disabled={statusChanging || saving || deleting}>上架商品</button>
          )}
          {draft.status !== "draft" ? (
            <button type="button" onClick={() => changeStatus("draft")} disabled={statusChanging || saving || deleting}>转为草稿</button>
          ) : null}
        </div>
      </section>
      <section className="edit-form">
        <Field label="商品标题" value={draft.title} onChange={(value) => set("title", value)} />
        <Field label="商品卖点" value={draft.intro} onChange={(value) => set("intro", value)} />
        <Field label="商品详情" value={draft.detail} onChange={(value) => set("detail", value)} multiline />
        <Field label="预估售价（元）" value={String(draft.price)} onChange={(value) => set("price", Number(value) || 0)} />
        {notice ? <div className="notice-card error">{notice}</div> : null}
      </section>
      <button className="primary-button fixed-action" onClick={save} disabled={saving || deleting || statusChanging}>{saving ? "保存中..." : "保存修改"}</button>
    </div>
  );
}

function LeadsList({ state, setState, go }) {
  const [filter, setFilter] = useState("all");
  const [filteredLeads, setFilteredLeads] = useState(state.leads);
  const [filtering, setFiltering] = useState(false);
  const [notice, setNotice] = useState("");
  const tabs = [
    ["all", "全部"],
    ["new", "待联系"],
    ["contacted", "已联系"]
  ];

  useEffect(() => {
    setFilteredLeads(filter === "all" ? state.leads : state.leads.filter((lead) => lead.status === filter));
  }, [filter, state.leads]);

  async function selectFilter(nextFilter) {
    setFilter(nextFilter);
    const query = nextFilter === "all" ? "" : `?status=${nextFilter}`;
    setFiltering(true);
    setNotice("");
    try {
      const result = await api(`/api/leads${query}`);
      setFilteredLeads(result.leads);
    } catch (error) {
      setNotice(`筛选失败：${error.message}`);
    } finally {
      setFiltering(false);
    }
  }

  return (
    <div className="screen with-nav fixed-tabs-screen">
      <div className="fixed-list-head">
        <Header title="客资列表" left={<BackButton go={go} />} />
        <div className="tabs three">
          {tabs.map(([key, label]) => (
            <button key={key} className={filter === key ? "active" : ""} onClick={() => selectFilter(key)} disabled={filtering}>{label}</button>
          ))}
        </div>
      </div>
      <div className="nav-scroll fixed-list-scroll">
        <section className="lead-list">
          {filteredLeads.map((lead) => (
            <button className="lead-line" key={lead.id} onClick={() => {
              setState((current) => ({ ...current, selectedLeadId: lead.id }));
              go(`lead/${lead.id}`);
            }}>
              <span>{lead.createdAt.slice(5, 16)}</span>
              <div>
                <strong>{lead.buyerNeed}</strong>
                <small>{lead.productTitle}</small>
              </div>
              <em>{lead.status === "contacted" ? "已联系" : "待联系"}</em>
              <small>{maskEmail(lead.buyerEmail)}</small>
            </button>
          ))}
          {!filteredLeads.length ? <div className="empty-state">当前分类暂无客资</div> : null}
          {notice ? <div className="notice-card error">{notice}</div> : null}
        </section>
        <div className="locked-tip">
          免费商家可查看部分邮箱，升级VIP查看全部
        </div>
        <button className="primary-button list-action" onClick={() => go("account")}>开通VIP，查看全部联系方式</button>
      </div>
      <BottomNav active="leads" go={go} />
    </div>
  );
}

function LeadDetail({ state, setState, go }) {
  const [drafting, setDrafting] = useState(false);
  const [contacting, setContacting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const selectedLeadId = state.selectedLeadId;
  const cachedLead = state.leads.find((item) => item.id === selectedLeadId);
  const [lead, setLead] = useState(cachedLead ?? null);
  const [loading, setLoading] = useState(Boolean(selectedLeadId));

  useEffect(() => {
    if (!selectedLeadId) {
      setLead(null);
      setLoading(false);
      return;
    }
    let ignored = false;
    setLead(cachedLead ?? null);
    setLoading(true);
    setNotice("");
    api(`/api/leads/${selectedLeadId}`)
      .then((result) => {
        if (ignored) return;
        setLead(result.lead);
        setState((current) => ({
          ...current,
          selectedLeadId,
          leads: current.leads.some((item) => item.id === result.lead.id)
            ? current.leads.map((item) => item.id === result.lead.id ? result.lead : item)
            : [result.lead, ...current.leads]
        }));
      })
      .catch((error) => {
        if (!ignored) setNotice(`加载失败：${error.message}`);
      })
      .finally(() => {
        if (!ignored) setLoading(false);
      });
    return () => {
      ignored = true;
    };
  }, [selectedLeadId]);

  if (!lead) {
    return (
      <div className="screen lead-detail-screen">
        <Header title="客资详情" left={<BackButton go={go} to="leads" />} />
        <div className="lead-detail-scroll">
          <div className="empty-state">{loading ? "正在加载客资详情..." : "暂无客资详情"}</div>
          {notice ? <div className="notice-card error">{notice}</div> : null}
        </div>
      </div>
    );
  }
  const followup = state.followupByLead?.[lead.id];

  async function contact() {
    if (contacting) return;
    setContacting(true);
    setNotice("");
    try {
      const result = await api(`/api/leads/${lead.id}/contacted`, { method: "POST", body: "{}" });
      setLead(result.lead);
      setState((current) => ({
        ...current,
        leads: current.leads.map((item) => item.id === result.lead.id ? result.lead : item)
      }));
    } catch (error) {
      setNotice(`标记失败：${error.message}`);
    } finally {
      setContacting(false);
    }
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(lead.buyerEmail);
      setCopied(true);
      setNotice("");
    } catch (error) {
      setNotice(`复制失败：${error.message}`);
    }
  }

  async function draftFollowup() {
    if (drafting) return;
    setDrafting(true);
    setNotice("");
    try {
      const result = await api(`/api/agent/leads/${lead.id}/followup`, { method: "POST", body: "{}" });
      const runs = await api("/api/agent/runs");
      setState((current) => ({
        ...current,
        followupByLead: { ...(current.followupByLead ?? {}), [lead.id]: result },
        agentRuns: runs.runs,
        lastTrace: result.trace
      }));
    } catch (error) {
      setNotice(`生成失败：${error.message}`);
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="screen lead-detail-screen">
      <Header title="客资详情" left={<BackButton go={go} to="leads" />} right={<button className="link-btn" onClick={contact} disabled={contacting || lead.status === "contacted"}>{contacting ? "标记中" : lead.status === "contacted" ? "已联系" : "标记已联系"}</button>} />
      <div className="lead-detail-scroll">
        <section className="lead-detail-card">
          <div className="lead-field">
            <span>留言时间</span>
            <strong>{lead.createdAt}</strong>
            <em className={lead.status === "contacted" ? "lead-status contacted" : "lead-status"}>{lead.status === "contacted" ? "已联系" : "待联系"}</em>
          </div>
          <div className="lead-field">
            <span>用户需求原文</span>
            <p>{lead.buyerNeed}</p>
          </div>
          <div className="lead-field">
            <span>关联商品</span>
            <button className="linked-product" type="button" onClick={() => go(`product/${lead.productId}`)}>
              {lead.productImage ? <SafeImage src={lead.productImage} alt={lead.productTitle} /> : <div className="product-thumb-empty"><Box size={22} /></div>}
              <div>
                <strong>{lead.productTitle}</strong>
                <small>{money(lead.productPrice)}</small>
                <b>{[lead.productCategory, lead.productSku].filter(Boolean).join(" · ")}</b>
              </div>
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="lead-field">
            <span>用户邮箱</span>
            <strong>{lead.buyerEmail}</strong>
          </div>
          <div className="lead-field">
            <span>商家账号</span>
            <strong>{lead.sellerEmail}</strong>
          </div>
        </section>
        {notice ? <div className="notice-card error">{notice}</div> : null}
        <section className="followup-card">
          <div className="section-head">
            <h3>AI跟进 Agent</h3>
            <button className="link-btn" onClick={draftFollowup} disabled={drafting}>{drafting ? "生成中" : "生成话术"}</button>
          </div>
          {followup ? (
            <>
              <p>{followup.reply}</p>
              <div className="action-chips">
                {followup.nextActions.map((item) => <span key={item}>{item}</span>)}
              </div>
              <div className="agent-trace compact">
                {followup.trace.map((step) => (
                  <div key={step.label}>
                    <CheckCircle2 size={15} />
                    <span>{step.label}</span>
                    <small>{step.detail}</small>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <small>根据买家需求、商品和商家身份生成可直接发送的跟进话术。</small>
          )}
        </section>
      </div>
      <div className="double-actions bottom lead-detail-actions">
        <button className="secondary-button" onClick={copyEmail}>{copied ? "已复制邮箱" : "复制邮箱"}</button>
        <button className="primary-button" onClick={contact} disabled={contacting || lead.status === "contacted"}>{contacting ? "标记中..." : lead.status === "contacted" ? "已联系" : "标记已联系"}</button>
      </div>
    </div>
  );
}

function AccountPermissions({ go }) {
  const [showBenefits, setShowBenefits] = useState(false);
  const [renewalMessage, setRenewalMessage] = useState("");
  const [renewing, setRenewing] = useState(false);
  const [notice, setNotice] = useState("");

  async function requestRenewal() {
    if (renewing) return;
    setRenewing(true);
    setNotice("");
    try {
      const result = await api("/api/account/renewal", { method: "POST", body: "{}" });
      setRenewalMessage(result.message);
    } catch (error) {
      setNotice(`提交失败：${error.message}`);
    } finally {
      setRenewing(false);
    }
  }

  return (
    <div className="screen">
      <Header title="账户权限" left={<BackButton go={go} />} right={<b className="vip-badge">VIP</b>} />
      <section className="vip-card">
        <div><Crown size={24} /><strong>VIP会员</strong><span>有效期至 2026-05-20</span></div>
        <button onClick={() => setShowBenefits((value) => !value)}>{showBenefits ? "收起权益" : "查看权益"}</button>
      </section>
      {showBenefits ? (
        <section className="notice-card">
          <strong>VIP权益</strong>
          <span>商品上架上限1000件、完整邮箱查看、AI发布与AI跟进优先队列、优先展示权重。</span>
        </section>
      ) : null}
      <section className="permission-list">
        {[
          ["商品发布上限", `${state.metrics.listedProducts} / ${state.metrics.productQuota}件`],
          ["今日客资", "8条"],
          ["买家联系方式", "完整邮箱查看"],
          ["优先展示权重", "高"]
        ].map(([label, value]) => (
          <div key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
      </section>
      <section className="plan-card">
        <h3>开通 / 续费</h3>
        <div><span>VIP会员（12个月）</span><strong>￥2999</strong></div>
        <div><span>VIP会员（6个月）</span><strong>￥1688</strong></div>
      </section>
      {renewalMessage ? <div className="notice-card">{renewalMessage}</div> : null}
      {notice ? <div className="notice-card error">{notice}</div> : null}
      <button className="primary-button fixed-action" onClick={requestRenewal} disabled={renewing}>{renewing ? "提交中..." : "联系运营续费"}</button>
    </div>
  );
}

function Profile({ state, setState, go }) {
  const [notice, setNotice] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      window.localStorage.removeItem("sellerToken");
      const appState = await api("/api/app-state");
      setState((current) => ({ ...current, ...appState, leads: [], agentRuns: [], selectedLeadId: null }));
      go("buyer");
    } catch (error) {
      setNotice(`退出失败：${error.message}`);
    } finally {
      setLoggingOut(false);
    }
  }

  function handleMenu(label) {
    if (label === "账户信息") go("account");
    if (label === "绑定邮箱") setNotice(`当前绑定邮箱：${state.seller?.email ?? sellerEmail}`);
    if (label === "商家店铺") go("products");
    if (label === "帮助中心") setNotice("帮助中心已记录您的咨询入口，后续可接入在线客服。");
    if (label === "关于我们") setNotice("AI翡翠匹配为买家找货和商家客资转化提供 Agent 工作流。");
    if (label === "退出登录") logout();
  }

  return (
    <div className="screen with-nav">
      <div className="nav-scroll">
        <Header title="个人中心" left={<BackButton go={go} />} />
        <section className="profile-card">
          <span className="logo-mark">翠</span>
          <div>
            <strong>{state.seller?.email ?? sellerEmail}</strong>
            <small><b className="vip-badge">VIP会员</b> 有效期至 2026-05-20</small>
          </div>
        </section>
        <section className="menu-list">
          {[
            [User, "账户信息"],
            [MessageCircle, "绑定邮箱"],
            [Store, "商家店铺"],
            [ShieldCheck, "帮助中心"],
            [Inbox, "关于我们"],
            [LockKeyhole, "退出登录"]
          ].map(([Icon, label]) => (
            <button key={label} onClick={() => handleMenu(label)} disabled={label === "退出登录" && loggingOut}>
              <Icon size={18} />
              <span>{label === "退出登录" && loggingOut ? "退出中" : label}</span>
              <ChevronRight size={16} />
            </button>
          ))}
        </section>
        {notice ? <div className="notice-card">{notice}</div> : null}
      </div>
      <BottomNav active="profile" go={go} />
    </div>
  );
}

export default function App() {
  const [routeInfo, go] = useHashRoute();
  const route = routeInfo.route;
  const [ready, setReady] = useState(false);
  const [state, setState] = useState({
    seller: null,
    products: [],
    leads: [],
    metrics: { listedProducts: 0, productQuota: 1000, todayLeads: 0, totalLeads: 0 },
    match: null,
    buyerDraftNeed: "",
    buyerMessages: initialBuyerMessages,
    draft: null,
    agentRuns: [],
    publishImages: null,
    publishImageAnalyses: [],
    followupByLead: {},
    lastTrace: []
  });
  const selectedProduct = useMemo(
    () => state.products.find((product) => product.id === (routeInfo.selectedProductId ?? state.selectedProductId)) ?? state.products[0],
    [state.products, state.selectedProductId, routeInfo.selectedProductId]
  );
  const selectedLeadId = routeInfo.selectedLeadId ?? state.selectedLeadId;

  useEffect(() => {
    api("/api/app-state")
      .then(async (result) => {
        const runs = result.seller ? await api("/api/agent/runs") : { runs: [] };
        setState((current) => ({ ...current, ...result, agentRuns: runs.runs }));
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!routeInfo.selectedProductId && !routeInfo.selectedLeadId) return;
    setState((current) => ({
      ...current,
      selectedProductId: routeInfo.selectedProductId ?? current.selectedProductId,
      selectedLeadId: routeInfo.selectedLeadId ?? current.selectedLeadId
    }));
  }, [routeInfo.selectedProductId, routeInfo.selectedLeadId]);

  if (!ready) {
    return <div className="loading">正在启动 AI 翡翠匹配...</div>;
  }

  const screens = {
    buyer: <BuyerHome state={state} setState={setState} go={go} />,
    detail: selectedProduct ? (
      <ProductDetail product={selectedProduct} go={go} setState={setState} />
    ) : (
      <div className="screen">
        <Header title="商品详情" left={<BackButton go={go} to="buyer" />} />
        <div className="empty-state">该商品暂不可查看</div>
      </div>
    ),
    login: <LoginPage go={go} setState={setState} />,
    dashboard: <Dashboard state={state} setState={setState} go={go} />,
    publish: <PublishGuide state={state} setState={setState} go={go} />,
    publishResult: <PublishResult state={state} go={go} />,
    editInfo: <EditInfo state={state} setState={setState} go={go} />,
    products: <ProductManagement state={state} setState={setState} go={go} />,
    editProduct: <EditProduct state={state} setState={setState} go={go} />,
    leads: <LeadsList state={state} setState={setState} go={go} />,
    leadDetail: <LeadDetail state={{ ...state, selectedLeadId }} setState={setState} go={go} />,
    account: <AccountPermissions go={go} />,
    profile: <Profile state={state} setState={setState} go={go} />
  };

  const activeScreen = merchantRoutes.has(route) && !state.seller
    ? <LoginPage go={go} setState={setState} />
    : screens[route] ?? screens.buyer;

  return (
    <main className="app-shell">
      <PortalSwitch route={route} go={go} />
      <div className="phone-frame">{activeScreen}</div>
    </main>
  );
}
