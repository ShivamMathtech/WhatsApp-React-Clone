import { useEffect, useState } from 'react';
import { Search, Check, Users, ArrowRight } from 'lucide-react';
import { api } from '../api.js';
import { Avatar, Empty, ErrorNote, Modal, Spinner } from './UI.jsx';

export default function NewChat({ onClose, onCreated, addTo = null }) {
  const [query, setQuery] = useState(''),
    [users, setUsers] = useState([]),
    [loading, setLoading] = useState(true);
  const [group, setGroup] = useState(!!addTo),
    [selected, setSelected] = useState([]),
    [name, setName] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      api(`/users?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((r) => setUsers(r.users.filter((u) => !addTo?.members.some((m) => m.id === u.id))))
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, addTo]);
  async function create(ids) {
    setBusy(true);
    setError('');
    try {
      const r = addTo
        ? await api(`/chats/${addTo.id}/members`, { method: 'POST', body: { userIds: ids } })
        : await api('/chats', {
            method: 'POST',
            body: { type: group ? 'group' : 'direct', userIds: ids, ...(group ? { name } : {}) },
          });
      await onCreated(r.chat);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={addTo ? 'Add participants' : group ? 'New group' : 'New chat'} onClose={onClose}>
      <div className="modal-content">
        {!addTo && (
          <div className="segmented">
            <button className={!group ? 'active' : ''} onClick={() => setGroup(false)}>
              Direct message
            </button>
            <button className={group ? 'active' : ''} onClick={() => setGroup(true)}>
              <Users size={16} /> New group
            </button>
          </div>
        )}
        {group && !addTo && (
          <label>
            Group name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Give your circle a name"
            />
          </label>
        )}
        <div className="search-field">
          <Search size={18} />
          <input
            aria-label="Find a person"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or exact email address"
          />
        </div>
        <p className="field-hint">
          Find people who have registered on this app. {group && `${selected.length} selected.`}
        </p>
        <ErrorNote error={error} />
        <div className="contacts-list">
          {loading ? (
            <Spinner />
          ) : users.length ? (
            users.map((u) => (
              <button
                key={u.id}
                className="contact-row"
                disabled={busy}
                onClick={() =>
                  group
                    ? setSelected((s) =>
                        s.includes(u.id) ? s.filter((id) => id !== u.id) : [...s, u.id],
                      )
                    : create([u.id])
                }
              >
                <Avatar user={u} online={u.online} />
                <span className="contact-copy">
                  <b>{u.name}</b>
                  <small>{u.about}</small>
                </span>
                {group && (
                  <span className={`checkbox ${selected.includes(u.id) ? 'checked' : ''}`}>
                    {selected.includes(u.id) && <Check size={14} />}
                  </span>
                )}
              </button>
            ))
          ) : (
            <Empty title="Find your people">
              Search a name or an exact email address. New users need to create their own account
              first.
            </Empty>
          )}
        </div>
        {group && (
          <button
            className="primary full"
            disabled={!selected.length || (!addTo && !name.trim()) || busy}
            onClick={() => create(selected)}
          >
            {busy ? 'Saving…' : addTo ? 'Add participants' : 'Create group'}
            <ArrowRight size={18} />
          </button>
        )}
      </div>
    </Modal>
  );
}
