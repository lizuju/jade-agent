import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { initialBuyerMessages, merchantRoutes } from "./constants.js";
import { BackButton, Header, PortalSwitch, useHashRoute } from "./routing.jsx";
import { BuyerHome, ProductDetail } from "./screens/buyer.jsx";
import {
  AccountPermissions,
  Dashboard,
  EditInfo,
  EditProduct,
  LeadDetail,
  LeadsList,
  LoginPage,
  ProductManagement,
  Profile,
  PublishGuide,
  PublishResult
} from "./screens/merchant.jsx";

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
    account: <AccountPermissions state={state} go={go} />,
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
