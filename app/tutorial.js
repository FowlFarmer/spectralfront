export default function Tutorial() {
  return <section className="tutorial" aria-labelledby="tutorial-title">
    <div className="tutorial-intro"><div className="eyebrow">FIELD MANUAL / 01</div><h2 id="tutorial-title">How to play</h2><p>This is a live artillery duel, not a turn-based puzzle. Both pilots regenerate energy, move, and fire at the same time. Destroy every opposing ship before your own fleet is eliminated.</p></div>
    <div className="tutorial-grid">
      <article className="tutorial-card fire-lesson"><div className="lesson-visual"><div className="lesson-stage"><i className="demo-ship" /><i className="demo-beam" /><i className="demo-head" /><i className="demo-range" /></div></div><div><span>01 / FIRE</span><h3>Shape an arc. Set its range.</h3><p>Select a ship, enter <code>y = f(x)</code>, then set beam power. Energy regenerates slowly, so every shot is a trade-off.</p></div></article>
      <article className="tutorial-card hitbox-lesson"><div className="lesson-visual"><div className="lesson-stage hitbox-stage"><i className="hit-ring" /><i className="demo-ship" /><i className="hit-probe" /></div></div><div><span>02 / HITBOX</span><h3>Ships use circular hitboxes.</h3><p>A beam destroys a ship when it enters its circular collision radius—not only when it touches a painted pixel.</p></div></article>
      <article className="tutorial-card move-lesson"><div className="lesson-visual"><div className="lesson-stage move-stage"><i className="demo-ship" /><i className="move-route" /><i className="move-waypoint">×</i></div></div><div><span>03 / MOVE</span><h3>Click space to set a waypoint.</h3><p>Routes cannot cross planets, moons, or asteroids. Hover the waypoint to reveal the <b>×</b> stop control; clicking it brakes the ship.</p></div></article>
    </div>
    <div className="tutorial-notes">
      <article><span>LAUNCH SEQUENCE</span><ol><li>Select a surviving ship from the fleet panel or click it in the arena.</li><li>Type an equation, inspect the dotted preview, then set beam power.</li><li>Fire when the energy meter covers the listed cost. There are no turns.</li></ol></article>
      <article><span>AIMING LANGUAGE</span><p>The selected ship is always <code>(0, 0)</code>. In the function field, right is positive <code>x</code> and up is positive <code>y</code>. Enter <code>sin</code>, <code>cos</code>, <code>abs</code>, <code>sqrt</code>, and the other listed functions normally. Constant vertical offsets are ignored so every beam begins at its ship.</p></article>
      <article><span>ENERGY &amp; RANGE</span><p>Energy reaches 100 and regenerates slowly. Beam power controls both range and cost: lower power is cheaper but ends sooner; higher power reaches farther. Moving also consumes energy—there is a start cost and a small drain while the ship travels.</p></article>
      <article><span>FIELD INTELLIGENCE</span><p>Planets and moons stop beams. Asteroids are destroyed by a hit. Ship hitboxes are circles, so aim for the collision ring rather than the triangle artwork. You can see an enemy ship’s live position and heading, but not its waypoint or planned route.</p></article>
    </div>
  </section>;
}
