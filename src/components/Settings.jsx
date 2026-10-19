import { useState, useRef } from 'react';
import {
  Camera,
  Moon,
  Sun,
  Bell,
  LogOut,
  KeyRound,
  ShieldCheck,
  Monitor,
  Check,
} from 'lucide-react';
import { api, COLORS, uploadFile } from '../api.js';
import { Avatar, ErrorNote, Modal } from './UI.jsx';

export default function Settings({ user, setUser, theme, setTheme, onClose, onLogout, toast }) {
  const [name, setName] = useState(user.name),
    [about, setAbout] = useState(user.about),
    [color, setColor] = useState(user.color);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [current, setCurrent] = useState(''),
    [password, setPassword] = useState('');
  const [section, setSection] = useState('profile');
  const file = useRef(null);
  const [notification, setNotification] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/profile', { method: 'PATCH', body: { name, about, color } });
      setUser(r.user);
      toast('Profile updated.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function avatar(e) {
    const image = e.target.files?.[0];
    if (!image) return;
    setBusy(true);
    setError('');
    try {
      const r = await uploadFile('/profile/avatar', image);
      setUser(r.user);
      toast('Profile photo updated.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }
  async function changePassword(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/profile/password', { method: 'POST', body: { current, password } });
      setCurrent('');
      setPassword('');
      toast('Password changed. Other sessions have been signed out.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="settings-layout">
        <nav className="settings-nav">
          {[
            ['profile', 'Your profile'],
            ['appearance', 'Appearance & alerts'],
            ['account', 'Account & privacy'],
          ].map(([id, title]) => (
            <button
              key={id}
              className={section === id ? 'active' : ''}
              onClick={() => {
                setSection(id);
                setError('');
              }}
            >
              {title}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          <ErrorNote error={error} />
          {section === 'profile' && (
            <form onSubmit={save}>
              <div className="profile-photo">
                <Avatar user={{ ...user, name, color }} size={104} />
                <button
                  type="button"
                  aria-label="Change profile photo"
                  disabled={busy}
                  onClick={() => file.current.click()}
                >
                  <Camera size={19} />
                </button>
                <input
                  hidden
                  ref={file}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={avatar}
                />
              </div>
              <p className="center muted">Your profile, your way.</p>
              <label>
                Your name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  minLength={2}
                  maxLength={60}
                  required
                />
              </label>
              <label>
                About
                <textarea
                  rows={3}
                  maxLength={160}
                  value={about}
                  onChange={(e) => setAbout(e.target.value)}
                />
                <small>{about.length}/160</small>
              </label>
              <label>
                Avatar color
                <span className="color-picker">
                  {COLORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      style={{ background: c }}
                      aria-label={`Use ${c} avatar color`}
                      className={color === c ? 'chosen' : ''}
                      onClick={() => setColor(c)}
                    >
                      {color === c && <Check size={17} />}
                    </button>
                  ))}
                </span>
              </label>
              <button className="primary full" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </form>
          )}
          {section === 'appearance' && (
            <>
              <h3>Make yourself at home</h3>
              <p className="muted">Choose a look that feels right.</p>
              <div className="theme-options">
                {[
                  ['light', Sun, 'Light'],
                  ['dark', Moon, 'Dark'],
                  ['system', Monitor, 'System'],
                ].map(([id, Icon, title]) => (
                  <button
                    key={id}
                    className={theme === id ? 'active' : ''}
                    onClick={() => setTheme(id)}
                  >
                    <Icon size={25} />
                    {title}
                  </button>
                ))}
              </div>
              <div className="settings-divider" />
              <div className="settings-info">
                <Bell size={22} />
                <div>
                  <h3>Desktop notifications</h3>
                  <p>
                    Get notified of new messages when this app’s tab is hidden. Muted conversations
                    stay quiet.
                  </p>
                  <button
                    className="secondary"
                    disabled={notification === 'granted' || notification === 'unsupported'}
                    onClick={async () => {
                      try {
                        setNotification(await Notification.requestPermission());
                      } catch {
                        toast('Notifications are unavailable in this browser.');
                      }
                    }}
                  >
                    {notification === 'granted'
                      ? 'Notifications enabled'
                      : notification === 'unsupported'
                        ? 'Not supported in this browser'
                        : 'Enable notifications'}
                  </button>
                  {notification === 'denied' && (
                    <p>
                      Notifications are blocked. Change permissions in your browser’s site settings.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
          {section === 'account' && (
            <>
              <div className="settings-info">
                <ShieldCheck size={23} />
                <div>
                  <h3>Your account</h3>
                  <p>{user.email}</p>
                  <p>
                    This independent app stores message history and attachments on its server. It
                    does not implement WhatsApp’s end-to-end encryption or connect to real WhatsApp
                    accounts.
                  </p>
                </div>
              </div>
              <div className="settings-divider" />
              <form onSubmit={changePassword}>
                <h3>
                  <KeyRound size={18} /> Change password
                </h3>
                <label>
                  Current password
                  <input
                    type="password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </label>
                <label>
                  New password
                  <input
                    type="password"
                    minLength={8}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </label>
                <button className="secondary" disabled={busy}>
                  Update password
                </button>
              </form>
              <div className="settings-divider" />
              <button className="danger-text" onClick={onLogout}>
                <LogOut size={19} /> Sign out of this account
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
