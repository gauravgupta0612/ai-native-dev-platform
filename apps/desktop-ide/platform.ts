import * as os from "node:os";
import * as path from "node:path";
import { AuditLog, Logger, ModelProvider, ToolDefinition, loadDotEnv } from "../../common/typescript/src";
import { AgentService } from "../../ai-orchestration/agent-runtime";
import { PlatformContextBuilder } from "../../ai-orchestration/context-manager";
import { buildRouter, loadRoutingConfig } from "../../ai-orchestration/model-router";
import { Telemetry } from "../../ai-orchestration/observability";
import { buildToolRegistry } from "../../ai-orchestration/tool-execution";
import { GitService } from "../../core/git-integration";
import { ProjectInfo, ProjectManager } from "../../core/project-manager";
import { TerminalManager } from "../../core/terminal-manager";
import { WorkspaceEngine } from "../../core/workspace-engine";
import { EffectivePolicy, loadPolicies } from "../../enterprise/enterprise-policies";
import { CodeIndex } from "../../knowledge-data/code-index";
import { KnowledgeGraph } from "../../knowledge-data/knowledge-graph";
import { ProjectDatabase } from "../../knowledge-data/project-database";
import { DataPrivacy } from "../../security/data-privacy";
import { PermissionManager, PromptUser } from "../../security/permission-control";
import { ChainedSecretStore, EncryptedFileSecretStore, EnvSecretStore, SecretStore } from "../../security/secure-storage";

export interface PlatformOptions {
  projectRoot: string;
  /** App data (recent projects, vault, telemetry). Default ~/.ai-native-platform */
  appDataDir?: string;
  /** Folder with routing.json and policy.json. Default ./config */
  configDir?: string;
  /** Asks the user to approve risky actions. Without it, risky actions are denied. */
  prompt?: PromptUser;
  /** Master password for the encrypted vault (optional; env vars are used otherwise). */
  vaultPassword?: string;
  extraTools?: ToolDefinition[];
  /** Extra model providers (your gateway, tests). The first one becomes the default. */
  providers?: ModelProvider[];
}

export interface Platform {
  project: ProjectInfo;
  policy: EffectivePolicy;
  secrets: SecretStore;
  workspace: WorkspaceEngine;
  codeIndex: CodeIndex;
  graph: KnowledgeGraph;
  db: ProjectDatabase;
  git: GitService;
  terminal: TerminalManager;
  permissions: PermissionManager;
  audit: AuditLog;
  agents: AgentService;
  routerInfo: { providers: string[]; skipped: string[] };
  router: ReturnType<typeof buildRouter>["router"];
  /** (Re)builds the code index and knowledge graph. */
  reindex(): Promise<{ files: number; chunks: number }>;
  dispose(): void;
}

/** Wires every platform module together for one project. Used by the CLI, the server and a future desktop UI. */
export async function createPlatform(opts: PlatformOptions): Promise<Platform> {
  loadDotEnv(path.join(opts.projectRoot, ".env"));
  const appData = opts.appDataDir ?? path.join(os.homedir(), ".ai-native-platform");
  const configDir = opts.configDir ?? path.resolve(__dirname, "../../../config");
  const logger = new Logger("platform");

  const projects = new ProjectManager(appData);
  const project = projects.open(opts.projectRoot);
  const policy = loadPolicies(path.join(configDir, "policy.json"), path.join(project.root, ".aiplatform", "policy.json"));

  const stores: SecretStore[] = [new EnvSecretStore()];
  if (opts.vaultPassword) stores.push(new EncryptedFileSecretStore(path.join(appData, "vault.json"), opts.vaultPassword));
  const secrets = new ChainedSecretStore(stores);

  const routing = loadRoutingConfig(path.join(configDir, "routing.json"));
  if (policy.allowedProviders) routing.providers = routing.providers.filter((p) => policy.allowedProviders!.includes(p) || p === "echo");
  const { router, skipped } = buildRouter({ ...routing, localOnly: routing.localOnly || policy.localOnly || !!project.localOnly }, secrets, logger.child("router"));

  (opts.providers ?? []).forEach((p, i) => router.register(p, { isDefault: i === 0 }));

  const workspace = new WorkspaceEngine();
  workspace.addRoot(project.root);
  const codeIndex = new CodeIndex();
  const graph = new KnowledgeGraph();
  const db = new ProjectDatabase(path.join(project.root, ".aiplatform", "project-db.json"));
  const git = new GitService(project.root);
  const terminal = new TerminalManager({ allowedCommands: policy.allowedCommands, workspaceRoot: project.root });
  const permissions = new PermissionManager(opts.prompt);
  const audit = new AuditLog(path.join(project.root, ".aiplatform", "audit.jsonl"));
  const telemetry = new Telemetry(path.join(appData, "telemetry.jsonl"), policy.telemetry);

  const tools = buildToolRegistry({
    workspaceRoot: project.root,
    allowWrite: policy.allowFileWrites,
    git: (await git.isRepo()) ? git : undefined,
    terminal: policy.allowedCommands.length ? terminal : undefined,
    codeIndex,
    graph,
    extra: opts.extraTools,
  });

  const agents = new AgentService({
    router, tools, policy, permissions, audit, telemetry, logger,
    privacy: new DataPrivacy(),
    context: new PlatformContextBuilder(workspace, codeIndex),
  });

  return {
    project, policy, secrets, workspace, codeIndex, graph, db, git, terminal, permissions, audit, agents, router,
    routerInfo: { providers: router.listProviders(), skipped },
    async reindex() {
      const files = workspace.index().map((f) => f.path);
      const chunks = await codeIndex.indexFiles(project.root, files);
      graph.clear();
      graph.buildFromCode(project.root, files, codeIndex.allSymbols());
      return { files: files.length, chunks };
    },
    dispose() { workspace.dispose(); },
  };
}
