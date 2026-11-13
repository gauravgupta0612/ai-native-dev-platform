import { ModelRouter, PolicyGuardrails } from "../../common/typescript/src";

export interface CodeBlock {
  language: string;
  code: string;
}

/** Pulls ``` fenced code blocks out of a model answer. */
export function extractCodeBlocks(text: string): CodeBlock[] {
  const out: CodeBlock[] = [];
  const re = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g;
  for (const m of text.matchAll(re)) out.push({ language: (m[1] || "text").toLowerCase(), code: m[2].replace(/\s+$/, "") + "\n" });
  return out;
}

export interface GenerateOptions {
  language: string;
  /** Existing code to change (refactor / fix). */
  existingCode?: string;
  /** Extra rules: style guide, framework, naming. */
  conventions?: string;
  temperature?: number;
}

/**
 * Code generation helpers: generate, explain, refactor, write tests, add docs.
 * Inputs are secret-masked before sending; generated code is returned as text for the user to review
 * (nothing is written or executed automatically).
 */
export class CodeGenerator {
  constructor(private readonly router: ModelRouter, private readonly guardrails = new PolicyGuardrails()) {}

  private async ask(system: string, user: string, temperature = 0.2): Promise<string> {
    const res = await this.router.chat(
      { messages: [{ role: "system", content: system }, { role: "user", content: this.guardrails.redact(user) }], temperature, maxTokens: 4096 },
      { task: "code-generation" },
    );
    return res.content;
  }

  async generate(instruction: string, opts: GenerateOptions): Promise<{ answer: string; code?: CodeBlock }> {
    const system = [
      `You write production-quality ${opts.language} code.`,
      "Return one fenced code block with the complete code, then at most 5 short bullet notes.",
      "Never include real credentials; read secrets from configuration.",
      opts.conventions ? `Follow these conventions:\n${opts.conventions}` : "",
    ].filter(Boolean).join("\n");
    const user = opts.existingCode ? `${instruction}\n\nExisting code:\n\`\`\`${opts.language}\n${opts.existingCode}\n\`\`\`` : instruction;
    const answer = await this.ask(system, user, opts.temperature);
    return { answer, code: extractCodeBlocks(answer)[0] };
  }

  explain(code: string, language: string): Promise<string> {
    return this.ask("Explain code clearly for a developer: purpose, flow, inputs/outputs, risks. Use short sections.", `\`\`\`${language}\n${code}\n\`\`\``);
  }

  refactor(code: string, language: string, goal = "readability and maintainability"): Promise<{ answer: string; code?: CodeBlock }> {
    return this.generate(`Refactor for ${goal}. Keep behaviour identical.`, { language, existingCode: code });
  }

  writeTests(code: string, language: string, framework: string): Promise<{ answer: string; code?: CodeBlock }> {
    return this.generate(`Write ${framework} unit tests covering normal cases, edge cases and errors.`, { language, existingCode: code });
  }

  addDocs(code: string, language: string): Promise<{ answer: string; code?: CodeBlock }> {
    return this.generate("Add doc comments to every public function/class. Do not change logic.", { language, existingCode: code });
  }

  /** Free-format RPG conversion helper for IBM i projects. */
  convertRpgToFree(fixedFormatCode: string): Promise<{ answer: string; code?: CodeBlock }> {
    return this.generate("Convert this fixed-format RPG to fully free-format RPGLE (**FREE). Keep behaviour identical.", { language: "rpgle", existingCode: fixedFormatCode });
  }
}
