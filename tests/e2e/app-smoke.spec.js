import { expect, test } from "@playwright/test";


test("buyer chat submits and clears the input", async ({ page }) => {
  await page.goto("/#buyer");
  await expect(page.getByText("AI翡翠匹配").first()).toBeVisible();

  const input = page.getByPlaceholder("请输入您的翡翠需求").first();
  await input.fill("你好");
  await page.getByRole("button", { name: /AI匹配/ }).click();

  await expect(input).toHaveValue("");
  await expect(page.getByText(/翡翠|预算/).last()).toBeVisible({ timeout: 15000 });
});


test("seller can log in and see dashboard", async ({ page }) => {
  await page.goto("/#login");
  await page.getByPlaceholder("请输入您的邮箱地址").fill("seller@email.com");
  await page.getByRole("button", { name: /获取验证码/ }).click();
  await page.getByPlaceholder("请输入验证码").fill("123456");
  await page.getByRole("button", { name: /登录/ }).click();

  await expect(page.getByText("商家后台")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/商品数量/)).toBeVisible();
});


test("product management renders newest products list", async ({ page }) => {
  await page.goto("/#login");
  await page.getByPlaceholder("请输入您的邮箱地址").fill("seller@email.com");
  await page.getByRole("button", { name: /获取验证码/ }).click();
  await page.getByPlaceholder("请输入验证码").fill("123456");
  await page.getByRole("button", { name: /登录/ }).click();

  await page.getByRole("button", { name: /商品管理/ }).click();
  await expect(page.getByText("商品管理")).toBeVisible();
  await expect(page.getByRole("button", { name: /全部/ })).toBeVisible();
  await expect(page.locator(".manage-row").first()).toBeVisible({ timeout: 10000 });
});
