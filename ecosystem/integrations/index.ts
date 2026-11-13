import { ToolDefinition } from "../../common/typescript/src";
import { assertSecureUrl } from "../../common/typescript/src/models/providers/http";
import { SecretStore } from "../../security/secure-storage";

async function getJson(service: string, url: string, headers: Record<string, string>, timeoutMs = 20_000): Promise<any> {
  assertSecureUrl(service, url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: ctrl.signal, redirect: "error" });
    const text = await res.text();
    if (!res.ok) throw new Error(`${service} HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(t);
  }
}

/** Read-only Jira Cloud/Server client. Token comes from the SecretStore (JIRA_EMAIL + JIRA_TOKEN, or JIRA_PAT). */
export class JiraIntegration {
  constructor(private readonly baseUrl: string, private readonly secrets: SecretStore) {}

  private headers(): Record<string, string> {
    const pat = this.secrets.get("JIRA_PAT");
    if (pat) return { Authorization: `Bearer ${pat}` };
    const email = this.secrets.get("JIRA_EMAIL");
    const token = this.secrets.get("JIRA_TOKEN");
    if (!email || !token) throw new Error("Jira credentials missing (JIRA_PAT or JIRA_EMAIL + JIRA_TOKEN)");
    return { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` };
  }

  async getIssue(key: string): Promise<{ key: string; summary: string; status: string; assignee?: string }> {
    if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) throw new Error("Invalid issue key");
    const d = await getJson("jira", `${this.baseUrl.replace(/\/+$/, "")}/rest/api/2/issue/${key}?fields=summary,status,assignee`, this.headers());
    return { key: d.key, summary: d.fields?.summary, status: d.fields?.status?.name, assignee: d.fields?.assignee?.displayName };
  }

  async search(jql: string, max = 20): Promise<Array<{ key: string; summary: string; status: string }>> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=${Math.min(max, 100)}&fields=summary,status`;
    const d = await getJson("jira", url, this.headers());
    return (d.issues ?? []).map((i: any) => ({ key: i.key, summary: i.fields?.summary, status: i.fields?.status?.name }));
  }

  tools(): ToolDefinition[] {
    return [
      {
        spec: { name: "jira_get_issue", description: "Get a Jira issue (summary, status, assignee).", parameters: { type: "object", properties: { key: { type: "string", minLength: 3, maxLength: 30 } }, required: ["key"], additionalProperties: false } },
        handler: ({ key }) => this.getIssue(String(key)),
      },
      {
        spec: { name: "jira_search", description: "Search Jira issues with JQL.", parameters: { type: "object", properties: { jql: { type: "string", minLength: 3, maxLength: 500 }, max: { type: "integer", minimum: 1, maximum: 50 } }, required: ["jql"], additionalProperties: false } },
        handler: ({ jql, max }) => this.search(String(jql), Number(max ?? 20)),
      },
    ];
  }
}

/** Read-only GitHub REST client. Token from the SecretStore (GITHUB_TOKEN). */
export class GitHubIntegration {
  constructor(private readonly secrets: SecretStore, private readonly apiUrl = "https://api.github.com") {}

  private headers(): Record<string, string> {
    const token = this.secrets.get("GITHUB_TOKEN");
    return { "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  private static checkRepo(repo: string): void {
    if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(repo) || repo.includes("..")) throw new Error("repo must be owner/name");
  }

  async listPullRequests(repo: string, state: "open" | "closed" | "all" = "open") {
    GitHubIntegration.checkRepo(repo);
    const d = await getJson("github", `${this.apiUrl}/repos/${repo}/pulls?state=${state}&per_page=30`, this.headers());
    return (d as any[]).map((p) => ({ number: p.number, title: p.title, author: p.user?.login, url: p.html_url }));
  }

  async listIssues(repo: string) {
    GitHubIntegration.checkRepo(repo);
    const d = await getJson("github", `${this.apiUrl}/repos/${repo}/issues?state=open&per_page=30`, this.headers());
    return (d as any[]).filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, url: i.html_url }));
  }

  tools(): ToolDefinition[] {
    const repoProp = { repo: { type: "string", minLength: 3, maxLength: 140 } };
    return [
      {
        spec: { name: "github_list_prs", description: "List pull requests of a GitHub repository (owner/name).", parameters: { type: "object", properties: { ...repoProp, state: { type: "string", enum: ["open", "closed", "all"] } }, required: ["repo"], additionalProperties: false } },
        handler: ({ repo, state }) => this.listPullRequests(String(repo), (state as "open") ?? "open"),
      },
      {
        spec: { name: "github_list_issues", description: "List open issues of a GitHub repository (owner/name).", parameters: { type: "object", properties: repoProp, required: ["repo"], additionalProperties: false } },
        handler: ({ repo }) => this.listIssues(String(repo)),
      },
    ];
  }
}
