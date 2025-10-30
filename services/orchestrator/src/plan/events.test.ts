import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HISTORY_RETENTION_MS,
  clearPlanHistory,
  getPlanHistory,
  publishPlanStepEvent,
  type PlanStepEvent,
} from "./events.js";

const baseEvent: PlanStepEvent = {
  event: "plan.step",
  traceId: "trace-123",
  planId: "plan-123",
  step: {
    id: "step-1",
    state: "queued",
    capability: "repo.read",
    timeout_s: 60,
    approval: false,
  },
};

describe("plan events history", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearPlanHistory();
  });

  afterEach(() => {
    clearPlanHistory();
    vi.useRealTimers();
  });

  it("cleans up plan history shortly after a terminal step", () => {
    publishPlanStepEvent(baseEvent);
    publishPlanStepEvent({
      ...baseEvent,
      step: { ...baseEvent.step, id: "step-2", state: "running" },
    });

    expect(getPlanHistory(baseEvent.planId)).toHaveLength(2);

    publishPlanStepEvent({
      ...baseEvent,
      step: { ...baseEvent.step, id: "step-3", state: "completed" },
    });

    expect(getPlanHistory(baseEvent.planId)).toHaveLength(3);

    vi.advanceTimersByTime(HISTORY_RETENTION_MS - 1);
    expect(getPlanHistory(baseEvent.planId)).toHaveLength(3);

    vi.advanceTimersByTime(1);
    expect(getPlanHistory(baseEvent.planId)).toHaveLength(0);
  });

  it("caps the stored events for a plan", () => {
    for (let index = 0; index < 250; index += 1) {
      publishPlanStepEvent({
        ...baseEvent,
        step: { ...baseEvent.step, id: `step-${index}`, state: "running" },
      });
    }

    const events = getPlanHistory(baseEvent.planId);
    expect(events).toHaveLength(200);
    expect(events[0]!.step.id).toBe("step-50");
    expect(events.at(-1)!.step.id).toBe("step-249");
  });
});
