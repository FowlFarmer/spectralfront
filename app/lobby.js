'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Tutorial from './tutorial';

const sessionKey = 'spectral-front-session';
async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Network request failed');
  return body;
}

export default function Lobby() {
  const router = useRouter();
  const timer = useRef(null);
  const [status, setStatus] = useState('idle');
  const [panel, setPanel] = useState('choose');
  const [message, setMessage] = useState('Join the queue. We pair you with one commander, create a direct connection, then enter the match.');
  const [ticket, setTicket] = useState(null);
  const [privateCode, setPrivateCode] = useState('');
  const [lobbyCode, setLobbyCode] = useState('');
  const [waitingMode, setWaitingMode] = useState('public');

  useEffect(() => () => clearInterval(timer.current), []);

  function watchForMatch(nextTicket) {
    const check = async () => {
      try {
        const found = await api(`/api/join?ticket=${encodeURIComponent(nextTicket)}`);
        if (found.status === 'matched') {
          clearInterval(timer.current);
          sessionStorage.setItem(sessionKey, JSON.stringify({ ticket: nextTicket, ...found }));
          router.push(`/match/${found.matchId}`);
        }
        if (found.status === 'expired') {
          clearInterval(timer.current);
          setStatus('error');
          setMessage('This lobby expired before another commander joined.');
        }
      } catch { /* Keep checking while the lobby service is briefly unavailable. */ }
    };
    check();
    timer.current = setInterval(check, 1400);
  }

  async function begin(mode, code) {
    clearInterval(timer.current);
    const nextTicket = crypto.randomUUID();
    setTicket(nextTicket);
    setWaitingMode(mode);
    setStatus('waiting');
    try {
      const result = await api('/api/join', { method: 'POST', body: JSON.stringify({ ticket: nextTicket, mode, code }) });
      if (mode === 'private-create') setLobbyCode(result.code);
      watchForMatch(nextTicket);
    } catch (error) {
      setStatus('error');
      setMessage(error.message);
    }
  }

  async function cancel() {
    clearInterval(timer.current);
    await api('/api/join', { method: 'DELETE', body: JSON.stringify({ ticket }) }).catch(() => {});
    setStatus('idle');
    setPanel('choose');
    setLobbyCode('');
  }

  function playBot() { sessionStorage.removeItem(sessionKey); router.push(`/match/bot-${crypto.randomUUID()}`); }
  function normalizeCode(value) { setPrivateCode(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)); }

  const isPrivateHost = waitingMode === 'private-create';
  return <div className="shell"><header className="top"><div className="brand">SPECTRAL <i>FRONT</i></div><div className="top-note">CASUAL P2P TACTICAL DUEL</div></header><section className="lobby"><div><div className="eyebrow">SECTOR 01 / OPEN QUEUE</div><h1>Shape the arc.<br /><span>Out-math the enemy.</span></h1><p className="lede">A small tactical duel of plotted functions. Face another commander over a direct link, invite one to a private lobby, or train against the onboard navigation AI.</p></div><div>{status === 'idle' && panel === 'choose' && <section className="join-card"><h2>Choose your opponent</h2><p>Every shot follows the same physics. Only the other commander changes.</p><div className="mode-grid"><button className="mode-card" onClick={() => begin('public')}><span className="mode-index">01 / LIVE</span><strong>Find a commander</strong><small>Enter the public queue for a peer-to-peer duel.</small></button><button className="mode-card private-mode" onClick={() => setPanel('private')}><span className="mode-index">02 / PRIVATE</span><strong>Private lobby</strong><small>Create or join a match with a six-character code.</small></button><button className="mode-card bot-mode" onClick={playBot}><span className="mode-index">03 / TRAINING</span><strong>Challenge the bot</strong><small>Play instantly against a basic tactical AI.</small></button></div><p className="fine">Live matches use the service only to connect both browsers; match data travels peer-to-peer when networks allow it.</p></section>}{status === 'idle' && panel === 'private' && <section className="join-card private-card"><button className="back-link" onClick={() => setPanel('choose')}>← ALL MODES</button><div className="eyebrow">PRIVATE CHANNEL</div><h2>Open a closed sector</h2><p>Create a lobby for a friend, or enter their signal code. Private lobby codes expire after ten minutes.</p><button className="private-create" onClick={() => begin('private-create')}><span>CREATE LOBBY</span><small>Generate a shareable six-character code</small></button><div className="code-divider"><span>OR JOIN ONE</span></div><label className="code-entry"><span>LOBBY CODE</span><input value={privateCode} onChange={event => normalizeCode(event.target.value)} placeholder="ABC123" maxLength={6} autoCapitalize="characters" spellCheck="false" /></label><button className="primary" disabled={privateCode.length !== 6} onClick={() => begin('private-join', privateCode)}>JOIN PRIVATE LOBBY</button></section>}{status === 'waiting' && <section className="status-card show private-status"><div className="eyebrow">{isPrivateHost ? 'PRIVATE CHANNEL / OPEN' : 'MATCHMAKING'}</div>{!isPrivateHost && <div className="spinner" />}{isPrivateHost ? <><h2>Lobby established</h2><p>Send this code to the other commander. It closes automatically as soon as they join.</p><output className="lobby-code" aria-label={`Private lobby code ${lobbyCode}`}>{lobbyCode || '······'}</output><small className="code-note">EXPIRES IN 10 MINUTES</small></> : <><h2>Looking for another commander</h2><p>Establishing a direct channel. You will enter the match as soon as the other commander is ready.</p></>}<button className="secondary" onClick={cancel}>CANCEL</button></section>}{status === 'error' && <section className="status-card show"><div className="eyebrow">CONNECTION NOTICE</div><h2>Could not join</h2><p>{message}</p><button className="secondary" onClick={cancel}>TRY AGAIN</button></section>}</div></section><Tutorial /></div>;
}
