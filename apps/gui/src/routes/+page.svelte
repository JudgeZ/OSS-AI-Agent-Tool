<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/stores';
  import { get } from 'svelte/store';
  import PlanTimeline from '$lib/components/PlanTimeline.svelte';
  import { timeline } from '$lib/stores/planTimeline';

  let planInput = '';

  onMount(() => {
    const current = get(page);
    const planParam = current.url.searchParams.get('plan');
    if (planParam) {
      planInput = planParam;
      timeline.connect(planParam);
    }
  });

  onDestroy(() => {
    timeline.disconnect();
  });

  const handleConnect = () => {
    if (planInput.trim().length === 0) return;
    timeline.connect(planInput.trim());
  };
</script>

<main class="container">
  <section class="controls">
    <label for="plan">Plan ID</label>
    <div class="controls__row">
      <input
        id="plan"
        name="plan"
        placeholder="plan-1234"
        bind:value={planInput}
        on:keydown={(event) => event.key === 'Enter' && handleConnect()}
      />
      <button class="connect" on:click={handleConnect}>Connect</button>
    </div>
  </section>
  <PlanTimeline />
</main>

<style>
  .container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    margin: 0 auto;
    padding: 2rem;
    max-width: 960px;
  }

  .controls {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 0.75rem;
    padding: 1.25rem;
    box-shadow: 0 15px 35px rgba(15, 23, 42, 0.35);
  }

  .controls label {
    display: block;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 0.5rem;
    color: #94a3b8;
  }

  .controls__row {
    display: flex;
    gap: 0.75rem;
  }

  input {
    flex: 1;
    border: 1px solid rgba(148, 163, 184, 0.4);
    border-radius: 0.5rem;
    padding: 0.65rem 0.85rem;
    background: rgba(15, 23, 42, 0.85);
    color: inherit;
  }

  input:focus {
    outline: 2px solid rgba(94, 234, 212, 0.6);
    outline-offset: 1px;
  }

  .connect {
    padding: 0.65rem 1rem;
    border-radius: 0.5rem;
    border: none;
    background: linear-gradient(135deg, #0ea5e9, #22d3ee);
    color: #0f172a;
    font-weight: 600;
    cursor: pointer;
  }

  .connect:hover {
    filter: brightness(1.1);
  }
</style>
