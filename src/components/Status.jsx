import { useEffect, useState } from 'react';
import { ImagePlus, Check, Trash2, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { api, COLORS, relative, uploadFile } from '../api.js';
import { Avatar, ErrorNote, IconButton, Modal } from './UI.jsx';

export function StatusComposer({ onClose, onSaved }) {
  const [text, setText] = useState(''),
    [color, setColor] = useState(COLORS[0]),
    [file, setFile] = useState(null),
    [image, setImage] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!file) {
      setImage('');
      return;
    }
    const url = URL.createObjectURL(file);
    setImage(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function post(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const attachmentId = file
        ? (await uploadFile('/statuses/upload', file)).attachment.id
        : undefined;
      await api('/statuses', { method: 'POST', body: { text, color, attachmentId } });
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Share a status" onClose={onClose}>
      <form className="modal-content" onSubmit={post}>
        <div className="status-compose" style={{ backgroundColor: color }}>
          {image && <img src={image} alt="Status preview" />}
          <textarea
            aria-label="Status text"
            placeholder="What’s on your mind?"
            maxLength={700}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="status-tools">
          <div className="color-picker">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                aria-label={`Use ${c} background`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              >
                {c === color && <Check size={16} />}
              </button>
            ))}
          </div>
          <label className="file-button" title="Add an image">
            <ImagePlus size={23} />
            <span className="sr-only">Status image</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => setFile(e.target.files[0] || null)}
            />
          </label>
          {file && <IconButton icon={Trash2} label="Remove image" onClick={() => setFile(null)} />}
        </div>
        <p className="field-hint">
          Visible for 24 hours to people you share a chat with. Images up to 5 MB.
        </p>
        <ErrorNote error={error} />
        <button className="primary full" disabled={busy || (!text.trim() && !file)}>
          {busy ? 'Sharing…' : 'Share status'}
        </button>
      </form>
    </Modal>
  );
}
export function StatusViewer({ statuses, user, onClose, onChange, toast }) {
  const [index, setIndex] = useState(0),
    [confirm, setConfirm] = useState(false);
  const status = statuses[index];
  useEffect(() => {
    if (status)
      api(`/statuses/${status.id}/view`, { method: 'POST' })
        .then(onChange)
        .catch((e) => toast(e.message));
  }, [status?.id]);
  if (!status) return null;
  async function remove() {
    try {
      await api(`/statuses/${status.id}`, { method: 'DELETE' });
      onChange();
      onClose();
      toast('Status deleted.');
    } catch (e) {
      toast(e.message);
    }
  }
  return (
    <Modal title="Status update" onClose={onClose} className="status-viewer">
      <div className="status-progress">
        {statuses.map((s, i) => (
          <button
            key={s.id}
            aria-label={`Show status ${i + 1}`}
            className={i <= index ? 'active' : ''}
            onClick={() => {
              setIndex(i);
              setConfirm(false);
            }}
          />
        ))}
      </div>
      <div className="status-person">
        <Avatar user={status.user} size={39} />
        <div>
          <b>{status.user.name}</b>
          <small>{relative(status.createdAt)}</small>
        </div>
        {status.user.id === user.id && (
          <IconButton icon={Trash2} label="Delete status" onClick={() => setConfirm(true)} />
        )}
      </div>
      <div className="status-stage" style={{ background: status.color }}>
        {status.attachment && <img src={status.attachment.url} alt="Status update" />}
        <p>{status.text}</p>
      </div>
      <div className="status-view-footer">
        <IconButton
          icon={ChevronLeft}
          label="Previous status"
          disabled={index === 0}
          onClick={() => {
            setIndex(index - 1);
            setConfirm(false);
          }}
        />
        <span>
          {status.user.id === user.id ? (
            <>
              <Eye size={17} /> {status.views} view{status.views === 1 ? '' : 's'}
            </>
          ) : (
            `${index + 1} of ${statuses.length}`
          )}
        </span>
        <IconButton
          icon={ChevronRight}
          label="Next status"
          disabled={index === statuses.length - 1}
          onClick={() => {
            setIndex(index + 1);
            setConfirm(false);
          }}
        />
      </div>
      {confirm && (
        <div className="inline-confirm">
          Delete this status?
          <button className="danger-text" onClick={remove}>
            Delete
          </button>
          <button className="text-button" onClick={() => setConfirm(false)}>
            Keep it
          </button>
        </div>
      )}
    </Modal>
  );
}
