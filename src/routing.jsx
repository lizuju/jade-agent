import { useEffect, useState } from "react";
import { ChevronLeft, Sparkles, Store } from "lucide-react";
import { buyerRoutes, routeAliases } from "./constants.js";

export function parseRoute(value) {
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

export function useHashRoute() {
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

export function PortalSwitch({ route, go }) {
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

export function Header({ title, left, right }) {
  return (
    <div className="topbar">
      <div className="topbar-side">{left}</div>
      <div className="topbar-title">{title}</div>
      <div className="topbar-side topbar-right">{right}</div>
    </div>
  );
}

export function BackButton({ go, to = "dashboard" }) {
  return (
    <button className="icon-btn" onClick={() => go(to)} aria-label="返回">
      <ChevronLeft size={22} />
    </button>
  );
}
