import { useState } from 'react';
import { Archive, BellOff, Download, LogOut, Pin, Shield, UserPlus, Users, X } from 'lucide-react';
import { api, preview, time } from '../api.js';
import { Avatar, ErrorNote, IconButton, Modal } from './UI.jsx';
import NewChat from './NewChat.jsx';

export default function ChatDetails({ chat, user, onClose, onChange, onLeave, toast }) {
  const [name, setName] = useState(chat.name),
    [addMembers, setAddMembers] = useState(false),
    [confirm, setConfirm] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function change(values) {
    setBusy(true);
    setError('');
    try {
      await api(`/chats/${chat.id}`, { method: 'PATCH', body: values });
      await onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id) {
    setBusy(true);
    try {
      await api(`/chats/${chat.id}/members/${id}`, { method: 'DELETE' });
      setConfirm(null);
      if (id === user.id) {
        onLeave();
        onClose();
      }
      await onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function block() {
    setBusy(true);
    try {
      await api(`/users/${chat.peer.id}/block`, {
        method: 'POST',
        body: { blocked: !chat.blocked },
      });
      await onChange();
      setConfirm(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function exportChat() {
    setBusy(true);
    setError('');
    try {
      let rows = [],
        before = '',
        hasMore = true;
      while (hasMore) {
        const r = await api(`/chats/${chat.id}/messages${before ? `?before=${before}` : ''}`);
        rows = [...r.messages, ...rows];
        hasMore = r.hasMore;
        before = r.messages[0]?.id;
      }
      const content = [
        `Conversation: ${chat.name}`,
        `Exported: ${new Date().toISOString()}`,
        'Attachments are listed by filename, not embedded.',
        '',
        ...rows.map(
          (m) =>
            `[${new Date(m.createdAt).toLocaleString()}] ${m.sender.name}: ${preview(m)}${m.attachment ? ` [${m.attachment.name}]` : ''}`,
        ),
      ].join('\n');
      const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${chat.name.replace(/[^a-z0-9]+/gi, '-')}-chat.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Conversation exported.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!addMembers && (
        <Modal title={chat.type === 'group' ? 'Group info' : 'Contact info'} onClose={onClose}>
          <div className="modal-content chat-details">
            <div className="contact-hero">
              <Avatar user={chat} group={chat.type === 'group'} size={96} />
              <h2>{chat.name}</h2>
              <p>
                {chat.type === 'group'
                  ? `Group · ${chat.members.length} participants`
                  : chat.peer.about}
              </p>
            </div>
            <ErrorNote error={error} />
            {chat.type === 'group' && chat.ownerId === user.id && (
              <form
                className="rename-group"
                onSubmit={(e) => {
                  e.preventDefault();
                  change({ name });
                }}
              >
                <label>
                  Group name
                  <input
                    value={name}
                    maxLength={80}
                    required
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <button className="secondary" disabled={busy || name === chat.name}>
                  Save
                </button>
              </form>
            )}
            <div className="detail-options">
              {[
                [Pin, 'Pin conversation', 'pinned'],
                [BellOff, 'Mute notifications', 'muted'],
                [Archive, 'Archive conversation', 'archived'],
              ].map(([Icon, label, key]) => (
                <button key={key} onClick={() => change({ [key]: !chat[key] })} disabled={busy}>
                  <Icon size={19} />
                  <span>{label}</span>
                  <span
                    className={`toggle ${chat[key] ? 'on' : ''}`}
                    role="switch"
                    aria-checked={chat[key]}
                    aria-label={label}
                  />
                </button>
              ))}
              <button onClick={exportChat} disabled={busy}>
                <Download size={19} />
                <span>Export conversation</span>
              </button>
            </div>
            {chat.type === 'group' ? (
              <>
                <div className="participants-heading">
                  <h3>{chat.members.length} participants</h3>
                  {chat.ownerId === user.id && (
                    <IconButton
                      icon={UserPlus}
                      label="Add participants"
                      onClick={() => setAddMembers(true)}
                    />
                  )}
                </div>
                <div className="participant-list">
                  {chat.members.map((m) => (
                    <div key={m.id} className="participant">
                      <Avatar user={m} size={36} />
                      <span>
                        <b>{m.id === user.id ? 'You' : m.name}</b>
                        <small>{m.id === chat.ownerId ? 'Group admin' : m.about}</small>
                      </span>
                      {chat.ownerId === user.id && m.id !== user.id && (
                        <IconButton
                          icon={X}
                          label={`Remove ${m.name}`}
                          onClick={() => setConfirm({ type: 'remove', user: m })}
                        />
                      )}
                    </div>
                  ))}
                </div>
                <button className="danger-text" onClick={() => setConfirm({ type: 'leave' })}>
                  <LogOut size={19} />
                  Leave group
                </button>
              </>
            ) : (
              <button
                className={chat.blocked ? 'text-button' : 'danger-text'}
                onClick={() => setConfirm({ type: 'block' })}
              >
                <Shield size={19} />
                {chat.blocked ? 'Unblock' : 'Block'} {chat.name}
              </button>
            )}
            {confirm && (
              <div className="confirm-panel">
                <h3>
                  {confirm.type === 'leave'
                    ? 'Leave this group?'
                    : confirm.type === 'remove'
                      ? `Remove ${confirm.user.name}?`
                      : `${chat.blocked ? 'Unblock' : 'Block'} ${chat.name}?`}
                </h3>
                <p>
                  {confirm.type === 'leave'
                    ? 'You will lose access to this group’s messages. If you are the admin, another member will become admin.'
                    : confirm.type === 'remove'
                      ? 'This person will no longer have access to the group or its files.'
                      : chat.blocked
                        ? 'You will be able to exchange messages and calls again.'
                        : 'Direct messages, calls, and status sharing will be blocked. Shared group conversations are unaffected.'}
                </p>
                <div className="modal-actions">
                  <button className="secondary" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      confirm.type === 'block'
                        ? block()
                        : remove(confirm.type === 'leave' ? user.id : confirm.user.id)
                    }
                  >
                    Confirm
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
      {addMembers && (
        <NewChat addTo={chat} onClose={() => setAddMembers(false)} onCreated={() => onChange()} />
      )}
    </>
  );
}
