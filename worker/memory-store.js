// In-memory store with the same interface as D1Store. Used by tests.

export class MemoryStore {
  users = [];
  sessions = new Map();
  attempts = new Map();

  async createUser(username, passwordHash, salt) {
    if (this.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return null;
    const id = this.users.length + 1;
    this.users.push({ id, username, password_hash: passwordHash, salt });
    return id;
  }

  async getUserByName(username) {
    return this.users.find((u) => u.username.toLowerCase() === username.toLowerCase()) ?? null;
  }

  async createSession(token, userId) {
    this.sessions.set(token, userId);
  }

  async getUserById(id) {
    const u = this.users.find((x) => x.id === id);
    return u ? { id: u.id, username: u.username } : null;
  }

  async getSessionUser(token) {
    const id = this.sessions.get(token);
    const u = this.users.find((x) => x.id === id);
    return u ? { id: u.id, username: u.username } : null;
  }

  async deleteSession(token) {
    this.sessions.delete(token);
  }

  async addAttempts(userId, attempts) {
    const list = this.attempts.get(userId) ?? [];
    list.push(...attempts.map((a) => structuredClone(a)));
    this.attempts.set(userId, list);
  }

  async listAttempts(userId) {
    return structuredClone(this.attempts.get(userId) ?? []);
  }

  async countAttempts(userId) {
    return (this.attempts.get(userId) ?? []).length;
  }

  async listActiveUserIdsSince(sinceIso) {
    return [...this.attempts]
      .filter(([, list]) => list.some((a) => a.at >= sinceIso))
      .map(([id]) => id)
      .sort((a, b) => a - b);
  }

  practice = new Map();

  async addPractice(userId, entries) {
    const days = this.practice.get(userId) ?? {};
    for (const { day, ms } of entries) days[day] = (days[day] ?? 0) + ms;
    this.practice.set(userId, days);
  }

  async listPractice(userId) {
    const days = this.practice.get(userId) ?? {};
    return Object.fromEntries(Object.keys(days).sort().map((d) => [d, days[d]]));
  }

  chat = new Map();

  async addChat(userId, messages) {
    const list = this.chat.get(userId) ?? [];
    const at = new Date().toISOString();
    list.push(...messages.map(({ role, content }) => ({ role, content, at })));
    this.chat.set(userId, list);
  }

  async listChat(userId, limit) {
    return structuredClone((this.chat.get(userId) ?? []).slice(-limit));
  }

  async countChatSince(userId, sinceIso) {
    return (this.chat.get(userId) ?? []).filter((m) => m.role === "user" && m.at >= sinceIso).length;
  }

  async clearChat(userId) {
    this.chat.delete(userId);
  }

  digests = new Map();

  async addDigest(userId, { day, markdown, notes = "", weights }) {
    const list = this.digests.get(userId) ?? [];
    list.push(structuredClone({ day, markdown, notes, weights, createdAt: new Date().toISOString() }));
    this.digests.set(userId, list);
  }

  async latestDigest(userId) {
    const d = (this.digests.get(userId) ?? []).at(-1);
    return d ? structuredClone(d) : null;
  }
}
