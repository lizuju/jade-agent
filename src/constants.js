export const sellerEmail = "seller@email.com";
export const buyerEmail = "buyer1@email.com";
export const initialBuyerMessages = [
  {
    id: "welcome",
    role: "assistant",
    text: "您好！请说出您的翡翠需求（预算、品类、尺寸、品相），我将为您精准匹配货源。",
    time: "10:30"
  }
];

export const buyerRoutes = new Set(["buyer", "detail"]);
export const merchantRoutes = new Set(["dashboard", "publish", "publishResult", "editInfo", "products", "editProduct", "leads", "leadDetail", "account", "profile"]);

export const routeAliases = {
  merchant: "dashboard",
  "publish-result": "publishResult",
  "edit-publish": "editInfo"
};
