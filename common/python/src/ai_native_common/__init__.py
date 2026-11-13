"""ai_native_common — reusable AI platform building blocks (stdlib only, Python 3.9+)."""
from .agent import AgentResult, AgentRuntime
from .audit import AuditEvent, AuditLog
from .config import PlatformConfig, load_config, load_dotenv
from .context import ContextManager, ContextSnippet
from .factory import create_router
from .guardrails import CheckResult, PolicyGuardrails
from .observability import Logger, Metrics
from .providers import AnthropicProvider, EchoProvider, GeminiProvider, OpenAICompatibleProvider
from .router import ModelRouter, RouteRule
from .tools import ToolDefinition, ToolRegistry, ToolResult
from .types import ChatMessage, ChatRequest, ChatResponse, ModelProvider, ProviderError, ToolCall, ToolSpec, Usage

__version__ = "0.1.0"
__all__ = [name for name in dir() if not name.startswith("_")]
