'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ArenaCanvas from './arena-canvas';
import {
  advanceSimulation,
  applyGameAction,
  beamDistanceForPower,
  createBotAction,
  createMatch,
  ENERGY_MAX,
  fireEnergyCost,
  isMatchOver,
  liveShips,
  MATCH_COUNTDOWN_MS,
  MOVE_INITIAL_COST,
  SIM_TICK_MS,
  worldDistanceToGraphUnits,
} from './game-model';
import { notificationFor } from './notification-config';

const sessionKey = 'spectral-front-session';
const request = async (path, options = {}) => { const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options }); const body = await response.json().catch(() => ({})); if (!response.ok) throw Error(body.error || 'Network error'); return body; };
const notificationKeyForResult = result => {
  if (result.unstable) return 'unstableFunction';
  if (result.hit) return 'directHit';
  if (result.impact?.kind === 'asteroid') return 'asteroidDestroyed';
  if (result.impact?.kind === 'moon') return 'moonImpact';
  if (result.impact?.kind === 'planet') return 'planetImpact';
  if (result.stopReason === 'range') return 'beamRangeExpired';
  return 'beamExited';
};

export default function GameClient({ matchId }) {
  const router = useRouter(), isBotMatch = matchId.startsWith('bot-');
  const peer = useRef(null), channel = useRef(null), session = useRef(null), gameRef = useRef(null);
  const botTimer = useRef(null), botTickKey = useRef(null);
  const noticeTimers = useRef(new Map()), simTimer = useRef(null);
  const [game, setGame] = useState(null), [selected, setSelected] = useState(0), [link, setLink] = useState('LINKING');
  const [problem, setProblem] = useState(''), [formula, setFormula] = useState('0.12 * sin(1.3*x) - 0.04*x');
  const [power, setPower] = useState(75), [notices, setNotices] = useState([]), [arcHistory, setArcHistory] = useState([]);

  const publish = useCallback(next => { gameRef.current = next; setGame(next); }, []);
  const send = useCallback(message => { if (channel.current?.readyState === 'open') channel.current.send(JSON.stringify(message)); }, []);
  const stop = useCallback(() => {
    clearTimeout(botTimer.current); botTickKey.current = null;
    clearInterval(simTimer.current); channel.current?.close(); peer.current?.close();
  }, []);
  const leave = useCallback(async () => { if (!isBotMatch) try { await request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: session.current?.ticket, message: { type: 'peer-left' } }) }); } catch {} stop(); sessionStorage.removeItem(sessionKey); router.push('/'); }, [isBotMatch, router, stop]);
  const pushNotice = useCallback(key => {
    const notification = notificationFor(key);
    if (!notification) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setNotices(queue => [...queue, { id, ...notification }].slice(-4));
    noticeTimers.current.set(id, window.setTimeout(() => { setNotices(queue => queue.filter(notice => notice.id !== id)); noticeTimers.current.delete(id); }, 15_000));
  }, []);
  const clearNotices = useCallback(() => { for (const timer of noticeTimers.current.values()) clearTimeout(timer); noticeTimers.current.clear(); setNotices([]); }, []);
  const restartBotMatch = useCallback(() => {
    clearTimeout(botTimer.current); botTickKey.current = null;
    clearNotices(); setSelected(0); setPower(75); pushNotice('trainingInitialized'); publish(createMatch(undefined, { botMatch: true }));
  }, [clearNotices, publish, pushNotice]);
  const rememberArc = useCallback(expression => { const arc = expression.trim(); if (arc) setArcHistory(history => [arc, ...history.filter(entry => entry !== arc)].slice(0, 6)); }, []);

  const commitAction = useCallback(action => {
    const result = applyGameAction(gameRef.current, action);
    const me = session.current?.role;
    if (result.ignored) {
      if (action.role !== me) return null;
      if (result.blocked) pushNotice('pathBlocked');
      else if (result.reason === 'lowEnergyFire') pushNotice('notEnoughEnergyFire');
      else if (result.reason === 'lowEnergyMove') pushNotice('notEnoughEnergyMove');
      else if (result.reason === 'countdown') pushNotice('combatStaging');
      return null;
    }
    if (action.type === 'fire' && action.role === session.current?.role) rememberArc(action.expression);
    if (action.type === 'move') pushNotice('moveOrdered');
    if (action.type === 'cancelMove') pushNotice('moveCancelled');
    if (action.type === 'fire') pushNotice(notificationKeyForResult(result));
    publish(result.game);
    if (!isBotMatch) send({ type: 'state', state: result.game });
    return result;
  }, [isBotMatch, publish, pushNotice, rememberArc, send]);

  const notifyEvents = useCallback(events => {
    const me = session.current?.role;
    for (const event of events || []) {
      if (!event.role || event.role === me) pushNotice(event.key);
    }
  }, [pushNotice]);

  const submitAction = useCallback(action => {
    const me = session.current?.role;
    if (gameRef.current?.phase !== 'live') {
      pushNotice('combatStaging');
      return;
    }
    if (action.type === 'fire' && gameRef.current?.energy[me] < fireEnergyCost(action.power ?? 100)) {
      pushNotice('notEnoughEnergyFire');
      return;
    }
    if (action.type === 'move' && gameRef.current?.energy[me] < MOVE_INITIAL_COST) {
      pushNotice('notEnoughEnergyMove');
      return;
    }
    if (isBotMatch || me === 'host') {
      commitAction(action);
      return;
    }
    if (action.type === 'fire') rememberArc(action.expression);
    send({ type: 'action', action });
  }, [commitAction, isBotMatch, pushNotice, rememberArc, send]);

  const handleMove = useCallback(point => {
    const me = session.current?.role;
    if (!me || isMatchOver(gameRef.current)) return;
    const ship = gameRef.current?.ships[me]?.[selected];
    if (!ship?.hp) return;
    submitAction({ type: 'move', role: me, shipIndex: selected, x: point.x, y: point.y });
  }, [selected, submitAction]);

  const handleCancelMove = useCallback(() => {
    const me = session.current?.role;
    if (!me || isMatchOver(gameRef.current)) return;
    const ship = gameRef.current?.ships[me]?.[selected];
    if (ship?.hp && ship.moving && !ship.braking) submitAction({ type: 'cancelMove', role: me, shipIndex: selected });
  }, [selected, submitAction]);

  const takeBotTurn = useCallback(tickKey => {
    if (botTickKey.current !== tickKey) return;
    const action = createBotAction(gameRef.current);
    if (!action) return;
    commitAction(action);
  }, [commitAction]);

  const botDecisionWindow = Math.floor((game?.simTime || 0) / 500);

  useEffect(() => {
    clearInterval(simTimer.current);
    const isAuthority = isBotMatch || session.current?.role === 'host';
    if (!game || isMatchOver(game) || !isAuthority) return;
    simTimer.current = window.setInterval(() => {
      const { game: next, events } = advanceSimulation(gameRef.current, SIM_TICK_MS);
      if (next.simTime !== gameRef.current?.simTime) {
        publish(next);
        notifyEvents(events);
        if (!isBotMatch) send({ type: 'state', state: next, events });
      }
    }, SIM_TICK_MS);
    return () => clearInterval(simTimer.current);
  }, [game?.outcome, game?.seed, isBotMatch, notifyEvents, publish, send]);

  useEffect(() => {
    clearTimeout(botTimer.current);
    const tickKey = game ? `${game.seed}:${botDecisionWindow}` : null;
    if (!isBotMatch || isMatchOver(game) || game?.phase !== 'live') { botTickKey.current = null; return; }
    if (botTickKey.current === tickKey) return;
    botTickKey.current = tickKey;
    botTimer.current = window.setTimeout(() => takeBotTurn(tickKey), 150 + Math.random() * 180);
    return () => { clearTimeout(botTimer.current); if (botTickKey.current === tickKey) botTickKey.current = null; };
  }, [botDecisionWindow, game?.outcome, game?.phase, game?.seed, isBotMatch, takeBotTurn]);

  const connect = useCallback(async () => {
    if (isBotMatch) { session.current = { role: 'host' }; setLink('BOT UPLINK'); publish(createMatch(undefined, { botMatch: true })); return; }
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); if (!stored || stored.matchId !== matchId) { router.replace('/'); return; }
    session.current = stored;
    try {
      const { iceServers } = await request(`/api/ice?ticket=${encodeURIComponent(stored.ticket)}`), pc = peer.current = new RTCPeerConnection({ iceServers });
      pc.onicecandidate = event => event.candidate && request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: stored.ticket, message: { type: 'candidate', candidate: event.candidate } }) });
      const reportDisconnect = () => { if (!isMatchOver(gameRef.current)) setProblem('Connection lost. The other commander or their network left the duel.'); };
      pc.onconnectionstatechange = () => { if (['failed', 'disconnected'].includes(pc.connectionState)) reportDisconnect(); };
      const open = dataChannel => {
        channel.current = dataChannel;
        dataChannel.onopen = () => { setLink('DIRECT LINK'); if (stored.role === 'host') { const initial = createMatch(); send({ type: 'state', state: initial }); publish(initial); } };
        dataChannel.onclose = () => { if (!isMatchOver(gameRef.current)) setProblem('The other commander left the duel.'); };
        dataChannel.onmessage = event => {
          const message = JSON.parse(event.data);
          if (message.type === 'state') {
            publish(message.state);
            notifyEvents(message.events);
          }
          if (message.type === 'action' && stored.role === 'host') commitAction({ ...message.action, role: 'guest' });
        };
      };
      pc.ondatachannel = event => open(event.channel);
      if (stored.role === 'host') { open(pc.createDataChannel('match', { ordered: true })); const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: stored.ticket, message: { type: 'offer', sdp: offer } }) }); }
      let cancelled = false;
      (async () => { while (!cancelled && pc.connectionState !== 'closed') { try { const { messages = [] } = await request(`/api/signal?ticket=${encodeURIComponent(stored.ticket)}`); for (const message of messages) { if (message.type === 'offer' && stored.role === 'guest') { await pc.setRemoteDescription(message.sdp); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); await request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: stored.ticket, message: { type: 'answer', sdp: answer } }) }); } if (message.type === 'answer' && stored.role === 'host') await pc.setRemoteDescription(message.sdp); if (message.type === 'candidate') await pc.addIceCandidate(message.candidate).catch(() => {}); if (message.type === 'peer-left' && !isMatchOver(gameRef.current)) setProblem('The other commander left the duel.'); } } catch {} await new Promise(resolvePoll => setTimeout(resolvePoll, 600)); } })();
      return () => { cancelled = true; };
    } catch (error) { setProblem(error.message); }
  }, [commitAction, isBotMatch, matchId, notifyEvents, publish, router, send]);

  useEffect(() => { let cleanup; connect().then(fn => cleanup = fn); return () => { cleanup?.(); stop(); }; }, [connect, stop]);
  useEffect(() => () => { for (const timer of noticeTimers.current.values()) clearTimeout(timer); }, []);

  if (!game || problem) return <div className="game-shell"><header className="game-top"><div className="brand">SPECTRAL <i>FRONT</i></div></header><section className="disconnected standalone"><div>{!problem && <div className="spinner" />}<h2>{problem ? 'Match unavailable' : 'Setting up the duel'}</h2><p>{problem || 'Securing a direct browser connection…'}</p><button className="primary" onClick={leave}>BACK TO LOBBY</button></div></section></div>;

  const me = session.current.role, foe = me === 'host' ? 'guest' : 'host', myShips = game.ships[me], matchOver = isMatchOver(game), combatActive = game.phase === 'live', won = game.outcome === me;
  const myEnergy = game.energy[me], fireCost = fireEnergyCost(power), beamRange = Math.round(worldDistanceToGraphUnits(beamDistanceForPower(power)));
  const countdownSeconds = Math.max(0, Math.ceil(((game.countdownMs ?? MATCH_COUNTDOWN_MS) - (game.simTime || 0)) / 1000));
  const canFire = combatActive && !matchOver && myShips[selected]?.hp && myEnergy >= fireCost;
  const fireCurrent = () => {
    if (matchOver || !myShips[selected]?.hp) return;
    if (!combatActive) { pushNotice('combatStaging'); return; }
    if (myEnergy < fireCost) { pushNotice('notEnoughEnergyFire'); return; }
    submitAction({ type: 'fire', role: me, shipIndex: selected, expression: formula, power });
  };

  return (
    <div className="game-shell">
      <header className="game-top"><div className="brand">SPECTRAL <i>FRONT</i></div><div className="match-meta"><span className="online">● {link}</span> &nbsp; {isBotMatch ? 'TRAINING MATCH' : `MATCH ${matchId.slice(0, 6).toUpperCase()}`}</div><button className="leave" onClick={leave}>LEAVE MATCH</button></header>
      <main className="game-grid">
        <aside className="panel side">
          <div>
            <div className="label">ENERGY</div>
            <div className="energy-bar" aria-label={`Energy ${Math.round(myEnergy)} of ${ENERGY_MAX}`}>
              <div className="energy-fill" style={{ width: `${(myEnergy / ENERGY_MAX) * 100}%` }} />
              <span><b>ENERGY</b>{Math.round(myEnergy)}<i>/ {ENERGY_MAX}</i></span>
            </div>
          </div>
          <div>
            <div className="player active"><strong>YOUR FLEET</strong><small>{matchOver ? `${liveShips(game, me).length} SURVIVING` : 'SELECT SHIP · LEFT CLICK TO MOVE'}</small>
              <div className="ship-select">{myShips.map((ship, index) => <button key={index} disabled={!ship.hp || matchOver} className={'ship-choice ' + (index === selected ? 'selected' : '') + (ship.hp && ship.moving ? ' moving' : '')} onClick={() => setSelected(index)}>SHIP {index + 1}<i>{ship.hp ? (ship.moving ? 'MOVING' : 'READY') : 'LOST'}</i></button>)}</div>
            </div>
            <div className="player enemy"><strong>{isBotMatch ? 'BOT FLEET' : 'RIVAL FLEET'}</strong><small>{matchOver ? `${liveShips(game, foe).length} SURVIVING` : isBotMatch ? 'NAVIGATION AI' : 'OPPOSING FLEET'}</small><div className="dots">{'● '.repeat(liveShips(game, foe).length) || '—'}</div></div>
          </div>
          <div className="rules">{combatActive ? 'Live combat — energy regenerates slowly. Left click to move a selected ship; click the waypoint to stop. Your fleet always appears on the left.' : 'Staging sequence — systems remain locked until the launch signal.'}</div>
        </aside>
        <section className="panel arena-wrap">
          <div className="arena-top"><span>LOCAL SIMULATION: <b>{isBotMatch ? 'BOT TRAINING' : me === 'host' ? 'HOST' : 'CONNECTED'}</b></span><span>{matchOver ? 'MATCH COMPLETE' : combatActive ? `LIVE · ${Math.round((game.simTime || 0) / 1000)}s` : 'STAGING SEQUENCE'}</span></div>
          <ArenaCanvas game={game} role={me} selected={selected} onSelectShip={setSelected} onMoveShip={combatActive ? handleMove : undefined} onCancelMove={combatActive ? handleCancelMove : undefined} matchOver={matchOver} expression={formula} power={power} previewDisabled={matchOver || !combatActive} />
          <div className="event-queue" aria-live="polite">{notices.map(notice => <div className="event show" key={notice.id} style={{ borderLeftColor: notice.accent }}>{notice.message}</div>)}</div>
          {!combatActive && !matchOver && <LaunchCountdown seconds={countdownSeconds} />}
          {matchOver && <MatchConclusion won={won} isBotMatch={isBotMatch} myRemaining={liveShips(game, me).length} foeRemaining={liveShips(game, foe).length} onRestart={restartBotMatch} onLeave={leave} />}
          <section className="command">
            <div className="formula">
              <label>FIRING ARC — Y = F(X)</label>
              <div className="formula-row"><span>y =</span><input value={formula} disabled={matchOver} onChange={event => setFormula(event.target.value)} autoComplete="off" spellCheck="false" /></div>
              <div className="power-control">
                <label htmlFor="beam-power">BEAM POWER — {power}% · {beamRange} graph units · {Math.round(fireCost)} energy</label>
                <input id="beam-power" type="range" min="5" max="100" value={power} style={{ '--power-fill': `${((power - 5) / 95) * 100}%` }} disabled={matchOver} onChange={event => setPower(+event.target.value)} />
              </div>
              <div className="hint">{matchOver ? 'Command channel closed.' : !combatActive ? `Systems unlock in ${countdownSeconds}s. Set an arc while you wait.` : myEnergy < fireCost ? `Need ${Math.round(fireCost - myEnergy)} more energy.` : 'Origin: selected ship (0, 0) · sin, cos, tan, abs, sqrt, log/ln, exp'}</div>
              {arcHistory.length > 0 && <div className="arc-history" aria-label="Previous firing arcs"><span>ARC BANK</span><div>{arcHistory.map((arc, index) => <button key={arc} type="button" disabled={matchOver} className={arc === formula ? 'selected' : ''} onClick={() => setFormula(arc)}><b>{String(index + 1).padStart(2, '0')}</b>{arc}</button>)}</div></div>}
            </div>
            <button className="fire" disabled={!canFire} onClick={fireCurrent}>{matchOver ? 'MATCH ENDED' : !combatActive ? 'SYSTEMS ARMING' : myEnergy < fireCost ? 'LOW ENERGY' : 'FIRE BEAM'}</button>
          </section>
        </section>
      </main>
    </div>
  );
}

function LaunchCountdown({ seconds }) {
  return <section className="launch-countdown" aria-live="polite"><div className="launch-kicker">ENGAGEMENT WINDOW</div><output>{seconds}</output><p>Fleet synchronized · energy reserves empty</p></section>;
}

function MatchConclusion({ won, isBotMatch, myRemaining, foeRemaining, onRestart, onLeave }) {
  const title = won ? 'SECTOR SECURED' : 'FLEET LOST', detail = won ? (isBotMatch ? 'Training objective complete. The bot fleet is dark.' : 'Opponent fleet eliminated. Your sector is secure.') : (isBotMatch ? 'The navigation AI eliminated your fleet.' : 'Your opponent eliminated the fleet.');
  return <section className={'match-conclusion ' + (won ? 'victory' : 'defeat')} role="dialog" aria-modal="true" aria-labelledby="match-result-title"><div className="result-signal">{won ? '◈' : '✕'} MATCH RESULT</div><h2 id="match-result-title">{title}</h2><p>{detail}</p><div className="result-score"><span><b>{myRemaining}</b> YOUR SHIPS</span><i>:</i><span><b>{foeRemaining}</b> {isBotMatch ? 'BOT SHIPS' : 'RIVAL SHIPS'}</span></div>{isBotMatch ? <button className="result-primary" onClick={onRestart}>RUN NEW TRAINING MATCH</button> : <button className="result-primary" onClick={onLeave}>RETURN TO LOBBY</button>}<button className="result-secondary" onClick={onLeave}>{isBotMatch ? 'RETURN TO LOBBY' : 'LEAVE MATCH'}</button></section>;
}
