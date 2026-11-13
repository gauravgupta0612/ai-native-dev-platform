"""Run:  python examples/basic_agent.py
Uses real providers when keys are in .env, otherwise the offline echo provider."""
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from ai_native_common import (  # noqa: E402
    AgentRuntime, AuditLog, PolicyGuardrails, RouteRule, ToolRegistry, create_router, load_config, load_dotenv,
)


def main() -> None:
    load_dotenv()
    config = load_config()
    router = create_router(config)
    router.add_rule(RouteRule("code-generation", router.list_providers()[0]))

    tools = ToolRegistry()

    @tools.tool("get_time", "Returns the current date and time (ISO 8601).")
    def get_time(_args):
        return datetime.now().isoformat()

    agent = AgentRuntime(
        router,
        tools=tools,
        guardrails=PolicyGuardrails(denied_tools=["delete_file"]),
        audit=AuditLog(config.audit_log_path),
        max_steps=config.max_agent_steps,
        name="demo-agent",
    )
    result = agent.run("What time is it? Use the get_time tool.", route_task="code-generation")
    print("Providers:", ", ".join(router.list_providers()))
    print("Answer   :", result.output)
    print("Steps    :", result.steps, "| tool calls:", result.tool_calls)
    print("Metrics  :", json.dumps(router.metrics.snapshot()))


if __name__ == "__main__":
    main()
