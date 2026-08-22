import { Database } from 'sqlite-napi';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { isWorkflowGraph } from '../automation/graph.ts';
import type { WorkflowGraph } from '../automation/types.ts';

interface WorkflowRow {
  id: string;
  name: string;
  enabled: number;
  graph_json: string;
  created_at: number;
  updated_at: number;
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

  constructor(dbPath?: string) {
    const defaultPath = join(process.cwd(), 'data', 'tiktok-automation.db');
    const resolvedPath = dbPath || defaultPath;
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
