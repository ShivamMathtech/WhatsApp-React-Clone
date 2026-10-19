import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Edit3,
  FileText,
  Image,
  LoaderCircle,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Play,
  Reply,
  Search,
  Send,
  Smile,
  Square,
  Star,
  Trash2,
  Video,
  X,
  Info,
  Ban,
} from 'lucide-react';
import { api, day, fileSize, preview, relative, time, uploadFile } from '../api.js';
import { Avatar, Empty, ErrorNote, IconButton, Modal, Receipt, Spinner } from './UI.jsx';

const EMOJI = [
  '😀',
  '😊',
  '😂',
  '🥰',
  '😎',
  '🤔',
  '🥳',
  '❤️',
  '💚',
  '👍',
  '👏',
  '🙌',
  '🙏',
  '🔥',
  '✨',
  '🎉',
  '☕',
  '🌿',
  '🌸',
  '💯',
  '🎧',
  '🚀',
  '✅',
  '👋',
];
const upsert = (rows, next) => {
  const map = new Map(rows.map((m) => [m.id, m]));
  for (const m of next) map.set(m.id, m);
  return [...map.values()].sort((a, b) => a.id - b.id);
};
function MessageText({ text }) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}
function Message({ message: m, mine, group, onAction, onImage }) {
  const [menu, setMenu] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => {
      if (!root.current?.contains(e.target)) setMenu(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  return (
    <div className={`message-row ${mine ? 'mine' : ''}`}>
      {!mine && group && <Avatar user={m.sender} size={27} />}
      <article
        className={`message-bubble ${m.kind === 'deleted' ? 'deleted' : ''}`}
        ref={root}
        aria-label={`Message from ${m.sender.name}`}
      >
        {!mine && group && (
          <b className="message-sender" style={{ color: m.sender.color }}>
            {m.sender.name}
          </b>
        )}
        {m.reply && (
          <div className="quoted-message">
            <b>{m.reply.name}</b>
            <span>{m.reply.text}</span>
          </div>
        )}
        {m.kind === 'deleted' ? (
          <span className="deleted-label">
            <Ban size={15} /> This message was deleted
          </span>
        ) : (
          <>
            {m.attachment && (
              <div className={`message-attachment ${m.kind}`}>
                {m.kind === 'image' ? (
                  <button className="image-message" onClick={() => onImage(m.attachment)}>
                    <img src={m.attachment.url} alt={m.attachment.name} loading="lazy" />
                  </button>
                ) : m.kind === 'video' ? (
                  <video src={m.attachment.url} controls preload="metadata" playsInline />
                ) : m.kind === 'audio' ? (
                  <audio src={m.attachment.url} controls preload="metadata" />
                ) : (
                  <a href={`${m.attachment.url}?download=1`} className="document-message" download>
                    <FileText size={30} />
                    <span>
                      <b>{m.attachment.name}</b>
                      <small>{fileSize(m.attachment.size)}</small>
                    </span>
                    <Download size={20} />
                  </a>
                )}
              </div>
            )}
            {m.text && (
              <p className="message-text">
                <MessageText text={m.text} />
              </p>
            )}
            <button
              className="message-menu-toggle"
              aria-label="Message actions"
              onClick={() => setMenu(!menu)}
            >
              <ChevronDown size={17} />
            </button>
          </>
        )}
        <span className="message-meta">
          {m.starred && <Star size={11} fill="currentColor" />}
          {m.editedAt && <span>edited</span>}
          <time>{time(m.createdAt)}</time>
          {mine && <Receipt status={m.status} />}
        </span>
        {menu && (
          <div className="message-menu">
            {[
              [Reply, 'Reply', 'reply'],
              [Star, m.starred ? 'Unstar message' : 'Star message', 'star'],
              ...(mine && m.kind === 'text' ? [[Edit3, 'Edit message', 'edit']] : []),
              ...(mine ? [[Trash2, 'Delete for everyone', 'delete']] : []),
            ].map(([Icon, label, action]) => (
              <button
                key={action}
                onClick={() => {
                  setMenu(false);
                  onAction(action, m);
                }}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

export default function Conversation({
  chat,
  user,
  socket,
  connected,
  onBack,
  onInfo,
  onCall,
  toast,
}) {
  const [messages, setMessages] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false),
    [olderBusy, setOlderBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false),
    [searchText, setSearchText] = useState(''),
    [query, setQuery] = useState('');
  const [text, setText] = useState(''),
    [reply, setReply] = useState(null),
    [emoji, setEmoji] = useState(false),
    [sending, setSending] = useState(false);
  const [file, setFile] = useState(null),
    [filePreview, setFilePreview] = useState(''),
    [attachment, setAttachment] = useState(null);
  const [typing, setTyping] = useState({}),
    [action, setAction] = useState(null),
    [editText, setEditText] = useState(''),
    [lightbox, setLightbox] = useState(null);
  const [recording, setRecording] = useState(false),
    [recordSeconds, setRecordSeconds] = useState(0),
    [recordPending, setRecordPending] = useState(false);
  const [showScroll, setShowScroll] = useState(false);
  const scroller = useRef(null),
    fileInput = useRef(null),
    input = useRef(null),
    readId = useRef(0),
    nearBottom = useRef(true),
    preserveHeight = useRef(null),
    clientId = useRef(null),
    lastTyped = useRef(0);
  const recorder = useRef(null),
    stream = useRef(null),
    chunks = useRef([]),
    discard = useRef(false),
    mounted = useRef(true),
    requestId = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current?.state === 'recording') {
        discard.current = true;
        recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      socket?.emit('typing', { chatId: chat.id, typing: false });
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchText.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchText]);
  const refresh = useCallback(
    async (quiet = false) => {
      const request = ++requestId.current;
      if (!quiet) setLoading(true);
      try {
        const r = await api(`/chats/${chat.id}/messages?q=${encodeURIComponent(query)}`);
        if (!mounted.current || request !== requestId.current) return;
        setMessages((old) => (quiet && !query ? upsert(old, r.messages) : r.messages));
        setHasMore((previous) => (quiet && !query ? previous : r.hasMore));
        setError('');
      } catch (e) {
        if (mounted.current && request === requestId.current) setError(e.message);
      } finally {
        if (mounted.current && request === requestId.current) setLoading(false);
      }
    },
    [chat.id, query],
  );
  useEffect(() => {
    nearBottom.current = true;
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (!socket) return;
    const changed = (data) => {
      if (data.chatId !== chat.id) return;
      if (data.messageId && !query)
        api(`/messages/${data.messageId}`)
          .then((r) => {
            if (mounted.current)
              setMessages((old) =>
                old.some((m) => m.id === r.message.id) ? upsert(old, [r.message]) : old,
              );
          })
          .catch((e) => toast(e.message));
      else refresh(true);
    };
    const incoming = (m) => {
      if (m.chatId !== chat.id) return;
      if (query) {
        refresh(true);
        return;
      }
      setMessages((old) => upsert(old, [m]));
      setTyping((old) => {
        const next = { ...old };
        delete next[m.sender.id];
        return next;
      });
    };
    const onTyping = (data) => {
      if (data.chatId !== chat.id || data.userId === user.id) return;
      setTyping((old) => {
        const next = { ...old };
        if (data.typing)
          next[data.userId] = { name: data.name.split(' ')[0], until: Date.now() + 4500 };
        else delete next[data.userId];
        return next;
      });
    };
    const reconnect = () => refresh();
    socket
      .on('message:new', incoming)
      .on('messages:changed', changed)
      .on('messages:receipts', changed)
      .on('typing', onTyping)
      .on('connect', reconnect);
    const timer = setInterval(
      () =>
        setTyping((old) =>
          Object.fromEntries(Object.entries(old).filter(([, value]) => value.until > Date.now())),
        ),
      2000,
    );
    return () => {
      socket
        .off('message:new', incoming)
        .off('messages:changed', changed)
        .off('messages:receipts', changed)
        .off('typing', onTyping)
        .off('connect', reconnect);
      clearInterval(timer);
    };
  }, [socket, chat.id, user.id, query, refresh]);
  const latestId = messages.at(-1)?.id || 0;
  useEffect(() => {
    const mark = () => {
      if (
        document.visibilityState === 'hidden' ||
        query ||
        loading ||
        !latestId ||
        readId.current >= latestId
      )
        return;
      const previous = readId.current;
      readId.current = latestId;
      api(`/chats/${chat.id}/read`, { method: 'POST', body: { messageId: latestId } }).catch(() => {
        readId.current = previous;
      });
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    window.addEventListener('focus', mark);
    return () => {
      document.removeEventListener('visibilitychange', mark);
      window.removeEventListener('focus', mark);
    };
  }, [latestId, chat.id, query, loading, connected]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (preserveHeight.current !== null) {
      el.scrollTop = el.scrollHeight - preserveHeight.current;
      preserveHeight.current = null;
    } else if (nearBottom.current && !query) el.scrollTop = el.scrollHeight;
  }, [messages, loading, query]);
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setFilePreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function older() {
    if (!messages.length) return;
    setOlderBusy(true);
    try {
      const r = await api(
        `/chats/${chat.id}/messages?before=${messages[0].id}&q=${encodeURIComponent(query)}`,
      );
      preserveHeight.current = scroller.current.scrollHeight - scroller.current.scrollTop;
      setMessages((old) => upsert(r.messages, old));
      setHasMore(r.hasMore);
    } catch (e) {
      toast(e.message);
    } finally {
      setOlderBusy(false);
    }
  }
  function changeText(value) {
    setText(value);
    clientId.current = null;
    if (socket?.connected && Date.now() - lastTyped.current > 1000) {
      socket.emit('typing', { chatId: chat.id, typing: !!value });
      lastTyped.current = Date.now();
    }
  }
  function chooseFile(selected) {
    if (!selected) return;
    if (selected.size > 20 * 1024 * 1024) {
      toast('Please choose a file under 20 MB.');
      return;
    }
    setFile(selected);
    setAttachment(null);
    clientId.current = null;
  }
  async function send(e) {
    e?.preventDefault();
    if ((!text.trim() && !file) || sending || recording) return;
    setSending(true);
    setError('');
    if (!clientId.current) clientId.current = crypto.randomUUID();
    try {
      let uploaded = attachment;
      if (file && !uploaded) {
        uploaded = (await uploadFile(`/chats/${chat.id}/attachments`, file)).attachment;
        setAttachment(uploaded);
      }
      const r = await api(`/chats/${chat.id}/messages`, {
        method: 'POST',
        body: {
          text,
          clientId: clientId.current,
          ...(uploaded ? { attachmentId: uploaded.id } : {}),
          ...(reply ? { replyId: reply.id } : {}),
        },
      });
      nearBottom.current = true;
      setMessages((old) => upsert(old, [r.message]));
      setText('');
      setFile(null);
      setAttachment(null);
      setReply(null);
      setEmoji(false);
      clientId.current = null;
      socket?.emit('typing', { chatId: chat.id, typing: false });
      input.current?.focus();
    } catch (e) {
      setError(`Message not sent: ${e.message} Your draft is still here. Retry when ready.`);
    } finally {
      if (mounted.current) setSending(false);
    }
  }
  async function messageAction(type, message) {
    if (type === 'reply') {
      clientId.current = null;
      setReply(message);
      input.current?.focus();
      return;
    }
    if (type === 'star') {
      try {
        await api(`/messages/${message.id}/star`, {
          method: 'POST',
          body: { starred: !message.starred },
        });
        setMessages((old) =>
          old.map((m) => (m.id === message.id ? { ...m, starred: !m.starred } : m)),
        );
      } catch (e) {
        toast(e.message);
      }
      return;
    }
    setAction({ type, message });
    setEditText(message.text);
  }
  async function commitAction(e) {
    e.preventDefault();
    if (!action) return;
    try {
      await api(`/messages/${action.message.id}`, {
        method: action.type === 'delete' ? 'DELETE' : 'PATCH',
        ...(action.type === 'edit' ? { body: { text: editText } } : {}),
      });
      setAction(null);
      refresh(true);
    } catch (e) {
      toast(e.message);
    }
  }
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('Voice recording needs HTTPS or localhost and a supported browser.');
      return;
    }
    setRecordPending(true);
    try {
      const captured = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        captured.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = captured;
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      const media = new MediaRecorder(captured, mimeType ? { mimeType } : undefined);
      recorder.current = media;
      chunks.current = [];
      discard.current = false;
      media.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      media.onstop = () => {
        captured.getTracks().forEach((t) => t.stop());
        if (!mounted.current) return;
        setRecording(false);
        if (!discard.current && chunks.current.length) {
          const type = media.mimeType.split(';')[0],
            ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          chooseFile(new File(chunks.current, `Voice-note-${Date.now()}.${ext}`, { type }));
        }
      };
      media.start();
      setRecordSeconds(0);
      setRecording(true);
    } catch {
      stream.current?.getTracks().forEach((t) => t.stop());
      toast('Microphone access failed. Allow microphone permission in your browser.');
    } finally {
      if (mounted.current) setRecordPending(false);
    }
  }
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(
      () =>
        setRecordSeconds((s) => {
          if (s >= 119 && recorder.current?.state === 'recording') recorder.current.stop();
          return s + 1;
        }),
      1000,
    );
    return () => clearInterval(timer);
  }, [recording]);
  const typers = Object.values(typing).map((t) => t.name);
  return (
    <section className="conversation">
      <header className="conversation-header">
        <IconButton
          icon={ArrowLeft}
          label="Back to chats"
          className="mobile-back"
          onClick={onBack}
        />
        <button className="conversation-person" onClick={onInfo}>
          <Avatar
            user={chat}
            group={chat.type === 'group'}
            size={43}
            online={chat.type === 'direct' && chat.peer?.online}
          />
          <span>
            <b>{chat.name}</b>
            <small className={typers.length ? 'typing-label' : ''}>
              {typers.length
                ? `${typers.join(', ')} ${typers.length > 1 ? 'are' : 'is'} typing…`
                : chat.type === 'group'
                  ? `${chat.members.length} participants · Click for group info`
                  : chat.peer?.online
                    ? 'online'
                    : `last seen ${relative(chat.peer?.lastSeen || Date.now())}`}
            </small>
          </span>
        </button>
        <div className="conversation-actions">
          {chat.type === 'direct' && (
            <>
              <IconButton
                icon={Video}
                label="Start video call"
                onClick={() => onCall(chat, 'video')}
                disabled={!connected || chat.blocked}
              />
              <IconButton
                icon={Phone}
                label="Start audio call"
                onClick={() => onCall(chat, 'audio')}
                disabled={!connected || chat.blocked}
              />
            </>
          )}
          <span className="action-divider" />
          <IconButton
            icon={Search}
            label="Search messages"
            onClick={() => {
              setSearchOpen(!searchOpen);
              setSearchText('');
            }}
          />
          <IconButton icon={MoreVertical} label="Conversation details" onClick={onInfo} />
        </div>
      </header>
      {searchOpen && (
        <div className="message-search">
          <Search size={18} />
          <input
            autoFocus
            aria-label="Search in conversation"
            value={searchText}
            placeholder="Search in this conversation"
            onChange={(e) => setSearchText(e.target.value)}
          />
          <span>{query && `${messages.length}${hasMore ? '+' : ''} found`}</span>
          <IconButton
            icon={X}
            label="Close message search"
            onClick={() => {
              setSearchOpen(false);
              setSearchText('');
            }}
          />
        </div>
      )}
      <div
        className="messages-area"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          setShowScroll(!nearBottom.current);
        }}
      >
        {loading ? (
          <Spinner label="Loading conversation…" />
        ) : (
          <>
            {hasMore && (
              <button className="load-older" disabled={olderBusy} onClick={older}>
                {olderBusy ? 'Loading…' : query ? 'Load more matches' : 'Load earlier messages'}
              </button>
            )}
            {!query && (
              <div className="conversation-notice">
                <span>👋</span> A little hello can go a long way.
              </div>
            )}
            {!messages.length && (
              <Empty title={query ? 'No matching messages' : 'This is the start of something'}>
                {query ? 'Try another word or clear your search.' : `Say hello to ${chat.name}.`}
              </Empty>
            )}
            {messages.map((m, i) => (
              <div key={m.id}>
                {(!i || day(m.createdAt) !== day(messages[i - 1].createdAt)) && (
                  <div className="date-divider">
                    <span>{day(m.createdAt)}</span>
                  </div>
                )}
                <Message
                  message={m}
                  mine={m.sender.id === user.id}
                  group={chat.type === 'group'}
                  onAction={messageAction}
                  onImage={setLightbox}
                />
              </div>
            ))}
            {typers.length > 0 && (
              <div className="typing-bubble">
                <i />
                <i />
                <i />
                <small>{typers.join(', ')}</small>
              </div>
            )}
          </>
        )}
      </div>
      {showScroll && (
        <button
          className="scroll-bottom"
          aria-label="Scroll to latest message"
          onClick={() => {
            nearBottom.current = true;
            scroller.current.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
          }}
        >
          <ArrowDown size={20} />
        </button>
      )}
      <div className="composer-wrap">
        <ErrorNote error={error} />
        {reply && (
          <div className="reply-preview">
            <Reply size={20} />
            <div>
              <b>Replying to {reply.sender.name}</b>
              <span>{preview(reply)}</span>
            </div>
            <IconButton icon={X} label="Cancel reply" onClick={() => setReply(null)} />
          </div>
        )}
        {file && (
          <div className="attachment-preview">
            {filePreview ? (
              <img src={filePreview} alt="Attachment preview" />
            ) : (
              <FileText size={27} />
            )}
            <div>
              <b>{file.name}</b>
              <span>{fileSize(file.size)} · Ready to send</span>
            </div>
            <IconButton
              icon={X}
              label="Remove attachment"
              disabled={sending}
              onClick={() => {
                setFile(null);
                setAttachment(null);
                clientId.current = null;
              }}
            />
          </div>
        )}
        {emoji && (
          <div className="emoji-picker" aria-label="Choose an emoji">
            {EMOJI.map((e) => (
              <button
                key={e}
                onClick={() => {
                  changeText(text + e);
                  input.current?.focus();
                }}
                aria-label={`Insert ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}
        {chat.blocked ? (
          <div className="blocked-banner">
            <Ban size={18} /> You blocked this contact. Open conversation details to unblock.
          </div>
        ) : recording ? (
          <div className="recording-bar">
            <span className="record-dot" />
            <b>Recording</b>
            <time>
              {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, '0')}
            </time>
            <span className="record-hint">Up to 2 minutes</span>
            <IconButton
              icon={Trash2}
              label="Discard recording"
              onClick={() => {
                discard.current = true;
                recorder.current.stop();
              }}
            />
            <button
              className="send-button"
              aria-label="Finish recording"
              onClick={() => recorder.current.stop()}
            >
              <Square size={19} fill="currentColor" />
            </button>
          </div>
        ) : (
          <form className="composer" onSubmit={send}>
            <IconButton
              icon={Smile}
              label="Choose emoji"
              onClick={() => setEmoji(!emoji)}
              disabled={sending}
            />
            <IconButton
              icon={Paperclip}
              label="Attach a file"
              onClick={() => fileInput.current.click()}
              disabled={sending}
            />
            <input
              hidden
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,audio/*,.pdf,.zip,.txt"
              onChange={(e) => {
                chooseFile(e.target.files[0]);
                e.target.value = '';
              }}
            />
            <textarea
              ref={input}
              aria-label="Type a message"
              rows={1}
              placeholder="Type a message…"
              maxLength={8000}
              value={text}
              disabled={sending}
              onChange={(e) => changeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {text.trim() || file ? (
              <button
                className="send-button"
                aria-label="Send message"
                disabled={sending || !connected}
              >
                {sending ? <LoaderCircle className="spin" size={21} /> : <Send size={20} />}
              </button>
            ) : (
              <button
                type="button"
                className="send-button"
                aria-label="Record a voice note"
                disabled={recordPending || !connected}
                onClick={startRecording}
              >
                {recordPending ? <LoaderCircle className="spin" size={21} /> : <Mic size={22} />}
              </button>
            )}
          </form>
        )}
        <div className="composer-caption">
          {sending ? 'Sending your message…' : 'Enter to send · Shift + Enter for a new line'}
        </div>
      </div>
      {action && (
        <Modal
          title={action.type === 'delete' ? 'Delete this message?' : 'Edit message'}
          onClose={() => setAction(null)}
        >
          <form className="modal-content" onSubmit={commitAction}>
            {action.type === 'delete' ? (
              <p>
                This will replace your message with “This message was deleted” for everyone in this
                conversation.
              </p>
            ) : (
              <label>
                Message
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={5}
                  maxLength={8000}
                  required
                />
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setAction(null)}>
                Cancel
              </button>
              <button className={action.type === 'delete' ? 'danger' : 'primary'}>
                {action.type === 'delete' ? 'Delete for everyone' : 'Save message'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {lightbox && (
        <Modal title={lightbox.name} onClose={() => setLightbox(null)} wide>
          <div className="lightbox">
            <img src={lightbox.url} alt={lightbox.name} />
            <a className="secondary" href={`${lightbox.url}?download=1`} download>
              <Download size={17} /> Download image
            </a>
          </div>
        </Modal>
      )}
    </section>
  );
}
