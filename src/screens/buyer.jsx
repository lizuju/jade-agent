import { useEffect, useState } from "react";
import { CheckCircle2, Send, Share2, Sparkles, User } from "lucide-react";
import { api, money } from "../api.js";
import { buyerEmail, initialBuyerMessages } from "../constants.js";
import { BackButton, Header } from "../routing.jsx";
import { Chip, ProductCard, SafeImage } from "../ui.jsx";
import { validateBuyerNeedText } from "../validation.js";

export function AgentEvidence({ match }) {
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

export function BuyerHome({ state, setState, go }) {
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

export function ProductDetail({ product, go, setState }) {
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
