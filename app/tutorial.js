export default function Tutorial() {
  return <section className="tutorial" aria-labelledby="tutorial-title">
    <div className="tutorial-intro"><div className="eyebrow">FIELD MANUAL / 01</div><h2 id="tutorial-title">How to play</h2><p>Spectral Front is a live artillery duel. Both commanders regenerate energy, move, and fire at the same time. Destroy the opposing ships before your own fleet is eliminated.</p></div>
    <div className="tutorial-grid">
      <article className="tutorial-card fire-lesson"><div className="lesson-visual"><div className="lesson-stage"><i className="demo-ship" /><i className="demo-beam" /><i className="demo-head" /><i className="demo-range" /></div></div><div><span>01 / FIRE</span><h3>Shape an arc. Set its range.</h3><p>Select a ship, define <code>y = f(x)</code>, then set beam power. Energy regenerates slowly, so every shot is a trade-off: Sweeping sine arcs cover more area but use more energy for the same distance.</p></div></article>
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
