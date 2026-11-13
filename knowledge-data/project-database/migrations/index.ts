import type { DatabaseData } from "../index";

export interface Migration {
  version: number;
  name: string;
  up(db: DatabaseData): void;
}

/** Ordered schema changes. Add new ones at the end; never edit an applied migration. */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial tables",
    up(db) {
      db.tables.conversations ??= {};
      db.tables.messages ??= {};
      db.tables.agentRuns ??= {};
      db.tables.settings ??= {};
    },
  },
  {
    version: 2,
    name: "default settings",
    up(db) {
      db.tables.settings["telemetry"] ??= { id: "telemetry", value: false };
      db.tables.settings["theme"] ??= { id: "theme", value: "dark" };
    },
  },
];
