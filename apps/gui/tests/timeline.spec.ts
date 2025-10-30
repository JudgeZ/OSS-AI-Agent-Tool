import { expect, test } from '@playwright/test';

const planId = 'plan-smoke';

test('timeline renders orchestrator events and captures approval flow', async ({ page }) => {
  await page.goto(`/?plan=${planId}`);

  await expect(page.getByLabel('Plan ID')).toHaveValue(planId);

  const stepOne = page.getByTestId('step-s1');
  await expect(stepOne).toContainText('Index repository', { timeout: 10_000 });
  await expect(stepOne).toContainText('completed');

  const approvalModal = page.getByRole('dialog', { name: 'Approval required' });
  await expect(approvalModal).toContainText('Apply workspace edits');
  await approvalModal.getByRole('button', { name: 'Approve' }).click();

  await expect(approvalModal).toBeHidden({ timeout: 5_000 });

  const stepTwo = page.getByTestId('step-s2');
  await expect(stepTwo).toContainText('repo.write');
  await expect(stepTwo).toContainText('approved', { timeout: 10_000 });
  await expect(stepTwo).toContainText('completed', { timeout: 10_000 });

  const stepThree = page.getByTestId('step-s3');
  await expect(stepThree).toContainText('Run smoke tests', { timeout: 10_000 });
  await expect(stepThree).toContainText('completed', { timeout: 10_000 });
});
