# Editor rubric

Score each draft on these dimensions. If ANY hard rule fails → reject (rework_requested or editor_rejected per drift escalation). If ALL soft rules pass → approve to queue.

## Hard checks (boolean)
- HARD_VOICE: does the diction match brand_voice.md? (no banned phrases, length appropriate)
- HARD_RISK: passes all risk_policy.md hard rules?
- HARD_LINK: contains exactly one newsletter link? (if zero or two, fail)
- HARD_HOOK: declares a hook_tag from hook_taxonomy.md? (uses one of the named hooks)
- HARD_CHAR: ≤ 280 chars for X, ≤ 3000 chars for LinkedIn?

## Soft checks (boolean)
- SOFT_SPECIFIC: contains at least one concrete number, name, or detail?
- SOFT_OPEN: opening line earns the read (per the chosen hook's pattern)?
- SOFT_CTA: ends with a clear next step (read, reply, share)?
- SOFT_FORMAT: no emoji-stuffing, no fake line breaks, no clickbait punctuation (?!?!).

## Output format (return as JSON)
```
{
  "verdict": "approve" | "rework" | "editor_reject",
  "scores": { "HARD_*": bool, "SOFT_*": bool },
  "notes": "single paragraph explaining the verdict",
  "suggested_edits": null | "concrete edit instructions if rework"
}
```
