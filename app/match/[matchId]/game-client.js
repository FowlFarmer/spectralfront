'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ArenaCanvas from './arena-canvas';
import { USERNAME_STORAGE_KEY } from '../../../lib/usernames';
import {
  advanceSimulation,
  applyGameAction,
  beamDistanceForPower,
  createBotAction,
  createMatch,
  ENERGY_MAX,
  fireEnergyCost,
  isMatchOver,
  isCombatLocked,
  liveShips,
  MATCH_COUNTDOWN_MS,
  MOVE_INITIAL_COST,
  SIM_TICK_MS,
  worldDistanceToGraphUnits,
} from './game-model';
import { notificationFor } from './notification-config';

const sessionKey = 'spectral-front-session';
const request = async (path, options = {}) => { const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options }); const body = await response.json().catch(() => ({})); if (!response.ok) throw Error(body.error || 'Network error'); return body; };
const notificationKeyForFireResult = (result, shooterRole, viewerRole) => {
  if (result.unstable) return shooterRole === viewerRole ? 'unstableFunction' : null;
  if (result.hit && result.impact?.kind === 'ship') {
    if (result.impact.shipRole === shooterRole && shooterRole === viewerRole) return 'selfShipDestroyed';
    if (shooterRole === viewerRole) return 'enemyShipDestroyed';
    if (result.impact.shipRole === viewerRole) return 'friendlyShipLost';
    return null;
  }
  if (shooterRole !== viewerRole) return null;
  if (result.impact?.kind === 'asteroid') return 'asteroidDestroyed';
  if (result.impact?.kind === 'moon') return 'moonImpact';
  if (result.impact?.kind === 'planet') return 'planetImpact';
  if (result.stopReason === 'range') return 'beamRangeExpired';
  return 'beamExited';
};

const fireNoticeEvents = (result, shooterRole) => {
  const events = [];
  for (const role of ['host', 'guest']) {
    const key = notificationKeyForFireResult(result, shooterRole, role);
    if (key) events.push({ key, role });
  }
  return events;
};

const candidateDetails = candidate => {
  const raw = candidate?.candidate || '';
  return {
    candidateType: candidate?.type || raw.match(/\btyp\s+(host|srflx|prflx|relay)\b/)?.[1] || 'unknown',
    protocol: candidate?.protocol || raw.match(/^candidate:\S+\s+\d+\s+(udp|tcp)\b/i)?.[1]?.toLowerCase() || 'unknown',
  };
};
const safeIceEndpoint = value => {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'unknown';
  }
};
async function selectedCandidateDetails(pc) {
  const stats = await pc.getStats();
  const pair = [...stats.values()].find(report => report.type === 'candidate-pair' && (report.selected || (report.nominated && report.state === 'succeeded')));
  if (!pair) return { route: 'unknown' };
  const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
  return { route: local?.candidateType || 'unknown', remoteCandidateType: remote?.candidateType || 'unknown', protocol: local?.protocol || 'unknown' };
}
async function candidatePairSummary(pc) {
  const stats = await pc.getStats();
  return [...stats.values()].filter(report => report.type === 'candidate-pair').slice(0, 12).map(pair => {
    const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
    return `${local?.candidateType || '?'}>${remote?.candidateType || '?'}:${pair.state}`;
  }).join(', ') || 'no-candidate-pairs';
}

const numericLiteralPattern = /(?:\d+\.\d*|\.\d+|\d+)/g, CONSTANT_SLIDER_LIMIT = 100, CONSTANT_SLIDER_SPAN = 1000, CONSTANT_SLIDER_COARSE_STEP = 25, POWER_HOTKEY_STEP = 5, FORMULA_FIELD_MIN_HEIGHT = 60;
const alphaTokenNames = ['sqrt', 'sin', 'cos', 'tan', 'abs', 'log', 'exp', 'ln', 'pi'];
function numericLiterals(expression) {
  return Array.from(expression.matchAll(numericLiteralPattern), match => {
    const numberStart = match.index, end = numberStart + match[0].length, rawValue = Number(match[0]);
    const beforeNumber = expression.slice(0, numberStart), signMatch = beforeNumber.match(/(\s*([+\-])\s*)$/);
    if (!signMatch) return { value: rawValue, start: numberStart, end, mode: 'bare' };
    const signIndex = beforeNumber.length - signMatch[0].length, beforeSign = expression.slice(0, signIndex).trimEnd().at(-1);
    const unary = !beforeSign || '()+-*/^'.includes(beforeSign);
    return { value: signMatch[2] === '-' ? -rawValue : rawValue, start: unary ? signIndex : numberStart, operatorStart: unary ? null : signIndex, end, mode: unary ? 'unary' : 'binary' };
  }).filter(literal => Math.abs(literal.value) <= CONSTANT_SLIDER_LIMIT);
}
function alphaTokens(word) {
  const tokens = [], lower = word.toLowerCase();
  for (let index = 0; index < lower.length;) {
    const named = alphaTokenNames.find(name => lower.startsWith(name, index));
    if (named) { tokens.push({ kind: named === 'pi' ? 'constant' : 'function', value: named }); index += named.length; continue; }
    const letter = lower[index];
    tokens.push({ kind: letter === 'x' || letter === 'y' ? 'variable' : 'parameter', value: letter });
    index += 1;
  }
  return tokens;
}
function parameterSymbols(expression) {
  const symbols = new Set();
  for (const match of expression.toLowerCase().matchAll(/[a-z]+/g)) {
    for (const token of alphaTokens(match[0])) if (token.kind === 'parameter') symbols.add(token.value);
  }
  return [...symbols].sort();
}
function activeFormulaParams(expression, params) {
  return Object.fromEntries(parameterSymbols(expression).map(symbol => [symbol, Number.isFinite(params[symbol]) ? params[symbol] : 1]));
}
function materializeFormulaParams(expression, params) {
  const active = activeFormulaParams(expression, params);
  return expression.replace(/[a-z]+/gi, word => {
    const tokens = alphaTokens(word);
    if (!tokens.some(token => token.kind === 'parameter')) return word;
    let output = '', previousValue = false;
    for (const token of tokens) {
      const currentValue = token.kind !== 'function';
      if (output && previousValue && currentValue) output += '*';
      if (output && previousValue && token.kind === 'function') output += '*';
      output += token.kind === 'parameter' ? `(${formatConstant(Number.isFinite(active[token.value]) ? active[token.value] : 1)})` : token.value;
      previousValue = currentValue;
    }
    return output;
  });
}
function constantToSliderPosition(value) {
  const clamped = Math.min(CONSTANT_SLIDER_LIMIT, Math.max(-CONSTANT_SLIDER_LIMIT, value));
  if (clamped < -1) return Math.round((CONSTANT_SLIDER_SPAN / 4) * (1 - Math.sqrt((Math.abs(clamped) - 1) / (CONSTANT_SLIDER_LIMIT - 1))));
  if (clamped < 0) return Math.round((CONSTANT_SLIDER_SPAN / 4) + (CONSTANT_SLIDER_SPAN / 4) * (clamped + 1));
  if (clamped <= 1) return Math.round((CONSTANT_SLIDER_SPAN / 2) + (CONSTANT_SLIDER_SPAN / 4) * clamped);
  return Math.round((CONSTANT_SLIDER_SPAN * 3 / 4) + (CONSTANT_SLIDER_SPAN / 4) * Math.sqrt((clamped - 1) / (CONSTANT_SLIDER_LIMIT - 1)));
}
function sliderPositionToConstant(position) {
  const normalized = Math.max(0, Math.min(CONSTANT_SLIDER_SPAN, position)) / CONSTANT_SLIDER_SPAN;
  if (normalized < 0.25) return -(1 + (1 - normalized / 0.25) ** 2 * (CONSTANT_SLIDER_LIMIT - 1));
  if (normalized < 0.5) return -1 + ((normalized - 0.25) / 0.25);
  if (normalized <= 0.75) return (normalized - 0.5) / 0.25;
  return 1 + ((normalized - 0.75) / 0.25) ** 2 * (CONSTANT_SLIDER_LIMIT - 1);
}
const sliderPositionStep = (position, delta) => Math.max(0, Math.min(CONSTANT_SLIDER_SPAN, position + delta));
function formatConstant(value) {
  const decimals = Math.abs(value) < 2 ? 3 : Math.abs(value) < 10 ? 2 : Math.abs(value) < 50 ? 1 : 0;
  return String(Number(value.toFixed(decimals)));
}
function replaceNumericLiteral(expression, index, value) {
  const literal = numericLiterals(expression)[index];
  if (!literal) return expression;
  const magnitude = formatConstant(Math.abs(value));
  const wrappedByParens = expression[literal.start - 1] === '(' && expression[literal.end] === ')';
  const replacement = literal.mode === 'binary'
    ? ` ${value < 0 ? '-' : '+'} ${magnitude}`
    : literal.mode === 'bare'
      ? value < 0 && !wrappedByParens ? `(${formatConstant(value)})` : formatConstant(value)
      : `${value < 0 ? '-' : ''}${magnitude}`;
  return `${expression.slice(0, literal.operatorStart ?? literal.start)}${replacement}${expression.slice(literal.end)}`;
}

export default function GameClient({ matchId }) {
  const router = useRouter(), isBotMatch = matchId.startsWith('bot-'), isOnslaughtMatch = matchId.startsWith('onslaught-'), isLocalBotMatch = isBotMatch || isOnslaughtMatch;
  const peer = useRef(null), channel = useRef(null), session = useRef(null), gameRef = useRef(null);
  const botTimer = useRef(null), botTickKey = useRef(null);
  const noticeTimers = useRef(new Map()), simTimer = useRef(null), scoreSubmitted = useRef(null);
  const formulaField = useRef(null);
  const [game, setGame] = useState(null), [selected, setSelected] = useState(0), [link, setLink] = useState('LINKING');
  const [problem, setProblem] = useState(''), [formula, setFormula] = useState('0.12 * sin(1.3*x) - 0.04*x');
  const [formulaParams, setFormulaParams] = useState({});
  const [power, setPower] = useState(75), [reverseFire, setReverseFire] = useState(false), [notices, setNotices] = useState([]), [arcHistory, setArcHistory] = useState([]);
  const [enemyPing, setEnemyPing] = useState(null);

  const publish = useCallback(next => { gameRef.current = next; setGame(next); }, []);
  const send = useCallback(message => { if (channel.current?.readyState === 'open') channel.current.send(JSON.stringify(message)); }, []);
  const reportWebRTC = useCallback((event, details = {}, level = 'info') => {
    if (isLocalBotMatch) return;
    console[level](`[spectral-front:webrtc] ${event} ${JSON.stringify(details)}`);
    const ticket = session.current?.ticket;
    if (ticket) fetch('/api/telemetry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket, event, details }) }).catch(() => {});
  }, [isLocalBotMatch]);
  const stop = useCallback(() => {
    clearTimeout(botTimer.current); botTickKey.current = null;
    clearInterval(simTimer.current); channel.current?.close(); peer.current?.close();
  }, []);
  const leave = useCallback(async () => { if (!isLocalBotMatch) try { await request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: session.current?.ticket, message: { type: 'peer-left' } }) }); } catch {} stop(); sessionStorage.removeItem(sessionKey); router.push('/'); }, [isLocalBotMatch, router, stop]);
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
    scoreSubmitted.current = null;
    clearNotices(); setSelected(0); setPower(75); setReverseFire(false); setFormulaParams({}); pushNotice('trainingInitialized'); publish(createMatch(undefined, { botMatch: true }));
  }, [clearNotices, publish, pushNotice]);
  const restartOnslaughtMatch = useCallback(() => {
    clearTimeout(botTimer.current); botTickKey.current = null;
    scoreSubmitted.current = null;
    clearNotices(); setSelected(0); setPower(75); setReverseFire(false); setFormulaParams({}); pushNotice('onslaughtInitialized'); publish(createMatch(undefined, { botMatch: true, onslaught: true }));
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
    if (action.type === 'move' && action.role === me) pushNotice('moveOrdered');
    if (action.type === 'cancelMove' && action.role === me) pushNotice('moveCancelled');
    if (action.type === 'fire') {
      const events = fireNoticeEvents(result, action.role);
      for (const event of events) {
        if (event.role === me) pushNotice(event.key);
      }
      publish(result.game);
      if (!isLocalBotMatch) send({ type: 'state', state: result.game, events: [...events, ...(result.gameEvents || [])] });
      return result;
    }
    publish(result.game);
    if (!isLocalBotMatch) send({ type: 'state', state: result.game, events: result.gameEvents || [] });
    return result;
  }, [isLocalBotMatch, publish, pushNotice, rememberArc, send]);

  const notifyEvents = useCallback(events => {
    const me = session.current?.role;
    for (const event of events || []) {
      if (!event.role || event.role === me) pushNotice(event.key);
    }
  }, [pushNotice]);

  const submitAction = useCallback(action => {
    const me = session.current?.role;
    const actingShip = gameRef.current?.ships[me]?.[action.shipIndex];
    if (gameRef.current?.phase !== 'live') {
      pushNotice('combatStaging');
      return;
    }
    if (action.type === 'fire' && (!actingShip || actingShip.energy < fireEnergyCost(action.power ?? 100))) {
      pushNotice('notEnoughEnergyFire');
      return;
    }
    if (action.type === 'move' && (!actingShip || actingShip.energy < MOVE_INITIAL_COST)) {
      pushNotice('notEnoughEnergyMove');
      return;
    }
    if (isLocalBotMatch || me === 'host') {
      commitAction(action);
      return;
    }
    if (action.type === 'fire') rememberArc(action.expression);
    send({ type: 'action', action });
  }, [commitAction, isLocalBotMatch, pushNotice, rememberArc, send]);

  const submitCosmetic = useCallback(value => {
    const me = session.current?.role;
    if (!me) return;
    const action = { type: 'cosmetic', role: me, target: 'color', value };
    if (isLocalBotMatch || me === 'host') {
      commitAction(action);
      return;
    }
    send({ type: 'action', action });
  }, [commitAction, isLocalBotMatch, send]);

  const handleMove = useCallback(point => {
    const me = session.current?.role;
    if (!me || isCombatLocked(gameRef.current)) return;
    const ship = gameRef.current?.ships[me]?.[selected];
    if (!ship?.hp) return;
    submitAction({ type: 'move', role: me, shipIndex: selected, x: point.x, y: point.y });
  }, [selected, submitAction]);

  const handleCancelMove = useCallback(() => {
    const me = session.current?.role;
    if (!me || isCombatLocked(gameRef.current)) return;
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
    const isAuthority = isLocalBotMatch || session.current?.role === 'host';
    if (!game || isMatchOver(game) || !isAuthority) return;
    simTimer.current = window.setInterval(() => {
      const { game: next, events } = advanceSimulation(gameRef.current, SIM_TICK_MS);
      if (next.simTime !== gameRef.current?.simTime) {
        publish(next);
        notifyEvents(events);
        if (!isLocalBotMatch) send({ type: 'state', state: next, events });
      }
    }, SIM_TICK_MS);
    return () => clearInterval(simTimer.current);
  }, [game?.outcome, game?.seed, isLocalBotMatch, notifyEvents, publish, send]);

  useEffect(() => {
    clearTimeout(botTimer.current);
    const tickKey = game ? `${game.seed}:${botDecisionWindow}` : null;
    if (!isLocalBotMatch || isCombatLocked(game) || game?.phase !== 'live') { botTickKey.current = null; return; }
    if (botTickKey.current === tickKey) return;
    botTickKey.current = tickKey;
    botTimer.current = window.setTimeout(() => takeBotTurn(tickKey), 150 + Math.random() * 180);
    return () => { clearTimeout(botTimer.current); if (botTickKey.current === tickKey) botTickKey.current = null; };
  }, [botDecisionWindow, game?.outcome, game?.phase, game?.seed, isLocalBotMatch, takeBotTurn]);

  const connect = useCallback(async () => {
    if (isLocalBotMatch) {
      session.current = { role: 'host' };
      setLink(isOnslaughtMatch ? 'ONSLAUGHT UPLINK' : 'BOT UPLINK');
      publish(createMatch(undefined, { botMatch: true, onslaught: isOnslaughtMatch }));
      return;
    }
    const stored = JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); if (!stored || stored.matchId !== matchId) { router.replace('/'); return; }
    session.current = stored;
    try {
      const { iceServers } = await request(`/api/ice?ticket=${encodeURIComponent(stored.ticket)}`);
      const turnServerCount = iceServers.filter(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => String(url).startsWith('turn'))).length;
      reportWebRTC('ice_servers_received', { iceServerCount: iceServers.length, turnServerCount });
      const pc = peer.current = new RTCPeerConnection({ iceServers });
      reportWebRTC('peer_created');
      pc.onsignalingstatechange = () => reportWebRTC('signaling_state', { state: pc.signalingState });
      pc.onicegatheringstatechange = () => reportWebRTC('ice_gathering_state', { state: pc.iceGatheringState });
      pc.oniceconnectionstatechange = () => {
        reportWebRTC('ice_connection_state', { state: pc.iceConnectionState }, ['failed', 'disconnected'].includes(pc.iceConnectionState) ? 'warn' : 'info');
        if (['connected', 'completed'].includes(pc.iceConnectionState)) selectedCandidateDetails(pc).then(details => reportWebRTC('selected_candidate_pair', details)).catch(() => {});
        if (pc.iceConnectionState === 'failed') candidatePairSummary(pc).then(reason => reportWebRTC('ice_candidate_pairs', { reason }, 'warn')).catch(() => {});
      };
      pc.onicecandidateerror = event => reportWebRTC('ice_candidate_error', { code: event.errorCode, reason: event.errorText || 'ice-candidate-error', endpoint: safeIceEndpoint(event.url) }, 'warn');
      pc.onicecandidate = event => {
        if (!event.candidate) {
          reportWebRTC('ice_gathering_complete');
          request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: stored.ticket, message: { type: 'candidate', candidate: null } }) }).catch(error => reportWebRTC('signal_send_error', { reason: error.message }, 'warn'));
          return;
        }
        reportWebRTC('ice_candidate', candidateDetails(event.candidate));
        request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: stored.ticket, message: { type: 'candidate', candidate: event.candidate } }) }).catch(error => reportWebRTC('signal_send_error', { reason: error.message }, 'warn'));
      };
      const reportDisconnect = () => { reportWebRTC('peer_disconnected', { state: pc.connectionState }, 'warn'); if (!isMatchOver(gameRef.current)) setProblem('Connection lost. The other commander or their network left the duel.'); };
      pc.onconnectionstatechange = () => { reportWebRTC('peer_connection_state', { state: pc.connectionState }, ['failed', 'disconnected'].includes(pc.connectionState) ? 'warn' : 'info'); if (['failed', 'disconnected'].includes(pc.connectionState)) reportDisconnect(); };
      const pendingRemoteCandidates = [];
      const addRemoteCandidate = async candidate => {
        if (!pc.remoteDescription) {
          pendingRemoteCandidates.push(candidate);
          reportWebRTC('remote_candidate_queued', candidateDetails(candidate));
          return;
        }
        try {
          await pc.addIceCandidate(candidate);
          reportWebRTC(candidate ? 'remote_candidate_added' : 'remote_candidate_complete', candidate ? candidateDetails(candidate) : {});
        } catch (error) {
          reportWebRTC('remote_candidate_error', { ...candidateDetails(candidate), reason: error.message }, 'warn');
        }
      };
      const setRemoteDescription = async (description, source) => {
        await pc.setRemoteDescription(description);
        reportWebRTC('remote_description_set', { state: pc.signalingState, reason: source });
        while (pendingRemoteCandidates.length) await addRemoteCandidate(pendingRemoteCandidates.shift());
      };
      const open = dataChannel => {
        channel.current = dataChannel;
        dataChannel.onopen = () => { reportWebRTC('data_channel_open', { channel: dataChannel.label }); setLink('DIRECT LINK'); if (stored.role === 'host') { const initial = createMatch(); send({ type: 'state', state: initial }); publish(initial); } reportWebRTC('match_transport_ready', { channel: dataChannel.label }); };
        dataChannel.onclose = () => { reportWebRTC('data_channel_close', { channel: dataChannel.label }, 'warn'); if (!isMatchOver(gameRef.current)) setProblem('The other commander left the duel.'); };
        dataChannel.onerror = () => reportWebRTC('data_channel_error', { channel: dataChannel.label }, 'warn');
        dataChannel.onmessage = event => {
          const message = JSON.parse(event.data);
          if (message.type === 'state') {
            publish(message.state);
            notifyEvents(message.events);
          }
          if (message.type === 'action' && stored.role === 'host') commitAction({ ...message.action, role: 'guest' });
        };
      };
      pc.ondatachannel = event => { reportWebRTC('data_channel_received', { channel: event.channel.label }); open(event.channel); };
      if (stored.role === 'host') { open(pc.createDataChannel('match', { ordered: true })); const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: stored.ticket, message: { type: 'offer', sdp: offer } }) }); reportWebRTC('offer_sent'); }
      let cancelled = false;
      let lastSignalFailureAt = 0;
      (async () => { while (!cancelled && pc.connectionState !== 'closed') { try { const { messages = [] } = await request(`/api/signal?ticket=${encodeURIComponent(stored.ticket)}`); for (const message of messages) { if (message.type === 'offer' && stored.role === 'guest') { reportWebRTC('offer_received'); await setRemoteDescription(message.sdp, 'offer'); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); await request('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: stored.ticket, message: { type: 'answer', sdp: answer } }) }); reportWebRTC('answer_sent'); } if (message.type === 'answer' && stored.role === 'host') { await setRemoteDescription(message.sdp, 'answer'); reportWebRTC('answer_received'); } if (message.type === 'candidate') { reportWebRTC('remote_candidate_received', candidateDetails(message.candidate)); await addRemoteCandidate(message.candidate); } if (message.type === 'peer-left' && !isMatchOver(gameRef.current)) { reportWebRTC('peer_disconnected', { reason: 'peer-left' }, 'warn'); setProblem('The other commander left the duel.'); } } } catch (error) { if (Date.now() - lastSignalFailureAt > 5000) { lastSignalFailureAt = Date.now(); reportWebRTC('signal_poll_error', { reason: error.message }, 'warn'); } } await new Promise(resolvePoll => setTimeout(resolvePoll, 600)); } })();
      return () => { cancelled = true; };
    } catch (error) { reportWebRTC('peer_connection_error', { reason: error.message }, 'warn'); setProblem(error.message); }
  }, [commitAction, isLocalBotMatch, isOnslaughtMatch, matchId, notifyEvents, publish, reportWebRTC, router, send]);

  useEffect(() => { let cleanup; connect().then(fn => cleanup = fn); return () => { cleanup?.(); stop(); }; }, [connect, stop]);
  useEffect(() => () => { for (const timer of noticeTimers.current.values()) clearTimeout(timer); }, []);
  useEffect(() => {
    if (!enemyPing) return;
    const timer = window.setTimeout(() => setEnemyPing(current => (current?.id === enemyPing.id ? null : current)), 1840);
    return () => clearTimeout(timer);
  }, [enemyPing]);
  useEffect(() => {
    const field = formulaField.current;
    if (!field) return;
    field.style.height = '0px';
    field.style.height = `${Math.max(FORMULA_FIELD_MIN_HEIGHT, Math.min(field.scrollHeight, 168))}px`;
  }, [formula]);
  useEffect(() => {
    const me = session.current?.role;
    if (!isOnslaughtMatch || !game || !me || !isMatchOver(game)) return;
    const destroyed = Math.max(0, Math.round(game.onslaughtDestroyed || 0));
    const scoreKey = `${game.seed}:${game.outcome}:${destroyed}`;
    if (scoreSubmitted.current === scoreKey) return;
    scoreSubmitted.current = scoreKey;
    const username = localStorage.getItem(USERNAME_STORAGE_KEY);
    if (!username) return;
    fetch('/api/leaderboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, kills: destroyed }) }).catch(() => {});
  }, [game, isOnslaughtMatch]);
  const fireCurrent = useCallback(() => {
    const current = gameRef.current, me = session.current?.role;
    if (!current || !me) return;
    const ship = current.ships[me]?.[selected], combatLocked = isCombatLocked(current), combatActive = current.phase === 'live', cost = fireEnergyCost(power);
    if (combatLocked || !ship?.hp) return;
    if (!combatActive) { pushNotice('combatStaging'); return; }
    if (ship.energy < cost) { pushNotice('notEnoughEnergyFire'); return; }
    submitAction({ type: 'fire', role: me, shipIndex: selected, expression: materializeFormulaParams(formula, formulaParams), power, reverse: reverseFire });
  }, [formula, formulaParams, power, pushNotice, reverseFire, selected, submitAction]);
  useEffect(() => {
    const handleCombatHotkey = event => {
      const key = event.key.toLowerCase();
      if (!['f', 'r', 'y', 'w', 's', '1', '2', '3', '4', '5', '6', '7', '8'].includes(key) || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target, tag = target?.tagName?.toLowerCase();
      const formulaFocused = target === formulaField.current;
      const textEditingTarget = target?.isContentEditable || tag === 'textarea' || tag === 'select' || (tag === 'input' && target.type !== 'range');
      if (textEditingTarget && !(key === 'y' && formulaFocused)) return;
      event.preventDefault();
      if (key === 'f') fireCurrent();
      else if (key === 'r' && !isCombatLocked(gameRef.current)) setReverseFire(value => !value);
      else if (key === 'w') setPower(value => Math.min(100, value + POWER_HOTKEY_STEP));
      else if (key === 's') setPower(value => Math.max(5, value - POWER_HOTKEY_STEP));
      else if (key === 'y') {
        if (formulaFocused) formulaField.current?.blur();
        else formulaField.current?.focus();
      }
      else if (['1', '2', '3', '4'].includes(key)) {
        const index = Number(key) - 1, me = session.current?.role;
        if (gameRef.current?.ships[me]?.[index]?.hp) setSelected(index);
      }
      else if (['5', '6', '7', '8'].includes(key)) {
        const index = Number(key) - 5, me = session.current?.role, foe = me === 'host' ? 'guest' : 'host';
        if (gameRef.current?.ships[foe]?.[index]?.hp) setEnemyPing({ shipIndex: index, id: Date.now() });
      }
    };
    window.addEventListener('keydown', handleCombatHotkey);
    return () => window.removeEventListener('keydown', handleCombatHotkey);
  }, [fireCurrent]);

  if (!game || problem) return <div className="game-shell"><header className="game-top"><div className="brand">SPECTRAL <i>FRONT</i></div></header><section className="disconnected standalone"><div>{!problem && <div className="spinner" />}<h2>{problem ? 'Match unavailable' : 'Setting up the duel'}</h2><p>{problem || 'Securing a direct browser connection…'}</p><button className="primary" onClick={leave}>BACK TO LOBBY</button></div></section></div>;

  const me = session.current.role, foe = me === 'host' ? 'guest' : 'host', myShips = game.ships[me], selectedShip = game.ships[me][selected], matchOver = isMatchOver(game), combatLocked = isCombatLocked(game), combatActive = game.phase === 'live', won = game.outcome === me;
  const myCosmetics = game.cosmetics?.[me] || { color: '#55d5cc', ui: '#55d5cc', laser: '#55d5cc', ship: '#55d5cc', shipOptions: ['#55d5cc'] };
  const foeCosmetics = game.cosmetics?.[foe] || { color: '#f27b82', ui: '#f27b82', laser: '#f27b82', ship: '#f27b82', shipOptions: ['#f27b82'] };
  const myColor = myCosmetics.color || myCosmetics.ship || '#55d5cc';
  const foeColor = foeCosmetics.color || foeCosmetics.ship || '#f27b82';
  const myEnergy = selectedShip?.energy ?? 0, fireCost = fireEnergyCost(power), beamRange = Math.round(worldDistanceToGraphUnits(beamDistanceForPower(power)));
  const botClearTimeMs = isBotMatch && matchOver && won ? Math.max(1, Math.round((game.simTime || 0) - (game.countdownMs ?? MATCH_COUNTDOWN_MS))) : null;
  const onslaughtDestroyed = isOnslaughtMatch ? game.onslaughtDestroyed || 0 : null;
  const foeShipEntries = game.ships[foe].map((ship, index) => ({ ship, index })).filter(({ ship }) => !isOnslaughtMatch || ship.hp);
  const countdownSeconds = Math.max(0, Math.ceil(((game.countdownMs ?? MATCH_COUNTDOWN_MS) - (game.simTime || 0)) / 1000));
  const canFire = combatActive && !combatLocked && myShips[selected]?.hp && myEnergy >= fireCost;
  const pingEnemyShip = index => {
    const ship = game.ships[foe][index];
    if (!ship?.hp) return;
    setEnemyPing({ shipIndex: index, id: Date.now() });
  };

  return (
    <div className="game-shell" style={{ '--player-ui': myColor, '--player-laser': myColor, '--player-ship': myColor }}>
      <header className="game-top"><div className="brand">SPECTRAL <i>FRONT</i></div><div className="match-meta"><span className="online">● {link}</span> &nbsp; {isOnslaughtMatch ? 'ONSLAUGHT' : isBotMatch ? 'TRAINING MATCH' : `MATCH ${matchId.slice(0, 6).toUpperCase()}`}</div><div className="top-actions"><HotkeyHelp /><button className="leave" onClick={leave}>LEAVE MATCH</button></div></header>
      <main className="game-grid">
        <aside className="panel side">
          <div className="fleet-command player active" style={{ '--fleet-ship': myColor }}><strong>YOUR FLEET</strong><small>{matchOver ? `${liveShips(game, me).length} SURVIVING` : 'SELECT SHIP · FIRE OR LEFT CLICK TO MOVE'}</small>
            <div className="ship-select">{myShips.map((ship, index) => <button key={index} disabled={!ship.hp || combatLocked} className={'ship-choice ' + (index === selected ? 'selected' : '') + (ship.hp && ship.moving ? ' moving' : '')} aria-label={`Select ship ${index + 1}. Energy ${Math.round(ship.energy)} of ${ENERGY_MAX}. ${ship.hp ? (ship.moving ? 'Moving' : 'Ready') : 'Lost'}`} onClick={() => setSelected(index)}><span className="ship-choice-head"><b>SHIP {String(index + 1).padStart(2, '0')}</b><i>{ship.hp ? (ship.moving ? 'MOVING' : 'READY') : 'LOST'}</i></span><span className="ship-energy" aria-hidden="true"><span className="ship-energy-fill" style={{ width: `${(ship.energy / ENERGY_MAX) * 100}%` }} /><em>{Math.round(ship.energy)}<i> / {ENERGY_MAX}</i></em></span></button>)}</div>
          </div>
          <div className="player enemy" style={{ '--enemy-ship': foeColor }}><strong>{isOnslaughtMatch ? 'ONSLAUGHT WAVE' : isBotMatch ? 'BOT FLEET' : 'RIVAL FLEET'}</strong><small>{isOnslaughtMatch ? `${liveShips(game, foe).length}/7 ACTIVE · ${onslaughtDestroyed} DESTROYED` : matchOver ? `${liveShips(game, foe).length} SURVIVING` : 'ENERGY RESERVES · CLICK TO LOCATE'}</small><div className="enemy-ship-list">{foeShipEntries.map(({ ship, index }) => <button type="button" key={index} disabled={!ship.hp} className={'enemy-ship' + (!ship.hp ? ' lost' : '') + (enemyPing?.shipIndex === index ? ' pinging' : '') + (ship.entryTargetX != null ? ' entering' : '')} aria-label={ship.hp ? `Locate enemy ship ${index + 1} on the battlefield` : `Enemy ship ${index + 1} lost`} onClick={() => pingEnemyShip(index)}><b>{isOnslaughtMatch ? 'BOGEY' : 'SHIP'} {String(index + 1).padStart(2, '0')}</b><div className="enemy-energy" aria-hidden="true"><i style={{ width: `${(ship.energy / ENERGY_MAX) * 100}%` }} /></div><span>{ship.hp ? (ship.entryTargetX != null ? 'IN' : Math.round(ship.energy)) : 'LOST'}</span></button>)}</div></div>
          <CosmeticControls cosmetics={myCosmetics} onChange={submitCosmetic} />
        </aside>
        <section className="panel arena-wrap">
          <div className="arena-top"><span>LOCAL SIMULATION: <b>{isOnslaughtMatch ? 'ONSLAUGHT' : isBotMatch ? 'BOT TRAINING' : me === 'host' ? 'HOST' : 'CONNECTED'}</b></span><span>{matchOver ? 'MATCH COMPLETE' : combatActive ? `LIVE · ${Math.round((game.simTime || 0) / 1000)}s` : 'STAGING SEQUENCE'}</span></div>
          <div className="arena-stage">
            <ArenaCanvas game={game} role={me} selected={selected} onSelectShip={setSelected} onMoveShip={combatActive ? handleMove : undefined} onCancelMove={combatActive ? handleCancelMove : undefined} matchOver={combatLocked} expression={materializeFormulaParams(formula, formulaParams)} reverse={reverseFire} power={power} previewDisabled={combatLocked || !combatActive} enemyPing={enemyPing} />
            <div className="event-queue" aria-live="polite">{notices.map(notice => <div className="event show" key={notice.id} style={{ borderLeftColor: notice.accent }}>{notice.message}</div>)}</div>
            {!combatActive && !matchOver && <LaunchCountdown seconds={countdownSeconds} />}
          </div>
          {matchOver && <MatchConclusion won={won} isBotMatch={isBotMatch} isOnslaughtMatch={isOnslaughtMatch} myRemaining={liveShips(game, me).length} foeRemaining={liveShips(game, foe).length} clearTimeMs={botClearTimeMs} destroyed={onslaughtDestroyed} onRestart={isOnslaughtMatch ? restartOnslaughtMatch : restartBotMatch} onLeave={leave} />}
        </section>
        <aside className="panel command-panel" aria-label="Fire control computer">
          <div className="formula command-editor">
            <div className="command-head"><span>FIRE COMPUTER</span><b>{combatActive ? 'ARMED' : 'STAGING'}</b></div>
            <label>FIRING ARC: Y = F(X)</label>
            <div className="formula-row"><span>y =</span><textarea ref={formulaField} rows={2} value={formula} disabled={combatLocked} onChange={event => setFormula(event.target.value)} autoComplete="off" spellCheck="false" /></div>
          </div>
          <div className="command-scroll">
            <FunctionConstantSliders formula={formula} params={formulaParams} disabled={combatLocked} onNumberChange={(index, value) => setFormula(current => replaceNumericLiteral(current, index, value))} onParamChange={(symbol, value) => setFormulaParams(current => ({ ...current, [symbol]: value }))} />
            {arcHistory.length > 0 && <div className="arc-history" aria-label="Previous firing arcs"><span>ARC BANK</span><div>{arcHistory.map((arc, index) => <button key={arc} type="button" disabled={combatLocked} className={arc === formula ? 'selected' : ''} onClick={() => setFormula(arc)}><b>{String(index + 1).padStart(2, '0')}</b>{arc}</button>)}</div></div>}
          </div>
          <div className="command-footer">
            <div className="power-control">
              <label htmlFor="beam-power">BEAM POWER — {power}% · {beamRange} graph units · {Math.round(fireCost)} energy</label>
              <input id="beam-power" type="range" min="5" max="100" value={power} style={{ '--power-fill': `${((power - 5) / 95) * 100}%` }} disabled={combatLocked} onChange={event => setPower(+event.target.value)} />
            </div>
            <button type="button" className={'reverse-fire ' + (reverseFire ? 'active' : '')} disabled={combatLocked} onClick={() => setReverseFire(value => !value)}><span>FIRE DIRECTION (R)</span><b>{reverseFire ? 'REVERSE' : 'FORWARD'}</b></button>
            <div className="hint">{matchOver ? 'Command channel closed.' : !combatActive ? `Unlocks in ${countdownSeconds}s.` : myEnergy < fireCost ? `Need ${Math.round(fireCost - myEnergy)} more energy.` : 'Origin: selected ship · +x points enemyward.'}</div>
            <button className="fire" disabled={!canFire} onClick={fireCurrent}>{matchOver ? 'MATCH ENDED' : !combatActive ? 'SYSTEMS ARMING' : myEnergy < fireCost ? 'LOW ENERGY' : 'FIRE BEAM (F)'}</button>
          </div>
        </aside>
      </main>
    </div>
  );
}

function FunctionConstantSliders({ formula, params, disabled, onNumberChange, onParamChange }) {
  const [activeSliderKey, setActiveSliderKey] = useState(null), [highlightedSliderKey, setHighlightedSliderKey] = useState(null);
  const highlightTimer = useRef(null);
  const constants = numericLiterals(formula), symbols = parameterSymbols(formula);
  const controls = [
    ...symbols.map(symbol => ({ key: `symbol-${symbol}`, label: symbol, value: Number.isFinite(params[symbol]) ? params[symbol] : 1, apply: value => onParamChange(symbol, value), symbol: true })),
    ...constants.map((constant, index) => ({ key: `constant-${constant.start}-${index}`, label: `C${String(index + 1).padStart(2, '0')}`, value: constant.value, apply: value => onNumberChange(index, value), index })),
  ];
  const activeIndex = Math.max(0, controls.findIndex(control => control.key === activeSliderKey));
  const activeControl = controls[activeIndex];
  const pulseHighlight = useCallback(key => {
    clearTimeout(highlightTimer.current);
    setHighlightedSliderKey(key);
    highlightTimer.current = setTimeout(() => setHighlightedSliderKey(null), 4000);
  }, []);
  const claimSlider = useCallback((key, highlight = false) => {
    setActiveSliderKey(key);
    if (highlight) pulseHighlight(key);
  }, [pulseHighlight]);
  const handleSliderKey = useCallback(event => {
    const key = event.key.toLowerCase();
    if (disabled || !['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd'].includes(key) || !activeControl) return;
    event.preventDefault();
    event.stopPropagation?.();
    if (key === 'arrowup' || key === 'arrowdown') {
      const nextIndex = Math.max(0, Math.min(controls.length - 1, activeIndex + (key === 'arrowup' ? -1 : 1)));
      claimSlider(controls[nextIndex].key, true);
      return;
    }
    const delta = key === 'arrowleft' ? -1 : key === 'arrowright' ? 1 : key === 'a' ? -CONSTANT_SLIDER_COARSE_STEP : CONSTANT_SLIDER_COARSE_STEP;
    const nextPosition = sliderPositionStep(constantToSliderPosition(activeControl.value), delta);
    claimSlider(activeControl.key, true);
    activeControl.apply(sliderPositionToConstant(nextPosition));
  }, [activeControl, activeIndex, claimSlider, controls, disabled]);
  useEffect(() => {
    const handleWindowKeyDown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'A', 'd', 'D'].includes(event.key)) return;
      const target = event.target, tag = target?.tagName?.toLowerCase();
      if (target?.isContentEditable || tag === 'textarea' || (tag === 'input' && target.type !== 'range')) return;
      if (tag === 'input' && target.type === 'range' && !target.closest?.('.constant-tuners')) return;
      handleSliderKey(event);
    };
    window.addEventListener('keydown', handleWindowKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleWindowKeyDown, { capture: true });
  }, [handleSliderKey]);
  useEffect(() => () => clearTimeout(highlightTimer.current), []);
  if (!constants.length && !symbols.length) return <section className="constant-tuners empty"><span>FUNCTION CONSTANTS</span><p>Add numbers or letters like a, b, c to tune them with sliders.</p></section>;
  return <section className="constant-tuners" aria-label="Function constant sliders"><div className="constant-tuners-head"><span>FUNCTION CONSTANTS</span><small></small></div><div className="constant-slider-list">{controls.map(control => <label className={'constant-slider ' + (control.symbol ? 'symbol-slider ' : '') + (control.key === (activeControl?.key) ? 'active-tuner ' : '') + (control.key === highlightedSliderKey ? 'keyboard-highlight ' : '')} key={control.key}><b>{control.label}</b><input type="range" min="0" max={CONSTANT_SLIDER_SPAN} step="1" value={constantToSliderPosition(control.value)} disabled={disabled} onFocus={() => claimSlider(control.key)} onPointerDown={() => claimSlider(control.key)} onChange={event => { claimSlider(control.key); control.apply(sliderPositionToConstant(Number(event.target.value))); }} /><output>{formatConstant(control.value)}</output></label>)}</div></section>;
}

function CosmeticControls({ cosmetics, onChange }) {
  const color = cosmetics.color || cosmetics.ship;
  return <section className="cosmetic-controls" aria-label="Commander color controls"><div className="cosmetic-title"><span>COMMANDER SIGNATURE</span><i style={{ '--swatch': color }} aria-hidden="true" /></div><ColorRow label="" value={color} options={cosmetics.shipOptions || []} onChange={onChange} /></section>;
}

function ColorRow({ label, value, options, onChange }) {
  const name = label || 'Commander';
  return <div className="color-row">{label && <span>{label}</span>}<div>{options.map((color, index) => <button key={color} type="button" aria-label={`${name} color option ${index + 1}`} className={color === value ? 'selected' : ''} style={{ '--swatch': color }} onClick={() => onChange(color)}><i /><b>{String(index + 1).padStart(2, '0')}</b></button>)}</div></div>;
}

function HotkeyHelp() {
  return <div className="hotkey-help" tabIndex={0} role="button" aria-label="Show hotkeys"><span>&lt; Hotkeys &gt;</span><div className="hotkey-popover" role="tooltip"><dl><div><dt>F</dt><dd>Fire beam</dd></div><div><dt>R</dt><dd>Reverse fire direction</dd></div><div><dt>Y</dt><dd>Toggle formula typing</dd></div><div><dt>W / S</dt><dd>Adjust beam power</dd></div><div><dt>1–4</dt><dd>Select ship</dd></div><div><dt>5–8</dt><dd>Locate enemy ship</dd></div><div><dt>A / D</dt><dd>Coarse-tune active slider</dd></div><div><dt>← / →</dt><dd>Fine-tune active slider</dd></div><div><dt>↑ / ↓</dt><dd>Select slider</dd></div></dl></div></div>;
}

function LaunchCountdown({ seconds }) {
  return <section className="launch-countdown" aria-live="polite"><div className="launch-kicker">ENGAGEMENT WINDOW</div><output>{seconds}</output><p>Fleet synchronized · opening reserves randomized</p></section>;
}

function formatClearTime(timeMs) {
  const totalSeconds = Math.max(0, Math.round(timeMs / 1000));
  const minutes = Math.floor(totalSeconds / 60), seconds = totalSeconds % 60;
  return minutes ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
}

function MatchConclusion({ won, isBotMatch, isOnslaughtMatch, myRemaining, foeRemaining, clearTimeMs, destroyed, onRestart, onLeave }) {
  const title = isOnslaughtMatch ? 'FLEET OVERRUN' : won ? 'SECTOR SECURED' : 'FLEET LOST';
  const detail = isOnslaughtMatch
    ? `Onslaught ended. ${destroyed || 0} enemies destroyed before the line broke.`
    : won
      ? (isBotMatch ? 'Training objective complete. The bot fleet is dark.' : 'Opponent fleet eliminated. Your sector is secure.')
      : (isBotMatch ? 'The navigation AI eliminated your fleet.' : 'Your opponent eliminated the fleet.');
  return <section className={'match-conclusion ' + (won && !isOnslaughtMatch ? 'victory' : 'defeat')} role="dialog" aria-modal="true" aria-labelledby="match-result-title"><div className="result-signal">{won && !isOnslaughtMatch ? '◈' : '✕'} MATCH RESULT</div><h2 id="match-result-title">{title}</h2><p>{detail}</p><div className="result-score"><span><b>{myRemaining}</b> YOUR SHIPS</span><i>:</i><span><b>{foeRemaining}</b> {isOnslaughtMatch ? 'ACTIVE' : isBotMatch ? 'BOT SHIPS' : 'RIVAL SHIPS'}</span>{clearTimeMs && <><i>:</i><span><b>{formatClearTime(clearTimeMs)}</b> CLEAR</span></>}{isOnslaughtMatch && <><i>:</i><span><b>{destroyed || 0}</b> DESTROYED</span></>}</div>{isBotMatch || isOnslaughtMatch ? <button className="result-primary" onClick={onRestart}>{isOnslaughtMatch ? 'RUN NEW ONSLAUGHT' : 'RUN NEW TRAINING MATCH'}</button> : <button className="result-primary" onClick={onLeave}>RETURN TO LOBBY</button>}<button className="result-secondary" onClick={onLeave}>{isBotMatch || isOnslaughtMatch ? 'RETURN TO LOBBY' : 'LEAVE MATCH'}</button></section>;
}
