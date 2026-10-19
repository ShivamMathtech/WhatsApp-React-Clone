import { useState } from 'react';
import {
  Search,
  Plus,
  MessageSquarePlus,
  MoreVertical,
  Archive,
  Pin,
  BellOff,
  Phone,
  Video,
  ArrowDownLeft,
  ArrowUpRight,
  Pencil,
  Camera,
  CircleDashed,
  Check,
  X,
} from 'lucide-react';
import { Avatar, Empty, IconButton, Receipt, Spinner } from './UI.jsx';
import { day, preview, relative, time } from '../api.js';

export default function Sidebar({
  tab,
  user,
  chats,
  statuses,
  calls,
  activeId,
  loading,
  connected,
  onSelect,
  onNew,
  onSettings,
  onStatus,
  onComposeStatus,
  onCall,
}) {
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all');
  const filtered = chats.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'archived' ? c.archived : !c.archived) &&
      (filter !== 'unread' || c.unread > 0) &&
      (filter !== 'groups' || c.type === 'group'),
  );
  const statusGroups = [
    ...new Set(statuses.filter((s) => s.user.id !== user.id).map((s) => s.user.id)),
  ].map((id) => statuses.filter((s) => s.user.id === id));
  const mine = statuses.filter((s) => s.user.id === user.id);
  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div>
          <h1>
            {tab === 'chats' ? 'Chats' : tab === 'status' ? 'Updates' : 'Calls'}
            <span className="heading-dot">.</span>
          </h1>
          <p>
            {tab === 'chats'
              ? 'Your people, one conversation away'
              : tab === 'status'
                ? 'Little moments from your circle'
                : 'A familiar voice goes a long way'}
          </p>
        </div>
        <div className="header-actions">
          <IconButton
            icon={tab === 'chats' ? MessageSquarePlus : tab === 'status' ? Pencil : Phone}
            label={tab === 'chats' ? 'New chat' : tab === 'status' ? 'Add status' : 'New call'}
            onClick={tab === 'status' ? onComposeStatus : onNew}
          />
          <IconButton icon={MoreVertical} label="Open settings" onClick={onSettings} />
        </div>
      </header>
      {!connected && (
        <div className="connection-banner">
          <span className="pulse-dot" /> Connecting to your conversations…
        </div>
      )}
      {tab === 'chats' && (
        <>
          <div className="sidebar-search">
            <Search size={18} />
            <input
              aria-label="Search conversations"
              placeholder="Search or start a new chat"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search">
                <X size={15} />
              </button>
            )}
          </div>
          <div className="chat-filters">
            {[
              ['all', 'All'],
              ['unread', 'Unread'],
              ['groups', 'Groups'],
              ['archived', 'Archived'],
            ].map(([id, title]) => (
              <button
                key={id}
                className={id === filter ? 'active' : ''}
                onClick={() => setFilter(id)}
              >
                {title}
                {id === 'unread' && chats.some((c) => c.unread) && <i />}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="sidebar-scroll">
        {loading ? (
          <Spinner label="Getting your conversations…" />
        ) : tab === 'chats' ? (
          <>
            <div className="list-caption">
              {filter === 'archived' ? (
                <>
                  <Archive size={13} /> ARCHIVED CONVERSATIONS
                </>
              ) : filter === 'groups' ? (
                'YOUR CIRCLES'
              ) : (
                'MESSAGES'
              )}
              <span>{filtered.length}</span>
            </div>
            {!filtered.length && (
              <Empty
                title={
                  query
                    ? 'No conversations found'
                    : filter === 'unread'
                      ? 'All caught up'
                      : 'Say your first hello'
                }
              >
                {query ? (
                  'Try a different name.'
                ) : filter === 'unread' ? (
                  'You have no unread messages.'
                ) : (
                  <button className="text-button" onClick={onNew}>
                    Start a new conversation
                  </button>
                )}
              </Empty>
            )}
            {filtered.map((c) => (
              <button
                key={c.id}
                className={`chat-row ${c.id === activeId ? 'selected' : ''}`}
                onClick={() => onSelect(c.id)}
              >
                <Avatar
                  user={c}
                  group={c.type === 'group'}
                  size={49}
                  online={c.type === 'direct' && c.peer?.online}
                />
                <span className="chat-row-content">
                  <span className="chat-row-top">
                    <b>{c.name}</b>
                    <time className={c.unread ? 'unread-time' : ''}>
                      {c.lastMessage
                        ? day(c.lastMessage.createdAt) === 'Today'
                          ? time(c.lastMessage.createdAt)
                          : day(c.lastMessage.createdAt)
                        : ''}
                    </time>
                  </span>
                  <span className="chat-row-bottom">
                    <span className="chat-preview">
                      {c.lastMessage?.sender?.id === user.id && (
                        <Receipt status={c.lastMessage.status} />
                      )}
                      {c.type === 'group' && c.lastMessage && (
                        <span>
                          {c.lastMessage.sender.id === user.id
                            ? 'You'
                            : c.lastMessage.sender.name.split(' ')[0]}
                          :{' '}
                        </span>
                      )}
                      {preview(c.lastMessage)}
                    </span>
                    <span className="chat-row-badges">
                      {c.muted && <BellOff size={13} />}
                      {c.pinned && <Pin size={13} />}
                      {c.unread > 0 && (
                        <b className="unread-count">{c.unread > 99 ? '99+' : c.unread}</b>
                      )}
                    </span>
                  </span>
                </span>
              </button>
            ))}
            <div className="list-end">
              <MessageSquarePlus size={14} />
              <span>A good conversation starts with hello.</span>
            </div>
          </>
        ) : tab === 'status' ? (
          <>
            <div className="my-status">
              <button
                className="status-avatar-button"
                onClick={() => (mine.length ? onStatus(mine) : onComposeStatus())}
              >
                <Avatar user={user} size={54} ring={mine.length > 0} />
                {!mine.length && (
                  <i>
                    <Plus size={15} />
                  </i>
                )}
              </button>
              <button
                className="status-main"
                onClick={() => (mine.length ? onStatus(mine) : onComposeStatus())}
              >
                <b>My status</b>
                <span>
                  {mine.length
                    ? `${mine.length} update${mine.length === 1 ? '' : 's'} · Tap to view`
                    : 'Share a little of your day'}
                </span>
              </button>
              <IconButton icon={Plus} label="Add a status update" onClick={onComposeStatus} />
            </div>
            <div className="list-caption">
              RECENT UPDATES<span>{statusGroups.length}</span>
            </div>
            {statusGroups.length ? (
              statusGroups.map((group) => (
                <button className="chat-row" key={group[0].user.id} onClick={() => onStatus(group)}>
                  <Avatar user={group[0].user} size={52} ring={group.some((s) => !s.viewed)} />
                  <span className="contact-copy">
                    <b>{group[0].user.name}</b>
                    <small>
                      {relative(group[0].createdAt)}
                      {group.every((s) => s.viewed) && ' · Viewed'}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <Empty icon={CircleDashed} title="A moment worth sharing">
                Updates from people you share conversations with appear here for 24 hours.
              </Empty>
            )}
            <div className="status-tip">
              <CircleDashed size={19} />
              <p>
                Here today, gone tomorrow.
                <br />
                <span>Status updates disappear after 24 hours.</span>
              </p>
            </div>
          </>
        ) : (
          <>
            <button className="new-call-row" onClick={onNew}>
              <span>
                <Phone size={22} />
              </span>
              <div>
                <b>Start a conversation</b>
                <small>Choose a contact, then tap the call icon</small>
              </div>
              <Plus size={20} />
            </button>
            <div className="list-caption">
              RECENT CALLS<span>{calls.length}</span>
            </div>
            {calls.length ? (
              calls.map((c) => (
                <div className="chat-row call-history-row" key={c.id}>
                  <Avatar user={c.peer} size={48} />
                  <button className="contact-copy" onClick={() => onSelect(c.chatId)}>
                    <b className={c.status === 'missed' ? 'missed' : ''}>{c.peer.name}</b>
                    <small>
                      {c.direction === 'outgoing' ? (
                        <ArrowUpRight size={15} />
                      ) : (
                        <ArrowDownLeft size={15} />
                      )}{' '}
                      {c.status === 'missed' ? 'Missed · ' : ''}
                      {day(c.createdAt)}, {time(c.createdAt)}
                      {c.duration > 0 && ` · ${Math.floor(c.duration / 60)}m ${c.duration % 60}s`}
                    </small>
                  </button>
                  <IconButton
                    icon={c.mode === 'video' ? Video : Phone}
                    label={`Call ${c.peer.name}`}
                    onClick={() => onCall(c.chatId, c.mode)}
                  />
                </div>
              ))
            ) : (
              <Empty icon={Phone} title="Hear their hello">
                Your incoming, outgoing, and missed calls will appear here.
              </Empty>
            )}
          </>
        )}
      </div>
      <button
        className="mobile-fab"
        aria-label={tab === 'status' ? 'Add status' : tab === 'calls' ? 'New call' : 'New chat'}
        onClick={tab === 'status' ? onComposeStatus : onNew}
      >
        {tab === 'status' ? (
          <Pencil size={23} />
        ) : tab === 'calls' ? (
          <Phone size={23} />
        ) : (
          <MessageSquarePlus size={23} />
        )}
      </button>
      <footer className="sidebar-footer">
        <span className={`connection-dot ${connected ? 'online' : ''}`} />
        {connected ? 'Connected · Messages sync in real time' : 'Reconnecting…'}
      </footer>
    </aside>
  );
}
