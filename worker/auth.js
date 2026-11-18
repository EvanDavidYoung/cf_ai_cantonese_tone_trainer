// Deliberately minimal auth: any non-empty username/password is accepted.
// Passwords are still salted + hashed (PBKDF2) so they never sit in the DB as plain text.

const ITERATIONS = 100_000; // Workers' PBKDF2 maximum
const enc = new TextEncoder();

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

async function derive(password, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    key,
    256,
  );
  return toHex(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await derive(password, salt), salt: toHex(salt) };
}

export async function verifyPassword(password, hash, salt) {
  return (await derive(password, fromHex(salt))) === hash;
}

export function newToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}
