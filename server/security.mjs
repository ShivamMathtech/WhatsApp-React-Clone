import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const deriveKey = promisify(scrypt);

export const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hex] = stored.split(':');
  const key = await deriveKey(password, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return expected.length === key.length && timingSafeEqual(key, expected);
}

export function cookies(header = '') {
  const parsed = {};
  for (const entry of header.split(';')) {
    const i = entry.indexOf('=');
    if (i < 0) continue;
    try {
      parsed[entry.slice(0, i).trim()] = decodeURIComponent(entry.slice(i + 1).trim());
    } catch {
      /* Malformed cookie ignored. */
    }
  }
  return parsed;
}

export function rateLimiter(limit, windowMs) {
  const entries = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of entries) if (value.until < now) entries.delete(key);
  }, windowMs);
  timer.unref();
  const middleware = (req, res, next) => {
    const key = req.ip;
    let value = entries.get(key);
    if (!value || value.until < Date.now()) {
      value = { count: 0, until: Date.now() + windowMs };
      entries.set(key, value);
    }
    if (++value.count > limit)
      return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    next();
  };
  middleware.close = () => clearInterval(timer);
  return middleware;
}
