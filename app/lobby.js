'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Tutorial from './tutorial';
import { pickSplashLine } from './splash-lines';
import { USERNAME_STORAGE_KEY, validateUsername } from '../lib/usernames';

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
  const [splash, setSplash] = useState(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardUnavailable, setLeaderboardUnavailable] = useState(false);

  const usernameValidation = useMemo(() => validateUsername(usernameInput), [usernameInput]);
  const commanderReady = usernameValidation.ok;

  useEffect(() => () => clearInterval(timer.current), []);
  useEffect(() => {
    setSplash(pickSplashLine());
    setUsernameInput(localStorage.getItem(USERNAME_STORAGE_KEY) || '');
    api('/api/leaderboard')
      .then(body => { setLeaderboard(body.leaderboard || []); setLeaderboardUnavailable(Boolean(body.unavailable)); })
      .catch(() => setLeaderboardUnavailable(true));
  }, []);

  function saveCommanderName() {
    setUsernameTouched(true);
    if (!usernameValidation.ok) return null;
    localStorage.setItem(USERNAME_STORAGE_KEY, usernameValidation.username);
    setUsernameInput(usernameValidation.username);
    return usernameValidation.username;
  }

  function watchForMatch(nextTicket, commanderName) {
    const check = async () => {
      try {
        const found = await api(`/api/join?ticket=${encodeURIComponent(nextTicket)}`);
        if (found.status === 'matched') {
          clearInterval(timer.current);
          sessionStorage.setItem(sessionKey, JSON.stringify({ ticket: nextTicket, commanderName, ...found }));
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
    const commanderName = saveCommanderName();
    if (!commanderName) return;
    clearInterval(timer.current);
    const nextTicket = crypto.randomUUID();
    setTicket(nextTicket);
    setWaitingMode(mode);
    setStatus('waiting');
    try {
      const result = await api('/api/join', { method: 'POST', body: JSON.stringify({ ticket: nextTicket, mode, code }) });
      if (mode === 'private-create') setLobbyCode(result.code);
      watchForMatch(nextTicket, commanderName);
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

  function playBot() {
    const commanderName = saveCommanderName();
    if (!commanderName) return;
    sessionStorage.removeItem(sessionKey);
    router.push(`/match/bot-${crypto.randomUUID()}`);
  }

  function playOnslaught() {
    const commanderName = saveCommanderName();
    if (!commanderName) return;
    sessionStorage.removeItem(sessionKey);
    router.push(`/match/onslaught-${crypto.randomUUID()}`);
  }

  function normalizeCode(value) {
    setPrivateCode(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
  }

  const isPrivateHost = waitingMode === 'private-create';
  const showUsernameError = usernameTouched && !usernameValidation.ok;

  return <div className="shell">
    <header className="top home-top">
      <div aria-hidden="true" />
      <div className="top-links">
        <a className="top-site-link" href="https://tzhu.dev" target="_blank" rel="noopener noreferrer">tzhu.dev</a>
        <a className="kofi-link" href="https://ko-fi.com/fowlfarmer" target="_blank" rel="noopener noreferrer" aria-label="Support on Ko-fi"><img src="https://storage.ko-fi.com/cdn/cup-border.png" alt="" width="15" height="15" />Ko-fi</a>
      </div>
    </header>

    <section className="lobby home-hero">
      <div className="lobby-brief home-brief">
        <h1 className={'lobby-splash' + (splash ? ' is-ready' : '')}>{splash && <>{splash.top}<br /><span>{splash.accent}</span></>}</h1>
        <p className="home-title">SPECTRAL FRONT</p>

        {status === 'idle' && panel === 'choose' && <section className="join-card">
          <div className="mode-grid">
            <button className="mode-card" disabled={!commanderReady} onClick={() => begin('public')}><strong>PUBLIC</strong></button>
            <button className="mode-card private-mode" disabled={!commanderReady} onClick={() => setPanel('private')}><strong>PRIVATE</strong></button>
            <button className="mode-card bot-mode" disabled={!commanderReady} onClick={playBot}><strong>BOT</strong></button>
            <button className="mode-card onslaught-mode" disabled={!commanderReady} onClick={playOnslaught}><strong>ONSLAUGHT</strong></button>
          </div>
        </section>}

        {status === 'idle' && panel === 'private' && <section className="join-card private-card">
          <button className="back-link" onClick={() => setPanel('choose')}>← ALL MODES</button>
          <div className="eyebrow">PRIVATE CHANNEL</div>
          <h2>Open a closed sector</h2>
          <p>Create a lobby for a friend, or enter their signal code. Private lobby codes expire after ten minutes.</p>
          <button className="private-create" onClick={() => begin('private-create')}><span>CREATE LOBBY</span><small>Generate a shareable six-character code</small></button>
          <div className="code-divider"><span>OR JOIN ONE</span></div>
          <label className="code-entry"><span>LOBBY CODE</span><input value={privateCode} onChange={event => normalizeCode(event.target.value)} placeholder="ABC123" maxLength={6} autoCapitalize="characters" spellCheck="false" /></label>
          <button className="primary" disabled={privateCode.length !== 6} onClick={() => begin('private-join', privateCode)}>JOIN PRIVATE LOBBY</button>
        </section>}

        {status === 'idle' && <label className={'username-entry callsign-strip ' + (showUsernameError ? 'invalid' : commanderReady ? 'valid' : '')}>
          <span>CALLSIGN</span>
          <input value={usernameInput} onBlur={() => setUsernameTouched(true)} onChange={event => { setUsernameTouched(true); setUsernameInput(event.target.value); }} placeholder="Commander name" maxLength={18} spellCheck="false" />
          <small>{showUsernameError ? usernameValidation.error : commanderReady ? 'accepted' : 'required for records'}</small>
        </label>}

        {status === 'waiting' && <section className="status-card show private-status">
          <div className="eyebrow">{isPrivateHost ? 'PRIVATE CHANNEL / OPEN' : 'MATCHMAKING'}</div>
          {!isPrivateHost && <div className="spinner" />}
          {isPrivateHost ? <><h2>Lobby established</h2><p>Send this code to the other commander. It closes automatically as soon as they join.</p><output className="lobby-code" aria-label={`Private lobby code ${lobbyCode}`}>{lobbyCode || '······'}</output><small className="code-note">EXPIRES IN 10 MINUTES</small></> : <><h2>Looking for another commander</h2><p>Establishing a direct channel. You will enter the match as soon as the other commander is ready.</p></>}
          <button className="secondary" onClick={cancel}>CANCEL</button>
        </section>}

        {status === 'error' && <section className="status-card show">
          <div className="eyebrow">CONNECTION NOTICE</div>
          <h2>Could not join</h2>
          <p>{message}</p>
          <button className="secondary" onClick={cancel}>TRY AGAIN</button>
        </section>}
      </div>
    </section>

    <Tutorial />
    <section className="leaderboard-card" aria-label="Onslaught destroyed enemies leaderboard">
      <div className="leaderboard-head"><span className="eyebrow">ONSLAUGHT RECORDS</span><h2>Most enemies destroyed</h2></div>
      {leaderboardUnavailable ? <p className="leaderboard-empty">Leaderboard storage is not configured yet.</p> : leaderboard.length ? <ol>{leaderboard.map(entry => <li key={`${entry.rank}-${entry.username}`}><span>{String(entry.rank).padStart(2, '0')}</span><b>{entry.username}</b><time>{entry.kills}</time></li>)}</ol> : <p className="leaderboard-empty">No onslaught runs posted yet. Hold the line and set the first mark.</p>}
    </section>
  </div>;
}
