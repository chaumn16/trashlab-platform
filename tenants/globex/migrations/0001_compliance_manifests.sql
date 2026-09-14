-- Globex only. Lives in Globex's own database; no other tenant has this table.
-- Prefixed t_ so core can distinguish tenant tables from its own.
CREATE TABLE IF NOT EXISTS t_compliance_manifests (
  id          text PRIMARY KEY,
  job_id      text NOT NULL,
  epa_code    text NOT NULL,
  filed_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS t_compliance_manifests_job_idx
  ON t_compliance_manifests (job_id);
