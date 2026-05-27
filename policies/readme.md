# Policies

These markdown files are loaded by Paperclip at startup and inlined into each agent's system prompt at the marker `{{policy:NAME}}` (where NAME is the basename without `.md`).

Editing these files changes agent behavior on the next agent run — no restart required (Paperclip re-reads on each invocation).

When you tighten a policy, also tighten the relevant `evals/` set so prompt regressions are caught in CI.
