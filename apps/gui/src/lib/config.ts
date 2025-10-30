export const orchestratorBaseUrl = (() => {
  const fromEnv = import.meta.env.VITE_ORCHESTRATOR_URL as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'http://127.0.0.1:3001';
})();

export const ssePath = (planId: string) => `${orchestratorBaseUrl}/plans/${encodeURIComponent(planId)}/stream`;
export const approvalPath = (planId: string, stepId: string) =>
  `${orchestratorBaseUrl}/plan/${encodeURIComponent(planId)}/steps/${encodeURIComponent(stepId)}/approve`;
