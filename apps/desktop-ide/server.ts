import { createPlatformServer } from "../../enterprise/scalable-architecture";
import { createPlatform } from "./platform";

/**
 * Server mode. Environment:
 *   PLATFORM_PROJECT_ROOT   project folder (default: current folder)
 *   PLATFORM_API_KEY_HASHES comma-separated SHA-256 hashes of client keys (create with: npm run hash-key -- <key>)
 *   PLATFORM_HOST / PLATFORM_PORT  default 127.0.0.1:8787
 * Risky tools (writes, commands) are always denied in server mode: there is nobody to approve them.
 */
async function main() {
  const hashes = (process.env.PLATFORM_API_KEY_HASHES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!hashes.length) throw new Error("Set PLATFORM_API_KEY_HASHES (SHA-256 of each client API key)");
  const platform = await createPlatform({ projectRoot: process.env.PLATFORM_PROJECT_ROOT ?? process.cwd() });
  await platform.reindex();
  const port = Number(process.env.PLATFORM_PORT ?? 8787);
  const host = process.env.PLATFORM_HOST ?? "127.0.0.1";
  createPlatformServer(platform.agents, { port, host, apiKeyHashes: hashes }).listen(port, host, () =>
    console.log(`Platform server on http://${host}:${port} (providers: ${platform.routerInfo.providers.join(", ")})`),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
