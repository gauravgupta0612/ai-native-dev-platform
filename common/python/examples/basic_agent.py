"""Run:  python examples/basic_agent.py
Uses real providers when keys are in .env, otherwise the offline echo provider."""
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from ai_native_common import (  # noqa: E402
    AgentRuntime, AuditLog, PolicyGuardrails, RouteRule, ToolRegistry, create_router, create_workspace_tools,
    load_config, load_dotenv,
)


def main() -> None:
    load_dotenv()
    config = load_config()
    print("Config   :", config.safe_dict()["openai"])  # keys shown as xxxx
    router = create_router(config)
    router.add_rule(RouteRule("code-generation", router.list_providers()[0]))

    tools = ToolRegistry(timeout=15).register_all(create_workspace_tools(os.getcwd()))  # read-only file tools

    @tools.tool("get_time", "Returns the current date and time (ISO 8601).")
    def get_time(_args):
        return datetime.now().isoformat()

    agent = AgentRuntime(
        router,
        tools=tools,
        guardrails=PolicyGuardrails(denied_tools=["delete_file"]),
        audit=AuditLog(config.audit_log_path),
        approver=lambda call: False,  # deny risky tools in the demo; plug in a real prompt in your app
        max_steps=config.max_agent_steps,
        max_total_tokens=50_000,
        name="demo-agent",
    )
    result = agent.run("List the files in this project and tell me what it does.", route_task="code-generation")
    print("Providers:", ", ".join(router.list_providers()))
    print("Answer   :", result.output)
    print("Steps    :", result.steps, "| tool calls:", result.tool_calls, "| stop:", result.stopped_reason)
    print("Metrics  :", json.dumps(router.metrics.snapshot()))


if __name__ == "__main__":
    main()
