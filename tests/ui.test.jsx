import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
  fireEvent,
  renderHook,
  act,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.jsx';
import Conversation from '../src/components/Conversation.jsx';
import NewChat from '../src/components/NewChat.jsx';
import Settings from '../src/components/Settings.jsx';
import { StatusComposer } from '../src/components/Status.jsx';
import useCalls from '../src/hooks/useCalls.js';
import { api, uploadFile } from '../src/api.js';

vi.mock('../src/api.js', async (original) => ({
  ...(await original()),
  api: vi.fn(),
  uploadFile: vi.fn(),
}));
vi.mock('socket.io-client', () => ({
  io: () => {
    const listeners = new Map();
    return {
      connected: true,
      on(name, handler) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(handler);
        return this;
      },
      off(name, handler) {
        listeners.get(name)?.delete(handler);
        return this;
      },
      emit: vi.fn(),
      connect() {
        listeners.get('connect')?.forEach((fn) => fn());
      },
      disconnect() {},
      removeAllListeners() {
        listeners.clear();
      },
    };
  },
}));

const me = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Shivam Singh',
  email: 'shivam@demo.local',
  about: 'Hello there',
  color: '#008069',
};
const peer = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Mahnoor',
  about: 'Designing things',
  color: '#b77946',
  online: true,
};
const chat = {
  id: '00000000-0000-4000-8000-000000000003',
  name: 'Mahnoor',
  color: '#b77946',
  type: 'direct',
  peer,
  members: [me, peer],
  pinned: false,
  archived: false,
  muted: false,
  unread: 0,
  createdAt: Date.now(),
  ownerId: me.id,
};
const initial = {
  id: 1,
  chatId: chat.id,
  sender: peer,
  text: 'Ready for a coffee?',
  createdAt: Date.now(),
  kind: 'text',
  status: 'read',
  starred: false,
};
const conversationProps = {
  chat,
  user: me,
  socket: null,
  connected: true,
  onBack: vi.fn(),
  onInfo: vi.fn(),
  onCall: vi.fn(),
  toast: vi.fn(),
};
let messages;

beforeEach(() => {
  vi.clearAllMocks();
  messages = [initial];
  localStorage.clear();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
  );
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/auth/me') return { user: me };
    if (path.startsWith('/auth/login')) return { user: me };
    if (path === '/chats' && options.method !== 'POST')
      return { chats: [{ ...chat, lastMessage: messages.at(-1) }] };
    if (path === '/statuses' && options.method !== 'POST') return { statuses: [] };
    if (path === '/calls') return { calls: [] };
    if (path.startsWith('/users')) return { users: [peer] };
    if (path === `/chats/${chat.id}/messages` && options.method === 'POST') {
      const message = {
        ...initial,
        id: messages.length + 1,
        sender: me,
        text: options.body.text,
        kind: options.body.attachmentId ? 'file' : 'text',
      };
      messages.push(message);
      return { message };
    }
    if (path.startsWith(`/chats/${chat.id}/messages`))
      return { messages: [...messages], hasMore: false };
    if (path === '/profile') return { user: { ...me, ...options.body } };
    return { ok: true };
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('React interaction flows (JSDOM; no camera or visual-layout simulation)', () => {
  it('shows sign-in, uses demo credentials, and opens a real conversation view after authentication', async () => {
    api.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Sign in'), { status: 401 });
    });
    render(<App />);
    const user = userEvent.setup();
    await screen.findByText('Welcome back.');
    await user.click(screen.getByRole('button', { name: /Shivam/ }));
    expect(screen.getByLabelText('Email address').value).toBe('shivam@demo.local');
    await user.click(screen.getByRole('button', { name: 'Let’s talk' }));
    await screen.findByText('Your people. Right here.');
    await user.click(screen.getByRole('button', { name: /Mahnoor.*Ready for a coffee/ }));
    expect(await screen.findByLabelText('Type a message')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start video call' })).toBeTruthy();
  });
  it('sends text, records a read cursor, and clears the draft only after acknowledgement', async () => {
    render(<Conversation {...conversationProps} />);
    const user = userEvent.setup();
    await screen.findByText('Ready for a coffee?');
    expect(api).toHaveBeenCalledWith(
      `/chats/${chat.id}/read`,
      expect.objectContaining({ body: { messageId: 1 } }),
    );
    const input = screen.getByLabelText('Type a message');
    await user.type(input, 'Absolutely, see you soon!');
    await user.click(screen.getByLabelText('Send message'));
    expect(await screen.findByText('Absolutely, see you soon!')).toBeTruthy();
    expect(input.value).toBe('');
    const sent = api.mock.calls.find(
      ([url, options]) => url.endsWith('/messages') && options?.method === 'POST',
    );
    expect(sent[1].body.clientId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('keeps failed drafts and retries with the same idempotency key', async () => {
    const handler = api.getMockImplementation();
    let first = true;
    api.mockImplementation(async (path, options = {}) => {
      if (options.method === 'POST' && path.endsWith('/messages') && first) {
        first = false;
        throw new Error('Network lost');
      }
      return handler(path, options);
    });
    render(<Conversation {...conversationProps} />);
    const user = userEvent.setup();
    await screen.findByText('Ready for a coffee?');
    const input = screen.getByLabelText('Type a message');
    await user.type(input, 'Keep this draft');
    await user.click(screen.getByLabelText('Send message'));
    await screen.findByRole('alert');
    expect(input.value).toBe('Keep this draft');
    await user.click(screen.getByLabelText('Send message'));
    await screen.findByText('Keep this draft');
    const requests = api.mock.calls.filter(
      ([url, options]) => url.endsWith('/messages') && options?.method === 'POST',
    );
    expect(requests).toHaveLength(2);
    expect(requests[0][1].body.clientId).toBe(requests[1][1].body.clientId);
  });
  it('supports replying, starring, emoji input, and permission-aware call controls', async () => {
    render(<Conversation {...conversationProps} />);
    const user = userEvent.setup();
    await screen.findByText('Ready for a coffee?');
    await user.click(screen.getByLabelText('Message actions'));
    await user.click(screen.getByRole('button', { name: 'Reply' }));
    expect(screen.getByText('Replying to Mahnoor')).toBeTruthy();
    await user.click(screen.getByLabelText('Choose emoji'));
    await user.click(screen.getByLabelText('Insert 👋'));
    expect(screen.getByLabelText('Type a message').value).toBe('👋');
    await user.click(screen.getByLabelText('Message actions'));
    await user.click(screen.getByRole('button', { name: 'Star message' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/messages/1/star', {
        method: 'POST',
        body: { starred: true },
      }),
    );
    await user.click(screen.getByLabelText('Start audio call'));
    expect(conversationProps.onCall).toHaveBeenCalledWith(chat, 'audio');
  });
  it('creates a group with the selected registered user', async () => {
    const onCreated = vi.fn(),
      onClose = vi.fn();
    const handler = api.getMockImplementation();
    api.mockImplementation(async (path, options) =>
      path === '/chats' && options?.method === 'POST'
        ? { chat: { ...chat, type: 'group', name: options.body.name } }
        : handler(path, options),
    );
    render(<NewChat onCreated={onCreated} onClose={onClose} />);
    const user = userEvent.setup();
    await screen.findByText('Mahnoor');
    await user.click(screen.getByRole('button', { name: 'New group' }));
    await user.type(screen.getByLabelText('Group name'), 'Project Circle');
    await user.click(screen.getByRole('button', { name: /Mahnoor Designing things/ }));
    await user.click(screen.getByRole('button', { name: 'Create group' }));
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ name: 'Project Circle' })),
    );
    expect(api).toHaveBeenCalledWith('/chats', {
      method: 'POST',
      body: { type: 'group', userIds: [peer.id], name: 'Project Circle' },
    });
    expect(onClose).toHaveBeenCalled();
  });
  it('uploads an attachment before sending the file message', async () => {
    uploadFile.mockResolvedValue({
      attachment: { id: 'attachment-id', name: 'hello.txt', mime: 'text/plain' },
    });
    const { container } = render(<Conversation {...conversationProps} />);
    const user = userEvent.setup();
    await screen.findByText('Ready for a coffee?');
    const file = new File(['Hello'], 'hello.txt', { type: 'text/plain' });
    await user.upload(container.querySelector('input[type=file]'), file);
    expect(await screen.findByText('hello.txt')).toBeTruthy();
    await user.click(screen.getByLabelText('Send message'));
    await waitFor(() =>
      expect(uploadFile).toHaveBeenCalledWith(`/chats/${chat.id}/attachments`, file),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        `/chats/${chat.id}/messages`,
        expect.objectContaining({
          body: expect.objectContaining({ attachmentId: 'attachment-id' }),
        }),
      ),
    );
  });
  it('saves profile changes and updates the selected theme', async () => {
    const setUser = vi.fn(),
      setTheme = vi.fn();
    render(
      <Settings
        user={me}
        setUser={setUser}
        theme="light"
        setTheme={setTheme}
        onClose={vi.fn()}
        onLogout={vi.fn()}
        toast={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Your name'));
    await user.type(screen.getByLabelText('Your name'), 'Shivam Updated');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ name: 'Shivam Updated' })),
    );
    await user.click(screen.getByRole('button', { name: 'Appearance & alerts' }));
    await user.click(screen.getByRole('button', { name: 'Dark' }));
    expect(setTheme).toHaveBeenCalledWith('dark');
  });
  it('publishes a text status through the backend API', async () => {
    const saved = vi.fn(),
      close = vi.fn();
    render(<StatusComposer onClose={close} onSaved={saved} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Status text'), 'A lovely day for building.');
    await user.click(screen.getByRole('button', { name: 'Share status' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(close).toHaveBeenCalled();
    expect(api).toHaveBeenCalledWith('/statuses', {
      method: 'POST',
      body: { text: 'A lovely day for building.', color: '#008069', attachmentId: undefined },
    });
  });
  it('reports microphone permission failures without pretending a call connected', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error('Permission denied')) },
    });
    const toast = vi.fn();
    const { result } = renderHook(() => useCalls(null, me, toast, null));
    await act(async () => {
      await result.current.start(chat, 'audio');
    });
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/permissions/i));
    expect(result.current.call).toBeNull();
    expect(result.current.localStream).toBeNull();
  });
});
