'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ArenaCanvas from './arena-canvas';
import { applyGameAction, createBotAction, createMatch, isMatchOver, liveShips, resolvePendingShot, SHOT_FLIGHT_MS } from './game-model';
import { notificationFor } from './notification-config';

const sessionKey = 'spectral-front-session';
const shotLockDuration = SHOT_FLIGHT_MS + 120;
const request = async (path, options = {}) => { const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options }); const body = await response.json().catch(() => ({})); if (!response.ok) throw Error(body.error || 'Network error'); return body; };
const notificationKeyForResult = result => result.unstable ? 'unstableFunction' : result.hit ? 'directHit' : result.impact?.kind === 'asteroid' ? 'asteroidDestroyed' : result.impact?.kind === 'moon' ? 'moonImpact' : result.impact?.kind === 'planet' ? 'planetImpact' : 'beamExited';

export default function GameClient({ matchId }) {
  const router = useRouter(), isBotMatch = matchId.startsWith('bot-');
  const peer = useRef(null), channel = useRef(null), session = useRef(null), gameRef = useRef(null), botTimer = useRef(null), botTurnKey = useRef(null), shotTimer = useRef(null), resolveTimer = useRef(null), noticeTimers = useRef(new Map()), shotAnimating = useRef(false);
  const [game, setGame] = useState(null), [selected, setSelected] = useState(0), [link, setLink] = useState('LINKING'), [problem, setProblem] = useState(''), [formula, setFormula] = useState('0.12 * sin(1.3*x) - 0.04*x'), [notices, setNotices] = useState([]), [arcHistory, setArcHistory] = useState([]);
  const publish = useCallback(next => { gameRef.current = next; setGame(next); }, []);
  const send = useCallback(message => { if (channel.current?.readyState === 'open') channel.current.send(JSON.stringify(message)); }, []);
  const lockShot = useCallback(() => { clearTimeout(shotTimer.current); shotAnimating.current = true; shotTimer.current = window.setTimeout(() => { shotAnimating.current = false; }, shotLockDuration); }, []);
  const stop = useCallback(() => { clearTimeout(botTimer.current); botTurnKey.current = null; clearTimeout(shotTimer.current); clearTimeout(resolveTimer.current); channel.current?.close(); peer.current?.close(); }, []);
  const leave = useCallback(async () => { if (!isBotMatch) try { await request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: session.current?.ticket, message: { type: 'peer-left' } }) }); } catch {} stop(); sessionStorage.removeItem(sessionKey); router.push('/'); }, [isBotMatch, router, stop]);
  const pushNotice = useCallback(key => {
    const message = notificationFor(key);
    if (!message) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setNotices(queue => [...queue, { id, message }].slice(-4));
    noticeTimers.current.set(id, window.setTimeout(() => { setNotices(queue => queue.filter(notice => notice.id !== id)); noticeTimers.current.delete(id); }, 3800));
  }, []);
  const clearNotices = useCallback(() => { for (const timer of noticeTimers.current.values()) clearTimeout(timer); noticeTimers.current.clear(); setNotices([]); }, []);
  const restartBotMatch = useCallback(() => { clearTimeout(botTimer.current); botTurnKey.current = null; clearTimeout(shotTimer.current); clearTimeout(resolveTimer.current); shotAnimating.current = false; clearNotices(); setSelected(0); pushNotice('trainingInitialized'); publish(createMatch()); }, [clearNotices, publish, pushNotice]);
  const rememberArc = useCallback(expression => { const arc = expression.trim(); if (arc) setArcHistory(history => [arc, ...history.filter(entry => entry !== arc)].slice(0, 6)); }, []);

  const commitAction = useCallback(action => {
    const result = applyGameAction(gameRef.current, action);
    if (result.ignored) return null;
    if (action.role === session.current?.role) rememberArc(action.expression);
    lockShot(); publish(result.game); pushNotice(result.pending ? 'playerArcInFlight' : notificationKeyForResult(result));
    if (!isBotMatch) send({ type: 'state', state: result.game });
    return result;
  }, [isBotMatch, lockShot, publish, pushNotice, rememberArc, send]);

  const completePendingShot = useCallback(shotId => {
    const result = resolvePendingShot(gameRef.current, shotId);
    if (result.ignored) return;
    shotAnimating.current = false;
    publish(result.game); pushNotice(notificationKeyForResult(result));
    if (!isBotMatch) send({ type: 'state', state: result.game });
  }, [isBotMatch, publish, pushNotice, send]);

  const takeBotTurn = useCallback(turnKey => {
    if (botTurnKey.current !== turnKey) return;
    botTurnKey.current = null;
    const action = createBotAction(gameRef.current); if (!action) return;
    const result = commitAction(action); if (!result) return;
    pushNotice('botArcInFlight');
  }, [commitAction, pushNotice]);

  const submitAction = useCallback(action => {
    if (shotAnimating.current || gameRef.current?.pendingShot) return;
    if (isBotMatch || session.current?.role === 'host') {
      commitAction(action);
      return;
    }
    rememberArc(action.expression);
    lockShot();
    send({ type: 'action', action });
  }, [commitAction, isBotMatch, lockShot, rememberArc, send]);

  useEffect(() => {
    if (!game?.pendingShot || (!isBotMatch && session.current?.role !== 'host')) return;
    const shotId = game.pendingShot.id;
    clearTimeout(resolveTimer.current);
    resolveTimer.current = window.setTimeout(() => completePendingShot(shotId), SHOT_FLIGHT_MS);
    return () => clearTimeout(resolveTimer.current);
  }, [completePendingShot, game?.pendingShot?.id, isBotMatch]);

  useEffect(() => {
    clearTimeout(botTimer.current);
    const turnKey = game ? `${game.seed}:${game.round}:${game.shotNumber}:${game.turn}` : null;
    if (!isBotMatch || game?.pendingShot || game?.turn !== 'guest' || isMatchOver(game)) { botTurnKey.current = null; return; }
    if (botTurnKey.current === turnKey) return;
    botTurnKey.current = turnKey;
    botTimer.current = window.setTimeout(() => takeBotTurn(turnKey), 700);
    return () => { clearTimeout(botTimer.current); if (botTurnKey.current === turnKey) botTurnKey.current = null; };
  }, [game?.outcome, game?.pendingShot?.id, game?.round, game?.seed, game?.shotNumber, game?.turn, isBotMatch, takeBotTurn]);

  const connect = useCallback(async () => {
    if (isBotMatch) { session.current = { role: 'host' }; setLink('BOT UPLINK'); publish(createMatch()); return; }
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); if (!stored || stored.matchId !== matchId) { router.replace('/'); return; }
    session.current = stored;
    try {
      const { iceServers } = await request(`/api/ice?ticket=${encodeURIComponent(stored.ticket)}`), pc = peer.current = new RTCPeerConnection({ iceServers });
      pc.onicecandidate = event => event.candidate && request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: stored.ticket, message: { type: 'candidate', candidate: event.candidate } }) });
      const reportDisconnect = () => { if (!isMatchOver(gameRef.current)) setProblem('Connection lost. The other pilot or their network left the duel.'); };
      pc.onconnectionstatechange = () => { if (['failed', 'disconnected'].includes(pc.connectionState)) reportDisconnect(); };
      const open = dataChannel => {
        channel.current = dataChannel;
        dataChannel.onopen = () => { setLink('DIRECT LINK'); if (stored.role === 'host') { const initial = createMatch(); send({ type: 'state', state: initial }); publish(initial); } };
        dataChannel.onclose = () => { if (!isMatchOver(gameRef.current)) setProblem('The other pilot left the duel.'); };
        dataChannel.onmessage = event => { const message = JSON.parse(event.data); if (message.type === 'state') publish(message.state); if (message.type === 'action' && stored.role === 'host') commitAction({ ...message.action, role: 'guest' }); };
      };
      pc.ondatachannel = event => open(event.channel);
      if (stored.role === 'host') { open(pc.createDataChannel('match', { ordered: true })); const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: stored.ticket, message: { type: 'offer', sdp: offer } }) }); }
      let cancelled = false;
      (async () => { while (!cancelled && pc.connectionState !== 'closed') { try { const { messages = [] } = await request(`/api/signal?ticket=${encodeURIComponent(stored.ticket)}`); for (const message of messages) { if (message.type === 'offer' && stored.role === 'guest') { await pc.setRemoteDescription(message.sdp); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); await request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: stored.ticket, message: { type: 'answer', sdp: answer } }) }); } if (message.type === 'answer' && stored.role === 'host') await pc.setRemoteDescription(message.sdp); if (message.type === 'candidate') await pc.addIceCandidate(message.candidate).catch(() => {}); if (message.type === 'peer-left' && !isMatchOver(gameRef.current)) setProblem('The other pilot left the duel.'); } } catch {} await new Promise(resolvePoll => setTimeout(resolvePoll, 600)); } })();
      return () => { cancelled = true; };
    } catch (error) { setProblem(error.message); }
  }, [commitAction, isBotMatch, matchId, publish, router, send]);

  useEffect(() => { let cleanup; connect().then(fn => cleanup = fn); return () => { cleanup?.(); stop(); }; }, [connect, stop]);
  useEffect(() => () => { for (const timer of noticeTimers.current.values()) clearTimeout(timer); }, []);
  if (!game || problem) return <div className="game-shell"><header className="game-top"><div className="brand">SPECTRAL <i>FRONT</i></div></header><section className="disconnected standalone"><div>{!problem && <div className="spinner" />}<h2>{problem ? 'Match unavailable' : 'Setting up the duel'}</h2><p>{problem || 'Securing a direct browser connection…'}</p><button className="primary" onClick={leave}>BACK TO LOBBY</button></div></section></div>;
  const me = session.current.role, foe = me === 'host' ? 'guest' : 'host', myShips = game.ships[me], matchOver = isMatchOver(game), won = game.outcome === me;
  const fireCurrent = () => { if (!matchOver && !game.pendingShot && game.turn === me && myShips[selected]?.hp) submitAction({ type: 'fire', role: me, shipIndex: selected, expression: formula }); };
  return (
    <div className="game-shell">
      <header className="game-top"><div className="brand">SPECTRAL <i>FRONT</i></div><div className="match-meta"><span className="online">● {link}</span> &nbsp; {isBotMatch ? 'TRAINING MATCH' : `MATCH ${matchId.slice(0, 6).toUpperCase()}`}</div><button className="leave" onClick={leave}>LEAVE MATCH</button></header>
      <main className="game-grid">
        <aside className="panel side">
          <div><div className="label">TURN</div><div className="turn">{matchOver ? (won ? 'Sector secured' : 'Fleet lost') : game.pendingShot ? 'Arc in flight' : game.turn === me ? 'Your turn — plot a line' : isBotMatch ? 'Bot is plotting' : 'Rival is plotting'}</div></div>
          <div>
            <div className={'player ' + (game.turn === me && !game.pendingShot ? 'active' : '')}><strong>YOUR FLEET</strong><small>{matchOver ? `${liveShips(game, me).length} SURVIVING` : game.pendingShot ? 'HOLDING FIRE' : 'SELECT A SHIP'}</small><div className="ship-select">{myShips.map((ship, index) => <button key={index} disabled={!ship.hp || matchOver || !!game.pendingShot} className={'ship-choice ' + (index === selected ? 'selected' : '')} onClick={() => setSelected(index)}>SHIP {index + 1}<i>{ship.hp ? 'READY' : 'LOST'}</i></button>)}</div></div>
            <div className={'player enemy ' + (game.turn === foe && !game.pendingShot ? 'active' : '')}><strong>{isBotMatch ? 'BOT FLEET' : 'RIVAL FLEET'}</strong><small>{matchOver ? `${liveShips(game, foe).length} SURVIVING` : game.pendingShot ? 'IMPACT PREDICTED' : isBotMatch ? 'NAVIGATION AI' : 'OPPOSING FLEET'}</small><div className="dots">{'● '.repeat(liveShips(game, foe).length) || '—'}</div></div>
          </div>
          <div className="rules">Pick a ship. It is <b>(0,0)</b> for this shot. The field remains Cartesian: left is −x, right is +x, up is +y.</div>
        </aside>
        <section className="panel arena-wrap">
          <div className="arena-top"><span>LOCAL SIMULATION: <b>{isBotMatch ? 'BOT TRAINING' : me === 'host' ? 'HOST' : 'CONNECTED'}</b></span><span>{matchOver ? 'MATCH COMPLETE' : game.pendingShot ? 'ARC IN FLIGHT' : `ROUND ${String(game.round).padStart(2, '0')}`}</span></div>
          <ArenaCanvas game={game} role={me} selected={selected} onSelectShip={setSelected} />
          <div className="event-queue" aria-live="polite">{notices.map(notice => <div className="event show" key={notice.id}>{notice.message}</div>)}</div>
          {matchOver && <MatchConclusion won={won} isBotMatch={isBotMatch} myRemaining={liveShips(game, me).length} foeRemaining={liveShips(game, foe).length} onRestart={restartBotMatch} onLeave={leave} />}
          <section className="command">
            <div className="formula">
              <label>FIRING ARC — Y = F(X)</label>
              <div className="formula-row"><span>y =</span><input value={formula} disabled={matchOver || !!game.pendingShot} onChange={event => setFormula(event.target.value)} autoComplete="off" spellCheck="false" /></div>
              <div className="hint">{matchOver ? 'Command channel closed — match result confirmed.' : game.pendingShot ? 'Trajectory locked until the beam resolves.' : 'Origin: selected ship (0, 0) · sin, cos, abs, sqrt, log, exp'}</div>
              {arcHistory.length > 0 && <div className="arc-history" aria-label="Previous firing arcs"><span>ARC BANK</span><div>{arcHistory.map((arc, index) => <button key={arc} type="button" disabled={matchOver || !!game.pendingShot} className={arc === formula ? 'selected' : ''} onClick={() => setFormula(arc)}><b>{String(index + 1).padStart(2, '0')}</b>{arc}</button>)}</div></div>}
            </div>
            <button className="fire" disabled={game.turn !== me || matchOver || !!game.pendingShot} onClick={fireCurrent}>{matchOver ? 'MATCH ENDED' : game.pendingShot ? 'ARC IN FLIGHT' : 'FIRE ARC'}</button>
          </section>
        </section>
      </main>
    </div>
  );
}

function MatchConclusion({ won, isBotMatch, myRemaining, foeRemaining, onRestart, onLeave }) {
  const title = won ? 'SECTOR SECURED' : 'FLEET LOST', detail = won ? (isBotMatch ? 'Training objective complete. The bot fleet is dark.' : 'Opponent fleet eliminated. Your sector is secure.') : (isBotMatch ? 'The navigation AI eliminated your fleet.' : 'Your opponent eliminated the fleet.');
  return <section className={'match-conclusion ' + (won ? 'victory' : 'defeat')} role="dialog" aria-modal="true" aria-labelledby="match-result-title"><div className="result-signal">{won ? '◈' : '✕'} MATCH RESULT</div><h2 id="match-result-title">{title}</h2><p>{detail}</p><div className="result-score"><span><b>{myRemaining}</b> YOUR SHIPS</span><i>:</i><span><b>{foeRemaining}</b> {isBotMatch ? 'BOT SHIPS' : 'RIVAL SHIPS'}</span></div>{isBotMatch ? <button className="result-primary" onClick={onRestart}>RUN NEW TRAINING MATCH</button> : <button className="result-primary" onClick={onLeave}>RETURN TO LOBBY</button>}<button className="result-secondary" onClick={onLeave}>{isBotMatch ? 'RETURN TO LOBBY' : 'LEAVE MATCH'}</button></section>;
}
