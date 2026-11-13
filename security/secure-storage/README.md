# Secure Storage

API keys and secrets in OS keychain / vault (never in plain files).

## Code in this folder

- `index.ts`

Main exports: `SecretStore`, `EnvSecretStore`, `EncryptedFileSecretStore`, `ChainedSecretStore`

Tests: see `tests/unit` and `tests/integration`. Build and test from the repository root with `npm test`.
