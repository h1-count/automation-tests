import { expect, type Locator, type Page } from "@playwright/test";

const createProductPath = "/integration/product/create";

/** Opens the product creation flow and selects the confirmed low-risk test combination. */
export async function prepareOpenProtocolSwitchProduct(page: Page): Promise<void> {
  await page.goto(createProductPath, { waitUntil: "domcontentloaded" });

  const primaryCategory = page.getByText("插座开关", { exact: true });
  await expect(primaryCategory).toHaveCount(1);
  await primaryCategory.click();

  const subCategory = page.getByText("开关", { exact: true });
  await expect(subCategory).toHaveCount(1);
  await subCategory.click();

  const developmentMethod = page.getByText("开放协议接入", { exact: true });
  await expect(developmentMethod).toHaveCount(1);
  await developmentMethod.click();

  const ordinaryDevice = page.getByRole("radio", { name: "普通设备", exact: true });
  await expect(ordinaryDevice).toHaveCount(1);
  // Element Plus 将原生 input 置于可见圆点之后；点击可见父容器而非被遮挡的 input。
  await ordinaryDevice.locator("xpath=..").click();
  await expect(ordinaryDevice).toBeChecked();

  const wifi = page.getByRole("radio", { name: "WiFi", exact: true });
  await expect(wifi).toHaveCount(1);
  await wifi.locator("xpath=..").click();
  await expect(wifi).toBeChecked();
}

export function productNameInput(page: Page): Locator {
  return page.getByPlaceholder("请输入产品名称", { exact: true });
}

export function productModelInput(page: Page): Locator {
  return page.getByPlaceholder("仅支持小写字母或数字", { exact: true });
}

export function createProductButton(page: Page): Locator {
  return page.getByRole("button", { name: "创建产品", exact: true });
}
