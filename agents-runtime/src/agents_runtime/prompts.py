from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import yaml

from .config import AGENTS_DIR, POLICIES_DIR

POLICY_MARKER = re.compile(r"\{\{policy:([a-z_][a-z0-9_]*)\}\}")


@dataclass(frozen=True)
class Agent:
    id: str
    name: str
    model: str
    system_prompt: str
    raw: dict[str, Any]


def _load_policies() -> dict[str, str]:
    return {p.stem: p.read_text() for p in POLICIES_DIR.glob("*.md") if p.stem != "readme"}


def resolve_policies(text: str, policies: dict[str, str]) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in policies:
            raise KeyError(name)
        return policies[name]

    return POLICY_MARKER.sub(replace, text)


def load_agent(agent_id: str) -> Agent:
    path = AGENTS_DIR / f"{agent_id}.yaml"
    raw = yaml.safe_load(path.read_text())
    policies = _load_policies()
    resolved = resolve_policies(raw["system_prompt"], policies)
    return Agent(
        id=raw["id"],
        name=raw["name"],
        model=raw["model"],
        system_prompt=resolved,
        raw=raw,
    )
