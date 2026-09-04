import { expect, test } from '@playwright/test';

test('register -> mage -> combat -> xp -> relog persistence', async ({ page }, testInfo) => {
  const suffix = Date.now().toString().slice(-8);
  const username = `e2e_${suffix}`;
  const password = 'Fracture123!';
  const characterName = `Mage${suffix}`;
  const browserErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('/');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create Account' }).click();

  await expect(page.getByRole('heading', { name: 'Create Character' })).toBeVisible();
  await page.getByLabel('Character Name').fill(characterName);
  await page.locator('.class-card').nth(1).click();
  await page.getByRole('button', { name: 'Begin as Mage' }).click();

  await expect(page.locator('.connection')).toContainText('Connected');
  const canvas = page.locator('.game-canvas canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.xp-line')).toContainText('XP 0 / 100');
  await canvas.hover();
  await page.mouse.wheel(0, -1200);
  await page.waitForTimeout(650);
  await page.screenshot({ path: '/tmp/worldofchatgpt-character.png', type: 'png' });

  await page.keyboard.down('w');
  await page.waitForTimeout(700);
  await page.keyboard.up('w');
  await page.keyboard.press('Tab');
  await expect(page.locator('.target-hud')).toContainText('Training Slime');

  await expect.poll(async () => {
    const text = await page.locator('.player-hud small').textContent();
    return Number(text?.match(/^(\d+)/)?.[1] ?? 999);
  }, { timeout: 7_000 }).toBeLessThan(115);

  await page.keyboard.press('2');
  await page.waitForTimeout(80);
  await page.screenshot({ path: testInfo.outputPath('mage-combat.jpg'), type: 'jpeg', quality: 55 });
  await page.keyboard.press('3');
  await page.waitForTimeout(120);
  await page.keyboard.press('1');

  await expect(page.locator('.xp-line')).toContainText('XP 25 / 100');
  await page.getByRole('button', { name: 'Logout' }).click();

  await expect(page.getByRole('button', { name: 'Enter World' })).toBeVisible();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Enter World' }).click();

  await expect(page.locator('.connection')).toContainText('Connected');
  await expect(page.locator('.player-hud')).toContainText(characterName);
  await expect(page.locator('.player-hud')).toContainText('MAGE · LV 1');
  await expect(page.locator('.xp-line')).toContainText('XP 25 / 100');
  expect(browserErrors).toEqual([]);
});
