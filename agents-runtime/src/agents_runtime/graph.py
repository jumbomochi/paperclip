from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from .nodes.copywriter import copywriter_linkedin_node, copywriter_x_node
from .nodes.editor import editor_node
from .nodes.researcher import researcher_node
from .nodes.strategist import strategist_node
from .state import GraphState


def build_graph():
    graph = StateGraph(GraphState)
    graph.add_node("strategist", strategist_node)
    graph.add_node("researcher", researcher_node)
    graph.add_node("copywriter_x", copywriter_x_node)
    graph.add_node("copywriter_linkedin", copywriter_linkedin_node)
    graph.add_node("editor", editor_node)

    graph.add_edge(START, "strategist")
    graph.add_edge("strategist", "researcher")
    # Fan-out:
    graph.add_edge("researcher", "copywriter_x")
    graph.add_edge("researcher", "copywriter_linkedin")
    # Fan-in to editor:
    graph.add_edge("copywriter_x", "editor")
    graph.add_edge("copywriter_linkedin", "editor")
    graph.add_edge("editor", END)

    return graph.compile()
