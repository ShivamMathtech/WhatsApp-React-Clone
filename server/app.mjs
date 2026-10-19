import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { Server } from 'socket.io';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { openDatabase, transaction } from './db.mjs';
import {
  cookies,
  hashPassword,
  newToken,
  rateLimiter,
  tokenHash,
  verifyPassword,
} from './security.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const fail = (status, message) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};
const field = (min, max) => z.string().trim().min(min).max(max);
const credentials = z.object({
  email: z
    .email()
    .max(200)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(8).max(128),
});
const colors = ['#008069', '#7c69aa', '#b77946', '#497da7', '#c26b80', '#597b5e'];
const safeColor = z.enum(colors);
const room = (id) => `chat:${id}`;
const userRoom = (id) => `user:${id}`;

export function createApplication(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || path.join(ROOT, 'data'));
  const db = openDatabase(dataDir);
  const app = express();
  const server = createServer(app);
  const origins = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    ...(process.env.APP_ORIGIN || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    ...(options.origins || []),
  ]);
  const io = new Server(server, {
    maxHttpBufferSize: 64 * 1024,
    allowRequest: (req, cb) => cb(null, !req.headers.origin || origins.has(req.headers.origin)),
  });
  const online = new Map();
  const callTimers = new Map();
  const callSockets = new Map();
  const authLimiter = rateLimiter(options.test ? 500 : 35, 15 * 60 * 1000);
  const apiLimiter = rateLimiter(options.test ? 5000 : 500, 60 * 1000);
  const uploadLimiter = rateLimiter(options.test ? 100 : 30, 60 * 1000);
  const upload = multer({
    storage: multer.diskStorage({
      destination: path.join(dataDir, 'uploads'),
      filename: (_req, _file, cb) => cb(null, randomUUID()),
    }),
    limits: {
      fileSize: Math.min(100, Number(process.env.MAX_UPLOAD_MB) || 20) * 1024 * 1024,
      files: 1,
    },
  });
  db.prepare("UPDATE calls SET status='ended', ended_at=? WHERE ended_at IS NULL").run(Date.now());
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const member = (chatId, userId) =>
    one('SELECT * FROM members WHERE chat_id=? AND user_id=?', chatId, userId) ||
    fail(403, 'You do not have access to this conversation.');
  const chatRow = (chatId) =>
    one('SELECT * FROM chats WHERE id=?', chatId) || fail(404, 'Conversation not found.');
  const sharesChat = (a, b) =>
    !!one(
      'SELECT 1 FROM members a JOIN members b ON a.chat_id=b.chat_id WHERE a.user_id=? AND b.user_id=?',
      a,
      b,
    );
  const isBlocked = (a, b) =>
    !!one(
      'SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)',
      a,
      b,
      b,
      a,
    );
  const notifyChat = (id) => io.to(room(id)).emit('chats:changed');
  const publicUser = (value) => {
    const u = typeof value === 'string' ? one('SELECT * FROM users WHERE id=?', value) : value;
    if (!u) return null;
    return {
      id: u.id,
      name: u.name,
      about: u.about,
      color: u.color,
      avatar: u.avatar_id ? `/api/files/${u.avatar_id}` : null,
      online: online.has(u.id),
      lastSeen: u.last_seen,
    };
  };
  const fileInfo = (id) => {
    const f = one('SELECT * FROM attachments WHERE id=?', id);
    return f
      ? { id: f.id, name: f.filename, mime: f.mime, size: f.size, url: `/api/files/${f.id}` }
      : null;
  };
  function messageInfo(m, viewer) {
    if (!m) return null;
    const others = all(
      'SELECT * FROM members WHERE chat_id=? AND user_id<>?',
      m.chat_id,
      m.sender_id,
    );
    const status =
      others.length && others.every((x) => x.read_id >= m.id)
        ? 'read'
        : others.length && others.every((x) => x.delivered_id >= m.id)
          ? 'delivered'
          : 'sent';
    const r = m.reply_id ? one('SELECT * FROM messages WHERE id=?', m.reply_id) : null;
    return {
      id: m.id,
      chatId: m.chat_id,
      sender: publicUser(m.sender_id),
      text: m.deleted ? '' : m.text,
      kind: m.deleted ? 'deleted' : m.kind,
      attachment: !m.deleted && m.attachment_id ? fileInfo(m.attachment_id) : null,
      createdAt: m.created_at,
      editedAt: m.edited_at,
      status,
      starred: !!one('SELECT 1 FROM stars WHERE user_id=? AND message_id=?', viewer, m.id),
      reply: r
        ? {
            id: r.id,
            name: publicUser(r.sender_id)?.name,
            text: r.deleted ? 'Deleted message' : r.text || r.kind,
          }
        : null,
    };
  }
  function chatInfo(c, viewer) {
    const mine = member(c.id, viewer);
    const members = all('SELECT user_id FROM members WHERE chat_id=?', c.id).map((m) =>
      publicUser(m.user_id),
    );
    const peer = members.find((u) => u.id !== viewer);
    return {
      id: c.id,
      type: c.type,
      name: c.type === 'group' ? c.name : peer?.name || 'Conversation',
      color: c.type === 'group' ? '#008069' : peer?.color,
      avatar: c.type === 'group' ? null : peer?.avatar,
      ownerId: c.owner_id,
      members,
      peer,
      pinned: !!mine.pinned,
      archived: !!mine.archived,
      muted: !!mine.muted,
      blocked:
        c.type === 'direct' &&
        !!one('SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=?', viewer, peer?.id),
      lastMessage: messageInfo(
        one('SELECT * FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT 1', c.id),
        viewer,
      ),
      unread: one(
        'SELECT COUNT(*) AS n FROM messages WHERE chat_id=? AND sender_id<>? AND id>?',
        c.id,
        viewer,
        mine.read_id,
      ).n,
      createdAt: c.created_at,
    };
  }
  const session = (header) => {
    const token = cookies(header).chat_session;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return one(
      'SELECT s.*, u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>?',
      tokenHash(token),
      Date.now(),
    );
  };
  function issueSession(res, id) {
    const token = newToken();
    run('INSERT INTO sessions VALUES (?,?,?)', tokenHash(token), id, Date.now() + 7 * 86400000);
    res.cookie('chat_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 7 * 86400000,
      path: '/',
    });
  }
  function auth(req, _res, next) {
    req.session = session(req.headers.cookie);
    if (!req.session)
      return next(Object.assign(new Error('Please sign in to continue.'), { status: 401 }));
    req.userId = req.session.user_id;
    next();
  }
  function canChat(req, _res, next) {
    member(req.params.id, req.userId);
    req.chat = chatRow(req.params.id);
    next();
  }
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '40kb' }));
  app.use('/api', apiLimiter, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.headers.origin && !origins.has(req.headers.origin))
      return res.status(403).json({ error: 'This origin is not allowed.' });
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.get('X-Requested-With') !== 'ChatApp'
    )
      return res.status(403).json({ error: 'Missing request verification header.' });
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true, version: '1.0.0' }));
  app.post('/api/auth/register', authLimiter, async (req, res) => {
    const input = credentials.extend({ name: field(2, 60) }).parse(req.body);
    const passwordHash = await hashPassword(input.password);
    if (one('SELECT 1 FROM users WHERE email=?', input.email))
      fail(409, 'An account with that email already exists.');
    const id = randomUUID(),
      now = Date.now();
    run(
      'INSERT INTO users (id,email,password_hash,name,color,last_seen,created_at) VALUES (?,?,?,?,?,?,?)',
      id,
      input.email,
      passwordHash,
      input.name,
      colors[Math.floor(Math.random() * colors.length)],
      now,
      now,
    );
    issueSession(res, id);
    res.status(201).json({ user: { ...publicUser(id), email: input.email } });
  });
  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const { email, password } = credentials.parse(req.body);
    const u = one('SELECT * FROM users WHERE email=?', email);
    const dummy = '0123456789abcdef0123456789abcdef:' + '00'.repeat(64);
    const correct = await verifyPassword(password, u?.password_hash || dummy);
    if (!u || !correct) fail(401, 'Email or password is incorrect.');
    issueSession(res, u.id);
    res.json({ user: { ...publicUser(u), email: u.email } });
  });
  app.get('/api/auth/me', auth, (req, res) =>
    res.json({ user: { ...publicUser(req.userId), email: req.session.email } }),
  );
  app.post('/api/auth/logout', auth, (req, res) => {
    run('DELETE FROM sessions WHERE token_hash=?', req.session.token_hash);
    io.in(`session:${req.session.token_hash}`).disconnectSockets(true);
    res.clearCookie('chat_session', {
      path: '/',
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      httpOnly: true,
    });
    res.json({ ok: true });
  });
  app.get('/api/config', auth, (_req, res) => {
    let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    try {
      if (process.env.ICE_SERVERS_JSON) iceServers = JSON.parse(process.env.ICE_SERVERS_JSON);
    } catch {
      /* Use fallback if environment is malformed. */
    }
    res.json({ iceServers, maxUploadMB: Math.min(100, Number(process.env.MAX_UPLOAD_MB) || 20) });
  });
  app.patch('/api/profile', auth, (req, res) => {
    const input = z
      .object({ name: field(2, 60), about: field(0, 160), color: safeColor })
      .parse(req.body);
    run(
      'UPDATE users SET name=?, about=?, color=? WHERE id=?',
      input.name,
      input.about,
      input.color,
      req.userId,
    );
    all('SELECT chat_id FROM members WHERE user_id=?', req.userId).forEach((c) =>
      notifyChat(c.chat_id),
    );
    res.json({ user: { ...publicUser(req.userId), email: req.session.email } });
  });
  app.post('/api/profile/password', auth, async (req, res) => {
    const p = z
      .object({ current: field(1, 128), password: z.string().min(8).max(128) })
      .parse(req.body);
    const u = one('SELECT * FROM users WHERE id=?', req.userId);
    if (!(await verifyPassword(p.current, u.password_hash)))
      fail(400, 'Your current password is incorrect.');
    run('UPDATE users SET password_hash=? WHERE id=?', await hashPassword(p.password), req.userId);
    run(
      'DELETE FROM sessions WHERE user_id=? AND token_hash<>?',
      req.userId,
      req.session.token_hash,
    );
    for (const s of io.sockets.sockets.values())
      if (s.data.userId === req.userId && s.data.sessionHash !== req.session.token_hash)
        s.disconnect(true);
    res.json({ ok: true });
  });
  app.get('/api/users', auth, (req, res) => {
    const q = String(req.query.q || '')
      .trim()
      .slice(0, 100);
    const rows = q
      ? all(
          'SELECT * FROM users WHERE id<>? AND (instr(lower(name),lower(?))>0 OR lower(email)=lower(?)) ORDER BY name LIMIT 60',
          req.userId,
          q,
          q,
        )
      : all(
          'SELECT DISTINCT u.* FROM users u JOIN members a ON a.user_id=u.id JOIN members b ON b.chat_id=a.chat_id WHERE b.user_id=? AND u.id<>? ORDER BY u.name LIMIT 60',
          req.userId,
          req.userId,
        );
    res.json({ users: rows.map(publicUser) });
  });
  app.get('/api/chats', auth, (req, res) => {
    const chats = all(
      'SELECT c.* FROM chats c JOIN members m ON c.id=m.chat_id WHERE m.user_id=?',
      req.userId,
    ).map((c) => chatInfo(c, req.userId));
    chats.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (b.lastMessage?.createdAt || b.createdAt) - (a.lastMessage?.createdAt || a.createdAt),
    );
    res.json({ chats });
  });
  function joinMembers(chatId, ids) {
    for (const id of ids) {
      run('INSERT OR IGNORE INTO members (chat_id,user_id) VALUES (?,?)', chatId, id);
      for (const s of io.sockets.sockets.values()) if (s.data.userId === id) s.join(room(chatId));
      io.to(userRoom(id)).emit('chats:changed');
    }
  }
  app.post('/api/chats', auth, (req, res) => {
    const input = z
      .object({
        type: z.enum(['direct', 'group']),
        name: field(1, 80).optional(),
        userIds: z.array(z.uuid()).min(1).max(49),
      })
      .parse(req.body);
    const ids = [...new Set([...input.userIds.filter((id) => id !== req.userId), req.userId])];
    if (ids.length < 2 || (input.type === 'direct' && ids.length !== 2))
      fail(400, 'Select the correct number of participants.');
    ids.forEach((id) => {
      if (!one('SELECT 1 FROM users WHERE id=?', id)) fail(404, 'A selected user was not found.');
    });
    let key = null;
    if (input.type === 'direct') {
      const peer = ids.find((id) => id !== req.userId);
      if (isBlocked(req.userId, peer)) fail(403, 'Messaging is unavailable for this contact.');
      key = ids.slice().sort().join(':');
      const existing = one('SELECT * FROM chats WHERE direct_key=?', key);
      if (existing) return res.json({ chat: chatInfo(existing, req.userId) });
    } else if (!input.name) fail(400, 'Give your group a name.');
    const id = randomUUID();
    transaction(db, () => {
      run(
        'INSERT INTO chats VALUES (?,?,?,?,?,?)',
        id,
        input.type,
        input.name || null,
        req.userId,
        key,
        Date.now(),
      );
      for (const uid of ids) run('INSERT INTO members (chat_id,user_id) VALUES (?,?)', id, uid);
    });
    joinMembers(id, ids);
    res.status(201).json({ chat: chatInfo(chatRow(id), req.userId) });
  });
  app.patch('/api/chats/:id', auth, canChat, (req, res) => {
    const input = z
      .object({
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
        muted: z.boolean().optional(),
        name: field(1, 80).optional(),
      })
      .parse(req.body);
    for (const key of ['pinned', 'archived', 'muted'])
      if (input[key] !== undefined)
        run(
          `UPDATE members SET ${key}=? WHERE chat_id=? AND user_id=?`,
          Number(input[key]),
          req.params.id,
          req.userId,
        );
    if (input.name !== undefined) {
      if (req.chat.type !== 'group' || req.chat.owner_id !== req.userId)
        fail(403, 'Only the group admin can rename this group.');
      run('UPDATE chats SET name=? WHERE id=?', input.name, req.params.id);
      notifyChat(req.params.id);
    }
    io.to(userRoom(req.userId)).emit('chats:changed');
    res.json({ chat: chatInfo(chatRow(req.params.id), req.userId) });
  });
  app.post('/api/chats/:id/members', auth, canChat, (req, res) => {
    if (req.chat.type !== 'group' || req.chat.owner_id !== req.userId)
      fail(403, 'Only the group admin can add members.');
    const { userIds } = z.object({ userIds: z.array(z.uuid()).min(1).max(49) }).parse(req.body);
    const existing = all('SELECT user_id FROM members WHERE chat_id=?', req.params.id).map(
      (m) => m.user_id,
    );
    if (new Set([...existing, ...userIds]).size > 50)
      fail(400, 'Groups can contain up to 50 members.');
    userIds.forEach((id) => {
      if (!one('SELECT 1 FROM users WHERE id=?', id)) fail(404, 'User not found.');
    });
    joinMembers(req.params.id, userIds);
    notifyChat(req.params.id);
    res.json({ chat: chatInfo(req.chat, req.userId) });
  });
  app.delete('/api/chats/:id/members/:userId', auth, canChat, (req, res) => {
    if (req.chat.type !== 'group') fail(400, 'This is not a group.');
    const target = req.params.userId;
    if (target !== req.userId && req.chat.owner_id !== req.userId)
      fail(403, 'Only the admin can remove members.');
    member(req.params.id, target);
    transaction(db, () => {
      run('DELETE FROM members WHERE chat_id=? AND user_id=?', req.params.id, target);
      if (req.chat.owner_id === target) {
        const next = one(
          'SELECT user_id FROM members WHERE chat_id=? ORDER BY user_id LIMIT 1',
          req.params.id,
        );
        run('UPDATE chats SET owner_id=? WHERE id=?', next?.user_id || null, req.params.id);
      }
    });
    for (const s of io.sockets.sockets.values())
      if (s.data.userId === target) s.leave(room(req.params.id));
    io.to(userRoom(target)).emit('chats:changed');
    notifyChat(req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/chats/:id/messages', auth, canChat, (req, res) => {
    const before = z.coerce
      .number()
      .int()
      .positive()
      .parse(req.query.before || Number.MAX_SAFE_INTEGER);
    const q = String(req.query.q || '')
      .trim()
      .slice(0, 200);
    const rows = all(
      "SELECT * FROM messages WHERE chat_id=? AND id<? AND (?='' OR (deleted=0 AND instr(lower(text),lower(?))>0)) ORDER BY id DESC LIMIT 61",
      req.params.id,
      before,
      q,
      q,
    );
    const hasMore = rows.length > 60;
    res.json({
      messages: rows
        .slice(0, 60)
        .reverse()
        .map((m) => messageInfo(m, req.userId)),
      hasMore,
    });
  });
  app.post('/api/chats/:id/read', auth, canChat, (req, res) => {
    const { messageId } = z.object({ messageId: z.number().int().nonnegative() }).parse(req.body);
    const max = one('SELECT MAX(id) AS id FROM messages WHERE chat_id=?', req.params.id).id || 0;
    const id = Math.min(messageId, max);
    run(
      'UPDATE members SET read_id=MAX(read_id,?), delivered_id=MAX(delivered_id,?) WHERE chat_id=? AND user_id=?',
      id,
      id,
      req.params.id,
      req.userId,
    );
    io.to(room(req.params.id)).emit('messages:receipts', { chatId: req.params.id });
    io.to(userRoom(req.userId)).emit('chats:changed');
    res.json({ ok: true });
  });
  app.post('/api/chats/:id/messages', auth, canChat, (req, res) => {
    const p = z
      .object({
        text: z.string().trim().max(8000).default(''),
        attachmentId: z.uuid().optional(),
        replyId: z.number().int().positive().optional(),
        clientId: z.uuid(),
      })
      .parse(req.body);
    if (!p.text && !p.attachmentId) fail(400, 'Write a message or attach a file.');
    const previous = one(
      'SELECT * FROM messages WHERE sender_id=? AND client_id=?',
      req.userId,
      p.clientId,
    );
    if (previous) {
      if (previous.chat_id !== req.params.id) fail(409, 'Message key belongs to another chat.');
      return res.json({ message: messageInfo(previous, req.userId) });
    }
    if (req.chat.type === 'direct') {
      const peer = one(
        'SELECT user_id FROM members WHERE chat_id=? AND user_id<>?',
        req.params.id,
        req.userId,
      );
      if (isBlocked(req.userId, peer.user_id))
        fail(403, 'Messaging is unavailable for this contact.');
    }
    let kind = 'text';
    if (p.attachmentId) {
      const file = one(
        'SELECT * FROM attachments WHERE id=? AND owner_id=? AND chat_id=?',
        p.attachmentId,
        req.userId,
        req.params.id,
      );
      if (!file) fail(400, 'Attachment does not belong to this conversation.');
      kind = file.mime.startsWith('image/')
        ? 'image'
        : file.mime.startsWith('audio/')
          ? 'audio'
          : file.mime.startsWith('video/')
            ? 'video'
            : 'file';
    }
    if (
      p.replyId &&
      !one('SELECT 1 FROM messages WHERE id=? AND chat_id=?', p.replyId, req.params.id)
    )
      fail(400, 'Reply must refer to this conversation.');
    const id = Number(
      run(
        'INSERT INTO messages (chat_id,sender_id,text,kind,attachment_id,reply_id,client_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
        req.params.id,
        req.userId,
        p.text,
        kind,
        p.attachmentId || null,
        p.replyId || null,
        p.clientId,
        Date.now(),
      ).lastInsertRowid,
    );
    for (const m of all('SELECT user_id FROM members WHERE chat_id=?', req.params.id))
      if (online.has(m.user_id))
        run(
          'UPDATE members SET delivered_id=? WHERE chat_id=? AND user_id=?',
          id,
          req.params.id,
          m.user_id,
        );
    run(
      'UPDATE members SET read_id=? WHERE chat_id=? AND user_id=?',
      id,
      req.params.id,
      req.userId,
    );
    const message = messageInfo(one('SELECT * FROM messages WHERE id=?', id), req.userId);
    io.to(room(req.params.id)).emit('message:new', { ...message, starred: false });
    notifyChat(req.params.id);
    res.status(201).json({ message });
  });
  function ownMessage(req) {
    const m =
      one('SELECT * FROM messages WHERE id=?', req.params.messageId) ||
      fail(404, 'Message not found.');
    member(m.chat_id, req.userId);
    if (m.sender_id !== req.userId) fail(403, 'You can only change your own messages.');
    return m;
  }
  app.get('/api/messages/:messageId', auth, (req, res) => {
    const m =
      one('SELECT * FROM messages WHERE id=?', req.params.messageId) ||
      fail(404, 'Message not found.');
    member(m.chat_id, req.userId);
    res.json({ message: messageInfo(m, req.userId) });
  });
  app.patch('/api/messages/:messageId', auth, (req, res) => {
    const m = ownMessage(req);
    if (m.deleted || m.kind !== 'text') fail(400, 'Only text messages can be edited.');
    const { text } = z.object({ text: field(1, 8000) }).parse(req.body);
    run('UPDATE messages SET text=?, edited_at=? WHERE id=?', text, Date.now(), m.id);
    io.to(room(m.chat_id)).emit('messages:changed', { chatId: m.chat_id, messageId: m.id });
    notifyChat(m.chat_id);
    res.json({ ok: true });
  });
  app.delete('/api/messages/:messageId', auth, (req, res) => {
    const m = ownMessage(req);
    run("UPDATE messages SET deleted=1, text='' WHERE id=?", m.id);
    io.to(room(m.chat_id)).emit('messages:changed', { chatId: m.chat_id, messageId: m.id });
    notifyChat(m.chat_id);
    res.json({ ok: true });
  });
  app.post('/api/messages/:messageId/star', auth, (req, res) => {
    const m =
      one('SELECT * FROM messages WHERE id=?', req.params.messageId) ||
      fail(404, 'Message not found.');
    member(m.chat_id, req.userId);
    const { starred } = z.object({ starred: z.boolean() }).parse(req.body);
    if (starred) run('INSERT OR IGNORE INTO stars VALUES (?,?)', req.userId, m.id);
    else run('DELETE FROM stars WHERE user_id=? AND message_id=?', req.userId, m.id);
    res.json({ ok: true });
  });
  app.get('/api/starred', auth, (req, res) =>
    res.json({
      messages: all(
        'SELECT m.* FROM messages m JOIN stars s ON s.message_id=m.id JOIN members mb ON mb.chat_id=m.chat_id AND mb.user_id=s.user_id WHERE s.user_id=? AND m.deleted=0 ORDER BY m.id DESC LIMIT 200',
        req.userId,
      ).map((m) => messageInfo(m, req.userId)),
    }),
  );
  app.post('/api/users/:id/block', auth, (req, res) => {
    const { blocked } = z.object({ blocked: z.boolean() }).parse(req.body);
    if (req.params.id === req.userId || !one('SELECT 1 FROM users WHERE id=?', req.params.id))
      fail(400, 'Invalid contact.');
    if (blocked) run('INSERT OR IGNORE INTO blocks VALUES (?,?)', req.userId, req.params.id);
    else run('DELETE FROM blocks WHERE user_id=? AND blocked_id=?', req.userId, req.params.id);
    res.json({ ok: true });
  });

  function saveUpload(req, purpose, chatId = null) {
    const f = req.file;
    if (!f) fail(400, 'Choose a file to upload.');
    try {
      const mime = f.mimetype.split(';')[0].toLowerCase();
      const allowed =
        /^(image\/(jpeg|png|webp|gif)|audio\/(webm|ogg|mpeg|mp4|wav|x-wav)|video\/(mp4|webm|ogg)|application\/(pdf|zip|octet-stream)|text\/plain)$/;
      if (!allowed.test(mime))
        fail(400, 'Unsupported file. Use an image, audio, video, PDF, ZIP, or text file.');
      if (purpose !== 'chat' && (!mime.startsWith('image/') || f.size > 5 * 1024 * 1024))
        fail(400, 'Choose a JPG, PNG, WEBP, or GIF image under 5 MB.');
      if (mime.startsWith('image/')) {
        const bytes = readFileSync(f.path).subarray(0, 12);
        const valid =
          mime === 'image/jpeg'
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : mime === 'image/png'
              ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : mime === 'image/gif'
                ? /^GIF8[79]a/.test(bytes.toString())
                : bytes.toString('ascii', 0, 4) === 'RIFF' &&
                  bytes.toString('ascii', 8, 12) === 'WEBP';
        if (!valid) fail(400, 'The image content does not match its file type.');
      }
      const id = randomUUID();
      const name =
        path
          .basename(f.originalname)
          .replace(/[\r\n\x00-\x1f]/g, '')
          .slice(0, 180) || 'attachment';
      run(
        'INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?)',
        id,
        req.userId,
        chatId,
        purpose,
        name,
        f.filename,
        mime,
        f.size,
        Date.now(),
      );
      return fileInfo(id);
    } catch (error) {
      try {
        unlinkSync(f.path);
      } catch {
        /* Already removed. */
      }
      throw error;
    }
  }
  app.post(
    '/api/chats/:id/attachments',
    auth,
    canChat,
    uploadLimiter,
    upload.single('file'),
    (req, res) => res.status(201).json({ attachment: saveUpload(req, 'chat', req.params.id) }),
  );
  app.post('/api/profile/avatar', auth, uploadLimiter, upload.single('file'), (req, res) => {
    const attachment = saveUpload(req, 'avatar');
    run('UPDATE users SET avatar_id=? WHERE id=?', attachment.id, req.userId);
    all('SELECT chat_id FROM members WHERE user_id=?', req.userId).forEach((c) =>
      notifyChat(c.chat_id),
    );
    res.json({ user: { ...publicUser(req.userId), email: req.session.email } });
  });
  app.post('/api/statuses/upload', auth, uploadLimiter, upload.single('file'), (req, res) =>
    res.status(201).json({ attachment: saveUpload(req, 'status') }),
  );
  app.get('/api/files/:id', auth, (req, res) => {
    const f =
      one('SELECT * FROM attachments WHERE id=?', req.params.id) || fail(404, 'File not found.');
    if (f.purpose === 'chat') {
      member(f.chat_id, req.userId);
      if (
        f.owner_id !== req.userId &&
        !one('SELECT 1 FROM messages WHERE attachment_id=? AND deleted=0', f.id)
      )
        fail(404, 'This file is no longer shared.');
    }
    if (f.purpose === 'status' && f.owner_id !== req.userId) {
      if (
        !sharesChat(f.owner_id, req.userId) ||
        isBlocked(f.owner_id, req.userId) ||
        !one('SELECT 1 FROM statuses WHERE attachment_id=? AND expires_at>?', f.id, Date.now())
      )
        fail(403, 'Status is not available.');
    }
    const inline = /^(image|audio|video)\//.test(f.mime) && req.query.download !== '1';
    res.set('Content-Type', f.mime);
    res.set(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename).replace(/'/g, '%27')}`,
    );
    res.sendFile(path.join(dataDir, 'uploads', f.disk_name));
  });
  function statusInfo(s, viewer) {
    return {
      id: s.id,
      user: publicUser(s.user_id),
      text: s.text,
      color: s.color,
      attachment: s.attachment_id ? fileInfo(s.attachment_id) : null,
      createdAt: s.created_at,
      expiresAt: s.expires_at,
      viewed: !!one('SELECT 1 FROM status_views WHERE status_id=? AND user_id=?', s.id, viewer),
      views:
        s.user_id === viewer
          ? one(
              'SELECT COUNT(*) AS n FROM status_views WHERE status_id=? AND user_id<>?',
              s.id,
              viewer,
            ).n
          : null,
    };
  }
  const notifyStatuses = (owner) => {
    const ids = all(
      'SELECT DISTINCT b.user_id FROM members a JOIN members b ON a.chat_id=b.chat_id WHERE a.user_id=?',
      owner,
    ).map((x) => x.user_id);
    for (const id of new Set([owner, ...ids])) io.to(userRoom(id)).emit('statuses:changed');
  };
  app.get('/api/statuses', auth, (req, res) => {
    const rows = all(
      'SELECT * FROM statuses WHERE expires_at>? ORDER BY created_at DESC',
      Date.now(),
    ).filter(
      (s) =>
        s.user_id === req.userId ||
        (sharesChat(s.user_id, req.userId) && !isBlocked(s.user_id, req.userId)),
    );
    res.json({ statuses: rows.map((s) => statusInfo(s, req.userId)) });
  });
  app.post('/api/statuses', auth, (req, res) => {
    const input = z
      .object({ text: field(0, 700), color: safeColor, attachmentId: z.uuid().optional() })
      .parse(req.body);
    if (!input.text && !input.attachmentId) fail(400, 'Write a status or add an image.');
    if (
      input.attachmentId &&
      !one(
        "SELECT 1 FROM attachments WHERE id=? AND owner_id=? AND purpose='status'",
        input.attachmentId,
        req.userId,
      )
    )
      fail(400, 'Invalid status image.');
    const id = randomUUID(),
      now = Date.now();
    run(
      'INSERT INTO statuses VALUES (?,?,?,?,?,?,?)',
      id,
      req.userId,
      input.text,
      input.color,
      input.attachmentId || null,
      now,
      now + 86400000,
    );
    notifyStatuses(req.userId);
    res
      .status(201)
      .json({ status: statusInfo(one('SELECT * FROM statuses WHERE id=?', id), req.userId) });
  });
  app.post('/api/statuses/:id/view', auth, (req, res) => {
    const s =
      one('SELECT * FROM statuses WHERE id=? AND expires_at>?', req.params.id, Date.now()) ||
      fail(404, 'This status has expired.');
    if (
      s.user_id !== req.userId &&
      (!sharesChat(s.user_id, req.userId) || isBlocked(s.user_id, req.userId))
    )
      fail(403, 'This status is not available.');
    run('INSERT OR IGNORE INTO status_views VALUES (?,?,?)', s.id, req.userId, Date.now());
    io.to(userRoom(s.user_id)).emit('statuses:changed');
    res.json({ ok: true });
  });
  app.delete('/api/statuses/:id', auth, (req, res) => {
    const s =
      one('SELECT * FROM statuses WHERE id=?', req.params.id) || fail(404, 'Status not found.');
    if (s.user_id !== req.userId) fail(403, 'You can only remove your own status.');
    run('DELETE FROM statuses WHERE id=?', s.id);
    notifyStatuses(req.userId);
    res.json({ ok: true });
  });
  app.get('/api/calls', auth, (req, res) =>
    res.json({
      calls: all(
        'SELECT * FROM calls WHERE caller_id=? OR callee_id=? ORDER BY created_at DESC LIMIT 100',
        req.userId,
        req.userId,
      ).map((c) => ({
        id: c.id,
        chatId: c.chat_id,
        peer: publicUser(c.caller_id === req.userId ? c.callee_id : c.caller_id),
        direction: c.caller_id === req.userId ? 'outgoing' : 'incoming',
        mode: c.mode,
        status: c.status,
        createdAt: c.created_at,
        duration: c.accepted_at && c.ended_at ? Math.round((c.ended_at - c.accepted_at) / 1000) : 0,
      })),
    }),
  );

  function callInfo(c) {
    return {
      id: c.id,
      chatId: c.chat_id,
      caller: publicUser(c.caller_id),
      callee: publicUser(c.callee_id),
      mode: c.mode,
      status: c.status,
    };
  }
  function endCall(id, status = 'ended') {
    const c = one('SELECT * FROM calls WHERE id=?', id);
    if (!c || c.ended_at) return;
    clearTimeout(callTimers.get(id));
    callTimers.delete(id);
    callSockets.delete(id);
    run('UPDATE calls SET status=?, ended_at=? WHERE id=?', status, Date.now(), id);
    io.to(userRoom(c.caller_id)).to(userRoom(c.callee_id)).emit('call:ended', { id, status });
  }
  io.use((socket, next) => {
    const s = session(socket.request.headers.cookie);
    if (!s) return next(new Error('Please sign in.'));
    socket.data.userId = s.user_id;
    socket.data.sessionHash = s.token_hash;
    socket.data.expiresAt = s.expires_at;
    next();
  });
  io.on('connection', (socket) => {
    const uid = socket.data.userId;
    const expiryTimer = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, socket.data.expiresAt - Date.now()),
    );
    expiryTimer.unref();
    const wasOnline = online.has(uid);
    online.set(uid, (online.get(uid) || 0) + 1);
    socket.join(userRoom(uid));
    socket.join(`session:${socket.data.sessionHash}`);
    const memberships = all('SELECT chat_id FROM members WHERE user_id=?', uid);
    for (const { chat_id } of memberships) {
      socket.join(room(chat_id));
      run(
        'UPDATE members SET delivered_id=MAX(delivered_id,COALESCE((SELECT MAX(id) FROM messages WHERE chat_id=?),0)) WHERE chat_id=? AND user_id=?',
        chat_id,
        chat_id,
        uid,
      );
      io.to(room(chat_id)).emit('messages:receipts', { chatId: chat_id });
      if (!wasOnline) io.to(room(chat_id)).emit('presence', publicUser(uid));
    }
    let bucket = { count: 0, until: Date.now() + 10000 };
    socket.use((_packet, next) => {
      if (!session(socket.request.headers.cookie)) {
        socket.disconnect(true);
        return next(new Error('Session expired.'));
      }
      if (bucket.until < Date.now()) bucket = { count: 0, until: Date.now() + 10000 };
      if (++bucket.count > 150) return next(new Error('Too many events.'));
      next();
    });
    const on = (name, fn) =>
      socket.on(name, (raw = {}, ack) => {
        try {
          const result = fn(raw);
          if (typeof ack === 'function') ack({ ok: true, ...result });
        } catch (error) {
          if (typeof ack === 'function')
            ack({
              ok: false,
              error: error instanceof z.ZodError ? 'Invalid request.' : error.message,
            });
        }
      });
    on('typing', (raw) => {
      const p = z.object({ chatId: z.uuid(), typing: z.boolean() }).parse(raw);
      member(p.chatId, uid);
      socket.to(room(p.chatId)).emit('typing', { ...p, userId: uid, name: publicUser(uid).name });
    });
    on('call:start', (raw) => {
      const p = z.object({ chatId: z.uuid(), mode: z.enum(['audio', 'video']) }).parse(raw);
      member(p.chatId, uid);
      if (chatRow(p.chatId).type !== 'direct')
        fail(400, 'Calls are supported in one-to-one chats.');
      const peer = one(
        'SELECT user_id FROM members WHERE chat_id=? AND user_id<>?',
        p.chatId,
        uid,
      ).user_id;
      if (isBlocked(uid, peer)) fail(403, 'Calling is unavailable for this contact.');
      if (!online.has(peer)) fail(400, 'This person is offline. Ask them to open the app first.');
      if (
        one(
          'SELECT 1 FROM calls WHERE ended_at IS NULL AND (caller_id IN (?,?) OR callee_id IN (?,?))',
          uid,
          peer,
          uid,
          peer,
        )
      )
        fail(409, 'One of you is already on a call.');
      const id = randomUUID();
      run(
        'INSERT INTO calls (id,chat_id,caller_id,callee_id,mode,status,created_at) VALUES (?,?,?,?,?,?,?)',
        id,
        p.chatId,
        uid,
        peer,
        p.mode,
        'ringing',
        Date.now(),
      );
      const call = callInfo(one('SELECT * FROM calls WHERE id=?', id));
      callSockets.set(id, { caller: socket.id, callee: null });
      io.to(userRoom(peer)).emit('call:incoming', call);
      callTimers.set(
        id,
        setTimeout(() => endCall(id, 'missed'), 40000),
      );
      callTimers.get(id).unref();
      return { call };
    });
    function authorizedCall(raw) {
      const id = z.uuid().parse(raw.id);
      const c =
        one('SELECT * FROM calls WHERE id=? AND ended_at IS NULL', id) ||
        fail(404, 'Call is no longer active.');
      if (![c.caller_id, c.callee_id].includes(uid)) fail(403, 'This call does not belong to you.');
      member(c.chat_id, uid);
      return c;
    }
    on('call:accept', (raw) => {
      const c = authorizedCall(raw);
      if (uid !== c.callee_id || c.status !== 'ringing') fail(400, 'This call cannot be accepted.');
      clearTimeout(callTimers.get(c.id));
      callTimers.delete(c.id);
      run("UPDATE calls SET status='active', accepted_at=? WHERE id=?", Date.now(), c.id);
      const activeSockets = callSockets.get(c.id);
      if (activeSockets) activeSockets.callee = socket.id;
      io.to(userRoom(c.caller_id)).emit('call:accepted', { id: c.id });
      socket.to(userRoom(c.callee_id)).emit('call:handled', { id: c.id });
    });
    on('call:signal', (raw) => {
      const c = authorizedCall(raw);
      if (c.status !== 'active') fail(400, 'The call has not been accepted.');
      const p = z
        .object({
          description: z
            .object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(40000) })
            .optional(),
          candidate: z
            .object({
              candidate: z.string().max(4000),
              sdpMid: z.string().nullable().optional(),
              sdpMLineIndex: z.number().nullable().optional(),
              usernameFragment: z.string().nullable().optional(),
            })
            .optional(),
        })
        .parse(raw.signal);
      io.to(userRoom(uid === c.caller_id ? c.callee_id : c.caller_id)).emit('call:signal', {
        id: c.id,
        signal: p,
      });
    });
    on('call:end', (raw) => {
      const c = authorizedCall(raw);
      endCall(
        c.id,
        c.status === 'ringing' ? (uid === c.callee_id ? 'declined' : 'cancelled') : 'ended',
      );
    });
    socket.on('disconnect', () => {
      clearTimeout(expiryTimer);
      for (const [id, participants] of callSockets)
        if (participants.caller === socket.id || participants.callee === socket.id)
          endCall(id, 'ended');
      const remaining = (online.get(uid) || 1) - 1;
      if (remaining) {
        online.set(uid, remaining);
        return;
      }
      online.delete(uid);
      run('UPDATE users SET last_seen=? WHERE id=?', Date.now(), uid);
      for (const { chat_id } of all('SELECT chat_id FROM members WHERE user_id=?', uid))
        io.to(room(chat_id)).emit('presence', publicUser(uid));
      for (const c of all(
        'SELECT id,status FROM calls WHERE ended_at IS NULL AND (caller_id=? OR callee_id=?)',
        uid,
        uid,
      ))
        endCall(c.id, c.status === 'ringing' ? 'missed' : 'ended');
    });
  });
  const cleanup = setInterval(
    () => {
      run('DELETE FROM sessions WHERE expires_at<?', Date.now());
      run('DELETE FROM statuses WHERE expires_at<?', Date.now());
    },
    60 * 60 * 1000,
  );
  cleanup.unref();
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  const dist = path.join(ROOT, 'dist');
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else
    app.get('/', (_req, res) =>
      res.type('text').send('Backend ready. Use npm run dev, or npm run build then npm start.'),
    );
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') });
    if (error instanceof multer.MulterError)
      return res
        .status(400)
        .json({
          error:
            error.code === 'LIMIT_FILE_SIZE'
              ? 'This file exceeds the upload size limit.'
              : 'File upload failed.',
        });
    const status = error.status || 500;
    if (status >= 500 && !options.test) console.error(error);
    res
      .status(status)
      .json({
        error:
          status >= 500 ? 'An unexpected server error occurred. Please try again.' : error.message,
      });
  });
  return {
    app,
    server,
    io,
    db,
    dataDir,
    close: async () => {
      clearInterval(cleanup);
      authLimiter.close();
      apiLimiter.close();
      uploadLimiter.close();
      for (const timer of callTimers.values()) clearTimeout(timer);
      await new Promise((resolve) => io.close(resolve));
      db.close();
    },
  };
}
