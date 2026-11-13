"""Lightweight JSON-Schema checker for tool arguments (type, required, enum, lengths, ranges, nesting)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

_TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def validate_args(schema: Optional[Dict[str, Any]], value: Any, path: str = "args") -> List[str]:
    """Returns a list of problems (empty list = valid)."""
    if not isinstance(schema, dict):
        return []
    errors: List[str] = []
    typ = schema.get("type")
    if typ in _TYPES and not _TYPES[typ](value):
        return [f"{path}: expected {typ}"]
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: must be one of {schema['enum']}")
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{path}: shorter than {schema['minLength']}")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errors.append(f"{path}: longer than {schema['maxLength']}")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: below {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"{path}: above {schema['maximum']}")
    if typ == "object" and isinstance(value, dict):
        for req in schema.get("required", []):
            if req not in value:
                errors.append(f"{path}.{req}: is required")
        props = schema.get("properties", {})
        for key, item in value.items():
            if key in props:
                errors += validate_args(props[key], item, f"{path}.{key}")
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}.{key}: unexpected property")
    if typ == "array" and isinstance(value, list) and isinstance(schema.get("items"), dict):
        for i, item in enumerate(value):
            errors += validate_args(schema["items"], item, f"{path}[{i}]")
    return errors
