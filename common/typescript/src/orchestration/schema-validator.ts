/**
 * Lightweight JSON-Schema checker for tool arguments (type, required, enum, string length,
 * number range, nested objects/arrays, additionalProperties:false). Returns a list of problems.
 */
export function validateArgs(schema: Record<string, any> | undefined, value: unknown, path = "args"): string[] {
  if (!schema || typeof schema !== "object") return [];
  const errors: string[] = [];
  const type = schema.type as string | undefined;

  const typeOk = (t: string): boolean => {
    switch (t) {
      case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
      case "array": return Array.isArray(value);
      case "string": return typeof value === "string";
      case "integer": return typeof value === "number" && Number.isInteger(value);
      case "number": return typeof value === "number" && Number.isFinite(value);
      case "boolean": return typeof value === "boolean";
      case "null": return value === null;
      default: return true;
    }
  };
  if (type && !typeOk(type)) return [`${path}: expected ${type}`];
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${JSON.stringify(schema.enum)}`);

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
  }
  if (type === "object" && value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const req of (schema.required as string[] | undefined) ?? []) {
      if (obj[req] === undefined) errors.push(`${path}.${req}: is required`);
    }
    const props = (schema.properties ?? {}) as Record<string, any>;
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) errors.push(...validateArgs(props[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${k}: unexpected property`);
    }
  }
  if (type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...validateArgs(schema.items, item, `${path}[${i}]`)));
  }
  return errors;
}
