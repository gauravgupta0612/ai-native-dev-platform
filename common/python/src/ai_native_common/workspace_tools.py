"""Safe file tools confined to one workspace folder: read_file, list_files, search_text and (optionally) write_file.

Blocks path traversal (../), absolute paths outside the root, symlink escapes and secret files (.env, keys...).
"""
from __future__ import annotations

import os
import re
from typing import Any, Dict, Iterator, List, Optional, Pattern

from .tools import ToolDefinition
from .types import ToolSpec

DEFAULT_DENIED: List[Pattern[str]] = [re.compile(p, re.I) for p in (
    r"^\.env(\..*)?$", r"\.pem$", r"\.key$", r"\.p12$", r"\.pfx$", r"\.jks$", r"\.keystore$",
    r"^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$", r"^\.npmrc$", r"^\.pypirc$", r"^\.netrc$", r"^\.git-credentials$",
    r"^credentials(\.json)?$", r"^secrets?\.(json|ya?ml|txt)$", r"^\.git$", r"^\.ssh$", r"^\.aws$", r"^node_modules$",
    r"^__pycache__$", r"^\.venv$",
)]


def create_workspace_tools(root: str, allow_write: bool = False, max_file_bytes: int = 1_000_000,
                           max_entries: int = 500, extra_denied: Optional[List[str]] = None) -> List[ToolDefinition]:
    base = os.path.realpath(os.path.abspath(root))
    denied = DEFAULT_DENIED + [re.compile(p, re.I) for p in (extra_denied or [])]

    def is_denied_name(name: str) -> bool:
        return any(p.search(name) for p in denied)

    def inside(path: str) -> bool:
        return path == base or path.startswith(base + os.sep)

    def resolve_safe(user_path: Any, must_exist: bool) -> str:
        if not isinstance(user_path, str) or not user_path.strip():
            raise ValueError("path is required")
        if "\0" in user_path:
            raise ValueError("invalid path")
        abs_path = os.path.abspath(os.path.join(base, user_path))
        if not inside(abs_path):
            raise ValueError("path is outside the workspace")
        rel = os.path.relpath(abs_path, base)
        if rel != "." and any(is_denied_name(part) for part in re.split(r"[\\/]", rel)):
            raise ValueError("access to this file is not allowed")
        if os.path.exists(abs_path):
            if not inside(os.path.realpath(abs_path)):
                raise ValueError("path is outside the workspace (symlink)")
        else:
            if must_exist:
                raise ValueError("file not found")
            parent = os.path.dirname(abs_path)
            while not os.path.exists(parent):
                parent = os.path.dirname(parent)
            if not inside(os.path.realpath(parent)):
                raise ValueError("path is outside the workspace (symlink)")
        return abs_path

    def read_text(path: str) -> str:
        if not os.path.isfile(path):
            raise ValueError("not a file")
        size = os.path.getsize(path)
        if size > max_file_bytes:
            raise ValueError(f"file too large ({size} bytes, limit {max_file_bytes})")
        with open(path, "rb") as fh:
            data = fh.read()
        if b"\0" in data:
            raise ValueError("binary file")
        return data.decode("utf-8", errors="replace")

    def walk(directory: str, depth: int) -> Iterator[str]:
        if depth < 0:
            return
        with os.scandir(directory) as it:
            entries = sorted(it, key=lambda e: e.name)
        for entry in entries:
            if is_denied_name(entry.name) or entry.is_symlink():
                continue
            if entry.is_dir():
                yield entry.path + os.sep
                yield from walk(entry.path, depth - 1)
            else:
                yield entry.path

    def rel_out(path: str) -> str:
        rel = os.path.relpath(path.rstrip(os.sep), base).replace(os.sep, "/")
        return rel + ("/" if path.endswith(os.sep) else "")

    def read_file(args: Dict[str, Any]) -> str:
        text = read_text(resolve_safe(args.get("path"), True))
        if args.get("start_line") is None and args.get("end_line") is None:
            return text
        lines = text.splitlines()
        start = int(args.get("start_line") or 1)
        end = int(args.get("end_line") or len(lines))
        return "\n".join(f"{start + i}: {line}" for i, line in enumerate(lines[start - 1:end]))

    def list_files(args: Dict[str, Any]) -> str:
        directory = resolve_safe(args["path"], True) if args.get("path") else base
        if not os.path.isdir(directory):
            raise ValueError("not a folder")
        out: List[str] = []
        for f in walk(directory, int(args.get("depth", 2))):
            out.append(rel_out(f))
            if len(out) >= max_entries:
                out.append(f"…(limit {max_entries} reached)")
                break
        return "\n".join(out)

    def search_text(args: Dict[str, Any]) -> str:
        directory = resolve_safe(args["path"], True) if args.get("path") else base
        needle = str(args["query"]).lower()
        limit = int(args.get("max_results", 100))
        hits: List[str] = []
        for f in walk(directory, 20):
            if f.endswith(os.sep):
                continue
            try:
                text = read_text(f)
            except (ValueError, OSError):
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if needle in line.lower():
                    hits.append(f"{rel_out(f)}:{i}: {line.strip()[:300]}")
                    if len(hits) >= limit:
                        return "\n".join(hits)
        return "\n".join(hits) if hits else "No matches."

    def write_file(args: Dict[str, Any]) -> str:
        path = resolve_safe(args.get("path"), False)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        content = str(args["content"])
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)
        return f"Wrote {len(content.encode('utf-8'))} bytes to {rel_out(path)}"

    tools = [
        ToolDefinition(ToolSpec("read_file", "Read a UTF-8 text file from the workspace. Optional 1-based start_line/end_line.", {
            "type": "object",
            "properties": {"path": {"type": "string", "minLength": 1},
                           "start_line": {"type": "integer", "minimum": 1},
                           "end_line": {"type": "integer", "minimum": 1}},
            "required": ["path"], "additionalProperties": False}), read_file),
        ToolDefinition(ToolSpec("list_files", "List files and folders in the workspace (folders end with /).", {
            "type": "object",
            "properties": {"path": {"type": "string"}, "depth": {"type": "integer", "minimum": 0, "maximum": 10}},
            "additionalProperties": False}), list_files),
        ToolDefinition(ToolSpec("search_text", "Find lines containing a text (case-insensitive) in workspace files.", {
            "type": "object",
            "properties": {"query": {"type": "string", "minLength": 1, "maxLength": 200}, "path": {"type": "string"},
                           "max_results": {"type": "integer", "minimum": 1, "maximum": 500}},
            "required": ["query"], "additionalProperties": False}), search_text),
    ]
    if allow_write:
        tools.append(ToolDefinition(ToolSpec("write_file", "Create or overwrite a UTF-8 text file in the workspace (needs user approval).", {
            "type": "object",
            "properties": {"path": {"type": "string", "minLength": 1}, "content": {"type": "string", "maxLength": max_file_bytes}},
            "required": ["path", "content"], "additionalProperties": False}), write_file, requires_approval=True))
    return tools
