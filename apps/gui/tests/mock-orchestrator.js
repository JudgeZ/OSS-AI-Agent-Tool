#!/usr/bin/env node
import http from 'node:http';

const port = Number(process.env.MOCK_PORT || 4010);

const plans = new Map();
const clients = new Map();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

function ensurePlan(planId) {
  if (!plans.has(planId)) {
    plans.set(planId, {
      steps: {
        s1: {
          id: 's1',
          action: 'Index repository',
          capability: 'repo.read',
          summary: 'Scanning files',
          approval: false
        },
        s2: {
          id: 's2',
          action: 'Apply workspace edits',
          capability: 'repo.write',
          summary: 'Proposed changes ready',
          approval: true,
          output: {
            diff: [
              {
                path: 'src/example.ts',
                patch: ['--- a/src/example.ts', '+++ b/src/example.ts', "@@ -1,3 +1,5 @@", "-console.log('old');", "+console.log('new');"].join('\n')
              }
            ]
          }
        },
        s3: {
          id: 's3',
          action: 'Run smoke tests',
          capability: 'test.run',
          summary: 'Smoke suite execution',
          approval: false
        }
      },
      awaiting: null,
      timers: []
    });
  }
  return plans.get(planId);
}

function writeEvent(planId, event, payload) {
  const sink = clients.get(planId);
  if (!sink) return;
  sink.res.write(`event: ${event}\n`);
  sink.res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function schedule(planId, fn, delay) {
  const plan = ensurePlan(planId);
  const timer = setTimeout(fn, delay);
  plan.timers.push(timer);
}

function startPlan(planId) {
  const plan = ensurePlan(planId);
  const baseDelay = 250;

  const s1 = plan.steps.s1;
  schedule(planId, () =>
    writeEvent(planId, 'plan.step', {
      plan_id: planId,
      step: { ...s1, state: 'queued', transitioned_at: new Date().toISOString() }
    }),
  baseDelay);
  schedule(planId, () =>
    writeEvent(planId, 'plan.step', {
      plan_id: planId,
      step: { ...s1, state: 'running', transitioned_at: new Date().toISOString() }
    }),
  baseDelay * 2);
  schedule(planId, () =>
    writeEvent(planId, 'plan.step', {
      plan_id: planId,
      step: { ...s1, state: 'completed', transitioned_at: new Date().toISOString() }
    }),
  baseDelay * 3);

  const s2 = plan.steps.s2;
  schedule(planId, () =>
    writeEvent(planId, 'plan.step', {
      plan_id: planId,
      step: { ...s2, state: 'queued', transitioned_at: new Date().toISOString(), output: s2.output }
    }),
  baseDelay * 4);
  schedule(planId, () =>
    writeEvent(planId, 'plan.step', {
      plan_id: planId,
      step: { ...s2, state: 'running', transitioned_at: new Date().toISOString(), output: s2.output }
    }),
  baseDelay * 5);
  schedule(planId, () => {
    plan.awaiting = s2.id;
    writeEvent(planId, 'plan.step', {
      plan_id: planId,
      step: { ...s2, state: 'waiting_approval', transitioned_at: new Date().toISOString(), output: s2.output }
    });
  }, baseDelay * 6);

  const s3 = plan.steps.s3;
  schedule(planId, () =>
    writeEvent(planId, 'plan.step', {
      plan_id: planId,
      step: { ...s3, state: 'queued', transitioned_at: new Date().toISOString() }
    }),
  baseDelay * 6);
}

function clearPlanTimers(planId) {
  const plan = plans.get(planId);
  if (!plan) return;
  while (plan.timers.length) {
    clearTimeout(plan.timers.pop());
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sseMatch = url.pathname.match(/^\/plan\/([^/]+)\/events$/);
  const approveMatch = url.pathname.match(/^\/plan\/([^/]+)\/steps\/([^/]+)\/approve$/);

  if (req.method === 'GET' && sseMatch) {
    const planId = decodeURIComponent(sseMatch[1]);
    ensurePlan(planId);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...corsHeaders
    });
    res.write('\n');
    clients.set(planId, { res });
    startPlan(planId);
    req.on('close', () => {
      clearPlanTimers(planId);
      clients.delete(planId);
    });
    return;
  }

  if (req.method === 'OPTIONS' && approveMatch) {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method === 'POST' && approveMatch) {
    const planId = decodeURIComponent(approveMatch[1]);
    const stepId = decodeURIComponent(approveMatch[2]);
    const plan = ensurePlan(planId);

    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf-8');
    });
    req.on('end', () => {
      let decision = 'approve';
      try {
        const parsed = body ? JSON.parse(body) : {};
        decision = parsed.decision;
      } catch (error) {
        // ignore malformed body and fall back to approve
      }

      if (!plan.steps[stepId]) {
        res.writeHead(404, corsHeaders);
        res.end('Step not found');
        return;
      }

      if (plan.awaiting !== stepId) {
        res.writeHead(409, corsHeaders);
        res.end('No pending approval for this step');
        return;
      }

      if (decision === 'reject') {
        writeEvent(planId, 'plan.step', {
          plan_id: planId,
          step: { ...plan.steps[stepId], state: 'rejected', transitioned_at: new Date().toISOString() }
        });
        plan.awaiting = null;
        res.writeHead(204, corsHeaders);
        res.end();
        return;
      }

      writeEvent(planId, 'plan.step', {
        plan_id: planId,
        step: { ...plan.steps[stepId], state: 'approved', transitioned_at: new Date().toISOString(), output: plan.steps[stepId].output }
      });
      plan.awaiting = null;
      schedule(planId, () =>
        writeEvent(planId, 'plan.step', {
          plan_id: planId,
          step: {
            ...plan.steps[stepId],
            state: 'completed',
            transitioned_at: new Date().toISOString(),
            output: plan.steps[stepId].output
          }
        }),
      250);
      const s3 = plan.steps.s3;
      schedule(planId, () =>
        writeEvent(planId, 'plan.step', {
          plan_id: planId,
          step: { ...s3, state: 'running', transitioned_at: new Date().toISOString() }
        }),
      300);
      schedule(planId, () =>
        writeEvent(planId, 'plan.step', {
          plan_id: planId,
          step: { ...s3, state: 'completed', transitioned_at: new Date().toISOString() }
        }),
      650);
      res.writeHead(204, corsHeaders);
      res.end();
    });
    return;
  }

  res.writeHead(404, corsHeaders);
  res.end();
});

server.listen(port, () => {
  console.log(`Mock orchestrator listening on :${port}`);
});
