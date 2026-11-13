import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { MIGRATIONS, Migration } from "./migrations";
import { Tables } from "./models";

export * from "./models";

export interface DatabaseData {
  schemaVersion: number;
  tables: { [K in keyof Tables]: Record<string, Tables[K]> };
}

/** Same API can be implemented on SQLite (local) or PostgreSQL (server); this one needs no dependencies. */
export interface Repository<T extends { id: string }> {
  insert(row: Omit<T, "id"> & { id?: string }): T;
  get(id: string): T | undefined;
  update(id: string, changes: Partial<T>): T;
  delete(id: string): boolean;
  find(where?: (row: T) => boolean): T[];
}

/**
 * File-based project database (JSON, atomic writes, versioned migrations).
 * Stored in <project>/.aiplatform/project-db.json. Swap for SQLite/PostgreSQL by implementing Repository.
 */
export class ProjectDatabase {
  private data: DatabaseData;

  constructor(private readonly file: string, migrations: Migration[] = MIGRATIONS) {
    this.data = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : { schemaVersion: 0, tables: {} as DatabaseData["tables"] };
    this.migrate(migrations);
  }

  get schemaVersion(): number { return this.data.schemaVersion; }

  table<K extends keyof Tables>(name: K): Repository<Tables[K]> {
    const tables = this.data.tables as unknown as Record<string, Record<string, Tables[K]>>;
    const rows = (tables[name as string] ??= {});
    const save = () => this.save();
    return {
      insert: (row) => {
        const id = row.id ?? randomUUID();
        if (rows[id]) throw new Error(`Duplicate id in ${String(name)}: ${id}`);
        const full = { ...row, id } as Tables[K];
        rows[id] = full;
        save();
        return full;
      },
      get: (id) => rows[id],
      update: (id, changes) => {
        if (!rows[id]) throw new Error(`Not found in ${String(name)}: ${id}`);
        rows[id] = { ...rows[id], ...changes, id };
        save();
        return rows[id];
      },
      delete: (id) => {
        const had = id in rows;
        delete rows[id];
        if (had) save();
        return had;
      },
      find: (where) => Object.values(rows).filter((r) => !where || where(r)),
    };
  }

  private migrate(migrations: Migration[]): void {
    const pending = migrations.filter((m) => m.version > this.data.schemaVersion).sort((a, b) => a.version - b.version);
    for (const m of pending) {
      m.up(this.data);
      this.data.schemaVersion = m.version;
    }
    if (pending.length || !fs.existsSync(this.file)) this.save();
  }

  private save(): void {
    fs.mkdirSync(path.dirname(path.resolve(this.file)), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
