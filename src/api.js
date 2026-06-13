export async function api(path, options = {}) {
  const token = window.localStorage.getItem("sellerToken");
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {})
    }
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error ?? `Request failed: ${response.status}`);
  }
  return response.json();
}

export const money = (value) =>
  `￥${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;

export const maskEmail = (email) => {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, 2)}***@${domain}`;
};
