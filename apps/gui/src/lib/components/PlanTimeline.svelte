<script lang="ts">
  import { timeline } from '$lib/stores/planTimeline';
  import ApprovalModal from './ApprovalModal.svelte';
  import type { PlanStep } from '$lib/stores/planTimeline';
  import { derived } from 'svelte/store';

  const timelineState = timeline;
  const awaitingApproval = derived(timelineState, ($state) => $state.awaitingApproval);
  const connection = derived(timelineState, ($state) => ({
    connected: $state.connected,
    error: $state.connectionError,
    planId: $state.planId
  }));

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString();

  const submitDecision = async (decision: 'approve' | 'reject', rationale?: string) => {
    try {
      await timeline.submitApproval(decision, rationale);
    } catch (error) {
      console.error(error);
    }
  };
</script>

<section class="status">
  {#if $connection.planId}
    <span class:connected={$connection.connected} class="status__pill">
      {$connection.connected ? 'Connected' : 'Connecting…'}
    </span>
    <span class="status__plan">Plan: {$connection.planId}</span>
  {:else}
    <span class="status__placeholder">Enter a plan ID to begin streaming events.</span>
  {/if}
  {#if $connection.error}
    <span class="status__error">{$connection.error}</span>
  {/if}
</section>

{#if $timelineState.steps.length === 0 && $connection.planId}
  <p class="empty">Waiting for orchestrator events…</p>
{:else if $timelineState.steps.length > 0}
  <ul class="timeline">
    {#each $timelineState.steps as step (step.id)}
      <li class={`timeline__item timeline__item--${step.state}`} data-testid={`step-${step.id}`}>
        <header class="timeline__header">
          <div>
            <h2>{step.action}</h2>
            <span class={`capability capability--${step.capability.replace(/\./g, '-')}`}>
              {step.capability}
            </span>
          </div>
          <span class="step-state">{step.state.replace(/_/g, ' ')}</span>
        </header>
        {#if step.summary}
          <p class="summary">{step.summary}</p>
        {/if}
        <ul class="history">
          {#each step.history as entry, index (entry.state + index)}
            <li>
              <span class="history__time">{formatTime(entry.at)}</span>
              <span class="history__state">{entry.state.replace(/_/g, ' ')}</span>
              {#if entry.summary}
                <span class="history__summary">{entry.summary}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </li>
    {/each}
  </ul>
{/if}

{#if $awaitingApproval}
  <ApprovalModal
    submitting={$timelineState.approvalSubmitting}
    error={$timelineState.approvalError}
    step={$awaitingApproval as PlanStep}
    on:approve={() => submitDecision('approve')}
    on:reject={() => submitDecision('reject')}
  />
{/if}

<style>
  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    padding: 0.75rem 1rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(15, 23, 42, 0.55);
  }

  .status__pill {
    padding: 0.35rem 0.75rem;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.25);
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
  }

  .status__pill.connected {
    background: rgba(34, 211, 238, 0.2);
    color: #22d3ee;
  }

  .status__plan {
    font-weight: 600;
  }

  .status__placeholder {
    color: #94a3b8;
  }

  .status__error {
    color: #f87171;
    font-weight: 500;
  }

  .empty {
    margin: 0;
    color: #94a3b8;
  }

  .timeline {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 0;
    margin: 0;
  }

  .timeline__item {
    border-radius: 1rem;
    padding: 1.25rem;
    border: 1px solid rgba(148, 163, 184, 0.25);
    background: rgba(15, 23, 42, 0.65);
    box-shadow: 0 20px 40px rgba(15, 23, 42, 0.35);
  }

  .timeline__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .timeline__header h2 {
    margin: 0 0 0.25rem;
    font-size: 1.15rem;
  }

  .capability {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: 0.5rem;
    background: rgba(59, 130, 246, 0.18);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .capability--repo-write {
    background: rgba(244, 114, 182, 0.2);
    color: #f472b6;
  }

  .capability--network-egress {
    background: rgba(248, 113, 113, 0.18);
    color: #f87171;
  }

  .step-state {
    padding: 0.25rem 0.65rem;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.25);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .summary {
    margin: 0.5rem 0 0;
    color: #cbd5f5;
  }

  .history {
    list-style: none;
    padding: 0;
    margin: 0.75rem 0 0;
    display: grid;
    gap: 0.25rem;
  }

  .history__time {
    font-size: 0.75rem;
    color: #94a3b8;
    min-width: 5.5rem;
  }

  .history li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }

  .history__state {
    font-weight: 600;
    text-transform: capitalize;
  }

  .history__summary {
    color: #cbd5f5;
  }
</style>
