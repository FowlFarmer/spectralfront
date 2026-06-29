'use client';

import { useEffect, useReducer } from 'react';

const fireArcDemos = [
  { formula: 'x(190-x)/250', path: 'M34 42 Q129 0 224 42', tone: 'high' },
  { formula: '18sin(x/30)', path: 'M34 42 C66 12 97 12 129 42 C161 72 192 72 224 42', tone: 'wave' },
  { formula: '(x-95)^3/9000', path: 'M34 42 C72 2 99 74 129 42 C159 10 186 74 224 42', tone: 'fold' },
];

const TYPE_MS = 75;
const PREVIEW_ENTER_MS = 140;
const ARMED_MS = 620;
const FIRE_MS = 980;
const IMPACT_MS = 520;
const PAUSE_MS = 420;

const initialFireArcState = {
  demoIndex: 0,
  phase: 'typing',
  typedCount: 0,
};

function getFireArcDelay({ demoIndex, phase, typedCount }) {
  const formulaLength = fireArcDemos[demoIndex].formula.length;

  if (phase === 'typing') {
    return typedCount < formulaLength ? TYPE_MS : PREVIEW_ENTER_MS;
  }

  if (phase === 'armed') return ARMED_MS;
  if (phase === 'firing') return FIRE_MS;
  if (phase === 'impact') return IMPACT_MS;
  return PAUSE_MS;
}

function advanceFireArcState(state) {
  const formulaLength = fireArcDemos[state.demoIndex].formula.length;

  if (state.phase === 'typing') {
    if (state.typedCount < formulaLength) {
      return { ...state, typedCount: state.typedCount + 1 };
    }

    return { ...state, phase: 'armed' };
  }

  if (state.phase === 'armed') return { ...state, phase: 'firing' };
  if (state.phase === 'firing') return { ...state, phase: 'impact' };
  if (state.phase === 'impact') return { ...state, phase: 'pause' };

  return {
    demoIndex: (state.demoIndex + 1) % fireArcDemos.length,
    phase: 'typing',
    typedCount: 0,
  };
}

function fireArcReducer(state, action) {
  if (action.type === 'advance') return advanceFireArcState(state);
  return state;
}

function FireArcDemo() {
  const [state, dispatch] = useReducer(fireArcReducer, initialFireArcState);
  const demo = fireArcDemos[state.demoIndex];
  const formulaText = demo.formula.slice(0, state.typedCount);
  const previewReady = state.phase !== 'typing' && state.phase !== 'pause' && state.typedCount === demo.formula.length;

  useEffect(() => {
    const timer = window.setTimeout(() => dispatch({ type: 'advance' }), getFireArcDelay(state));
    return () => window.clearTimeout(timer);
  }, [state]);

  return <div className="lesson-stage fire-arc-stage">
    <svg className="fire-arc-svg" viewBox="0 0 260 110" aria-hidden="true">
      <defs>
        <filter id="tutorialLaserGlow" x="-20%" y="-80%" width="140%" height="260%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g className="fire-grid">
        {[34, 82, 130, 178, 226].map(x => <path key={`x-${x}`} d={`M${x} 15V96`} />)}
        {[24, 48, 72, 96].map(y => <path key={`y-${y}`} d={`M18 ${y}H242`} />)}
      </g>
      <g className={`fire-shot-state ${demo.tone} is-${state.phase} ${previewReady ? 'has-preview' : ''}`} key={`${demo.formula}-${state.phase}`}>
        <path className="fire-ghost-path" d={demo.path} />
        <path className="fire-laser-path fire-laser-glow" d={demo.path} pathLength="1" />
        <path className="fire-laser-path fire-laser-core" d={demo.path} pathLength="1" />
        <circle className="fire-impact" cx="224" cy="42" r="5" />
      </g>
      <g className="fire-demo-ship player-ship" transform="translate(34 42)">
        <path d="M10 0 L-8 -6 L-4 0 L-8 6 Z" />
      </g>
      <g className="fire-demo-ship enemy-ship-demo" transform="translate(224 42) rotate(180)">
        <path d="M10 0 L-8 -6 L-4 0 L-8 6 Z" />
      </g>
    </svg>
    <div className="function-terminal" aria-hidden="true">
      <b>y =</b>
      <span className="typed-functions">
        <i>{formulaText}</i>
      </span>
      <em />
    </div>
  </div>;
}

export default function Tutorial() {
  return <section className="tutorial" aria-labelledby="tutorial-title">
    <div className="tutorial-intro"><div className="eyebrow">FIELD MANUAL / 01</div><h2 id="tutorial-title">How to play</h2><p>Spectral Front is a live artillery duel. Both commanders regenerate energy, move, and fire at the same time. Destroy the opposing ships before your own fleet is eliminated.</p></div>
    <div className="tutorial-grid">
      <article className="tutorial-card fire-lesson"><div className="lesson-visual"><FireArcDemo /></div><div><span>01 / FIRE</span><h3>Shape an arc. Set its range.</h3><p>Select a ship, define <code>y = f(x)</code>, then set beam power. Energy regenerates slowly, so every shot is a trade-off: Sweeping sine arcs cover more area but use more energy for the same distance.</p></div></article>
      <article className="tutorial-card hitbox-lesson"><div className="lesson-visual"><div className="lesson-stage hitbox-stage"><i className="hit-ring" /><i className="demo-ship" /><i className="hit-probe" /></div></div><div><span>02 / HITBOX</span><h3>Ships use circular hitboxes.</h3><p>A beam destroys a ship when it enters its circular collision radius.</p></div></article>
      <article className="tutorial-card move-lesson"><div className="lesson-visual"><div className="lesson-stage move-stage"><i className="demo-ship" /><i className="move-route" /><i className="move-waypoint">×</i></div></div><div><span>03 / MOVE</span><h3>Left click to move a ship to a waypoint.</h3><p>Routes cannot cross planets, moons, or asteroids. Clicking an existing waypoint stops the ship. Each ship pays 25 energy to start, then 3 energy per second while moving.</p></div></article>
    </div>
    <div className="tutorial-notes">
      <article><span>STAGING WINDOW</span><ol><li>Every duel opens with a five-second synchronized countdown.</li><li>Ships begin at zero energy; weapons and movement unlock on the launch signal.</li><li>Use this window to choose a ship, write an arc, and set its power.</li></ol></article>
      <article><span>GRAPH REFERENCE</span><p>The selected ship becomes the function origin <code>(0, 0)</code>. Each grid square is one graph unit: right is positive <code>x</code>, up is positive <code>y</code>. Hovering the arena displays the local coordinates relative to the selected ship.</p></article>
      <article><span>EXPRESSION RULES</span><p>Use numbers, <code>x</code>, parentheses, and <code>+ − * / ^</code>, plus <code>sin</code>, <code>cos</code>, <code>tan</code>, <code>abs</code>, <code>sqrt</code>, <code>log</code>/<code>ln</code>, and <code>exp</code>. Constant vertical offsets are removed, so every valid arc begins at its ship.</p></article>
      <article><span>FIELD INTELLIGENCE</span><p>Planets and moons absorb beams; asteroids are destroyed on contact. You can see an enemy ship’s live position and heading, but never its waypoint or planned route. Leverage terrain to make your trajectories more easily defined than the enemy's.</p></article>
    </div>
  </section>;
}
