CREATE TABLE runner_executions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
 run_id TEXT NOT NULL UNIQUE REFERENCES runs(id), grant_id TEXT NOT NULL REFERENCES grants(id),
 claim_id TEXT NOT NULL UNIQUE, scope_id TEXT NOT NULL REFERENCES resources(id),
 state TEXT NOT NULL CHECK(state IN ('starting','running','stopping','succeeded','stopped','failed','unknown')),
 fingerprint TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE TABLE runner_events (
 execution_id TEXT NOT NULL REFERENCES runner_executions(id), seq INTEGER NOT NULL CHECK(seq BETWEEN 1 AND 256),
 fingerprint TEXT NOT NULL, frame TEXT NOT NULL CHECK(json_valid(frame)), ack TEXT NOT NULL CHECK(json_valid(ack)),
 PRIMARY KEY(execution_id,seq)
);
