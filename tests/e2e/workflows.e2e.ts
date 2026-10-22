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

test('subscribers see last year’s balance applied and what carries into next year', async ({ page, isMobile }, testInfo) => {
  await useSubscriberWorkspace(page);
  const year = new Date().getUTCFullYear();
  // Last year's ₦18,000 credit is applied to this year's premium.
  await expect(page.locator('.brought-forward')).toContainText(`Brought forward from ${year - 1}`);
  await expect(page.locator('.brought-forward')).toContainText('+₦18,000.00');
  const panel = page.getByRole('region', { name: `Your ${year + 1} enrollment` });
  // The unpaid higher CAC contribution becomes only the one-time ₦15,000 fee next year.
  await expect(panel).toContainText('One-time CAC registration fee');
  await expect(panel).toContainText('−₦15,000.00');
  await expect(panel).toContainText('only the one-time ₦15,000.00 CAC registration fee is charged');
  await expect(panel).toContainText('Paying ₦33,000.00 now earns that credit instead');
  await expect(panel).toContainText('Applied automatically');
  await assertViewportIntegrity(page);
  await capture(page, testInfo, 'subscriber-carry-forward');

  // Paying the higher contribution in full turns the fee into the ₦18,000 credit once verified.
  await page.getByLabel('Preview role').selectOption('owner');
  await page.goto('/admin/enrollees');
  const row = page.locator('.data-table__row').filter({ hasText: 'Ada' });
  await expect(row.locator('.carry-cell')).toContainText('incl. ₦15,000.00 CAC fee');
  await expect(row.locator('[data-label="HMO position"]')).toContainText(`incl. +₦18,000.00 from ${year - 1}`);
  if (!isMobile) {
    const cells = await page.locator('.admin-table span, .admin-table strong').evaluateAll(
      (elements) => elements.filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.getAttribute('data-label')));
    expect(cells).toEqual([]);
  }
  await assertViewportIntegrity(page);
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

test('new subscribers keep joining after the renewal window with prorated AVON billing', async ({ page, isMobile }, testInfo) => {
  // Demo state lives in memory, so every step after closing uses in-app navigation.
  const navigate = async (name: string) => {
    if (isMobile) await page.getByLabel('Open navigation').click();
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name, exact: true }).click();
  };
  await page.goto('/admin/settings');
  await expect(page.getByLabel('Keep accepting new subscribers after the renewal window closes')).toBeChecked();
  await expect(page.locator('.period-intake')).toContainText('Renewal window open');
  await page.locator('#period select').selectOption('closed');
  page.once('dialog', async (dialog) => { expect(dialog.message()).toContain('New subscribers can still join as late enrollees'); await dialog.accept(); });
  await page.getByRole('button', { name: 'Save period' }).click();
  await expect(page.getByText('Enrollment period updated.')).toBeVisible();
  await expect(page.locator('.period-intake')).toContainText('New subscribers are joining as late enrollees');
  await assertViewportIntegrity(page);

  // The applicant sees the late terms before submitting.
  await page.evaluate(() => { window.history.pushState({}, '', '/join'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.getByRole('button', { name: 'Add principal' }).click();
  await expect(page.getByRole('note').filter({ hasText: 'Joining after the' })).toContainText('You pay the full annual subscriber total');
  await page.getByLabel('FUTO graduation year').fill('1996');
  await page.getByLabel('Surname').fill('Obi');
  await page.getByLabel('First name').fill('Chika');
  await page.getByLabel('Date of birth').fill('1976-02-11');
  await page.getByLabel('Mobile number').fill('08012345670');
  await page.getByLabel('Residential address').fill('3 Aba Road');
  await page.getByLabel('State').fill('Rivers');
  await page.getByLabel('Town').fill('Port Harcourt');
  await page.getByLabel('LGA').fill('Obio/Akpor');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.locator('.join-plan-options label').first().click();
  const estimate = page.locator('.proration-breakdown');
  await expect(estimate).toContainText('AVON coverage (expected)');
  await expect(estimate).toContainText(/Estimated credit toward \d{4} enrollment/);
  await assertViewportIntegrity(page);
  await capture(page, testInfo, 'late-applicant-estimate');

  // Administrators see the late terms before approving.
  await page.evaluate(() => { window.history.pushState({}, '', '/admin/applications'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByRole('note').filter({ hasText: 'Late enrollment.' })).toBeVisible();
  page.once('dialog', async (dialog) => { expect(dialog.message()).toMatch(/This is a late enrollment: AVON coverage .* months\)/); await dialog.accept(); });
  await page.getByRole('button', { name: 'Approve subscriber' }).click();
  await expect(page.getByText('0 pending')).toBeVisible();

  // The stored proration is visible, filterable, and correctable to match AVON's invoice.
  await navigate('Enrollees');
  const late = page.locator('.data-table__row').filter({ hasText: 'Tunde' });
  await expect(late.locator('.late-badge')).toBeVisible();
  await page.getByLabel('Filter status').selectOption('late');
  await expect(page.locator('.data-table__row')).toHaveCount(1);
  await late.getByRole('button', { name: 'Coverage' }).click();
  await expect(page.locator('.modal .proration-breakdown')).toContainText('11 of 12 months');
  const month = page.getByLabel('AVON coverage start month');
  await month.fill(await month.getAttribute('min') ?? '');
  await expect(page.locator('.modal .proration-breakdown')).toContainText('12 of 12 months');
  await page.getByLabel('Reason for change').fill('');
  await page.getByRole('button', { name: 'Save coverage start' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter the reason');
  await page.getByLabel('Reason for change').fill('Matches AVON supplementary invoice.');
  await assertViewportIntegrity(page);
  await capture(page, testInfo, 'admin-coverage-start');
  await page.getByRole('button', { name: 'Save coverage start' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(late.locator('.proration-credit')).toContainText('₦0.00 credit');

  // The member sees their coverage and next-year credit.
  page.once('dialog', (dialog) => dialog.accept());
  await late.getByRole('button', { name: 'Act for' }).click();
  await expect(page.getByRole('note').filter({ hasText: 'Late enrollment · AVON coverage' })).toBeVisible();
  await assertViewportIntegrity(page);
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
  const graduationYear = page.getByLabel('FUTO graduation year');
  await graduationYear.fill('');
  await expect(graduationYear).toHaveValue('');
  await graduationYear.pressSequentially('1996');
  await expect(graduationYear).toHaveValue('1996');

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

test('administrator assigns individual fee-only terms without changing other enrollees', async ({ page, isMobile }, testInfo) => {
  await page.goto('/admin/enrollees');
  const target = page.locator('.data-table__row').nth(1);
  await expect(page.locator('.data-table__row')).toHaveCount(2);
  const otherPayables = await page.locator('.data-table__row').locator('[data-label="Assessment payable"]').allInnerTexts();
  await target.getByRole('button', { name: 'Adjust', exact: true }).click();
  await page.getByLabel('Include this subscriber in the assessment').check();
  const year = page.getByLabel('Credit enrollment year');
  const initialYear = await year.inputValue();
  await year.fill('');
  await expect(year).toHaveValue('');
  await year.pressSequentially(initialYear);
  await expect(year).toHaveValue(initialYear);
  const credit = page.getByLabel('Future enrollment credit (₦)');
  await credit.fill('');
  await expect(credit).toHaveValue('');
  await page.getByRole('button', { name: 'Save subscriber assessment' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter valid amounts');
  await page.getByLabel('Assigned contribution (₦)').fill('15000');
  await page.getByLabel('One-time program fee (₦)').fill('15000');
  await page.getByLabel('Future enrollment credit (₦)').fill('0');
  await page.getByRole('button', { name: 'Save subscriber assessment' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a reason');
  await page.getByLabel('Reason for change').fill('Late joining member: one-time fee only, no future credit.');
  await assertViewportIntegrity(page);
  await capture(page, testInfo, 'individual-assessment-terms');
  await page.getByRole('button', { name: 'Save subscriber assessment' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(target.locator('[data-label="Assessment payable"]')).toContainText('₦15,000.00');
  const savedPayables = await page.locator('.data-table__row').locator('[data-label="Assessment payable"]').allInnerTexts();
  expect(savedPayables.filter((_value, index) => index !== 1)).toEqual(otherPayables.filter((_value, index) => index !== 1));

  page.once('dialog', dialog => dialog.accept());
  await target.getByRole('button', { name: 'Act for' }).click();
  await page.getByRole('navigation', { name: isMobile ? 'Mobile navigation' : 'Primary navigation' }).getByRole('link', { name: isMobile ? 'Upload proof' : 'Upload payment', exact: true }).click();
  const panel = page.locator('.assessment-panel');
  await expect(panel).toContainText('₦15,000.00');
  await expect(panel).toContainText('No future enrollment credit is included.');
  await expect(panel).not.toContainText('₦18,000.00');
  await assertViewportIntegrity(page);
});

test('numeric settings can be cleared and retyped without a persistent zero', async ({ page }) => {
  await page.goto('/admin/settings');
  const nhis = page.getByLabel('AVON NHIS fee (%)');
  await expect(nhis).toBeVisible();
  await nhis.fill('');
  await expect(nhis).toHaveValue('');
  let confirmationCount = 0;
  page.on('dialog', async dialog => { confirmationCount++; await dialog.dismiss(); });
  await page.getByRole('button', { name: 'Save surcharge rates' }).click();
  expect(confirmationCount).toBe(0);
  await nhis.pressSequentially('0.50');
  await expect(nhis).toHaveValue('0.50');
  const settings = page.locator('#assessment');
  for (const [label, replacement] of [
    ['Program administrative fee (%)', '2.25'],
    ['Base contribution (₦)', '15000.25'],
    ['One-time program fee (₦)', '15000.25'],
    ['Future enrollment credit (₦)', '0'],
    ['Credit enrollment year', String(new Date().getFullYear() + 1)],
  ]) {
    const input = label.includes('(%)') ? page.getByLabel(label) : settings.getByLabel(label);
    await input.fill('');
    await expect(input).toHaveValue('');
    await input.pressSequentially(replacement);
    await expect(input).toHaveValue(replacement);
  }
  await assertViewportIntegrity(page);
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
  await expect(page.locator('.table-legend').filter({ hasText: 'Assessment columns' })).toContainText('CAC registration contribution');
  // The swept HMO variance is rendered, not left to a hover title that touch devices lack.
  await expect(page.locator('.data-table__row').first().locator('[data-label="Assessment net due"]'))
    .toContainText('incl. ₦221,246.59 HMO shortfall');
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
