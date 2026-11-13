import { redactSecrets } from "../../common/typescript/src";

export type Sensitivity = "public" | "internal" | "confidential" | "restricted";

export interface Finding {
  type: string;
  count: number;
}

export interface Classification {
  level: Sensitivity;
  findings: Finding[];
  /** True when the content should stay on a local model (route with { sensitive: true }). */
  keepLocal: boolean;
}

const luhn = (digits: string): boolean => {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return digits.length >= 13 && sum % 10 === 0;
};

interface Detector {
  type: string;
  level: Sensitivity;
  pattern: RegExp;
  validate?: (m: string) => boolean;
}

const DETECTORS: Detector[] = [
  { type: "credit-card", level: "restricted", pattern: /\b(?:\d[ -]?){13,19}\b/g, validate: (m) => luhn(m.replace(/\D/g, "")) },
  { type: "iban", level: "restricted", pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g },
  { type: "email", level: "confidential", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { type: "phone", level: "confidential", pattern: /(?<![\w+])\+\d{1,3}(?:[ .-]?\(?\d\)?){8,12}(?!\w)/g }, // international, e.g. +33 6 12 34 56 78
  { type: "phone", level: "confidential", pattern: /\b\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g }, // 555-123-4567
  { type: "ipv4", level: "internal", pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
];

const ORDER: Sensitivity[] = ["public", "internal", "confidential", "restricted"];

/**
 * Finds personal and confidential data (cards with Luhn check, IBAN, e-mail, phone, IP, secrets),
 * rates the text, and masks it. Use classify() to decide whether data may go to a cloud model.
 */
export class DataPrivacy {
  constructor(private readonly keepLocalFrom: Sensitivity = "confidential") {}

  classify(text: string): Classification {
    const findings: Finding[] = [];
    let level: Sensitivity = "public";
    const raise = (l: Sensitivity) => { if (ORDER.indexOf(l) > ORDER.indexOf(level)) level = l; };

    const secretsMasked = redactSecrets(text, false);
    if (secretsMasked !== text) {
      findings.push({ type: "secret", count: (secretsMasked.match(/xxxx/g) ?? []).length - (text.match(/xxxx/g) ?? []).length });
      raise("restricted");
    }
    for (const d of DETECTORS) {
      const matches = (text.match(d.pattern) ?? []).filter((m) => !d.validate || d.validate(m));
      if (matches.length) {
        findings.push({ type: d.type, count: matches.length });
        raise(d.level);
      }
    }
    return { level, findings, keepLocal: ORDER.indexOf(level) >= ORDER.indexOf(this.keepLocalFrom) };
  }

  /** Masks secrets and personal data with "xxxx". */
  mask(text: string): string {
    let out = redactSecrets(text, true);
    for (const d of DETECTORS) {
      if (d.type === "email") continue; // already masked by redactSecrets
      out = out.replace(d.pattern, (m) => (!d.validate || d.validate(m) ? "xxxx" : m));
    }
    return out;
  }
}
