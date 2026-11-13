import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { tempDir, write } from "../helpers";
import { VectorStore } from "../../knowledge-data/vector-store";
import { CodeIndex, extractSymbols } from "../../knowledge-data/code-index";
import { KnowledgeGraph } from "../../knowledge-data/knowledge-graph";
import { ProjectDatabase } from "../../knowledge-data/project-database";

test("vector store: search ranks the relevant text first and persists", async () => {
  const vs = new VectorStore<{ kind: string }>();
  await vs.upsert([
    { id: "1", text: "calculate invoice total with tax", metadata: { kind: "a" } },
    { id: "2", text: "render the login page html form", metadata: { kind: "b" } },
  ]);
  assert.equal((await vs.search("invoice tax total", 1))[0].id, "1");
  const file = path.join(tempDir(), "vs.json");
  vs.save(file);
  const vs2 = new VectorStore<{ kind: string }>();
  vs2.load(file);
  assert.equal(vs2.size, 2);
});

test("code index: symbols (TS, Java, Python, RPG) and semantic search", async () => {
  assert.deepEqual(extractSymbols("x.rpgle", "dcl-proc CalcTax;\nend-proc;").map((s) => s.name), ["CalcTax"]);
  const root = tempDir();
  write(root, "src/tax.ts", "export function calculateTax(amount: number) {\n  return amount * 0.2;\n}\n");
  write(root, "src/Login.java", "public class LoginController {\n  public void login(String user) {\n  }\n}\n");
  write(root, "app.py", "def send_email(to):\n    pass\n");
  const idx = new CodeIndex();
  const chunks = await idx.indexFiles(root, ["src/tax.ts", "src/Login.java", "app.py"]);
  assert.equal(chunks, 3);
  assert.equal(idx.findSymbol("calculateTax")[0].file, "src/tax.ts");
  assert.equal(idx.findSymbol("LoginController")[0].kind, "class");
  assert.equal((await idx.search("tax amount calculation", 1))[0].metadata.file, "src/tax.ts");
});

test("knowledge graph: imports, impact analysis, path, json round-trip", async () => {
  const root = tempDir();
  write(root, "src/a.ts", 'import { b } from "./b";\nexport function a() { return b(); }\n');
  write(root, "src/b.ts", 'import { c } from "./c";\nexport function b() { return c(); }\n');
  write(root, "src/c.ts", "export function c() { return 1; }\n");
  const files = ["src/a.ts", "src/b.ts", "src/c.ts"];
  const idx = new CodeIndex();
  await idx.indexFiles(root, files);
  const g = new KnowledgeGraph();
  g.buildFromCode(root, files, idx.allSymbols());
  const impact = g.impactOf("file:src/c.ts").map((n) => n.id).sort();
  assert.deepEqual(impact, ["file:src/a.ts", "file:src/b.ts"]);
  assert.deepEqual(g.path("file:src/a.ts", "file:src/c.ts"), ["file:src/a.ts", "file:src/b.ts", "file:src/c.ts"]);
  assert.equal(KnowledgeGraph.fromJSON(g.toJSON()).nodeCount, g.nodeCount);
});

test("project database: migrations, CRUD, persistence", () => {
  const file = path.join(tempDir(), "db.json");
  const db = new ProjectDatabase(file);
  assert.equal(db.schemaVersion, 2);
  const conv = db.table("conversations").insert({ projectRoot: "/p", title: "Hello", createdAt: "t", updatedAt: "t" });
  db.table("conversations").update(conv.id, { title: "Renamed" });
  const db2 = new ProjectDatabase(file);
  assert.equal(db2.table("conversations").get(conv.id)?.title, "Renamed");
  assert.equal(db2.table("settings").get("theme")?.value, "dark");
  assert.equal(db2.table("conversations").delete(conv.id), true);
});
