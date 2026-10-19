import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';

export default function useCalls(socket, user, toast, onEnded) {
  const [call, setCall] = useState(null),
    [localStream, setLocalStream] = useState(null),
    [remoteStream, setRemoteStream] = useState(null);
  const [muted, setMuted] = useState(false),
    [cameraOff, setCameraOff] = useState(false);
  const current = useRef(null),
    local = useRef(null),
    peer = useRef(null),
    candidates = useRef([]),
    config = useRef(null),
    connectingTimer = useRef(null),
    busy = useRef(false);
  const update = (value) => {
    current.current = value;
    setCall(value);
  };
  const cleanup = useCallback(() => {
    clearTimeout(connectingTimer.current);
    connectingTimer.current = null;
    if (peer.current) {
      peer.current.onconnectionstatechange = null;
      peer.current.close();
      peer.current = null;
    }
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    candidates.current = [];
    current.current = null;
    busy.current = false;
    setCall(null);
    setLocalStream(null);
    setRemoteStream(null);
    setMuted(false);
    setCameraOff(false);
  }, []);
  const emit = useCallback(
    (event, data) =>
      new Promise((resolve, reject) => {
        if (!socket?.connected) return reject(new Error('Reconnect before placing a call.'));
        socket.timeout(10000).emit(event, data, (error, result) => {
          if (error) reject(new Error('The call request timed out.'));
          else if (!result?.ok)
            reject(new Error(result?.error || 'The call could not be completed.'));
          else resolve(result);
        });
      }),
    [socket],
  );
  const end = useCallback(async () => {
    const id = current.current?.id;
    if (id && socket?.connected) socket.emit('call:end', { id });
    cleanup();
    onEnded?.();
  }, [socket, cleanup, onEnded]);
  async function media(mode) {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Calls require HTTPS or localhost and a browser with microphone support.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video:
          mode === 'video'
            ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
            : false,
      });
      local.current = stream;
      setLocalStream(stream);
      return stream;
    } catch {
      throw new Error(
        'Could not access your microphone or camera. Check browser permissions and close apps using the device.',
      );
    }
  }
  async function connection() {
    if (peer.current) return peer.current;
    if (!config.current) config.current = await api('/config');
    const pc = new RTCPeerConnection({ iceServers: config.current.iceServers });
    peer.current = pc;
    local.current?.getTracks().forEach((track) => pc.addTrack(track, local.current));
    pc.ontrack = (event) => setRemoteStream(event.streams[0] || new MediaStream([event.track]));
    pc.onicecandidate = (event) => {
      if (event.candidate && current.current)
        socket.emit('call:signal', {
          id: current.current.id,
          signal: { candidate: event.candidate.toJSON() },
        });
    };
    pc.onconnectionstatechange = () => {
      if (!current.current) return;
      if (pc.connectionState === 'connected') {
        clearTimeout(connectingTimer.current);
        update({ ...current.current, phase: 'connected', connectedAt: Date.now() });
      }
      if (pc.connectionState === 'failed') {
        toast('The media connection failed. For different networks, configure a TURN server.');
        end();
      }
    };
    connectingTimer.current = setTimeout(() => {
      if (current.current && current.current.phase !== 'connected') {
        toast('The call could not connect. Check network access and TURN configuration.');
        end();
      }
    }, 30000);
    return pc;
  }
  async function start(chat, mode) {
    if (current.current || busy.current) return;
    busy.current = true;
    try {
      await media(mode);
      const { call } = await emit('call:start', { chatId: chat.id, mode });
      update({ ...call, phase: 'ringing' });
    } catch (e) {
      cleanup();
      toast(e.message);
    } finally {
      busy.current = false;
    }
  }
  async function accept() {
    if (!current.current || busy.current) return;
    busy.current = true;
    const id = current.current.id;
    try {
      update({ ...current.current, phase: 'preparing' });
      await media(current.current.mode);
      if (current.current?.id !== id) {
        cleanup();
        return;
      }
      await connection();
      await emit('call:accept', { id });
      if (current.current) update({ ...current.current, phase: 'connecting' });
    } catch (e) {
      toast(e.message);
      end();
    } finally {
      busy.current = false;
    }
  }
  useEffect(() => {
    if (!socket || !user) return;
    const incoming = (data) => {
      if (!current.current) update({ ...data, phase: 'incoming' });
    };
    const accepted = async ({ id }) => {
      if (current.current?.id !== id) return;
      try {
        update({ ...current.current, phase: 'connecting' });
        const pc = await connection();
        await pc.setLocalDescription(await pc.createOffer());
        await emit('call:signal', { id, signal: { description: pc.localDescription.toJSON() } });
      } catch (e) {
        toast(e.message);
        end();
      }
    };
    const signal = async ({ id, signal }) => {
      if (current.current?.id !== id) return;
      try {
        const pc = await connection();
        if (signal.description) {
          await pc.setRemoteDescription(signal.description);
          for (const candidate of candidates.current) await pc.addIceCandidate(candidate);
          candidates.current = [];
          if (signal.description.type === 'offer') {
            await pc.setLocalDescription(await pc.createAnswer());
            await emit('call:signal', {
              id,
              signal: { description: pc.localDescription.toJSON() },
            });
          }
        } else if (signal.candidate) {
          if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
          else candidates.current.push(signal.candidate);
        }
      } catch (e) {
        toast(`Call connection error: ${e.message}`);
        end();
      }
    };
    const ended = ({ id, status }) => {
      if (current.current?.id === id) {
        cleanup();
        toast(
          {
            missed: 'No answer. Try again later.',
            declined: 'Call declined.',
            cancelled: 'Call cancelled.',
          }[status] || 'Call ended.',
        );
      }
      onEnded?.();
    };
    const handled = ({ id }) => {
      if (current.current?.id === id) cleanup();
    };
    const disconnected = () => {
      if (current.current) {
        cleanup();
        toast('Call ended because the connection was lost.');
      }
    };
    socket
      .on('call:incoming', incoming)
      .on('call:accepted', accepted)
      .on('call:signal', signal)
      .on('call:ended', ended)
      .on('call:handled', handled)
      .on('disconnect', disconnected);
    return () => {
      socket
        .off('call:incoming', incoming)
        .off('call:accepted', accepted)
        .off('call:signal', signal)
        .off('call:ended', ended)
        .off('call:handled', handled)
        .off('disconnect', disconnected);
      cleanup();
    };
    // Socket listeners use refs for active media and call state.
  }, [socket, user?.id, cleanup, emit, toast, onEnded]);
  return {
    call,
    localStream,
    remoteStream,
    start,
    accept,
    end,
    muted,
    cameraOff,
    toggleMute: () => {
      local.current?.getAudioTracks().forEach((t) => {
        t.enabled = muted;
      });
      setMuted(!muted);
    },
    toggleCamera: () => {
      local.current?.getVideoTracks().forEach((t) => {
        t.enabled = cameraOff;
      });
      setCameraOff(!cameraOff);
    },
  };
}
