export async function api(url, options = {}) {
  const { body, ...rest } = options;
  const multipart = body instanceof FormData;
  const response = await fetch(`/api${url}`, {
    ...rest,
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'ChatApp',
      ...(!multipart && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...rest.headers,
    },
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    signal: rest.signal || AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return data;
}
export const uploadFile = (url, file) => {
  const body = new FormData();
  body.append('file', file);
  return api(url, { method: 'POST', body });
};
export const time = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const relative = (ts) => {
  const minutes = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (!minutes) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
};
export const day = (ts) => {
  const d = new Date(ts),
    today = new Date(),
    yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  return d.toDateString() === today.toDateString()
    ? 'Today'
    : d.toDateString() === yesterday.toDateString()
      ? 'Yesterday'
      : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};
export const preview = (m) =>
  !m
    ? 'Start a conversation'
    : m.kind === 'deleted'
      ? 'This message was deleted'
      : m.text ||
        { image: '📷 Photo', video: '🎬 Video', audio: '🎙 Voice message', file: '📎 Document' }[
          m.kind
        ] ||
        'Message';
export const fileSize = (n) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;
export const COLORS = ['#008069', '#7c69aa', '#b77946', '#497da7', '#c26b80', '#597b5e'];
