const app = document.querySelector('#app');
const api = async (path, options = {}) => {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Network request failed');
  return body;
};
const ticket = () => crypto.randomUUID();
const sessionKey = 'spectral-front-session';
let session = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
let match = null;
let poller = null;
let peer = null;
let channel = null;
let arena = null;
let selectedShip = 0;

function saveSession() { sessionStorage.setItem(sessionKey, JSON.stringify(session)); }
function clearSession() { session = null; sessionStorage.removeItem(sessionKey); }

function lobby() {
  clearInterval(poller); poller = null; match = null; channel?.close(); peer?.close(); channel = peer = null;
  app.innerHTML = `<div class="shell"><header class="top"><div class="brand">SPECTRAL <i>FRONT</i></div><div class="top-note">CASUAL P2P TACTICAL DUEL</div></header><section class="lobby"><div><div class="eyebrow">SECTOR 01 / OPEN QUEUE</div><h1>Shape the arc.<br><span>Break the line.</span></h1><p class="lede">A small, private duel played directly between two browsers. Three ships each. Planets in the way. One function at a time.</p></div><div><section class="join-card"><h2>Open a duel</h2><p>Join the queue. We pair you with one pilot, create a direct connection, then enter the match.</p><button class="primary" id="join">JOIN MATCH</button><p class="fine">No account. No public room. Connection setup uses the service; match data travels peer-to-peer when networks allow it.</p></section><section class="status-card" id="status"><div class="eyebrow">MATCHMAKING</div><div class="spinner"></div><h2 id="status-title">Looking for another pilot</h2><p id="status-copy">You are in the queue. This page will move into the match when someone joins.</p><button class="secondary" id="cancel">CANCEL</button></section></div></section></div>`;
  document.querySelector('#join').onclick = join;
}

async function join() {
  session = { ticket: ticket() }; saveSession();
  document.querySelector('.join-card').style.display = 'none'; document.querySelector('#status').classList.add('show');
  try { await api('/api/join', { method: 'POST', body: JSON.stringify({ ticket: session.ticket }) }); await waitForMatch(); }
  catch (error) { showStatus('Could not reach matchmaking', `${error.message}. Check that Vercel KV is connected, then try again.`, true); }
}
function showStatus(title, copy, failed = false) { document.querySelector('#status-title').textContent = title; document.querySelector('#status-copy').textContent = copy; if (failed) document.querySelector('.spinner').style.display = 'none'; }
async function waitForMatch() {
  clearInterval(poller);
  const check = async () => {
    try { const result = await api(`/api/join?ticket=${encodeURIComponent(session.ticket)}`); if (result.status === 'matched') { clearInterval(poller); session = { ...session, ...result }; saveSession(); location.hash = `match/${result.matchId}`; } }
    catch { /* keep waiting through a brief serverless restart */ }
  };
  await check(); poller = setInterval(check, 1400);
  document.querySelector('#cancel').onclick = async () => { await api('/api/join', { method: 'DELETE', body: JSON.stringify({ ticket: session.ticket }) }).catch(() => {}); clearSession(); lobby(); };
}

function gameShell() {
  selectedShip = 0;
  const me = session.role === 'host' ? 'ORBITAL' : 'VECTOR'; const them = session.role === 'host' ? 'VECTOR' : 'ORBITAL';
  app.innerHTML = `<div class="game-shell"><header class="game-top"><div class="brand">SPECTRAL <i>FRONT</i></div><div class="match-meta"><span class="online" id="link">● LINKING</span> &nbsp; MATCH ${session.matchId.slice(0, 6).toUpperCase()}</div><button class="leave" id="leave">LEAVE MATCH</button></header><main class="game-grid"><aside class="panel side"><div><div class="label">TURN</div><div class="turn" id="turn">Establishing link…</div></div><div><div class="player active" id="mine"><strong>${me} / YOU</strong><small>YOUR FLEET — SELECT A SHIP</small><div class="ship-select" id="ship-select"></div></div><div class="player enemy" id="theirs"><strong>${them} / RIVAL</strong><small>OPPOSING FLEET</small><div class="dots" id="their-ships">● ● ●</div></div></div><div class="rules">Pick one of your ships. That ship is <b>(0, 0)</b> for the shot. The board axes stay horizontal and vertical: left is −x, right is +x; up is +y.</div></aside><section class="panel arena-wrap"><div class="arena-top"><span>LOCAL SIMULATION: <b id="sim">WAITING</b></span><span id="round">ROUND 01</span></div><canvas id="arena" width="1000" height="600"></canvas><div class="event" id="event"></div><section class="command"><div class="formula"><label for="formula">FIRING ARC — Y = F(X)</label><div class="formula-row"><span>y =</span><input id="formula" value="0.12 * sin(1.3*x) - 0.04*x" autocomplete="off" spellcheck="false"/><button hidden></button></div><div class="hint" id="hint">Origin: selected ship (0, 0) · Functions: sin, cos, abs, sqrt, log, exp</div></div><button class="fire" id="fire" disabled>FIRE ARC</button></section><div class="disconnected" id="cover"><div><div class="spinner"></div><h2 id="cover-title">Setting up the duel</h2><p id="cover-copy">Securing a direct browser connection…</p><button class="primary" id="back" hidden>BACK TO LOBBY</button></div></div></section></main></div>`;
  arena = document.querySelector('#arena'); document.querySelector('#leave').onclick = leave; document.querySelector('#back').onclick = () => { clearSession(); location.hash = ''; };
}

async function startGame() {
  gameShell();
  try {
    const ice = await api(`/api/ice?ticket=${encodeURIComponent(session.ticket)}`);
    peer = new RTCPeerConnection({ iceServers: ice.iceServers });
    peer.onicecandidate = ({ candidate }) => candidate && signal({ type: 'candidate', candidate });
    peer.onconnectionstatechange = () => { if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') disconnected('Connection lost', 'The other pilot or their network left the duel.'); };
    peer.ondatachannel = ({ channel: incoming }) => openChannel(incoming);
    if (session.role === 'host') { openChannel(peer.createDataChannel('match', { ordered: true })); const offer = await peer.createOffer(); await peer.setLocalDescription(offer); await signal({ type: 'offer', sdp: offer }); }
    pollSignals();
  } catch (error) { disconnected('Could not start the match', error.message); }
}
async function signal(message) { return api('/api/signal', { method: 'POST', body: JSON.stringify({ ticket: session.ticket, message }) }); }
function openChannel(dc) { channel = dc; channel.onopen = () => { document.querySelector('#link').textContent = '● DIRECT LINK'; document.querySelector('#link').className = 'online'; document.querySelector('#sim').textContent = session.role === 'host' ? 'HOST' : 'CONNECTED'; document.querySelector('#cover').style.display = 'none'; if (session.role === 'host') { match = createMatch(); broadcast({ type: 'state', state: match }); } }; channel.onmessage = ({ data }) => receive(JSON.parse(data)); channel.onclose = () => disconnected('Connection closed', 'The other pilot left the duel.'); }
async function pollSignals() {
  while (session && !channel?.readyState?.includes('closed')) {
    try { const { messages = [] } = await api(`/api/signal?ticket=${encodeURIComponent(session.ticket)}`); for (const message of messages) await receiveSignal(message); }
    catch { /* polling retries */ }
    await new Promise(resolve => setTimeout(resolve, 600));
  }
}
async function receiveSignal(message) {
  if (message.type === 'offer' && session.role === 'guest') { await peer.setRemoteDescription(message.sdp); const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); await signal({ type: 'answer', sdp: answer }); }
  if (message.type === 'answer' && session.role === 'host') await peer.setRemoteDescription(message.sdp);
  if (message.type === 'candidate') await peer.addIceCandidate(message.candidate).catch(() => {});
  if (message.type === 'peer-left') disconnected('Pilot departed', 'The match has ended.');
}
function broadcast(message) { if (channel?.readyState === 'open') channel.send(JSON.stringify(message)); }
function receive(message) { if (message.type === 'state') { match = message.state; render(); } if (message.type === 'fire' && session.role === 'host') resolveFire(message.expression, 'guest', message.shipIndex); }

// The host resolves every shot. This keeps the MVP casual but coherent: only one state wins.
function createMatch() { return { turn: 'host', round: 1, ships: { host: [{ x: 120, y: 150, hp: 1 }, { x: 135, y: 300, hp: 1 }, { x: 120, y: 450, hp: 1 }], guest: [{ x: 880, y: 150, hp: 1 }, { x: 865, y: 300, hp: 1 }, { x: 880, y: 450, hp: 1 }] }, planets: [{ x: 480, y: 185, r: 58 }, { x: 570, y: 405, r: 72 }], lastPath: [], outcome: null }; }
function alive(role) { return match.ships[role].filter(ship => ship.hp > 0); }
function resolveFire(expression, role, shipIndex) { if (!match || match.turn !== role || match.outcome || !match.ships[role][shipIndex]?.hp) return; const path = trace(expression, role, shipIndex); if (!path.length) { toast('Unstable function — turn lost'); match.turn = role === 'host' ? 'guest' : 'host'; match.round++; broadcast({ type: 'state', state: match }); render(); return; } let hit = null; for (const p of path) { if (match.planets.some(planet => Math.hypot(p.x - planet.x, p.y - planet.y) < planet.r)) break; hit = alive(role === 'host' ? 'guest' : 'host').find(ship => Math.hypot(p.x - ship.x, p.y - ship.y) < 16); if (hit) { hit.hp = 0; break; } } match.lastPath = path; if (hit) toast('Direct hit. One ship lost.'); else toast('Arc dissipated.'); const opponent = role === 'host' ? 'guest' : 'host'; if (!alive(opponent).length) match.outcome = role; else { match.turn = opponent; match.round++; } broadcast({ type: 'state', state: match }); render(); }
function fire() { const expression = document.querySelector('#formula').value; if (!match || match.turn !== session.role || match.outcome || !match.ships[session.role][selectedShip]?.hp) return; if (session.role === 'host') resolveFire(expression, 'host', selectedShip); else broadcast({ type: 'fire', expression, shipIndex: selectedShip }); document.querySelector('#fire').disabled = true; }
function trace(expression, role, shipIndex) { let evaluate; try { evaluate = compile(expression); } catch (error) { document.querySelector('#hint').textContent = error.message; return []; } const ship = match.ships[role][shipIndex]; if (!ship?.hp) return []; const direction = role === 'host' ? 1 : -1; const path = []; for (let i = 0; i < 520; i++) { const localX = direction * (i / 519) * 12; const y = evaluate(localX); const x = ship.x + localX * 72; const py = ship.y - y * 42; if (!Number.isFinite(y) || Math.abs(y) > 30 || py < 0 || py > 600 || x < 0 || x > 1000) break; path.push({ x, y: py }); } return path; }
function render() { if (!match) return; const mine = session.role, theirs = mine === 'host' ? 'guest' : 'host'; if (!match.ships[mine][selectedShip]?.hp) selectedShip = match.ships[mine].findIndex(ship => ship.hp); document.querySelector('#turn').textContent = match.outcome ? (match.outcome === mine ? 'You won the sector' : 'Sector lost') : (match.turn === mine ? 'Your turn — plot a line' : 'Rival is plotting'); document.querySelector('#round').textContent = `ROUND ${String(match.round).padStart(2, '0')}`; document.querySelector('#ship-select').innerHTML = match.ships[mine].map((ship, index) => `<button class="ship-choice ${index === selectedShip ? 'selected' : ''}" data-ship="${index}" ${ship.hp ? '' : 'disabled'}>SHIP ${index + 1}<i>${ship.hp ? 'READY' : 'LOST'}</i></button>`).join(''); document.querySelectorAll('[data-ship]').forEach(button => button.onclick = () => { selectedShip = Number(button.dataset.ship); render(); }); document.querySelector('#their-ships').textContent = '● '.repeat(alive(theirs).length) || '—'; document.querySelector('#mine').classList.toggle('active', match.turn === mine); document.querySelector('#theirs').classList.toggle('active', match.turn === theirs); document.querySelector('#fire').disabled = match.turn !== mine || !!match.outcome; draw(); }
function draw() { const ctx = arena.getContext('2d'), { width: w, height: h } = arena; ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#07131f'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#183246'; ctx.lineWidth = 1; for(let x=0;x<w;x+=50){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()} for(let y=0;y<h;y+=50){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()} const origin = match.ships[session.role][selectedShip]; if(origin?.hp){ctx.save();ctx.setLineDash([5,6]);ctx.strokeStyle='#5fe2d455';ctx.beginPath();ctx.moveTo(0,origin.y);ctx.lineTo(w,origin.y);ctx.moveTo(origin.x,0);ctx.lineTo(origin.x,h);ctx.stroke();ctx.setLineDash([]);ctx.strokeStyle='#5fe2d4';ctx.beginPath();ctx.arc(origin.x,origin.y,20,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#a7dcd8';ctx.font='10px DM Mono';ctx.fillText('(0, 0)', origin.x + 26, origin.y - 24);ctx.restore();} for(const planet of match.planets){const g=ctx.createRadialGradient(planet.x-15,planet.y-16,4,planet.x,planet.y,planet.r);g.addColorStop(0,'#7694a0');g.addColorStop(1,'#152f42');ctx.fillStyle=g;ctx.beginPath();ctx.arc(planet.x,planet.y,planet.r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#6193a1';ctx.stroke()} if(match.lastPath.length){ctx.strokeStyle='#f0c96a';ctx.lineWidth=3;ctx.shadowBlur=13;ctx.shadowColor='#f0c96a';ctx.beginPath();match.lastPath.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();ctx.shadowBlur=0;} for(const [role, ships] of Object.entries(match.ships)) for(const s of ships){if(!s.hp)continue;ctx.save();ctx.translate(s.x,s.y);ctx.fillStyle=role==='host'?'#5fe2d4':'#f27b82';ctx.beginPath();ctx.moveTo(role==='host'?14:-14,0);ctx.lineTo(role==='host'?-10:10,-8);ctx.lineTo(role==='host'?-5:5,0);ctx.lineTo(role==='host'?-10:10,8);ctx.closePath();ctx.fill();ctx.restore();} }
function toast(text) { const e = document.querySelector('#event'); e.textContent = text; e.classList.add('show'); setTimeout(() => e.classList.remove('show'), 2500); }
function disconnected(title, copy) { clearInterval(poller); const cover = document.querySelector('#cover'); if (!cover) return; document.querySelector('#cover-title').textContent = title; document.querySelector('#cover-copy').textContent = copy; cover.querySelector('.spinner').style.display = 'none'; document.querySelector('#back').hidden = false; }
async function leave() { if (session) await signal({ type: 'peer-left' }).catch(() => {}); await api('/api/join', { method: 'DELETE', body: JSON.stringify({ ticket: session?.ticket }) }).catch(() => {}); clearSession(); location.hash = ''; }

// Strict, tiny expression language: numbers, x, pi, + - * / ^, and selected functions. No eval.
function compile(source) { const tokens = source.toLowerCase().match(/\s*(\d*\.?\d+|pi|x|sin|cos|tan|abs|sqrt|log|exp|[()+\-*/^])/g)?.map(x => x.trim()); if (!tokens?.length || tokens.join('') !== source.toLowerCase().replace(/\s/g,'')) throw Error('Use numbers, x, operators, and approved functions only.'); const out=[], ops=[], precedence={'+':1,'-':1,'*':2,'/':2,'^':3}; let expectValue=true; for(const token of tokens){if(/^\d|^(x|pi)$/.test(token)){out.push(token);expectValue=false;continue} if(['sin','cos','tan','abs','sqrt','log','exp'].includes(token)){ops.push(token);continue} if(token==='('){ops.push(token);expectValue=true;continue} if(token===')'){while(ops.length&&ops.at(-1)!=='(')out.push(ops.pop());if(ops.pop()!=='(')throw Error('Parentheses do not match.');if(['sin','cos','tan','abs','sqrt','log','exp'].includes(ops.at(-1)))out.push(ops.pop());expectValue=false;continue} if(token==='-'&&expectValue)out.push('0'); if(!precedence[token])throw Error('Invalid expression.'); while(ops.length&&precedence[ops.at(-1)]&&((token==='^'?precedence[token]<precedence[ops.at(-1)]:precedence[token]<=precedence[ops.at(-1)])))out.push(ops.pop());ops.push(token);expectValue=true;} while(ops.length){const op=ops.pop();if(op==='(')throw Error('Parentheses do not match.');out.push(op)} return x=>{const stack=[];for(const token of out){if(/^\d/.test(token))stack.push(Number(token));else if(token==='x')stack.push(x);else if(token==='pi')stack.push(Math.PI);else if(['sin','cos','tan','abs','sqrt','log','exp'].includes(token)){const a=stack.pop();stack.push(Math[token==='log'?'log':token](a));}else{const b=stack.pop(),a=stack.pop();stack.push(token==='+'?a+b:token==='-'?a-b:token==='*'?a*b:token==='/'?a/b:Math.pow(a,b));}}return stack.length===1?stack[0]:NaN}; }

function route() { const wanted = location.hash.startsWith('#match/') && session?.matchId; if (wanted) startGame(); else lobby(); }
window.addEventListener('hashchange', route); route();
