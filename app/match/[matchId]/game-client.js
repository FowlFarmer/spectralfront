'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ArenaCanvas from './arena-canvas';
import { applyGameAction, createBotAction, createMatch, liveShips } from './game-model';

const sessionKey = 'spectral-front-session';
const shotLockDuration = 780;
const request = async (path, options = {}) => { const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options }); const body = await response.json().catch(() => ({})); if (!response.ok) throw Error(body.error || 'Network error'); return body; };

export default function GameClient({ matchId }) {
  const router = useRouter(), isBotMatch = matchId.startsWith('bot-');
  const peer = useRef(null), channel = useRef(null), session = useRef(null), gameRef = useRef(null), botTimer = useRef(null), shotTimer = useRef(null), shotAnimating = useRef(false);
  const [game, setGame] = useState(null), [selected, setSelected] = useState(0), [link, setLink] = useState('LINKING'), [problem, setProblem] = useState(''), [formula, setFormula] = useState('0.12 * sin(1.3*x) - 0.04*x'), [notice, setNotice] = useState('');
  const publish = useCallback(next => { gameRef.current = next; setGame(next); }, []);
  const send = useCallback(message => { if (channel.current?.readyState === 'open') channel.current.send(JSON.stringify(message)); }, []);
  const lockShot = useCallback(() => { clearTimeout(shotTimer.current); shotAnimating.current = true; shotTimer.current = window.setTimeout(() => { shotAnimating.current = false; }, shotLockDuration); }, []);
  const stop = useCallback(() => { clearTimeout(botTimer.current); clearTimeout(shotTimer.current); channel.current?.close(); peer.current?.close(); }, []);
  const leave = useCallback(async () => { if (!isBotMatch) try { await request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: session.current?.ticket, message: { type: 'peer-left' } }) }); } catch {} stop(); sessionStorage.removeItem(sessionKey); router.push('/'); }, [isBotMatch, router, stop]);
  const describe = result => result.unstable ? 'Unstable function — turn lost.' : result.hit ? 'Direct hit. One ship lost.' : result.game.lastShot?.impact?.kind === 'asteroid' ? 'Asteroid vaporized.' : result.game.lastShot?.impact?.kind === 'planet' ? 'Planetary impact. Arc stopped.' : 'Beam exits the sector.';

  const commitAction = useCallback(action => {
    const result = applyGameAction(gameRef.current, action);
    if (result.ignored) return null;
    lockShot(); publish(result.game); setNotice(describe(result));
    if (!isBotMatch) send({ type: 'state', state: result.game });
    return result;
  }, [isBotMatch, lockShot, publish, send]);

  const takeBotTurn = useCallback(() => {
    const action = createBotAction(gameRef.current); if (!action) return;
    const result = commitAction(action); if (!result) return;
    setNotice(result.hit ? 'Bot solution connected. Ship lost.' : 'Bot shifted its trajectory wide.');
  }, [commitAction]);

  const submitAction = useCallback(action => {
    if (shotAnimating.current) return;
    if (isBotMatch || session.current?.role === 'host') {
      const result = commitAction(action);
      if (result && isBotMatch && action.role === 'host' && !result.game.outcome) botTimer.current = window.setTimeout(takeBotTurn, 2000);
      return;
    }
    lockShot();
    send({ type: 'action', action });
  }, [commitAction, isBotMatch, lockShot, send, takeBotTurn]);

  const connect = useCallback(async () => {
    if (isBotMatch) { session.current = { role: 'host' }; setLink('BOT UPLINK'); publish(createMatch()); return; }
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); if (!stored || stored.matchId !== matchId) { router.replace('/'); return; }
    session.current = stored;
    try {
      const { iceServers } = await request(`/api/ice?ticket=${encodeURIComponent(stored.ticket)}`), pc = peer.current = new RTCPeerConnection({ iceServers });
      pc.onicecandidate = event => event.candidate && request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: stored.ticket, message: { type: 'candidate', candidate: event.candidate } }) });
      pc.onconnectionstatechange = () => { if (['failed', 'disconnected'].includes(pc.connectionState)) setProblem('Connection lost. The other pilot or their network left the duel.'); };
      const open = dataChannel => {
        channel.current = dataChannel;
        dataChannel.onopen = () => { setLink('DIRECT LINK'); if (stored.role === 'host') { const initial = createMatch(); send({ type: 'state', state: initial }); publish(initial); } };
        dataChannel.onclose = () => setProblem('The other pilot left the duel.');
        dataChannel.onmessage = event => { const message = JSON.parse(event.data); if (message.type === 'state') publish(message.state); if (message.type === 'action' && stored.role === 'host') commitAction({ ...message.action, role: 'guest' }); };
      };
      pc.ondatachannel = event => open(event.channel);
      if (stored.role === 'host') { open(pc.createDataChannel('match', { ordered: true })); const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: stored.ticket, message: { type: 'offer', sdp: offer } }) }); }
      let cancelled = false;
      (async () => { while (!cancelled && pc.connectionState !== 'closed') { try { const { messages = [] } = await request(`/api/signal?ticket=${encodeURIComponent(stored.ticket)}`); for (const message of messages) { if (message.type === 'offer' && stored.role === 'guest') { await pc.setRemoteDescription(message.sdp); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); await request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: stored.ticket, message: { type: 'answer', sdp: answer } }) }); } if (message.type === 'answer' && stored.role === 'host') await pc.setRemoteDescription(message.sdp); if (message.type === 'candidate') await pc.addIceCandidate(message.candidate).catch(() => {}); if (message.type === 'peer-left') setProblem('The other pilot left the duel.'); } } catch {} await new Promise(resolvePoll => setTimeout(resolvePoll, 600)); } })();
      return () => { cancelled = true; };
    } catch (error) { setProblem(error.message); }
  }, [commitAction, isBotMatch, matchId, publish, router, send]);

  useEffect(() => { let cleanup; connect().then(fn => cleanup = fn); return () => { cleanup?.(); stop(); }; }, [connect, stop]);
  if (!game || problem) return <div className="game-shell"><header className="game-top"><div className="brand">SPECTRAL <i>FRONT</i></div></header><section className="disconnected standalone"><div>{!problem && <div className="spinner" />}<h2>{problem ? 'Match unavailable' : 'Setting up the duel'}</h2><p>{problem || 'Securing a direct browser connection…'}</p><button className="primary" onClick={leave}>BACK TO LOBBY</button></div></section></div>;
  const me = session.current.role, foe = me === 'host' ? 'guest' : 'host', myShips = game.ships[me];
  const fireCurrent = () => { if (game.turn === me && myShips[selected]?.hp) submitAction({ type: 'fire', role: me, shipIndex: selected, expression: formula }); };
  return <div className="game-shell"><header className="game-top"><div className="brand">SPECTRAL <i>FRONT</i></div><div className="match-meta"><span className="online">● {link}</span> &nbsp; {isBotMatch ? 'TRAINING MATCH' : `MATCH ${matchId.slice(0, 6).toUpperCase()}`}</div><button className="leave" onClick={leave}>LEAVE MATCH</button></header><main className="game-grid"><aside className="panel side"><div><div className="label">TURN</div><div className="turn">{game.outcome ? (game.outcome === me ? 'You won the sector' : 'Sector lost') : game.turn === me ? 'Your turn — plot a line' : isBotMatch ? 'Bot is plotting' : 'Rival is plotting'}</div></div><div><div className={'player ' + (game.turn === me ? 'active' : '')}><strong>YOUR FLEET</strong><small>SELECT A SHIP</small><div className="ship-select">{myShips.map((ship, index) => <button key={index} disabled={!ship.hp} className={'ship-choice ' + (index === selected ? 'selected' : '')} onClick={() => setSelected(index)}>SHIP {index + 1}<i>{ship.hp ? 'READY' : 'LOST'}</i></button>)}</div></div><div className={'player enemy ' + (game.turn === foe ? 'active' : '')}><strong>{isBotMatch ? 'BOT FLEET' : 'RIVAL FLEET'}</strong><small>{isBotMatch ? 'NAVIGATION AI' : 'OPPOSING FLEET'}</small><div className="dots">{'● '.repeat(liveShips(game, foe).length) || '—'}</div></div></div><div className="rules">Pick a ship. It is <b>(0,0)</b> for this shot. The field remains Cartesian: left is −x, right is +x, up is +y.</div></aside><section className="panel arena-wrap"><div className="arena-top"><span>LOCAL SIMULATION: <b>{isBotMatch ? 'BOT TRAINING' : me === 'host' ? 'HOST' : 'CONNECTED'}</b></span><span>ROUND {String(game.round).padStart(2, '0')}</span></div><ArenaCanvas game={game} role={me} selected={selected} onSelectShip={setSelected} /><div className={'event ' + (notice ? 'show' : '')}>{notice}</div><section className="command"><div className="formula"><label>FIRING ARC — Y = F(X)</label><div className="formula-row"><span>y =</span><input value={formula} onChange={event => setFormula(event.target.value)} autoComplete="off" spellCheck="false" /></div><div className="hint">Origin: selected ship (0, 0) · sin, cos, abs, sqrt, log, exp</div></div><button className="fire" disabled={game.turn !== me || !!game.outcome} onClick={fireCurrent}>FIRE ARC</button></section></section></main></div>;
}
