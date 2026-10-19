import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, transaction } from './db.mjs';
import { hashPassword } from './security.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const db = openDatabase(path.resolve(process.env.DATA_DIR || path.join(root, 'data')));
const profiles = [
  ['Shivam Singh', 'shivam@demo.local', '#008069', 'Building things that bring people together.'],
  ['Mahnoor', 'mahnoor@demo.local', '#b77946', 'Designing a little, dreaming a lot.'],
  ['Usama', 'usama@demo.local', '#497da7', 'Available for a good conversation.'],
  ['Sana', 'sana@demo.local', '#c26b80', 'A little sunshine, every day.'],
  ['Areeb', 'areeb@demo.local', '#7c69aa', 'Coffee. Code. Repeat.'],
];
const password = await hashPassword('DemoChat@123');
const now = Date.now();
let added = 0;
transaction(db, () => {
  const users = profiles.map(([name, email, color, about]) => {
    const existing = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (existing) return existing;
    const id = randomUUID();
    added++;
    db.prepare(
      'INSERT INTO users (id,email,password_hash,name,about,color,last_seen,created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(id, email, password, name, about, color, now - 3600000, now);
    return { id, name, email };
  });
  if (!added) return;
  const message = (chat, sender, text, minutes) =>
    db
      .prepare(
        'INSERT INTO messages (chat_id,sender_id,text,created_at,client_id) VALUES (?,?,?,?,?)',
      )
      .run(chat, sender, text, now - minutes * 60000, randomUUID());
  const addChat = (type, name, participants, key) => {
    if (key && db.prepare('SELECT 1 FROM chats WHERE direct_key=?').get(key)) return null;
    const id = randomUUID();
    db.prepare('INSERT INTO chats VALUES (?,?,?,?,?,?)').run(
      id,
      type,
      name,
      users[0].id,
      key,
      now - 86400000,
    );
    participants.forEach((u) =>
      db.prepare('INSERT INTO members (chat_id,user_id) VALUES (?,?)').run(id, u.id),
    );
    return id;
  };
  const conversations = [
    [
      'Hey! How is the new project coming along? 🌿',
      'Really well! The chat screens are coming together.',
      'Love that! Send me a preview when you can.',
    ],
    [
      'Are we still meeting for coffee this weekend?',
      'Absolutely. Saturday afternoon?',
      'Sounds perfect ☕',
    ],
    [
      'Just found the best playlist for working!',
      'Share it with me! I need some new music 🎧',
      'On it. Hope your day is going well!',
    ],
    [
      'The little details make all the difference.',
      'Couldn’t agree more. Let’s keep it simple.',
      'Clean design, happy users. ✨',
    ],
  ];
  users.slice(1).forEach((u, i) => {
    const chat = addChat('direct', null, [users[0], u], [users[0].id, u.id].sort().join(':'));
    if (!chat) return;
    conversations[i].forEach((text, j) =>
      message(chat, j === 1 ? users[0].id : u.id, text, 28 + i * 65 - j * 4),
    );
    const max = db.prepare('SELECT MAX(id) AS id FROM messages WHERE chat_id=?').get(chat).id;
    db.prepare('UPDATE members SET read_id=?,delivered_id=? WHERE chat_id=?').run(max, max, chat);
  });
  const group = addChat('group', 'Design Team', users.slice(0, 4), null);
  message(
    group,
    users[1].id,
    'A place for ideas, feedback, and the occasional coffee debate ☕',
    80,
  );
  message(group, users[0].id, 'Welcome, everyone! Let’s make something we’re proud of.', 75);
  message(group, users[3].id, 'The new palette is looking so good! 🌱', 12);
  db.prepare('UPDATE members SET pinned=1 WHERE chat_id=? AND user_id=?').run(group, users[0].id);
  const family = addChat('group', 'Weekend Plans', [users[0], users[2], users[4]], null);
  message(family, users[2].id, 'Mountains or a quiet café this weekend? 🏔️', 190);
  message(family, users[4].id, 'Why not both?', 180);
  for (const [index, text] of [
    [1, 'Finding beauty in the little things. 🌿'],
    [3, 'A fresh start. A good coffee. A whole lot of possibilities. ☕'],
  ]) {
    const u = users[index];
    db.prepare('INSERT INTO statuses VALUES (?,?,?,?,?,?,?)').run(
      randomUUID(),
      u.id,
      text,
      profiles[index][2],
      null,
      now - index * 300000,
      now + 86400000,
    );
  }
});
db.close();
console.log(
  added
    ? 'Demo accounts and sample conversations created.'
    : 'Demo accounts already exist. No existing content was changed.',
);
console.log('Demo login: shivam@demo.local / DemoChat@123');
console.log('Second account: mahnoor@demo.local / DemoChat@123');
console.log('These are local demo accounts. Do not seed a public production server.');
