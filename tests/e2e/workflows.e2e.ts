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
  // One account collects everything, so the outstanding HMO premium must lead while it is
  // unpaid and each obligation must carry its own transfer reference.
  await expect(page.getByText(/HMO premium outstanding/)).toBeVisible();
  await expect(page.locator('.next-step-band').getByRole('link', { name: /Upload confirmation/ })).toBeVisible();

  await page.getByRole('link', { name: isMobile ? 'Upload proof' : 'Upload payment' }).click();
  await expect(page.getByRole('heading', { name: 'Payments and confirmations' })).toBeVisible();
  if (isMobile) await expect(page.locator('.mobile-payment-action')).toBeVisible();
  await expect(page.locator('.amount-due').getByRole('button', { name: 'Upload HMO payment' })).toBeVisible();
  await expect(page.locator('.assessment-panel').getByRole('button', { name: 'Pay CAC registration contribution' })).toBeVisible();
  // The assessment panel must ask only for its own contribution, not the premium shortfall.
  await expect(page.locator('.assessment-panel')).toContainText('₦33,000.00');
  await expect(page.locator('.assessment-panel')).toContainText(/HMO premium is short by/);
  // One account, two references: both must be shown, and they must differ.
  const references = await page.locator('.transfer-references dd').allInnerTexts();
  expect(references).toHaveLength(2);
  expect(references[0]).not.toEqual(references[1]);
  const accountNumbers = await page.locator('.bank-card .account-number strong').allInnerTexts();
  expect(accountNumbers).toHaveLength(1);

  const upload = async (purpose: 'HMO' | 'CAC', amount: string, fileName: string) => {
    const trigger = purpose === 'CAC'
      ? page.locator('.assessment-panel').getByRole('button', { name: 'Pay CAC registration contribution' })
      : page.locator('.amount-due').getByRole('button', { name: 'Upload HMO payment' });
    await trigger.click();
    await expect(page.getByRole('heading', { name: purpose === 'CAC' ? 'Pay CAC registration contribution' : 'Upload HMO payment confirmation' })).toBeVisible();
    if (fileName === 'first-confirmation.png') { await assertViewportIntegrity(page); await capture(page, testInfo, 'subscriber-upload-modal'); }
    await page.getByLabel('Amount shown on confirmation (₦)').fill(amount);
    await page.locator('input[name="proof"]').setInputFiles({ ...confirmation, name: fileName });
    await page.getByRole('button', { name: 'Upload confirmation' }).click();
    await expect(page.getByText('Payment confirmation uploaded for administrator review.')).toBeVisible();
    await expect(page.getByText(fileName)).toBeVisible();
  };

  await upload('CAC', '33000', 'first-confirmation.png');
  await page.getByLabel('Dismiss').click();
  await upload('HMO', '10000', 'second-confirmation.png');
  await expect(page.getByText('4 confirmations')).toBeVisible();
  await assertViewportIntegrity(page);
  await capture(page, testInfo, 'subscriber-payments');
});

test('payment confirmations cannot be dated in the future', async ({ page }) => {
  await useSubscriberWorkspace(page);
  await page.goto('/payments');
  await page.locator('.amount-due').getByRole('button', { name: 'Upload HMO payment' }).click();
  const paidAt = page.getByLabel('Date paid');
  const max = await paidAt.getAttribute('max');
  expect(max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await paidAt.evaluate((input) => input.removeAttribute('max'));
  await paidAt.fill('2999-01-01');
  await page.getByLabel('Amount shown on confirmation (₦)').fill('1000');
  await page.locator('input[name="proof"]').setInputFiles({ ...confirmation, name: 'future.png' });
  await page.getByRole('button', { name: 'Upload confirmation' }).click();
  await expect(page.getByText('The date paid cannot be in the future.')).toBeVisible();
});

test('existing subscriber can change plan and submit enrollment while the period is open', async ({ page }, testInfo) => {
  await useSubscriberWorkspace(page);
  await page.goto('/plans');
  await expect(page.getByRole('heading', { name: 'Choose your health plan' })).toBeVisible();
  const prestige = page.locator('.plan-card').filter({ hasText: 'Prestige Plan' });
  await prestige.getByRole('button', { name: 'Select plan' }).click();
  await expect(page.getByText('Plan selection updated.')).toBeVisible();
  await expect(prestige.getByRole('button', { name: 'Selected' })).toBeDisabled();

  await page.goto('/enrollment');
  await page.getByLabel('Preferred hospital (optional)').fill('St. David Hospital Owerri');
  await page.getByRole('button', { name: 'Save progress' }).click();
  await expect(page.getByText('Enrollment details saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit enrollment' }).click();
  await expect(page.getByText('Enrollment details saved.')).toBeVisible();
  await assertViewportIntegrity(page);
  await capture(page, testInfo, 'subscriber-enrollment-submitted');
});

test('closing the period makes subscriber enrollment read only', async ({ page, isMobile }) => {
  // Demo state lives in memory, so the period change must survive in-app navigation only.
  const navigate = async (name: string) => {
    if (isMobile) await page.getByLabel('Open navigation').click();
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name, exact: true }).click();
  };
  await page.goto('/admin/settings');
  await page.locator('#period select').selectOption('closed');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Save period' }).click();
  await expect(page.getByText('Enrollment period updated.')).toBeVisible();

  await page.getByLabel('Preview role').selectOption('subscriber');
  await navigate('Enrollment');
  await expect(page.getByText('This enrollment period is closed. Details remain available as read-only records.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enrollment closed' })).toBeDisabled();
  await expect(page.getByLabel('Preferred hospital (optional)')).toBeDisabled();

  await navigate('Plans');
  await expect(page.getByText('The enrollment period is closed. Plan offerings remain available for reference.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enrollment closed' }).first()).toBeDisabled();
});

test('existing subscriber can reach enrollment, plans, history, and account actions', async ({ page, isMobile }, testInfo) => {
  await useSubscriberWorkspace(page);
  const navigate = async (mobileName: string, desktopName = mobileName) => page.getByRole('navigation', { name: isMobile ? 'Mobile navigation' : 'Primary navigation' }).getByRole('link', { name: isMobile ? mobileName : desktopName, exact: true }).click();

  await navigate('Plans');
  await expect(page.getByRole('heading', { name: 'Choose your health plan' })).toBeVisible();
  await page.getByRole('button', { name: 'View benefits' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // The dialog must be dismissible from the keyboard, not only by pointer.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await navigate('Enrollment');
  await expect(page.getByRole('heading', { name: 'Confirm who is covered' })).toBeVisible();
  await expect(page.getByLabel('Preferred hospital (optional)')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Submit enrollment' })).toBeEnabled();

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

  // Family pricing costs several times the individual premium, so an empty household must
  // not be able to reach submission.
  await page.getByRole('button', { name: 'Family', exact: true }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Family members' })).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Add at least one dependent for family coverage.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review and submit' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Individual', exact: true }).click();
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

test('administrator completes enrollment and records offline consent for a subscriber', async ({ page, isMobile }, testInfo) => {
  await page.goto('/admin/enrollees');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Act for' }).first().click();

  const banner = page.locator('.acting-banner');
  await expect(banner).toContainText('You are acting for Ada Nneka Okafor');
  await expect(banner).toContainText('recorded in the audit history against');
  await expect(page.getByRole('heading', { name: /Welcome, Ada/ })).toBeVisible();

  // The acting administrator can do the subscriber's work, including changing the plan.
  await page.getByRole('navigation', { name: isMobile ? 'Mobile navigation' : 'Primary navigation' }).getByRole('link', { name: isMobile ? 'Enrollment' : 'Enrollment', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirm who is covered' })).toBeVisible();

  // Consent is recorded, never given on the subscriber's behalf by ticking a box.
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  // This subscriber already consented in the portal, and that provenance is shown as such.
  await expect(page.locator('.offline-consent__done')).toContainText('gave consent in the portal');
  await page.getByLabel('How consent was received').fill('Signed consent form received by WhatsApp and filed offline.');
  await page.getByRole('button', { name: 'Record consent' }).click();
  await expect(page.getByText('Offline consent recorded against your administrator account.')).toBeVisible();
  await expect(page.locator('.offline-consent__done')).toContainText('Signed consent form received by WhatsApp');

  await assertViewportIntegrity(page);
  await capture(page, testInfo, 'admin-acting-consent');

  // Leaving acting mode returns the administrator to their own workspace.
  await banner.getByRole('button', { name: 'Stop acting' }).click();
  await expect(page.getByRole('heading', { name: 'Enrollees' })).toBeVisible();
  await expect(page.locator('.acting-banner')).toHaveCount(0);
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

  // Verifying and rejecting both move a real money position, so each needs confirmation.
  page.once('dialog', (dialog) => dialog.dismiss());
  await card.getByRole('button', { name: 'Verify' }).click();
  await expect(card).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
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
  // The assessment reports payable/paid/net due, matching the premium trio, and the
  // eleven-column table must not clip any cell at desktop or mobile width.
  for (const column of ['Assessment payable', 'Assessment paid', 'Assessment net due']) {
    await expect(page.locator('.data-table__row').first().locator(`[data-label="${column}"]`)).toBeVisible();
  }
  await expect(page.locator('.table-legend')).toContainText('CAC registration contribution');
  // The swept HMO variance is rendered, not left to a hover title that touch devices lack.
  await expect(page.locator('.data-table__row').first().locator('[data-label="Assessment net due"]'))
    .toContainText('incl. ₦239,246.59 HMO shortfall');
  const cells = await page.locator('.admin-table span, .admin-table strong').evaluateAll(
    (elements) => elements.filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.getAttribute('data-label')));
  expect(cells).toEqual([]);
  await assertViewportIntegrity(page);
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
  await page.locator('#payment-account').getByLabel('Bank', { exact: true }).fill('Test Bank');
  await page.getByRole('button', { name: 'Save HMO payment account' }).click();
  await expect(page.getByText('Payment account updated.')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Save surcharge rates' }).click();
  await expect(page.getByText('Surcharge rates and enrollment totals updated.')).toBeVisible();

  await page.goto('/admin/access');
  page.once('dialog', (dialog) => dialog.accept());
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
