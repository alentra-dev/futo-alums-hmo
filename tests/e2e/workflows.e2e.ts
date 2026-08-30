import { expect, test, type Page, type TestInfo } from '@playwright/test';

const confirmation = {
  name: 'payment-confirmation.png',
  mimeType: 'image/png',
  buffer: Buffer.from('synthetic payment confirmation'),
};

async function assertViewportIntegrity(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const clippedButtons = await page.locator('button:visible, a.button:visible').evaluateAll((elements) => elements.filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent?.trim()));
  expect(clippedButtons).toEqual([]);
}

async function useSubscriberWorkspace(page: Page) {
  await page.goto('/account');
  await page.getByLabel('Preview role').selectOption('subscriber');
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: /Welcome, Ada/ })).toBeVisible();
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
}

test('existing subscriber can find and submit multiple payment confirmations', async ({ page, isMobile }, testInfo) => {
  await useSubscriberWorkspace(page);
  await expect(page.getByRole('button', { name: 'Upload payment confirmation' })).toBeVisible();
  await expect(page.getByText('Upload your payment confirmation.')).toBeVisible();

  await page.getByRole('link', { name: isMobile ? 'Upload proof' : 'Upload payment' }).click();
  await expect(page.getByRole('heading', { name: 'Payments and confirmations' })).toBeVisible();
  if (isMobile) await expect(page.locator('.mobile-payment-action')).toBeVisible();

  const upload = async (amount: string, fileName: string) => {
    const trigger = isMobile ? page.locator('.mobile-payment-action').getByRole('button') : page.getByRole('button', { name: 'Upload payment confirmation' });
    await trigger.click();
    await expect(page.getByRole('heading', { name: 'Upload payment confirmation' })).toBeVisible();
    if (fileName === 'first-confirmation.png') { await assertViewportIntegrity(page); await capture(page, testInfo, 'subscriber-upload-modal'); }
    await page.getByLabel('Amount shown on confirmation (₦)').fill(amount);
    await page.locator('input[name="proof"]').setInputFiles({ ...confirmation, name: fileName });
    await page.getByRole('button', { name: 'Upload confirmation' }).click();
    await expect(page.getByText('Payment confirmation uploaded for administrator review.')).toBeVisible();
    await expect(page.getByText(fileName)).toBeVisible();
  };

  await upload('42345.67', 'first-confirmation.png');
  await page.getByLabel('Dismiss').click();
  await upload('10000', 'second-confirmation.png');
  await expect(page.getByText('4 confirmations')).toBeVisible();
  await assertViewportIntegrity(page);
  await capture(page, testInfo, 'subscriber-payments');
});

test('existing subscriber can reach enrollment, plans, history, and account actions', async ({ page, isMobile }, testInfo) => {
  await useSubscriberWorkspace(page);
  const navigate = async (mobileName: string, desktopName = mobileName) => page.getByRole('navigation', { name: isMobile ? 'Mobile navigation' : 'Primary navigation' }).getByRole('link', { name: isMobile ? mobileName : desktopName, exact: true }).click();

  await navigate('Plans');
  await expect(page.getByRole('heading', { name: 'Choose your health plan' })).toBeVisible();
  await page.getByRole('button', { name: 'View benefits' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').locator('.modal__actions').getByRole('button', { name: 'Close' }).click();
  await page.locator('.plan-card').first().getByRole('button', { name: 'Select plan' }).click();
  await expect(page.getByText('Plan selection updated.')).toBeVisible();
  await page.getByLabel('Dismiss').click();

  await navigate('Enrollment');
  await expect(page.getByRole('heading', { name: 'Confirm who is covered' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit enrollment' })).toBeVisible();
  await page.getByLabel('Preferred hospital (optional)').fill('Rivers State University Teaching Hospital');
  await page.getByRole('button', { name: 'Save progress' }).click();
  await expect(page.getByText('Enrollment details saved.')).toBeVisible();

  if (isMobile) {
    await page.getByLabel('Open navigation').click();
    await page.getByRole('link', { name: 'History', exact: true }).click();
  } else {
    await page.getByRole('link', { name: 'History', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: /Enrollment history/ })).toBeVisible();
  await assertViewportIntegrity(page);
  await capture(page, testInfo, 'subscriber-history');
});

test('new subscriber completes the progressive application', async ({ page }, testInfo) => {
  await page.goto('/join');
  await page.getByRole('button', { name: 'Add principal' }).click();
  await expect(page.getByRole('heading', { name: 'Principal member' })).toBeVisible();

  await page.getByLabel('Surname').fill('Eze');
  await page.getByLabel('First name').fill('Desmond');
  await page.getByLabel('Date of birth').fill('1975-05-20');
  await page.getByLabel('Mobile number').fill('08012345678');
  await page.getByLabel('Residential address').fill('12 Rumuola Road');
  await page.getByLabel('State').fill('Rivers');
  await page.getByLabel('Town').fill('Port Harcourt');
  await page.getByLabel('LGA').fill('Obio/Akpor');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByRole('heading', { name: 'Plan and care preference' })).toBeVisible();
  await page.locator('.join-plan-options label').first().click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Individual coverage' })).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Review and submit' })).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByRole('heading', { name: 'Application received' })).toBeVisible();
  await assertViewportIntegrity(page);
  await capture(page, testInfo, 'new-subscriber-complete');
});

test('administrator uploads a confirmation and completes payment review', async ({ page }, testInfo) => {
  await page.goto('/admin/payments');
  await expect(page.getByRole('heading', { name: 'Payment review' })).toBeVisible();
  await page.getByRole('button', { name: 'Upload for subscriber' }).click();
  await page.getByLabel('Subscriber', { exact: true }).selectOption('enrollment-ada');
  await assertViewportIntegrity(page);
  await capture(page, testInfo, 'admin-upload-modal');
  await page.getByLabel('Amount shown on confirmation (₦)').fill('12345.67');
  await page.locator('input[name="proof"]').setInputFiles({ ...confirmation, name: 'admin-upload.png' });
  await page.getByRole('button', { name: 'Upload for review' }).click();
  await expect(page.getByText('Payment confirmation uploaded for administrator review.')).toBeVisible();

  const card = page.locator('.payment-review-card').filter({ hasText: '₦12,345.67' });
  await expect(card).toBeVisible();
  await expect(card.getByText('admin-upload.png')).toBeVisible();
  await card.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Payment verified.')).toBeVisible();
  await expect(card).not.toBeVisible();
  await assertViewportIntegrity(page);
  await capture(page, testInfo, 'admin-payment-review');
});

test('administrator can access and operate administration tools', async ({ page, isMobile }, testInfo) => {
  await page.goto('/admin/applications');
  await expect(page.getByRole('heading', { name: 'Emeka Nneka Nwosu' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Approve subscriber' }).click();
  await expect(page.getByText('0 pending')).toBeVisible();

  await page.goto('/admin/enrollees');
  await expect(page.getByLabel('Enrollment year')).toBeVisible();
  for (const name of ['Summary', 'Admin full export', 'AVON export']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name }).click();
    await expect((await download).suggestedFilename()).toMatch(/\.xlsx$/i);
  }

  await page.goto('/admin/subscriber-access');
  await page.getByRole('button', { name: 'Change email' }).click();
  await page.getByLabel('New access email', { exact: true }).fill('new.ada@example.com');
  await page.getByLabel('Confirm new access email').fill('new.ada@example.com');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Change access email' }).click();
  await expect(page.getByText('Account access updated to new.ada@example.com.')).toBeVisible();

  await page.goto('/admin/settings');
  await page.locator('#timezone select').selectOption('Africa/Lagos');
  await page.getByRole('button', { name: 'Save time zone' }).click();
  await expect(page.getByText('Program time zone updated.')).toBeVisible();
  await page.getByLabel('Bank', { exact: true }).fill('Test Bank');
  await page.getByRole('button', { name: 'Save payment account' }).click();
  await expect(page.getByText('Payment account updated.')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Save surcharge rates' }).click();
  await expect(page.getByText('Surcharge rates and enrollment totals updated.')).toBeVisible();

  await page.goto('/admin/access');
  await page.getByRole('button', { name: 'Make admin' }).click();
  await expect(page.getByRole('button', { name: 'Remove admin' })).toHaveCount(2);

  await page.goto('/admin/activity');
  await expect(page.getByRole('heading', { name: 'Portal activity' })).toBeVisible();
  await page.getByRole('button', { name: '7 days' }).click();
  await expect(page.getByText('Selected 7-day period')).toBeVisible();

  await page.goto('/admin/audit');
  await page.getByLabel('Search audit history').fill('Ada Okafor');
  await expect(page.locator('.audit-list article')).not.toHaveCount(0);

  if (isMobile) {
    await page.getByLabel('Open navigation').click();
    await expect(page.getByRole('link', { name: 'Program settings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Subscriber access' })).toBeVisible();
  }
  await assertViewportIntegrity(page);
  await capture(page, testInfo, 'admin-tools');
});
