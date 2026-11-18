// D1 (SQLite) implementation of the store interface. Schema: migrations/.

export class D1Store {
  constructor(db) {
    this.db = db;
  }

  async createUser(username, passwordHash, salt) {
    const row = await this.db
      .prepare("INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING id")
      .bind(username, passwordHash, salt)
      .first();
    return row ? row.id : null;
  }

  getUserByName(username) {
    return this.db
      .prepare("SELECT id, username, password_hash, salt FROM users WHERE username = ?")
      .bind(username)
      .first();
  }

  async createSession(token, userId) {
    await this.db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").bind(token, userId).run();
  }

  getUserById(id) {
    return this.db.prepare("SELECT id, username FROM users WHERE id = ?").bind(id).first();
  }

  getSessionUser(token) {
    return this.db
      .prepare("SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?")
      .bind(token)
      .first();
  }

  async deleteSession(token) {
    await this.db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  }

  async addAttempts(userId, attempts) {
    const stmt = this.db.prepare("INSERT INTO attempts (user_id, at, word, data) VALUES (?, ?, ?, ?)");
    for (let i = 0; i < attempts.length; i += 500) {
      await this.db.batch(
        attempts.slice(i, i + 500).map((a) => stmt.bind(userId, a.at, a.word, JSON.stringify(a))),
      );
    }
  }

  async listAttempts(userId) {
    const { results } = await this.db
      .prepare("SELECT data FROM attempts WHERE user_id = ? ORDER BY id")
      .bind(userId)
      .all();
    return results.map((r) => JSON.parse(r.data));
  }

  async countAttempts(userId) {
    const row = await this.db.prepare("SELECT count(*) AS n FROM attempts WHERE user_id = ?").bind(userId).first();
    return row.n;
  }

  async listActiveUserIdsSince(sinceIso) {
    const { results } = await this.db
      .prepare("SELECT DISTINCT user_id FROM attempts WHERE at >= ? ORDER BY user_id")
      .bind(sinceIso)
      .all();
    return results.map((r) => r.user_id);
  }

  async addPractice(userId, entries) {
    const stmt = this.db.prepare(
      "INSERT INTO practice (user_id, day, ms) VALUES (?, ?, ?) " +
        "ON CONFLICT (user_id, day) DO UPDATE SET ms = ms + excluded.ms",
    );
    await this.db.batch(entries.map((e) => stmt.bind(userId, e.day, e.ms)));
  }

  async listPractice(userId) {
    const { results } = await this.db
      .prepare("SELECT day, ms FROM practice WHERE user_id = ? ORDER BY day")
      .bind(userId)
      .all();
    return Object.fromEntries(results.map((r) => [r.day, r.ms]));
  }

  async addChat(userId, messages) {
    const stmt = this.db.prepare("INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)");
    await this.db.batch(messages.map((m) => stmt.bind(userId, m.role, m.content)));
  }

  async listChat(userId, limit) {
    const { results } = await this.db
      .prepare(
        "SELECT role, content, created_at AS at FROM " +
          "(SELECT * FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id",
      )
      .bind(userId, limit)
      .all();
    return results;
  }

  async countChatSince(userId, sinceIso) {
    const row = await this.db
      .prepare("SELECT count(*) AS n FROM chat_messages WHERE user_id = ? AND role = 'user' AND created_at >= ?")
      .bind(userId, sinceIso)
      .first();
    return row.n;
  }

  async clearChat(userId) {
    await this.db.prepare("DELETE FROM chat_messages WHERE user_id = ?").bind(userId).run();
  }

  async addDigest(userId, { day, markdown, notes = "", weights }) {
    await this.db
      .prepare("INSERT INTO digests (user_id, day, markdown, notes, weights) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, day, markdown, notes, JSON.stringify(weights))
      .run();
  }

  async latestDigest(userId) {
    const row = await this.db
      .prepare(
        "SELECT day, markdown, notes, weights, created_at AS createdAt FROM digests " +
          "WHERE user_id = ? ORDER BY id DESC LIMIT 1",
      )
      .bind(userId)
      .first();
    return row ? { ...row, weights: JSON.parse(row.weights) } : null;
  }
}
