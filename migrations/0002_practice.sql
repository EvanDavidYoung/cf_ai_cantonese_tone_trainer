-- Practice time per user per local calendar day, in milliseconds.
CREATE TABLE practice (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  ms      INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
