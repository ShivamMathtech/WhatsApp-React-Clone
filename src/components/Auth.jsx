import { useState } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  MessageCircle,
  CheckCheck,
  Users,
  Phone,
  Sparkles,
  LoaderCircle,
} from 'lucide-react';
import { api } from '../api.js';
import { Avatar, Brand, ErrorNote } from './UI.jsx';

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api(`/auth/${mode}`, {
        method: 'POST',
        body: { email, password, ...(mode === 'register' ? { name } : {}) },
      });
      onAuth(result.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-art">
        <Brand />
        <div className="auth-copy">
          <span className="eyebrow">
            <span /> MADE FOR YOUR EVERYDAY
          </span>
          <h1>
            A little closer.
            <br />
            <span>Every conversation.</span>
          </h1>
          <p>
            Catch up, share a moment, and keep your people close. All in a familiar little space.
          </p>
        </div>
        <div className="chat-illustration" aria-hidden="true">
          <div className="floating-orbit orbit-one" />
          <div className="floating-orbit orbit-two" />
          <div className="mini-chat-card">
            <div className="mini-chat-header">
              <Avatar user={{ name: 'Mahnoor', color: '#b77946' }} size={42} />
              <div>
                <b>Mahnoor</b>
                <small>
                  <span className="tiny-dot" /> Online
                </small>
              </div>
              <Phone size={19} />
            </div>
            <span className="mini-day">TODAY</span>
            <div className="mini-bubble">
              Coffee and a catch-up? ☕<small>10:24</small>
            </div>
            <div className="mini-bubble own">
              Always a good idea.
              <small>
                10:24 <CheckCheck size={14} />
              </small>
            </div>
            <div className="mini-bubble">
              See you soon! 🌿<small>10:25</small>
            </div>
            <div className="mini-input">
              Message{' '}
              <span>
                <ArrowRight size={19} />
              </span>
            </div>
          </div>
          <div className="float-badge">
            <Sparkles size={20} /> Small moments. Real connections.
          </div>
        </div>
        <div className="auth-features">
          <span>
            <MessageCircle size={19} /> Real-time chats
          </span>
          <span>
            <Users size={19} /> Your circles
          </span>
          <span>
            <Phone size={19} /> Voice & video
          </span>
        </div>
      </div>
      <div className="auth-form-area">
        <div className="auth-mobile-brand">
          <Brand small />
        </div>
        <form className="auth-form" onSubmit={submit}>
          <span className="eyebrow">LET’S GET YOU CONNECTED</span>
          <h2>{mode === 'login' ? 'Welcome back.' : 'Hello, you.'}</h2>
          <p>
            {mode === 'login'
              ? 'Sign in to pick up where you left off.'
              : 'Create your account. Your people are one hello away.'}
          </p>
          <div className="segmented">
            <button
              type="button"
              className={mode === 'login' ? 'active' : ''}
              onClick={() => {
                setMode('login');
                setError('');
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={mode === 'register' ? 'active' : ''}
              onClick={() => {
                setMode('register');
                setError('');
              }}
            >
              Create account
            </button>
          </div>
          {mode === 'register' && (
            <label>
              Your name
              <input
                autoComplete="name"
                required
                minLength={2}
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="How should we call you?"
              />
            </label>
          )}
          <label>
            Email address
            <input
              type="email"
              autoComplete="username"
              required
              maxLength={200}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password
            <div className="password-input">
              <input
                type={show ? 'text' : 'password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
              <button
                type="button"
                aria-label={show ? 'Hide password' : 'Show password'}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
          </label>
          <ErrorNote error={error} />
          <button className="primary auth-submit" disabled={busy}>
            {busy ? (
              <LoaderCircle size={20} className="spin" />
            ) : (
              <>
                {mode === 'login' ? 'Let’s talk' : 'Create account'}
                <ArrowRight size={20} />
              </>
            )}
          </button>
          <p className="auth-note">
            Your account belongs to this app. Use a new password rather than your WhatsApp
            credentials.
          </p>
          <div className="demo-box">
            <b>Just exploring?</b>
            <p>After running setup, try a local demo account.</p>
            <div>
              {['Shivam', 'Mahnoor'].map((n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() => {
                    setMode('login');
                    setEmail(`${n.toLowerCase()}@demo.local`);
                    setPassword('DemoChat@123');
                    setError('');
                  }}
                >
                  <Avatar
                    user={{ name: n, color: n === 'Shivam' ? '#008069' : '#b77946' }}
                    size={26}
                  />
                  {n}
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
            <small>
              Demo password: <code>DemoChat@123</code>
            </small>
          </div>
        </form>
        <footer>Independent learning project. Not affiliated with WhatsApp or Meta.</footer>
      </div>
    </div>
  );
}
