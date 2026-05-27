# Evals

Golden-set evaluations gating prompt changes. Each agent that produces structured output has its own subdir with:

- `promptfooconfig.yaml` — the prompt under test + case glob.
- `cases/*.yaml` — canned inputs (brief + research blob).

A shared `judge.yaml` defines the eval-judge prompt that scores agent outputs against the rubric. The judge runs on a DIFFERENT model than the agent under test.

## Running

```bash
# Replay-mode (uses cached LLM responses if recorded). Fast, free, CI-friendly.
PROMPTFOO_REPLAY=1 pnpm evals

# Live mode (calls the real model). Run nightly + before major releases.
pnpm evals
```

## Promotion criterion

A change is promotable iff `pass_rate >= 0.95` on the affected agent's set. CI enforces this in `.github/workflows/evals.yml`.

## Case templates

Each subdir contains 1-2 starter cases. The full eval sets (20 per copywriter, 20 for editor)
must be authored manually — see comments in each starter file for the shape. Spending
10-15 minutes per case is reasonable. Use real-world themes you'd actually post about.
