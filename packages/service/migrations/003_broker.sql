CREATE TABLE broker_workspaces (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, root TEXT NOT NULL UNIQUE,
 head TEXT NOT NULL, grant_id TEXT REFERENCES grants(id), mode TEXT NOT NULL CHECK(mode='development')
);
CREATE TABLE broker_claims (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES broker_workspaces(id),
 grant_id TEXT NOT NULL REFERENCES grants(id), task_id TEXT NOT NULL REFERENCES resources(id),
 candidate_id TEXT NOT NULL UNIQUE REFERENCES resources(id),
 state TEXT NOT NULL CHECK(state IN ('active','quarantined','released')),
 lease_until INTEGER NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE UNIQUE INDEX broker_task_writer ON broker_claims(project_id,task_id) WHERE state!='released';
CREATE TABLE broker_locks (
 project_id TEXT NOT NULL, path_key TEXT NOT NULL,
 claim_id TEXT NOT NULL REFERENCES broker_claims(id), PRIMARY KEY(project_id,path_key)
);
CREATE TABLE broker_edits (
 action_id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES broker_claims(id),
 phase TEXT NOT NULL CHECK(phase IN ('prepared','files_applied','checkpointed')),
 fingerprint TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE UNIQUE INDEX broker_pending_edit ON broker_edits(claim_id) WHERE phase!='checkpointed';

