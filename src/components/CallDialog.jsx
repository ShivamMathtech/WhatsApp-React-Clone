import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, Phone, PhoneOff } from 'lucide-react';
import { Avatar, IconButton } from './UI.jsx';

function Stream({ stream, muted, className }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}
export default function CallDialog({ controls, user }) {
  const {
    call,
    localStream,
    remoteStream,
    accept,
    end,
    muted,
    cameraOff,
    toggleMute,
    toggleCamera,
  } = controls;
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!call) return null;
  const peer = call.caller.id === user.id ? call.callee : call.caller;
  const seconds = call.connectedAt ? Math.max(0, Math.floor((tick - call.connectedAt) / 1000)) : 0;
  const duration = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  return (
    <div
      className="call-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${call.mode} call with ${peer.name}`}
    >
      <div className={`call-card ${call.mode === 'video' && remoteStream ? 'has-video' : ''}`}>
        {remoteStream && (
          <Stream
            stream={remoteStream}
            className={call.mode === 'video' ? 'remote-video' : 'audio-only'}
          />
        )}
        <div className="call-heading">
          <span className="eyebrow">WHATSAPP CLONE · {call.mode.toUpperCase()} CALL</span>
          <Avatar user={peer} size={104} />
          <h2>{peer.name}</h2>
          <p aria-live="polite">
            {call.phase === 'connected'
              ? duration
              : {
                  incoming: `Incoming ${call.mode} call`,
                  preparing: 'Waiting for microphone permission…',
                  ringing: 'Ringing…',
                  connecting: 'Connecting…',
                }[call.phase]}
          </p>
        </div>
        {localStream && call.mode === 'video' && !cameraOff && (
          <Stream stream={localStream} muted className="local-video" />
        )}
        <div className="call-controls">
          {call.phase === 'incoming' ? (
            <>
              <button className="call-round decline" onClick={end}>
                <PhoneOff />
                <span>Decline</span>
              </button>
              <button className="call-round accept" onClick={accept}>
                <Phone />
                <span>Accept</span>
              </button>
            </>
          ) : (
            <>
              <IconButton
                icon={muted ? MicOff : Mic}
                label={muted ? 'Unmute microphone' : 'Mute microphone'}
                onClick={toggleMute}
                className={muted ? 'toggled' : ''}
              />
              {call.mode === 'video' && (
                <IconButton
                  icon={cameraOff ? VideoOff : Video}
                  label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
                  onClick={toggleCamera}
                />
              )}
              <button className="call-round decline" onClick={end} aria-label="End call">
                <PhoneOff />
              </button>
            </>
          )}
        </div>
        <small className="call-footnote">Browser-to-browser connection</small>
      </div>
    </div>
  );
}
