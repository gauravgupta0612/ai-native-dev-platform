# AI-Native Developer Platform

Secure · Intelligent · Extensible

Reusable project skeleton based on the "NextGen AI IDE" architecture.

## Layer map

| Diagram layer | Folder |
|---|---|
| NextGen AI IDE | `apps/desktop-ide` |
| Application Core | `core/` |
| AI Orchestration Engine | `ai-orchestration/` |
| AI Models (your choice) | `model-providers/` |
| Knowledge & Data Layer | `knowledge-data/` |
| Security First | `security/` |
| Developer Ecosystem | `ecosystem/` |
| Smart Features | `features/` |
| Deployment & Updates | `deployment/` |
| Enterprise Ready | `enterprise/` |

## Request flow

Developer → `apps/desktop-ide` → `core/` → `ai-orchestration/`
(model-router → `model-providers/`, context-manager → `knowledge-data/`, guardrails → `security/`)

## Common library (TypeScript · Java · Python)

`common/` contains secure, reusable AI code for any project, in TypeScript, Java and Python: model providers (OpenAI, Claude, Gemini, Ollama, custom), a router with retry and fallback, an agent runtime with budgets, validated and sandboxed tools, guardrails (secret masking, prompt-injection detection), a hash-chained audit log and metrics. Start with `common/README.md`; the security details are in `common/SECURITY.md`.

## Shared folders

- `config/` – settings (`.env.example`, never real keys)
- `docs/` – architecture + user guide
- `tests/` – unit and integration tests
- `scripts/` – build and release scripts

Every folder contains a README.md describing its purpose.
