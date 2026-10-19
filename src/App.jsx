import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  ArrowRight,
  CircleDashed,
  Heart,
  MessageCircle,
  Moon,
  Phone,
  Plus,
  Settings as SettingsIcon,
  Star,
  Sun,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { api, preview, time } from './api.js';
import Auth from './components/Auth.jsx';
import Sidebar from './components/Sidebar.jsx';
import Conversation from './components/Conversation.jsx';
import NewChat from './components/NewChat.jsx';
import Settings from './components/Settings.jsx';
import ChatDetails from './components/ChatDetails.jsx';
import CallDialog from './components/CallDialog.jsx';
import { StatusComposer, StatusViewer } from './components/Status.jsx';
import { Avatar, Brand, Empty, IconButton, Modal, Spinner } from './components/UI.jsx';
import useCalls from './hooks/useCalls.js';

function Welcome({ onNew, tab }) {
  return (
    <section className="welcome-panel">
      <div className="welcome-top">
        <span className="welcome-pill">
          <span /> A SPACE FOR CONNECTION
        </span>
        <span className="welcome-version">WEB APP · 1.0</span>
      </div>
      <div className="welcome-center">
        <div className="welcome-visual" aria-hidden="true">
          <div className="welcome-ring ring-a" />
          <div className="welcome-ring ring-b" />
          <div className="hello-bubble">
            hey, you <span>👋</span>
          </div>
          <div className="hello-reply">
            <Heart size={22} fill="currentColor" />
            <span>It’s good to stay close.</span>
          </div>
          <div className="welcome-avatar avatar-one">
            <Avatar user={{ name: 'M', color: '#b77946' }} size={50} />
          </div>
          <div className="welcome-avatar avatar-two">
            <Avatar user={{ name: 'S', color: '#c26b80' }} size={42} />
          </div>
          <div className="sparkle sparkle-a">✧</div>
          <div className="sparkle sparkle-b">✦</div>
        </div>
        <span className="eyebrow">LIFE HAPPENS IN CONVERSATIONS</span>
        <h2>
          {tab === 'status'
            ? 'The everyday, shared.'
            : tab === 'calls'
              ? 'Some things sound better.'
              : 'Your people. Right here.'}
        </h2>
        <p>
          {tab === 'status'
            ? 'A thought, a photo, a little moment. See what your circle is up to, or share an update of your own.'
            : tab === 'calls'
              ? 'Catch up with a familiar voice. Open a conversation to start a voice or video call.'
              : 'Big news, little updates, and everything in between. Pick a conversation or start something new.'}
        </p>
        <button className="primary" onClick={onNew}>
          Start a conversation <ArrowRight size={18} />
        </button>
        <div className="welcome-chips">
          <span>
            <MessageCircle size={16} /> Messages
          </span>
          <span>
            <Users size={16} /> Groups
          </span>
          <span>
            <Phone size={16} /> Calls
          </span>
        </div>
      </div>
      <footer>
        <span>Built for the little hellos.</span>
        <span>Independent WhatsApp-inspired project</span>
      </footer>
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState(null),
    [authLoading, setAuthLoading] = useState(true),
    [authError, setAuthError] = useState('');
  const [chats, setChats] = useState([]),
    [statuses, setStatuses] = useState([]),
    [calls, setCalls] = useState([]),
    [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('chats'),
    [activeId, setActiveId] = useState(null),
    [socket, setSocket] = useState(null),
    [connected, setConnected] = useState(false);
  const [modal, setModal] = useState(null),
    [viewStatuses, setViewStatuses] = useState(null),
    [stars, setStars] = useState([]),
    [toastText, setToastText] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('chat-theme') || 'light');
  const timer = useRef(null),
    chatRef = useRef([]),
    userRef = useRef(null),
    refreshRequest = useRef(0);
  chatRef.current = chats;
  userRef.current = user;
  const toast = useCallback((text) => {
    clearTimeout(timer.current);
    setToastText(text);
    timer.current = setTimeout(() => setToastText(''), 6000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    localStorage.setItem('chat-theme', theme);
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [theme]);
  const checkAuth = useCallback(async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const r = await api('/auth/me');
      setUser(r.user);
    } catch (e) {
      if (e.status === 401) setUser(null);
      else
        setAuthError('We couldn’t reach the server. Make sure the app is running, then try again.');
    } finally {
      setAuthLoading(false);
    }
  }, []);
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);
  useEffect(() => {
    if (!user) {
      setChats([]);
      setStatuses([]);
      setCalls([]);
      setStars([]);
      setActiveId(null);
      setModal(null);
      setViewStatuses(null);
    }
  }, [user?.id]);
  const loadChats = useCallback(async () => {
    const seq = ++refreshRequest.current;
    const owner = userRef.current?.id;
    const r = await api('/chats');
    if (seq === refreshRequest.current && owner && userRef.current?.id === owner) {
      setChats(r.chats);
      setLoading(false);
    }
  }, []);
  const loadStatuses = useCallback(async () => {
    const owner = userRef.current?.id;
    try {
      const r = await api('/statuses');
      if (owner && userRef.current?.id === owner) setStatuses(r.statuses);
    } catch (e) {
      if (userRef.current?.id === owner) toast(e.message);
    }
  }, [toast]);
  const loadCalls = useCallback(async () => {
    const owner = userRef.current?.id;
    try {
      const r = await api('/calls');
      if (owner && userRef.current?.id === owner) setCalls(r.calls);
    } catch (e) {
      if (userRef.current?.id === owner) toast(e.message);
    }
  }, [toast]);
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    loadChats().catch((e) => {
      toast(e.message);
      setLoading(false);
    });
    loadStatuses();
    loadCalls();
    const connection = io({ autoConnect: false });
    setSocket(connection);
    const changed = () => loadChats().catch((e) => toast(e.message));
    connection.on('connect', () => {
      setConnected(true);
      changed();
      loadStatuses();
      loadCalls();
    });
    connection.on('disconnect', () => setConnected(false));
    connection.on('connect_error', (e) => {
      setConnected(false);
      if (/sign in/i.test(e.message)) checkAuth();
    });
    connection.on('chats:changed', changed);
    connection.on('statuses:changed', loadStatuses);
    connection.on('presence', (person) =>
      setChats((old) =>
        old.map((c) => ({
          ...c,
          peer: c.peer?.id === person.id ? person : c.peer,
          members: c.members.map((m) => (m.id === person.id ? person : m)),
        })),
      ),
    );
    connection.on('message:new', (m) => {
      const c = chatRef.current.find((c) => c.id === m.chatId);
      if (
        m.sender.id !== userRef.current?.id &&
        !c?.muted &&
        document.visibilityState === 'hidden' &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        const notification = new Notification(m.sender.name, {
          body: preview(m),
          tag: m.chatId,
          icon: '/favicon.svg',
        });
        notification.onclick = () => {
          window.focus();
          setActiveId(m.chatId);
          setTab('chats');
          notification.close();
        };
      }
    });
    connection.connect();
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        changed();
        loadStatuses();
        loadCalls();
      }
    };
    document.addEventListener('visibilitychange', refresh);
    const statusTimer = setInterval(loadStatuses, 60000);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      clearInterval(statusTimer);
      connection.disconnect();
      connection.removeAllListeners();
      setSocket(null);
      setConnected(false);
    };
  }, [user?.id, loadChats, loadStatuses, loadCalls, checkAuth, toast]);
  const callControls = useCalls(socket, user, toast, loadCalls);
  const active = chats.find((c) => c.id === activeId);
  useEffect(() => {
    if (activeId && !active && !loading) {
      setActiveId(null);
      if (modal === 'details') setModal(null);
    }
  }, [activeId, active, loading, modal]);
  function selectChat(id) {
    setActiveId(id);
    setTab('chats');
  }
  async function created(chat) {
    setChats((old) =>
      old.some((c) => c.id === chat.id)
        ? old.map((c) => (c.id === chat.id ? chat : c))
        : [chat, ...old],
    );
    selectChat(chat.id);
    await loadChats();
  }
  async function logout() {
    try {
      await callControls.end();
      await api('/auth/logout', { method: 'POST' });
      socket?.disconnect();
      setUser(null);
      setChats([]);
      setStatuses([]);
      setCalls([]);
      setActiveId(null);
      setModal(null);
    } catch (e) {
      toast(e.message);
    }
  }
  async function openStars() {
    try {
      const r = await api('/starred');
      setStars(r.messages);
      setModal('starred');
    } catch (e) {
      toast(e.message);
    }
  }
  if (authLoading)
    return (
      <div className="splash">
        <Brand />
        <Spinner label="Getting things ready…" />
      </div>
    );
  if (authError)
    return (
      <div className="fatal">
        <WifiOff size={44} />
        <h1>Let’s reconnect.</h1>
        <p>{authError}</p>
        <button className="primary" onClick={checkAuth}>
          Try again
        </button>
      </div>
    );
  if (!user) return <Auth onAuth={setUser} />;
  const unread = chats.reduce((sum, c) => sum + c.unread, 0);
  return (
    <div className="app-page">
      <div className={`app-shell ${active && tab === 'chats' ? 'chat-open' : ''}`}>
        <nav className="nav-rail" aria-label="Main navigation">
          <div className="rail-brand">
            <MessageCircle size={28} />
          </div>
          <div className="rail-tabs">
            {[
              ['chats', MessageCircle, 'Chats'],
              ['status', CircleDashed, 'Updates'],
              ['calls', Phone, 'Calls'],
            ].map(([id, Icon, label]) => (
              <button
                key={id}
                className={tab === id ? 'active' : ''}
                aria-label={label}
                title={label}
                onClick={() => {
                  setTab(id);
                  setActiveId(null);
                }}
              >
                <Icon size={23} />
                {id === 'chats' && unread > 0 && (
                  <span className="rail-badge">{unread > 9 ? '9+' : unread}</span>
                )}
              </button>
            ))}
            <button title="Starred messages" aria-label="Starred messages" onClick={openStars}>
              <Star size={22} />
            </button>
          </div>
          <div className="rail-bottom">
            <IconButton
              icon={theme === 'dark' ? Sun : Moon}
              label="Toggle color theme"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            />
            <IconButton icon={SettingsIcon} label="Settings" onClick={() => setModal('settings')} />
            <button
              className="profile-button"
              title="Your profile"
              aria-label="Your profile"
              onClick={() => setModal('settings')}
            >
              <Avatar user={user} size={35} />
            </button>
          </div>
        </nav>
        <div className="mobile-top">
          <header>
            <Brand small />
            <div>
              <IconButton icon={Star} label="Starred messages" onClick={openStars} />
              <IconButton
                icon={SettingsIcon}
                label="Settings"
                onClick={() => setModal('settings')}
              />
            </div>
          </header>
          <div className="mobile-tabs">
            {[
              ['chats', 'Chats'],
              ['status', 'Status'],
              ['calls', 'Calls'],
            ].map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? 'active' : ''}
                onClick={() => {
                  setTab(id);
                  setActiveId(null);
                }}
              >
                {label}
                {id === 'chats' && unread > 0 && <span>{unread}</span>}
              </button>
            ))}
          </div>
        </div>
        <Sidebar
          tab={tab}
          user={user}
          chats={chats}
          statuses={statuses}
          calls={calls}
          activeId={activeId}
          loading={loading}
          connected={connected}
          onSelect={selectChat}
          onNew={() => setModal('new')}
          onSettings={() => setModal('settings')}
          onStatus={setViewStatuses}
          onComposeStatus={() => setModal('status')}
          onCall={(id, mode) => {
            const chat = chats.find((c) => c.id === id);
            if (chat) callControls.start(chat, mode);
            else toast('This conversation is unavailable.');
          }}
        />
        <main className="main-panel">
          {active && tab === 'chats' ? (
            <Conversation
              key={active.id}
              chat={active}
              user={user}
              socket={socket}
              connected={connected}
              onBack={() => setActiveId(null)}
              onInfo={() => setModal('details')}
              onCall={callControls.start}
              toast={toast}
            />
          ) : (
            <Welcome onNew={() => setModal('new')} tab={tab} />
          )}
        </main>
      </div>
      <div className="app-underbar">
        <Brand small />
        <span>Small moments. Meaningful connections.</span>
      </div>
      {modal === 'new' && <NewChat onClose={() => setModal(null)} onCreated={created} />}
      {modal === 'settings' && (
        <Settings
          user={user}
          setUser={setUser}
          theme={theme}
          setTheme={setTheme}
          onClose={() => setModal(null)}
          onLogout={logout}
          toast={toast}
        />
      )}
      {modal === 'details' && active && (
        <ChatDetails
          chat={active}
          user={user}
          onClose={() => setModal(null)}
          onChange={loadChats}
          onLeave={() => setActiveId(null)}
          toast={toast}
        />
      )}
      {modal === 'status' && (
        <StatusComposer onClose={() => setModal(null)} onSaved={loadStatuses} />
      )}
      {modal === 'starred' && (
        <Modal title="Starred messages" onClose={() => setModal(null)}>
          <div className="starred-list">
            {stars.length ? (
              stars.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    selectChat(m.chatId);
                    setModal(null);
                  }}
                >
                  <Avatar user={m.sender} size={37} />
                  <div>
                    <b>
                      {m.sender.name}
                      <time>{time(m.createdAt)}</time>
                    </b>
                    <p>{preview(m)}</p>
                    <small>{chats.find((c) => c.id === m.chatId)?.name}</small>
                  </div>
                  <Star size={16} />
                </button>
              ))
            ) : (
              <Empty icon={Star} title="Keep the good stuff close">
                Open a message’s action menu and star it to find it here later.
              </Empty>
            )}
          </div>
        </Modal>
      )}
      {viewStatuses && (
        <StatusViewer
          statuses={viewStatuses}
          user={user}
          onClose={() => {
            setViewStatuses(null);
            loadStatuses();
          }}
          onChange={loadStatuses}
          toast={toast}
        />
      )}
      {callControls.call && <CallDialog controls={callControls} user={user} />}
      {toastText && (
        <div className="toast" role="status">
          <span>{toastText}</span>
          <button onClick={() => setToastText('')} aria-label="Dismiss notification">
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
