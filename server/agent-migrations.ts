import type { Pool } from 'pg';
import { AgentError } from '../shared/agent-contracts.ts';

/** Separate namespace: this migration never alters existing application tables. */
export async function migrateAgentSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(1096434004, 1)');
    await client.query('CREATE SCHEMA IF NOT EXISTS azat_agent');
    await client.query(`CREATE TABLE IF NOT EXISTS azat_agent.migrations (
      version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    const versions = await client.query<{ version: number }>('SELECT version FROM azat_agent.migrations ORDER BY version');
    if (versions.rows.some(row => row.version !== 1)) throw new AgentError('The agent database schema requires a compatible application version.', 503, 'AGENT_STORE_UNAVAILABLE');
    if (!versions.rows.length) {
      await client.query(`CREATE TABLE azat_agent.projects (
        id uuid PRIMARY KEY, name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )`);
      await client.query(`CREATE TABLE azat_agent.runs (
        id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES azat_agent.projects(id),
        revision integer NOT NULL CHECK (revision > 0), status text NOT NULL,
        data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
        lease_owner text, lease_until timestamptz, fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CHECK ((lease_owner IS NULL) = (lease_until IS NULL)),
        CHECK (status IN ('queued','running','waiting-approval','waiting-input','paused','failed','cancelled','completed')),
        CHECK (data->>'id' = id::text), CHECK (data->>'projectId' = project_id::text),
        CHECK ((data->>'revision')::integer = revision), CHECK (data->>'status' = status)
      )`);
      await client.query('CREATE INDEX agent_runs_project_updated ON azat_agent.runs(project_id, updated_at DESC)');
      await client.query('CREATE INDEX agent_runs_live_lease ON azat_agent.runs(lease_until) WHERE lease_owner IS NOT NULL');
      await client.query(`CREATE TABLE azat_agent.events (
        id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES azat_agent.runs(id),
        revision integer NOT NULL CHECK (revision > 0), type text NOT NULL, message text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE (run_id, revision)
      )`);
      await client.query('INSERT INTO azat_agent.migrations(version) VALUES (1)');
    }
    await client.query('COMMIT');
  } catch (issue) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the safe original category. */ }
    throw issue;
  } finally { client.release(); }
}
