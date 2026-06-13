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

const buyerRoutes = new Set(["buyer", "detail"]);
const merchantRoutes = new Set(["dashboard", "publish", "publishResult", "editInfo", "products", "editProduct", "leads", "leadDetail", "account", "profile"]);

const routeAliases = {
  merchant: "dashboard",
  "product/1": "detail",
  "publish-result": "publishResult",
  "edit-publish": "editInfo",
  "edit-product/1": "editProduct",
  "lead/1": "leadDetail"
};

function normalizeRoute(value) {
  return routeAliases[value] ?? value;
}

function useHashRoute() {
  const [route, setRoute] = useState(() => normalizeRoute(window.location.hash.replace("#", "") || "buyer"));
  useEffect(() => {
    const onHash = () => setRoute(normalizeRoute(window.location.hash.replace("#", "") || "buyer"));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = (key) => {
    window.location.hash = key;
    setRoute(normalizeRoute(key));
  };
  return [route, go];
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

function ProductCard({ product, go }) {
  return (
    <button className="product-card" onClick={() => go("detail")}>
      <img src={product.images[0]} alt={product.title} />
      <div className="product-card-body">
        <strong>{product.title}</strong>
        <span>{product.tags.slice(0, 3).join(" · ")}</span>
        <div className="product-price">
          {money(product.price)}
          {product.vipUntil ? <small>VIP</small> : null}
        </div>
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

function BuyerHome({ state, setState, go }) {
  const [need, setNeed] = useState("预算5万左右，冰种晴底翡翠手镯，55圈口，正圈，无纹裂，送礼");
  const [loading, setLoading] = useState(false);
  const products = state.match?.products?.length ? state.match.products : state.products.slice(0, 3);

  async function match() {
    setLoading(true);
    try {
      const result = await api("/api/agent/buyer-match", {
        method: "POST",
        body: JSON.stringify({ sessionId: state.sessionId, need, buyerEmail })
      });
      setState((current) => ({ ...current, sessionId: result.sessionId, match: result, lastTrace: result.trace }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen">
      <div className="brandbar">
        <div className="brand">
          <span className="logo-mark">翠</span>
          <strong>AI翡翠匹配</strong>
        </div>
        <button className="pill-button" onClick={() => go("login")}>商家入驻</button>
      </div>

      <div className="chat">
        <div className="avatar bot"><Sparkles size={18} /></div>
        <div className="bubble">
          您好！请说出您的翡翠需求（预算、品类、尺寸、品相），我将为您精准匹配货源。
          <time>10:30</time>
        </div>
      </div>

      <div className="quick-tags">
        {["10万预算 帝王绿手镯 55圈口 微瑕", "冰种平安扣 预算2万 无纹无裂", "冰种晴底吊坠 送礼自用均可"].map((text) => (
          <button key={text} onClick={() => setNeed(text)}>{text}</button>
        ))}
      </div>

      <div className="chat user-chat">
        <div className="bubble user">
          {need}
          <time>10:32</time>
        </div>
        <div className="avatar user"><User size={17} /></div>
      </div>

      <div className="chat">
        <div className="avatar bot"><Sparkles size={18} /></div>
        <div className="bubble">
          {loading ? "已为您解析需求，正在匹配优质翡翠货源..." : state.match?.reply ?? "已为您解析需求，正在匹配优质翡翠货源..."}
        </div>
      </div>

      <section className="card-section">
        <h3>为您找到以下优质货源（共{products.length}件）</h3>
        <div className="product-grid">
          {products.map((product) => <ProductCard key={product.id} product={product} go={go} />)}
        </div>
      </section>

      {state.match?.trace ? (
        <section className="agent-trace">
          {state.match.trace.map((step) => (
            <div key={step.label}>
              <CheckCircle2 size={15} />
              <span>{step.label}</span>
              <small>{step.detail}</small>
            </div>
          ))}
        </section>
      ) : null}

      <div className="input-dock">
        <input value={need} onChange={(event) => setNeed(event.target.value)} placeholder="请输入您的翡翠需求，支持中文、英文等语言" />
        <button onClick={match} disabled={loading}>
          <Send size={16} />
          AI匹配
        </button>
      </div>
    </div>
  );
}

function ProductDetail({ product, go, setState }) {
  const [email, setEmail] = useState(buyerEmail);
  const [sent, setSent] = useState(false);

  async function submitLead() {
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
  }

  return (
    <div className="screen">
      <Header title="商品详情" left={<BackButton go={go} to="buyer" />} right={<button className="icon-btn"><Share2 size={20} /></button>} />
      <div className="hero-image">
        <img src={product.images[0]} alt={product.title} />
        <span>1/5</span>
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
        <button className="primary-button" onClick={submitLead}>{sent ? "已提交，等待商家联系" : "提交意向，等待卖家联系"}</button>
        <small>我们将严格保护隐私，仅用于卖家联系您</small>
      </div>
    </div>
  );
}

function LoginPage({ go, setState }) {
  const [email, setEmail] = useState(sellerEmail);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);

  async function requestCode() {
    const result = await api("/api/auth/otp", { method: "POST", body: JSON.stringify({ email }) });
    setCode(result.code ?? "");
    setSent(true);
  }

  async function login() {
    const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, code }) });
    window.localStorage.setItem("sellerToken", result.token);
    const appState = await api("/api/app-state");
    const runs = await api("/api/agent/runs");
    setState((current) => ({ ...current, ...appState, agentRuns: runs.runs }));
    go("dashboard");
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
        <button className="primary-button" onClick={requestCode}>{sent ? "验证码已发送" : "获取验证码"}</button>
        <label><ShieldCheck size={18} /><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="请输入验证码" /></label>
        <button className="primary-button" onClick={login}>登录 / 注册</button>
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
      <Header title={<span>商家后台 <b className="vip-badge">VIP</b></span>} left={<button className="icon-btn"><Menu size={21} /></button>} right={<button className="icon-btn"><Bell size={20} /></button>} />
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
            go("leadDetail");
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
          <strong>{state.agentRuns[0].agentType === "lead_followup" ? "客资跟进 Agent" : "商品发布 Agent"}</strong>
          <span>{state.agentRuns[0].trace?.[0]?.detail ?? "暂无运行详情"}</span>
        </section>
      ) : null}
      <BottomNav active="dashboard" go={go} />
    </div>
  );
}

function PublishGuide({ state, setState, go }) {
  const [loading, setLoading] = useState(false);
  const images = ["/assets/jade-upload-bangle.jpg", "/assets/jade-pendant.jpg"];

  async function generateDraft() {
    setLoading(true);
    try {
      const draft = await api("/api/agent/publish", {
        method: "POST",
        body: JSON.stringify({
          hint: "冰种晴底翡翠手镯，55圈口，正圈，无纹裂，适合送礼",
          images
        })
      });
      const runs = await api("/api/agent/runs");
      setState((current) => ({ ...current, draft, agentRuns: runs.runs, lastTrace: draft.agentNotes.map((note) => ({ label: note, detail: "发布 agent 已完成" })) }));
      go("publishResult");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen">
      <Header title="发布商品" left={<BackButton go={go} />} right={<span className="saving">{loading ? "AI生成中" : "AI辅助"}</span>} />
      <section className="upload-card">
        <div className="step-title"><span>1.</span><strong>上传商品图片</strong><small>上传清晰的翡翠图片，AI将为您自动生成商品文案</small></div>
        <div className="upload-grid">
          {images.map((image) => <img key={image} src={image} alt="上传商品" />)}
          <button><ImagePlus size={28} /><span>添加图片</span></button>
        </div>
      </section>
      <section className="steps-card">
        {[
          ["2.", "AI智能生成", loading ? "正在识别图片特征，生成商品信息..." : "点击按钮后生成标题、描述、标签和价格"],
          ["3.", "编辑商品信息", "可修改AI生成的标题、描述、标签和价格"],
          ["4.", "提交发布", "发布后商品将展示给平台买家"]
        ].map(([no, title, text]) => (
          <div className="step-line" key={title}>
            <CheckCircle2 size={18} />
            <div><strong>{no} {title}</strong><span>{text}</span></div>
          </div>
        ))}
      </section>
      <button className="primary-button fixed-action" onClick={generateDraft} disabled={loading}>
        <Wand2 size={18} />
        {loading ? "AI正在生成..." : "AI生成商品信息"}
      </button>
      <small className="quota-text">免费商家最多发布2件商品，当前已发布1/2件</small>
    </div>
  );
}

function PublishResult({ state, go }) {
  const draft = state.draft ?? state.products[0];
  return (
    <div className="screen">
      <Header title="AI智能生成结果" left={<BackButton go={go} to="publish" />} right={<button className="link-btn" onClick={() => go("publish")}>重新生成</button>} />
      <ProductEditorPreview draft={draft} />
      <div className="double-actions">
        <button className="secondary-button" onClick={() => go("publish")}>重新生成</button>
        <button className="primary-button" onClick={() => go("editInfo")}>进入编辑</button>
      </div>
    </div>
  );
}

function ProductEditorPreview({ draft }) {
  return (
    <section className="editor-preview">
      <div className="hero-image compact">
        <img src={draft.images[0]} alt={draft.title} />
        <span>1/3</span>
      </div>
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
  const [draft, setDraft] = useState(state.draft ?? state.products[0]);
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  async function publish() {
    const result = await api("/api/products", {
      method: "POST",
      body: JSON.stringify({ ...draft, status: "listed" })
    });
    const appState = await api("/api/app-state");
    setState((current) => ({ ...current, ...appState, selectedProductId: result.product.id }));
    go("products");
  }

  return (
    <div className="screen">
      <Header title="编辑商品信息" left={<BackButton go={go} to="publishResult" />} right={<button className="link-btn" onClick={publish}>保存</button>} />
      <section className="edit-form">
        <Field label="商品标题" value={draft.title} onChange={(value) => set("title", value)} />
        <Field label="商品简介" value={draft.intro} onChange={(value) => set("intro", value)} />
        <Field label="商品详情" value={draft.detail} onChange={(value) => set("detail", value)} multiline />
        <label className="field"><span>商品标签</span><div className="tags-row wrap">{draft.tags.map((tag) => <Chip key={tag} active>{tag}</Chip>)}<button className="mini-add">+ 添加标签</button></div></label>
        <Field label="预估售价（元）" value={String(draft.price)} onChange={(value) => set("price", Number(value) || 0)} />
      </section>
      <button className="primary-button fixed-action" onClick={publish}>确认发布</button>
    </div>
  );
}

function ProductManagement({ state, go }) {
  const counts = {
    all: state.products.length,
    listed: state.products.filter((product) => product.status === "listed").length,
    draft: state.products.filter((product) => product.status === "draft").length,
    unlisted: state.products.filter((product) => product.status === "unlisted").length
  };
  return (
    <div className="screen with-nav">
      <Header title="商品管理" left={<BackButton go={go} />} />
      <div className="tabs">
        <button className="active">全部({counts.all})</button>
        <button>已上架({counts.listed})</button>
        <button>草稿({counts.draft})</button>
        <button>已下架({counts.unlisted})</button>
      </div>
      <section className="product-list">
        {state.products.map((product) => (
          <div className="manage-row" key={product.id}>
            <img src={product.images[0]} alt={product.title} />
            <div>
              <strong>{product.title}</strong>
              <b>{money(product.price)}</b>
              <small>{product.createdAt.slice(5, 16)}</small>
            </div>
            <span className={product.status === "listed" ? "status listed" : "status"}>{product.status === "listed" ? "已上架" : product.status === "draft" ? "草稿" : "已下架"}</span>
            <div className="row-actions">
              <button onClick={() => go("editProduct")}><Edit3 size={14} />编辑</button>
              <button><Trash2 size={14} />删除</button>
            </div>
          </div>
        ))}
      </section>
      <button className="primary-button list-action" onClick={() => go("publish")}>+ 发布新商品</button>
      <BottomNav active="products" go={go} />
    </div>
  );
}

function EditProduct({ state, setState, go }) {
  const [draft, setDraft] = useState(state.products[0]);
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  async function save() {
    await api(`/api/products/${draft.id}`, { method: "PUT", body: JSON.stringify(draft) });
    const appState = await api("/api/app-state");
    setState((current) => ({ ...current, ...appState }));
    go("products");
  }

  return (
    <div className="screen">
      <Header title="编辑商品" left={<BackButton go={go} to="products" />} right={<button className="danger-link">删除</button>} />
      <div className="hero-image compact">
        <img src={draft.images[0]} alt={draft.title} />
        <span>1/3</span>
      </div>
      <section className="edit-form">
        <Field label="商品标题" value={draft.title} onChange={(value) => set("title", value)} />
        <Field label="商品卖点" value={draft.intro} onChange={(value) => set("intro", value)} />
        <Field label="商品详情" value={draft.detail} onChange={(value) => set("detail", value)} multiline />
        <Field label="预估售价（元）" value={String(draft.price)} onChange={(value) => set("price", Number(value) || 0)} />
      </section>
      <button className="primary-button fixed-action" onClick={save}>保存修改</button>
    </div>
  );
}

function LeadsList({ state, setState, go }) {
  return (
    <div className="screen with-nav">
      <Header title="客资列表" left={<BackButton go={go} />} />
      <div className="tabs three">
        <button className="active">全部</button>
        <button>待联系</button>
        <button>已联系</button>
      </div>
      <section className="lead-list">
        {state.leads.map((lead) => (
          <button className="lead-line" key={lead.id} onClick={() => {
            setState((current) => ({ ...current, selectedLeadId: lead.id }));
            go("leadDetail");
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
      </section>
      <div className="locked-tip">
        免费商家可查看部分邮箱，升级VIP查看全部
      </div>
      <button className="primary-button list-action" onClick={() => go("account")}>开通VIP，查看全部联系方式</button>
      <BottomNav active="leads" go={go} />
    </div>
  );
}

function LeadDetail({ state, setState, go }) {
  const [drafting, setDrafting] = useState(false);
  const lead = state.leads.find((item) => item.id === state.selectedLeadId) ?? state.leads[0];
  const followup = state.followupByLead?.[lead.id];

  async function contact() {
    await api(`/api/leads/${lead.id}/contacted`, { method: "POST", body: "{}" });
    const appState = await api("/api/app-state");
    setState((current) => ({ ...current, ...appState }));
  }

  async function draftFollowup() {
    setDrafting(true);
    try {
      const result = await api(`/api/agent/leads/${lead.id}/followup`, { method: "POST", body: "{}" });
      const runs = await api("/api/agent/runs");
      setState((current) => ({
        ...current,
        followupByLead: { ...(current.followupByLead ?? {}), [lead.id]: result },
        agentRuns: runs.runs,
        lastTrace: result.trace
      }));
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="screen">
      <Header title="客资详情" left={<BackButton go={go} to="leads" />} right={<button className="link-btn" onClick={contact}>标记已联系</button>} />
      <section className="lead-detail-card">
        <span>留言时间</span>
        <strong>{lead.createdAt}</strong>
        <span>用户需求原文</span>
        <p>{lead.buyerNeed}</p>
        <span>关联商品</span>
        <div className="linked-product">
          <img src={lead.productImage} alt={lead.productTitle} />
          <div><strong>{lead.productTitle}</strong><small>{money(lead.productPrice)}</small></div>
        </div>
        <span>用户邮箱</span>
        <strong>{lead.buyerEmail}</strong>
        <span>商家账号</span>
        <strong>{lead.sellerEmail}</strong>
      </section>
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
      <div className="double-actions bottom">
        <button className="secondary-button">复制邮箱</button>
        <button className="primary-button" onClick={draftFollowup} disabled={drafting}>{drafting ? "生成中..." : "AI跟进"}</button>
      </div>
    </div>
  );
}

function AccountPermissions({ go }) {
  return (
    <div className="screen">
      <Header title="账户权限" left={<BackButton go={go} />} right={<b className="vip-badge">VIP</b>} />
      <section className="vip-card">
        <div><Crown size={24} /><strong>VIP会员</strong><span>有效期至 2026-05-20</span></div>
        <button>查看权益</button>
      </section>
      <section className="permission-list">
        {[
          ["商品发布上限", "100 / 100件"],
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
      <button className="primary-button fixed-action">联系运营续费</button>
    </div>
  );
}

function Profile({ state, go }) {
  return (
    <div className="screen">
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
          <button key={label} onClick={() => (label === "账户信息" ? go("account") : null)}>
            <Icon size={18} />
            <span>{label}</span>
            <ChevronRight size={16} />
          </button>
        ))}
      </section>
    </div>
  );
}

export default function App() {
  const [route, go] = useHashRoute();
  const [ready, setReady] = useState(false);
  const [state, setState] = useState({
    seller: null,
    products: [],
    leads: [],
    metrics: { listedProducts: 0, productQuota: 100, todayLeads: 0, totalLeads: 0 },
    match: null,
    draft: null,
    agentRuns: [],
    followupByLead: {},
    lastTrace: []
  });
  const selectedProduct = useMemo(() => state.products[0], [state.products]);

  useEffect(() => {
    api("/api/app-state")
      .then(async (result) => {
        const runs = result.seller ? await api("/api/agent/runs") : { runs: [] };
        setState((current) => ({ ...current, ...result, agentRuns: runs.runs }));
      })
      .finally(() => setReady(true));
  }, []);

  if (!ready || !selectedProduct) {
    return <div className="loading">正在启动 AI 翡翠匹配...</div>;
  }

  const screens = {
    buyer: <BuyerHome state={state} setState={setState} go={go} />,
    detail: <ProductDetail product={selectedProduct} go={go} setState={setState} />,
    login: <LoginPage go={go} setState={setState} />,
    dashboard: <Dashboard state={state} setState={setState} go={go} />,
    publish: <PublishGuide state={state} setState={setState} go={go} />,
    publishResult: <PublishResult state={state} go={go} />,
    editInfo: <EditInfo state={state} setState={setState} go={go} />,
    products: <ProductManagement state={state} go={go} />,
    editProduct: <EditProduct state={state} setState={setState} go={go} />,
    leads: <LeadsList state={state} setState={setState} go={go} />,
    leadDetail: <LeadDetail state={state} setState={setState} go={go} />,
    account: <AccountPermissions go={go} />,
    profile: <Profile state={state} go={go} />
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
