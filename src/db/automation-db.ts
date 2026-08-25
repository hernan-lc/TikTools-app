import { Database } from 'sqlite-napi';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { isWorkflowGraph } from '../automation/graph.ts';
import { normalizeAction, normalizeEvent, normalizeUnresolvedAction } from '../automation/behavior/schema.ts';
import type { ActionRegistry } from '../automation/behavior/action-registry.ts';
import type { LiveAction, LiveEvent } from '../automation/behavior/types.ts';
import type { WorkflowGraph } from '../automation/types.ts';
import { resolveDatabasePath } from './legacy-migration.ts';

interface WorkflowRow {
  id: string;
  name: string;
  enabled: number;
  graph_json: string;
  created_at: number;
  updated_at: number;
}

interface BehaviorRow {
  id: string;
  name: string;
  enabled: number;
  payload_json: string;
  created_at: number;
  updated_at: number;
}

interface PluginStateRow {
  id: string;
  installed: number;
  enabled: number;
}

export interface PluginStateRecord {
  id: string;
  installed: boolean;
  enabled: boolean;
}

export interface WorkflowRecord {
  id: string;
  name: string;
  enabled: boolean;
  graph: WorkflowGraph;
  createdAt: number;
  updatedAt: number;
}

export class AutomationDatabase {
  private readonly db: Database;
  private readonly actionRegistry?: ActionRegistry;

  constructor(dbPath?: string, actionRegistry?: ActionRegistry) {
    this.actionRegistry = actionRegistry;
    const resolvedPath = resolveDatabasePath('tiktok-automation.db', dbPath);
    const directory = dirname(resolvedPath);
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
    this.db = new Database(resolvedPath);
    this.initTables();
  }

  listWorkflows(): WorkflowRecord[] {
    const rows = this.db.query(`
      SELECT id, name, enabled, graph_json, created_at, updated_at
      FROM automation_workflows
      ORDER BY updated_at DESC, name ASC
    `).all([]) as WorkflowRow[];
    return rows.map((row) => this.fromRow(row));
  }

  getWorkflow(id: string): WorkflowRecord | null {
    const row = this.db.query(`
      SELECT id, name, enabled, graph_json, created_at, updated_at
      FROM automation_workflows
      WHERE id = ?
    `).get([id]) as WorkflowRow | null;
    return row ? this.fromRow(row) : null;
  }

  saveWorkflow(graph: WorkflowGraph): WorkflowRecord {
    const now = Date.now();
    const existing = this.getWorkflow(graph.id);
    const createdAt = existing?.createdAt ?? now;
    this.db.query(`
      INSERT INTO automation_workflows (id, name, enabled, graph_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        enabled = excluded.enabled,
        graph_json = excluded.graph_json,
        updated_at = excluded.updated_at
    `).run([
      graph.id,
      graph.name,
      graph.enabled ? 1 : 0,
      JSON.stringify(graph),
      createdAt,
      now,
    ]);
    const saved = this.getWorkflow(graph.id);
    if (!saved) throw new Error(`Workflow was not saved: ${graph.id}`);
    return saved;
  }

  setWorkflowEnabled(id: string, enabled: boolean): WorkflowRecord {
    const existing = this.getWorkflow(id);
    if (!existing) throw new Error(`Unknown workflow: ${id}`);
    const graph: WorkflowGraph = { ...existing.graph, enabled };
    return this.saveWorkflow(graph);
  }

  deleteWorkflow(id: string): boolean {
    const result = this.db.query('DELETE FROM automation_workflows WHERE id = ?').run([id]);
    return result.changes > 0;
  }

  listActions(): LiveAction[] {
    return this.readAll('behavior_actions', (value) => {
      try {
        return normalizeAction(value, this.actionRegistry);
      } catch {
        // Keep a saved action visible when its plugin is currently missing.
        return normalizeUnresolvedAction(value);
      }
    });
  }

  saveAction(action: LiveAction): LiveAction {
    this.writeRow('behavior_actions', action.id, action.name, action.enabled, action);
    return action;
  }

  setActionEnabled(id: string, enabled: boolean): LiveAction {
    const action = this.listActions().find((entry) => entry.id === id);
    if (!action) throw new Error(`Unknown action: ${id}`);
    return this.saveAction({ ...action, enabled });
  }

  deleteAction(id: string): boolean {
    const result = this.db.query('DELETE FROM behavior_actions WHERE id = ?').run([id]);
    if (result.changes > 0) {
      // An event must never keep pointing at an action that no longer exists.
      for (const event of this.listEvents()) {
        if (!event.actionIds.includes(id)) continue;
        this.saveEvent({ ...event, actionIds: event.actionIds.filter((entry) => entry !== id) });
      }
    }
    return result.changes > 0;
  }

  listEvents(): LiveEvent[] {
    return this.readAll('behavior_events', (value) => normalizeEvent(value));
  }

  saveEvent(event: LiveEvent): LiveEvent {
    this.writeRow('behavior_events', event.id, event.name, event.enabled, event);
    return event;
  }

  setEventEnabled(id: string, enabled: boolean): LiveEvent {
    const event = this.listEvents().find((entry) => entry.id === id);
    if (!event) throw new Error(`Unknown event: ${id}`);
    return this.saveEvent({ ...event, enabled });
  }

  deleteEvent(id: string): boolean {
    const result = this.db.query('DELETE FROM behavior_events WHERE id = ?').run([id]);
    return result.changes > 0;
  }

  listPluginStates(): PluginStateRecord[] {
    const rows = this.db.query('SELECT id, installed, enabled FROM behavior_plugins').all([]) as PluginStateRow[];
    return rows.map((row) => ({
      id: row.id,
      installed: Boolean(row.installed),
      enabled: Boolean(row.enabled),
    }));
  }

  setPluginState(id: string, installed: boolean, enabled: boolean): PluginStateRecord {
    this.db.query(`
      INSERT INTO behavior_plugins (id, installed, enabled, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        installed = excluded.installed,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `).run([id, installed ? 1 : 0, enabled ? 1 : 0, Date.now()]);
    return { id, installed, enabled };
  }

  private readAll<T>(table: string, parse: (value: unknown) => T): T[] {
    const rows = this.db.query(`
      SELECT id, name, enabled, payload_json, created_at, updated_at
      FROM ${table}
      ORDER BY updated_at DESC, name ASC
    `).all([]) as BehaviorRow[];

    const records: T[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.payload_json) as unknown;
        records.push(parse({ ...(parsed as object), enabled: Boolean(row.enabled) }));
      } catch (error) {
        console.warn(`[behavior] ${table}/${row.id} was skipped:`, error);
      }
    }
    return records;
  }

  private writeRow(table: string, id: string, name: string, enabled: boolean, payload: unknown): void {
    const now = Date.now();
    const existing = this.db.query(`SELECT created_at FROM ${table} WHERE id = ?`).get([id]) as { created_at: number } | null;
    this.db.query(`
      INSERT INTO ${table} (id, name, enabled, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        enabled = excluded.enabled,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run([id, name, enabled ? 1 : 0, JSON.stringify(payload), existing?.created_at ?? now, now]);
  }

  private initTables(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS automation_workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        graph_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    for (const table of ['behavior_actions', 'behavior_events']) {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS ${table} (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 0,
          payload_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
    }
    this.db.run(`
      CREATE TABLE IF NOT EXISTS behavior_plugins (
        id TEXT PRIMARY KEY,
        installed INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  private fromRow(row: WorkflowRow): WorkflowRecord {
    const graph = parseWorkflowGraph(row.graph_json);
    return {
      id: row.id,
      name: row.name,
      enabled: Boolean(row.enabled),
      graph: { ...graph, enabled: Boolean(row.enabled) },
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
}

function parseWorkflowGraph(raw: string): WorkflowGraph {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Stored automation workflow contains invalid JSON.');
  }
  if (!isWorkflowGraph(value)) throw new Error('Stored automation workflow has an invalid graph shape.');
  return value;
}

export function emptyWorkflowGraph(id: string, name: string): WorkflowGraph {
  return {
    schemaVersion: 1,
    id,
    name,
    enabled: false,
    nodes: [],
    edges: [],
  };
}
