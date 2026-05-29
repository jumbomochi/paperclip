import textwrap
from pathlib import Path

import pytest

from agents_runtime.prompts import load_agent, resolve_policies


def test_load_agent_returns_id_and_prompt(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    agents_dir = tmp_path / "agents"
    policies_dir = tmp_path / "policies"
    agents_dir.mkdir()
    policies_dir.mkdir()
    (agents_dir / "demo.yaml").write_text(
        textwrap.dedent(
            """
        id: demo
        name: Demo
        model: smart
        system_prompt: |
          Hello.
          Follow {{policy:brand_voice}}.
    """
        )
    )
    (policies_dir / "brand_voice.md").write_text("Be warm.")

    monkeypatch.setattr("agents_runtime.prompts.AGENTS_DIR", agents_dir)
    monkeypatch.setattr("agents_runtime.prompts.POLICIES_DIR", policies_dir)

    agent = load_agent("demo")
    assert agent.id == "demo"
    assert "Hello." in agent.system_prompt
    assert "Be warm." in agent.system_prompt
    assert "{{policy:brand_voice}}" not in agent.system_prompt


def test_unknown_policy_marker_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    agents_dir = tmp_path / "agents"
    policies_dir = tmp_path / "policies"
    agents_dir.mkdir()
    policies_dir.mkdir()
    (agents_dir / "demo.yaml").write_text(
        "id: demo\nname: Demo\nmodel: smart\nsystem_prompt: |\n  uses {{policy:missing}}\n"
    )

    monkeypatch.setattr("agents_runtime.prompts.AGENTS_DIR", agents_dir)
    monkeypatch.setattr("agents_runtime.prompts.POLICIES_DIR", policies_dir)

    with pytest.raises(KeyError, match="missing"):
        load_agent("demo")


def test_resolve_policies_is_idempotent() -> None:
    resolved = resolve_policies("no markers here", policies={"brand_voice": "x"})
    assert resolved == "no markers here"
