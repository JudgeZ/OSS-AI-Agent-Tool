import { get, writable } from 'svelte/store';
import { approvalPath, ssePath } from '$lib/config';

type StepState =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed';

export interface StepHistoryEntry {
  state: StepState;
  at: string;
  summary?: string;
  output?: Record<string, unknown>;
}

export interface DiffFile {
  path: string;
  patch: string;
}

export interface DiffPayload {
  files: DiffFile[];
}

export interface PlanStep {
  id: string;
  action: string;
  capability: string;
  capabilityLabel: string;
  tool: string;
  labels: string[];
  timeoutSeconds: number;
  state: StepState;
  summary?: string;
  approvalRequired: boolean;
  history: StepHistoryEntry[];
  latestOutput?: Record<string, unknown>;
  diff?: DiffPayload;
}

export interface TimelineState {
  planId: string | null;
  connected: boolean;
  steps: PlanStep[];
  awaitingApproval: PlanStep | null;
  approvalSubmitting: boolean;
  connectionError: string | null;
  approvalError: string | null;
}

const initialState: TimelineState = {
  planId: null,
  connected: false,
  steps: [],
  awaitingApproval: null,
  approvalSubmitting: false,
  connectionError: null,
  approvalError: null
};

interface StepEventPayload {
  plan_id: string;
  step: {
    id: string;
    action?: string;
    tool?: string;
    capability: string;
    capability_label?: string;
    labels?: string[];
    state: StepState;
    summary?: string;
    approval_required?: boolean;
    timeoutSeconds?: number;
    timeout_seconds?: number;
    transitioned_at?: string;
    output?: Record<string, unknown>;
  };
}

let eventSource: EventSource | null = null;

function toHistoryEntry(step: StepEventPayload['step']): StepHistoryEntry {
  const at = step.transitioned_at ?? new Date().toISOString();
  return { state: step.state, at, summary: step.summary, output: step.output };
}

function toDiffPayload(output: Record<string, unknown> | undefined): DiffPayload | undefined {
  if (!output) return undefined;
  const candidate = (output as { diff?: unknown }).diff;
  if (!candidate) return undefined;

  if (typeof candidate === 'string') {
    return { files: [{ path: 'changes', patch: candidate }] };
  }

  if (Array.isArray(candidate)) {
    const files = candidate
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const path = typeof (entry as { path?: unknown }).path === 'string' ? (entry as { path: string }).path : 'changes';
        const patch = typeof (entry as { patch?: unknown }).patch === 'string' ? (entry as { patch: string }).patch : null;
        if (!patch) return null;
        return { path, patch };
      })
      .filter((file): file is DiffFile => file !== null);
    return files.length > 0 ? { files } : undefined;
  }

  if (typeof candidate === 'object') {
    const filesField = (candidate as { files?: unknown }).files;
    if (Array.isArray(filesField)) {
      const files = filesField
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const path = typeof (entry as { path?: unknown }).path === 'string' ? (entry as { path: string }).path : 'changes';
          const patch = typeof (entry as { patch?: unknown }).patch === 'string' ? (entry as { patch: string }).patch : null;
          if (!patch) return null;
          return { path, patch };
        })
        .filter((file): file is DiffFile => file !== null);
      return files.length > 0 ? { files } : undefined;
    }
  }

  return undefined;
}

function upsertStep(state: TimelineState, payload: StepEventPayload): TimelineState {
  const historyEntry = toHistoryEntry(payload.step);
  const steps = [...state.steps];
  const existingIndex = steps.findIndex((step) => step.id === payload.step.id);
  const approvalRequired = Boolean(payload.step.approval_required);
  const timeoutSeconds =
    typeof payload.step.timeoutSeconds === 'number'
      ? payload.step.timeoutSeconds
      : typeof payload.step.timeout_seconds === 'number'
      ? payload.step.timeout_seconds
      : undefined;

  if (existingIndex === -1) {
    const latestOutput = payload.step.output;
    steps.push({
      id: payload.step.id,
      action: payload.step.action ?? payload.step.id,
      capability: payload.step.capability,
      capabilityLabel: payload.step.capability_label ?? payload.step.capability,
      tool: payload.step.tool ?? payload.step.action ?? payload.step.id,
      labels: payload.step.labels ?? [],
      timeoutSeconds: timeoutSeconds ?? 0,
      state: payload.step.state,
      summary: payload.step.summary,
      approvalRequired,
      history: [historyEntry],
      latestOutput,
      diff: toDiffPayload(latestOutput)
    });
  } else {
    const existing = steps[existingIndex];
    const alreadyLogged = existing.history.some((entry) => entry.state === historyEntry.state && entry.at === historyEntry.at);
    const history = alreadyLogged ? existing.history : [...existing.history, historyEntry];
    const latestOutput = payload.step.output ?? existing.latestOutput;
    const diff = payload.step.output ? toDiffPayload(payload.step.output) ?? existing.diff : existing.diff;
    steps[existingIndex] = {
      ...existing,
      action: payload.step.action ?? existing.action,
      capability: payload.step.capability ?? existing.capability,
      capabilityLabel: payload.step.capability_label ?? existing.capabilityLabel ?? existing.capability,
      tool: payload.step.tool ?? existing.tool,
      labels: payload.step.labels ?? existing.labels,
      timeoutSeconds: timeoutSeconds ?? existing.timeoutSeconds,
      state: payload.step.state,
      summary: payload.step.summary ?? existing.summary,
      approvalRequired: approvalRequired || existing.approvalRequired,
      history,
      latestOutput,
      diff
    };
  }

  steps.sort((a, b) => a.id.localeCompare(b.id));

  const awaitingApproval = (() => {
    if (payload.step.state === 'waiting_approval') {
      return steps.find((step) => step.id === payload.step.id) ?? null;
    }
    if (state.awaitingApproval && state.awaitingApproval.id === payload.step.id && payload.step.state !== 'waiting_approval') {
      return null;
    }
    return state.awaitingApproval;
  })();

  return {
    ...state,
    steps,
    awaitingApproval
  };
}

async function postApproval(decision: 'approve' | 'reject', rationale?: string) {
  const current = get(timelineStore);
  if (!current.planId || !current.awaitingApproval) {
    throw new Error('No pending approval');
  }
  const target = approvalPath(current.planId, current.awaitingApproval.id);
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ decision, rationale })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Approval request failed');
  }
}

const timelineStore = writable<TimelineState>(initialState);
const { subscribe, set, update } = timelineStore;

function disconnect() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function connect(planId: string) {
  if (typeof window === 'undefined') return;
  disconnect();
  const url = ssePath(planId);
  set({ ...initialState, planId });
  eventSource = new EventSource(url, { withCredentials: false });

  eventSource.addEventListener('open', () => {
    update((state) => ({ ...state, connected: true, connectionError: null }));
  });

  eventSource.addEventListener('error', () => {
    update((state) => ({ ...state, connected: false, connectionError: 'Connection lost' }));
  });

  eventSource.addEventListener('plan.step', (event) => {
    const detail = JSON.parse((event as MessageEvent).data) as StepEventPayload;
    update((state) => upsertStep(state, detail));
  });
}

async function submitApproval(decision: 'approve' | 'reject', rationale?: string) {
  update((state) => ({ ...state, approvalSubmitting: true, approvalError: null }));
  try {
    await postApproval(decision, rationale);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Approval failed';
    update((state) => ({ ...state, approvalSubmitting: false, approvalError: message }));
    throw error;
  }
  update((state) => ({ ...state, approvalSubmitting: false }));
}

export const timeline = {
  subscribe,
  connect,
  disconnect,
  submitApproval
};

export type { DiffPayload, DiffFile, PlanStep, StepHistoryEntry, StepState, TimelineState };
