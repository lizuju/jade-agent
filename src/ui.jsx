import { useState } from "react";
import { Box, Home, MessageCircle, User } from "lucide-react";
import { money } from "./api.js";

export function Chip({ children, active }) {
  return <span className={active ? "chip active" : "chip"}>{children}</span>;
}

export function BottomNav({ active, go }) {
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

export function agentLabel(type) {
  if (type === "buyer_match") return "买家匹配 Agent";
  if (type === "lead_followup") return "客资跟进 Agent";
  return "商品发布 Agent";
}

export function assetUrl(value) {
  const raw = typeof value === "string" ? value : value?.url;
  const src = String(raw || "").trim();
  if (!src) return "";
  if (/^(https?:|data:|blob:)/.test(src)) return src;
  if (src.startsWith("/uploads/") && window.location.port === "5173") {
    return `${window.location.protocol}//${window.location.hostname}:8787${src}`;
  }
  return src;
}

export function SafeImage({ src, alt, className }) {
  const [failed, setFailed] = useState(false);
  const resolved = assetUrl(src);
  if (!resolved || failed) {
    return <div className={className ? `image-fallback ${className}` : "image-fallback"}><Box size={24} /></div>;
  }
  return <img className={className} src={resolved} alt={alt} onError={() => setFailed(true)} />;
}

export function ProductCard({ product, onOpen }) {
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

export function Field({ label, value, onChange, multiline }) {
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
