def test_graph_compiles_with_expected_nodes() -> None:
    from agents_runtime.graph import build_graph

    compiled = build_graph()
    nodes = set(compiled.get_graph().nodes.keys())
    assert {
        "strategist",
        "researcher",
        "copywriter_x",
        "copywriter_linkedin",
        "editor",
    } <= nodes
