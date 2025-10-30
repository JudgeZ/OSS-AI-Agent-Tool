<script lang="ts">
  import type { PlanStep } from '$lib/stores/planTimeline';
  import { createEventDispatcher } from 'svelte';
  export let step: PlanStep;
  export let submitting: boolean;
  export let error: string | null;
  const dispatch = createEventDispatcher();

  const onApprove = () => {
    dispatch('approve');
  };

  const onReject = () => {
    dispatch('reject');
  };
</script>

<div class="modal__backdrop" role="presentation">
  <section class="modal" role="dialog" aria-modal="true" aria-labelledby="approval-title">
    <header class="modal__header">
      <h2 id="approval-title">Approval required</h2>
      <p class="modal__subtitle">
        Step <strong>{step.action}</strong> requires confirmation before continuing.
      </p>
    </header>
    <dl class="modal__details">
      <div>
        <dt>Capability</dt>
        <dd>{step.capability}</dd>
      </div>
      <div>
        <dt>Current status</dt>
        <dd>{step.state.replace('_', ' ')}</dd>
      </div>
      {#if step.summary}
        <div>
          <dt>Summary</dt>
          <dd>{step.summary}</dd>
        </div>
      {/if}
    </dl>
    {#if error}
      <p class="modal__error">{error}</p>
    {/if}
    <footer class="modal__actions">
      <button class="reject" on:click={onReject} disabled={submitting}>Reject</button>
      <button class="approve" on:click={onApprove} disabled={submitting}>
        {submitting ? 'Submitting…' : 'Approve'}
      </button>
    </footer>
  </section>
</div>

<style>
  .modal__backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.65);
    display: grid;
    place-items: center;
    z-index: 20;
    backdrop-filter: blur(8px);
  }

  .modal {
    width: min(420px, 90vw);
    background: rgba(15, 23, 42, 0.95);
    border-radius: 1rem;
    padding: 1.5rem;
    border: 1px solid rgba(148, 163, 184, 0.4);
    box-shadow: 0 20px 55px rgba(15, 23, 42, 0.45);
    color: inherit;
  }

  .modal__header h2 {
    margin: 0;
    font-size: 1.35rem;
  }

  .modal__subtitle {
    margin: 0.5rem 0 0;
    color: #cbd5f5;
  }

  .modal__details {
    margin: 1rem 0 1.5rem;
    display: grid;
    gap: 0.75rem;
  }

  dt {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #94a3b8;
  }

  dd {
    margin: 0.25rem 0 0;
    font-weight: 600;
  }

  .modal__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  button {
    padding: 0.55rem 1rem;
    border-radius: 0.5rem;
    border: none;
    font-weight: 600;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .approve {
    background: linear-gradient(135deg, #4ade80, #22d3ee);
    color: #0f172a;
  }

  .reject {
    background: rgba(248, 113, 113, 0.15);
    color: #fca5a5;
  }

  .modal__error {
    margin: 0 0 1rem;
    color: #fca5a5;
  }
</style>
