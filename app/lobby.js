'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

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
  const [message, setMessage] = useState('Join the queue. We pair you with one pilot, create a direct connection, then enter the match.');
  const [ticket, setTicket] = useState(null);
  useEffect(() => () => clearInterval(timer.current), []);
  async function join() {
    const nextTicket = crypto.randomUUID(); setTicket(nextTicket); setStatus('waiting');
    try {
      await api('/api/join', { method: 'POST', body: JSON.stringify({ ticket: nextTicket }) });
      const check = async () => { try { const found = await api(`/api/join?ticket=${encodeURIComponent(nextTicket)}`); if (found.status === 'matched') { clearInterval(timer.current); sessionStorage.setItem(sessionKey, JSON.stringify({ ticket: nextTicket, ...found })); router.push(`/match/${found.matchId}`); } } catch { /* retry while the queue is alive */ } };
      await check(); timer.current = setInterval(check, 1400);
    } catch (error) { setStatus('error'); setMessage(error.message); }
  }
  async function cancel() { clearInterval(timer.current); await api('/api/join', { method: 'DELETE', body: JSON.stringify({ ticket }) }).catch(() => {}); setStatus('idle'); }
  function playBot() { sessionStorage.removeItem(sessionKey); router.push(`/match/bot-${crypto.randomUUID()}`); }
  return <div className="shell"><header className="top"><div className="brand">SPECTRAL <i>FRONT</i></div><div className="top-note">CASUAL P2P TACTICAL DUEL</div></header><section className="lobby"><div><div className="eyebrow">SECTOR 01 / OPEN QUEUE</div><h1>Shape the arc.<br /><span>Break the line.</span></h1><p className="lede">A small tactical duel of plotted functions. Face another pilot over a direct link, or train against the onboard navigation AI.</p></div><div>{status === 'idle' ? <section className="join-card"><h2>Choose your opponent</h2><p>Every shot follows the same physics. Only the other pilot changes.</p><div className="mode-grid"><button className="mode-card" onClick={join}><span className="mode-index">01 / LIVE</span><strong>Find a pilot</strong><small>Enter the queue for a private peer-to-peer duel.</small></button><button className="mode-card bot-mode" onClick={playBot}><span className="mode-index">02 / TRAINING</span><strong>Challenge the bot</strong><small>Play instantly against a basic tactical AI.</small></button></div><p className="fine">Live matches use the service only to connect both browsers; match data travels peer-to-peer when networks allow it.</p></section> : <section className="status-card show"><div className="eyebrow">MATCHMAKING</div>{status === 'waiting' && <div className="spinner" />}<h2>{status === 'waiting' ? 'Looking for another pilot' : 'Could not join'}</h2><p>{status === 'waiting' ? 'You are in the queue. This page will move into the match when someone joins.' : message}</p><button className="secondary" onClick={cancel}>{status === 'waiting' ? 'CANCEL' : 'TRY AGAIN'}</button></section>}</div></section></div>;
}
