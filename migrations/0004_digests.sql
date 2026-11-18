-- Learner digests written by the DigestWorkflow (worker/digest-workflow.js).
-- One row per run; the newest row is the tutor's long-term memory and the
-- source of the scheduler's focus weights. Older rows are kept as a record.
CREATE TABLE digests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  markdown   TEXT NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  weights    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX digests_user ON digests(user_id, id);
CREATE INDEX attempts_at ON attempts(at);
