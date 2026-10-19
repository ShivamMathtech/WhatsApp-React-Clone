import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { io } from 'socket.io-client';
import { createApplication } from '../server/app.mjs';

function event(socket, name, predicate = () => true, timeout = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, handler);
      reject(new Error(`Timed out waiting for ${name}`));
    }, timeout);
    const handler = (data) => {
      if (predicate(data)) {
        clearTimeout(timer);
        socket.off(name, handler);
        resolve(data);
      }
    };
    socket.on(name, handler);
  });
}
const ack = (socket, name, data) =>
  new Promise((resolve, reject) =>
    socket.timeout(2500).emit(name, data, (err, result) => (err ? reject(err) : resolve(result))),
  );

test(
  'Messaging app: real HTTP, SQLite persistence, authorization, and Socket.IO',
  { timeout: 60000 },
  async (t) => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'whatsapp-test-'));
    let instance = createApplication({ dataDir, test: true });
    const sockets = [];
    await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
    let base = `http://127.0.0.1:${instance.server.address().port}`;
    t.after(async () => {
      sockets.forEach((s) => s.disconnect());
      await instance.close();
      await rm(dataDir, { recursive: true, force: true });
    });

    async function request(user, url, options = {}) {
      const headers = {
        'X-Requested-With': 'ChatApp',
        ...(user?.cookie ? { Cookie: user.cookie } : {}),
        ...options.headers,
      };
      let body = options.body;
      if (body !== undefined && !(body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
      }
      const response = await fetch(`${base}/api${url}`, { ...options, headers, body });
      const cookie = response.headers.get('set-cookie');
      if (cookie && user) user.cookie = cookie.split(';')[0];
      const data = response.headers.get('content-type')?.includes('application/json')
        ? await response.json()
        : await response.text();
      return { status: response.status, data, headers: response.headers };
    }
    async function register(name) {
      const u = { email: `${name.toLowerCase()}@example.test`, password: 'TestingChat@123' };
      const r = await request(u, '/auth/register', {
        method: 'POST',
        body: { name, email: u.email, password: u.password },
      });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      u.id = r.data.user.id;
      return u;
    }
    async function connect(u) {
      const socket = io(base, {
        transports: ['websocket'],
        extraHeaders: { Cookie: u.cookie },
        forceNew: true,
        reconnection: false,
        autoConnect: false,
      });
      sockets.push(socket);
      const ready = event(socket, 'connect');
      socket.connect();
      await ready;
      return socket;
    }
    const alice = await register('Alice'),
      bob = await register('Bobby'),
      carol = await register('Carol');
    let chat, group, initialMessage, attachment, statusId, sa, sb, sc;

    await t.test(
      'accounts use HTTP-only sessions, validate credentials, and reject unauthorized requests',
      async () => {
        assert.equal((await request(null, '/chats')).status, 401);
        const duplicate = await request(null, '/auth/register', {
          method: 'POST',
          body: { name: 'Duplicate', email: alice.email, password: alice.password },
        });
        assert.equal(duplicate.status, 409);
        assert.equal(
          (
            await request(null, '/auth/login', {
              method: 'POST',
              body: { email: alice.email, password: 'incorrect1' },
            })
          ).status,
          401,
        );
        const login = await request(alice, '/auth/login', {
          method: 'POST',
          body: { email: alice.email.toUpperCase(), password: alice.password },
        });
        assert.equal(login.status, 200);
        assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
        assert.match(login.headers.get('set-cookie'), /SameSite=Lax/i);
        assert.equal((await request(alice, '/auth/me')).data.user.id, alice.id);
        assert.equal(
          (
            await request(alice, '/profile', {
              method: 'PATCH',
              headers: { 'X-Requested-With': '' },
              body: {},
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request(alice, '/profile', {
              method: 'PATCH',
              headers: { Origin: 'https://evil.example' },
              body: {},
            })
          ).status,
          403,
        );
        const raw = instance.db
          .prepare('SELECT password_hash FROM users WHERE id=?')
          .get(alice.id).password_hash;
        assert.notEqual(raw, alice.password);
        assert.ok(raw.includes(':'));
      },
    );
    await t.test(
      'contact search and direct chat creation do not duplicate conversations',
      async () => {
        assert.equal((await request(alice, '/users')).data.users.length, 0);
        const found = (await request(alice, `/users?q=${bob.email}`)).data.users;
        assert.equal(found[0].id, bob.id);
        assert.equal(found[0].email, undefined);
        const r = await request(alice, '/chats', {
          method: 'POST',
          body: { type: 'direct', userIds: [bob.id] },
        });
        assert.equal(r.status, 201);
        chat = r.data.chat;
        const duplicate = await request(bob, '/chats', {
          method: 'POST',
          body: { type: 'direct', userIds: [alice.id] },
        });
        assert.equal(duplicate.status, 200);
        assert.equal(duplicate.data.chat.id, chat.id);
        assert.equal((await request(carol, `/chats/${chat.id}/messages`)).status, 403);
      },
    );
    await t.test(
      'sockets authenticate and messages deliver in real time only to participants',
      async () => {
        const rejected = io(base, {
          autoConnect: false,
          reconnection: false,
          transports: ['websocket'],
        });
        sockets.push(rejected);
        const error = event(rejected, 'connect_error');
        rejected.connect();
        assert.match((await error).message, /sign in/i);
        sa = await connect(alice);
        sb = await connect(bob);
        sc = await connect(carol);
        const received = event(sb, 'message:new');
        let leaked = false;
        sc.once('message:new', () => {
          leaked = true;
        });
        const clientId = randomUUID();
        const sent = await request(alice, `/chats/${chat.id}/messages`, {
          method: 'POST',
          body: { text: 'Hello Bobby, real-time messaging works!', clientId },
        });
        assert.equal(sent.status, 201);
        initialMessage = sent.data.message;
        assert.equal((await received).text, initialMessage.text);
        assert.equal(initialMessage.status, 'delivered');
        assert.equal(leaked, false);
        const duplicate = await request(alice, `/chats/${chat.id}/messages`, {
          method: 'POST',
          body: { text: 'Hello Bobby, real-time messaging works!', clientId },
        });
        assert.equal(duplicate.data.message.id, initialMessage.id);
        assert.equal((await request(bob, `/chats/${chat.id}/messages`)).data.messages.length, 1);
      },
    );
    await t.test(
      'typing, unread counts, and read receipts reflect actual member state',
      async () => {
        const typing = event(sb, 'typing');
        assert.equal((await ack(sa, 'typing', { chatId: chat.id, typing: true })).ok, true);
        assert.equal((await typing).userId, alice.id);
        assert.equal((await ack(sc, 'typing', { chatId: chat.id, typing: true })).ok, false);
        assert.equal((await request(bob, '/chats')).data.chats[0].unread, 1);
        assert.equal(
          (
            await request(bob, `/chats/${chat.id}/read`, {
              method: 'POST',
              body: { messageId: initialMessage.id },
            })
          ).status,
          200,
        );
        assert.equal(
          (await request(alice, `/chats/${chat.id}/messages`)).data.messages[0].status,
          'read',
        );
        assert.equal((await request(bob, '/chats')).data.chats[0].unread, 0);
      },
    );
    await t.test(
      'reply, search, edit, and personal starring work without cross-user mutation',
      async () => {
        const r = await request(bob, `/chats/${chat.id}/messages`, {
          method: 'POST',
          body: { text: 'Yes, it does!', replyId: initialMessage.id, clientId: randomUUID() },
        });
        assert.equal(r.data.message.reply.text, initialMessage.text);
        assert.equal(
          (
            await request(bob, `/messages/${initialMessage.id}`, {
              method: 'PATCH',
              body: { text: 'not mine' },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request(alice, `/messages/${initialMessage.id}`, {
              method: 'PATCH',
              body: { text: 'Edited searchable message' },
            })
          ).status,
          200,
        );
        const search = await request(bob, `/chats/${chat.id}/messages?q=searchable`);
        assert.equal(search.data.messages.length, 1);
        assert.ok(search.data.messages[0].editedAt);
        assert.equal(
          (
            await request(bob, `/messages/${initialMessage.id}/star`, {
              method: 'POST',
              body: { starred: true },
            })
          ).status,
          200,
        );
        assert.equal((await request(bob, '/starred')).data.messages.length, 1);
        assert.equal((await request(alice, '/starred')).data.messages.length, 0);
        assert.equal((await request(carol, `/messages/${initialMessage.id}`)).status, 403);
      },
    );
    await t.test(
      'authenticated uploads, image signatures, downloads, and deleted file access',
      async () => {
        const form = new FormData();
        form.append(
          'file',
          new Blob(['hello from the attached document'], { type: 'text/plain' }),
          'notes.txt',
        );
        const r = await request(alice, `/chats/${chat.id}/attachments`, {
          method: 'POST',
          body: form,
        });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        attachment = r.data.attachment;
        assert.equal((await request(carol, `/files/${attachment.id}`)).status, 403);
        assert.equal((await request(bob, `/files/${attachment.id}`)).status, 404);
        const sent = await request(alice, `/chats/${chat.id}/messages`, {
          method: 'POST',
          body: { attachmentId: attachment.id, clientId: randomUUID() },
        });
        assert.equal(sent.data.message.kind, 'file');
        const downloaded = await request(bob, `/files/${attachment.id}`);
        assert.equal(downloaded.data, 'hello from the attached document');
        assert.match(downloaded.headers.get('content-disposition'), /attachment/);
        const invalid = new FormData();
        invalid.append(
          'file',
          new Blob(['<script>malicious</script>'], { type: 'image/png' }),
          'photo.png',
        );
        assert.equal(
          (await request(alice, `/chats/${chat.id}/attachments`, { method: 'POST', body: invalid }))
            .status,
          400,
        );
        const png = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKZkAAAAASUVORK5CYII=',
          'base64',
        );
        const avatar = new FormData();
        avatar.append('file', new Blob([png], { type: 'image/png' }), 'avatar.png');
        const profile = await request(alice, '/profile/avatar', { method: 'POST', body: avatar });
        assert.equal(profile.status, 200);
        assert.match(profile.data.user.avatar, /^\/api\/files\//);
        assert.equal(
          (await request(alice, `/messages/${sent.data.message.id}`, { method: 'DELETE' })).status,
          200,
        );
        assert.equal((await request(bob, `/files/${attachment.id}`)).status, 404);
        assert.equal(
          (await request(bob, `/messages/${sent.data.message.id}`)).data.message.kind,
          'deleted',
        );
      },
    );
    await t.test(
      'group admin checks, new membership, and removed-member isolation are enforced',
      async () => {
        group = (
          await request(alice, '/chats', {
            method: 'POST',
            body: { type: 'group', name: 'Our Test Group', userIds: [bob.id] },
          })
        ).data.chat;
        assert.equal(
          (
            await request(bob, `/chats/${group.id}`, {
              method: 'PATCH',
              body: { name: 'Unauthorized rename' },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request(alice, `/chats/${group.id}/members`, {
              method: 'POST',
              body: { userIds: [carol.id] },
            })
          ).status,
          200,
        );
        const groupMessage = await request(carol, `/chats/${group.id}/messages`, {
          method: 'POST',
          body: { text: 'Hi group', clientId: randomUUID() },
        });
        assert.equal(groupMessage.status, 201);
        const invalidReply = await request(alice, `/chats/${group.id}/messages`, {
          method: 'POST',
          body: { text: 'Invalid', replyId: initialMessage.id, clientId: randomUUID() },
        });
        assert.equal(invalidReply.status, 400);
        const foreignAttachment = await request(alice, `/chats/${group.id}/messages`, {
          method: 'POST',
          body: { attachmentId: attachment.id, clientId: randomUUID() },
        });
        assert.equal(foreignAttachment.status, 400);
        assert.equal(
          (await request(bob, `/chats/${group.id}/members/${carol.id}`, { method: 'DELETE' }))
            .status,
          403,
        );
        assert.equal(
          (await request(alice, `/chats/${group.id}/members/${carol.id}`, { method: 'DELETE' }))
            .status,
          200,
        );
        assert.equal((await request(carol, `/chats/${group.id}/messages`)).status, 403);
        assert.equal((await ack(sc, 'typing', { chatId: group.id, typing: true })).ok, false);
        const serverSocket = instance.io.sockets.sockets.get(sc.id);
        assert.equal(serverSocket.rooms.has(`chat:${group.id}`), false);
      },
    );
    await t.test(
      'pin, archive, mute, and profile changes are durable per-account preferences',
      async () => {
        const r = await request(alice, `/chats/${chat.id}`, {
          method: 'PATCH',
          body: { pinned: true, archived: true, muted: true },
        });
        assert.equal(r.data.chat.pinned, true);
        assert.equal(r.data.chat.archived, true);
        assert.equal(r.data.chat.muted, true);
        assert.equal(
          (await request(bob, '/chats')).data.chats.find((c) => c.id === chat.id).muted,
          false,
        );
        const profile = await request(alice, '/profile', {
          method: 'PATCH',
          body: { name: 'Alice Updated', about: 'All systems go.', color: '#497da7' },
        });
        assert.equal(profile.data.user.name, 'Alice Updated');
        assert.equal(profile.data.user.about, 'All systems go.');
      },
    );
    await t.test(
      'status updates are limited to contacts, count views, expire, and respect blocks',
      async () => {
        const r = await request(alice, '/statuses', {
          method: 'POST',
          body: { text: 'A good day!', color: '#008069' },
        });
        assert.equal(r.status, 201);
        statusId = r.data.status.id;
        assert.ok((await request(bob, '/statuses')).data.statuses.some((s) => s.id === statusId));
        assert.equal((await request(carol, '/statuses')).data.statuses.length, 0);
        assert.equal(
          (await request(carol, `/statuses/${statusId}/view`, { method: 'POST' })).status,
          403,
        );
        await request(bob, `/statuses/${statusId}/view`, { method: 'POST' });
        await request(bob, `/statuses/${statusId}/view`, { method: 'POST' });
        assert.equal((await request(alice, '/statuses')).data.statuses[0].views, 1);
        assert.equal(
          (await request(bob, `/statuses/${statusId}`, { method: 'DELETE' })).status,
          403,
        );
        await request(bob, `/users/${alice.id}/block`, { method: 'POST', body: { blocked: true } });
        assert.equal((await request(bob, '/statuses')).data.statuses.length, 0);
        assert.equal(
          (
            await request(alice, `/chats/${chat.id}/messages`, {
              method: 'POST',
              body: { text: 'Blocked', clientId: randomUUID() },
            })
          ).status,
          403,
        );
        assert.equal((await ack(sa, 'call:start', { chatId: chat.id, mode: 'audio' })).ok, false);
        await request(bob, `/users/${alice.id}/block`, {
          method: 'POST',
          body: { blocked: false },
        });
        instance.db
          .prepare('UPDATE statuses SET expires_at=? WHERE id=?')
          .run(Date.now() - 1, statusId);
        assert.equal((await request(bob, '/statuses')).data.statuses.length, 0);
        assert.equal(
          (await request(bob, `/statuses/${statusId}/view`, { method: 'POST' })).status,
          404,
        );
        assert.equal(
          (await request(alice, `/statuses/${statusId}`, { method: 'DELETE' })).status,
          200,
        );
      },
    );
    await t.test(
      'call signaling enforces membership, accept/end state, and call history',
      async () => {
        const incoming = event(sb, 'call:incoming');
        const start = await ack(sa, 'call:start', { chatId: chat.id, mode: 'video' });
        assert.equal(start.ok, true);
        const id = start.call.id;
        assert.equal((await incoming).id, id);
        assert.equal((await ack(sc, 'call:accept', { id })).ok, false);
        assert.equal((await ack(sa, 'call:accept', { id })).ok, false);
        const accepted = event(sa, 'call:accepted');
        assert.equal((await ack(sb, 'call:accept', { id })).ok, true);
        await accepted;
        assert.equal(
          (
            await ack(sc, 'call:signal', {
              id,
              signal: { description: { type: 'offer', sdp: 'forged' } },
            })
          ).ok,
          false,
        );
        const signal = event(sb, 'call:signal');
        assert.equal(
          (
            await ack(sa, 'call:signal', {
              id,
              signal: { description: { type: 'offer', sdp: 'v=0\r\n' } },
            })
          ).ok,
          true,
        );
        assert.equal((await signal).signal.description.type, 'offer');
        const ended = event(sb, 'call:ended');
        await ack(sa, 'call:end', { id });
        assert.equal((await ended).status, 'ended');
        const history = (await request(bob, '/calls')).data.calls;
        assert.equal(history[0].id, id);
        assert.equal(history[0].mode, 'video');
        assert.equal(history[0].direction, 'incoming');
        assert.equal(
          (await ack(sa, 'call:signal', { id, signal: { candidate: { candidate: 'late' } } })).ok,
          false,
        );
      },
    );
    await t.test(
      'closing the calling tab ends its call even if another tab keeps the account online',
      async () => {
        const second = await connect(alice);
        const incoming = event(sb, 'call:incoming');
        const start = await ack(sa, 'call:start', { chatId: chat.id, mode: 'audio' });
        await incoming;
        assert.equal(start.ok, true);
        const ended = event(sb, 'call:ended');
        sa.disconnect();
        await ended;
        assert.equal(second.connected, true);
        sa = second;
      },
    );
    await t.test(
      'cursor pagination loads older history without losing or duplicating messages',
      async () => {
        for (let i = 0; i < 65; i++) {
          const r = await request(alice, `/chats/${group.id}/messages`, {
            method: 'POST',
            body: { text: `History item ${i}`, clientId: randomUUID() },
          });
          assert.equal(r.status, 201);
        }
        const first = (await request(alice, `/chats/${group.id}/messages`)).data;
        assert.equal(first.messages.length, 60);
        assert.equal(first.hasMore, true);
        const second = (
          await request(alice, `/chats/${group.id}/messages?before=${first.messages[0].id}`)
        ).data;
        assert.equal(second.messages.length, 6);
        assert.equal(second.hasMore, false);
        const all = [...second.messages, ...first.messages];
        assert.equal(new Set(all.map((m) => m.id)).size, 66);
      },
    );
    await t.test(
      'leaving as group owner transfers administration and revokes the old membership',
      async () => {
        assert.equal(
          (await request(alice, `/chats/${group.id}/members/${alice.id}`, { method: 'DELETE' }))
            .status,
          200,
        );
        const b = (await request(bob, '/chats')).data.chats.find((c) => c.id === group.id);
        assert.equal(b.ownerId, bob.id);
        assert.equal((await request(alice, `/chats/${group.id}/messages`)).status, 403);
      },
    );
    await t.test(
      'password changes revoke other sessions; logout revokes HTTP and sockets',
      async () => {
        const oldAlice = { ...alice };
        await request(alice, '/auth/login', {
          method: 'POST',
          body: { email: alice.email, password: alice.password },
        });
        const disconnect = event(sa, 'disconnect');
        assert.equal(
          (
            await request(alice, '/profile/password', {
              method: 'POST',
              body: { current: alice.password, password: 'NewPassword@456' },
            })
          ).status,
          200,
        );
        await disconnect;
        assert.equal((await request(oldAlice, '/auth/me')).status, 401);
        assert.equal((await request(alice, '/auth/me')).status, 200);
        assert.equal(
          (
            await request(null, '/auth/login', {
              method: 'POST',
              body: { email: alice.email, password: alice.password },
            })
          ).status,
          401,
        );
        sa = await connect(alice);
        const loggedOut = event(sa, 'disconnect');
        assert.equal((await request(alice, '/auth/logout', { method: 'POST' })).status, 200);
        await loggedOut;
        assert.equal((await request(alice, '/auth/me')).status, 401);
        alice.password = 'NewPassword@456';
        await request(alice, '/auth/login', {
          method: 'POST',
          body: { email: alice.email, password: alice.password },
        });
      },
    );
    await t.test(
      'messages, profile, preferences, files, and session remain available after restart',
      async () => {
        sockets.forEach((s) => s.disconnect());
        await instance.close();
        instance = createApplication({ dataDir, test: true });
        await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${instance.server.address().port}`;
        assert.equal((await request(alice, '/auth/me')).data.user.name, 'Alice Updated');
        const c = (await request(alice, '/chats')).data.chats.find((c) => c.id === chat.id);
        assert.equal(c.pinned, true);
        assert.equal(c.muted, true);
        assert.ok((await request(alice, `/chats/${chat.id}/messages`)).data.messages.length >= 3);
        assert.equal(
          (await request(alice, `/files/${attachment.id}`)).data,
          'hello from the attached document',
        );
      },
    );
  },
);

test('Demo seeding is repeatable and does not overwrite existing users or conversations', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'whatsapp-seed-'));
  try {
    for (let i = 0; i < 2; i++) {
      const r = spawnSync(process.execPath, ['server/seed.mjs'], {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: { ...process.env, DATA_DIR: dataDir },
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, i ? /already exist/ : /created/);
    }
    const instance = createApplication({ dataDir, test: true });
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 5);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM chats').get().n, 6);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 17);
    await instance.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
