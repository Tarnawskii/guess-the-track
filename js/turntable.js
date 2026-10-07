// ---------- the turntable: inertia on the platter, a tonearm that tracks the song, tap to pause/play
const vinyl = { anim: null, rate: 0, target: 0, raf: 0, boostUntil: 0 };

function vinylAnim() {
  if (!vinyl.anim && !reduceMotion.matches) {
    const disc = $("disc");
    if (disc && disc.animate) {
      vinyl.anim = disc.animate([{ rotate: "0deg" }, { rotate: "360deg" }], { duration: 1800, iterations: Infinity }); // ~33⅓ rpm
      vinyl.anim.playbackRate = 0;
    }
  }
  return vinyl.anim;
}

// spin up quick, coast down slow, like a real platter
function vinylStep() {
  const a = vinylAnim();
  if (!a) { vinyl.raf = 0; return; }
  const boosting = Date.now() < vinyl.boostUntil;
  const goal = boosting ? 3.2 : vinyl.target;
  vinyl.rate += (goal - vinyl.rate) * (goal > vinyl.rate ? 0.07 : 0.03);
  if (Math.abs(goal - vinyl.rate) < 0.004) vinyl.rate = goal;
  a.playbackRate = vinyl.rate;
  const settled = vinyl.rate === goal && !boosting;
  vinyl.raf = settled ? 0 : els.app.ownerDocument.defaultView.requestAnimationFrame(vinylStep);
}

function vinylGo() {
  if (!vinyl.raf) vinyl.raf = els.app.ownerDocument.defaultView.requestAnimationFrame(vinylStep);
}

function vinylBoost() {
  vinyl.boostUntil = Date.now() + 700;
  vinylGo();
}

// the arm rests off the record when nothing plays; playing, it sits in the groove and creeps inward with the song
function updateArm(progress) {
  const playing = els.stage.classList.contains("playing") && !!state.track;
  const p = Math.min(1, Math.max(0, progress == null ? (state.trackDuration ? currentElapsed() / state.trackDuration : 0) : progress));
  els.stage.style.setProperty("--arm", (playing ? 10 + 24 * p : -9).toFixed(2) + "deg");
}

function currentElapsed() {
  return state.pos ? state.pos.position_ms + (Date.now() - state.pos.timestamp_ms) * (state.pos.speed || 0) : 0;
}

function setPlaying(on) {
  els.stage.classList.toggle("playing", on);
  vinyl.target = on ? 1 : 0;
  vinylGo();
  updateArm();
}

async function toggleVinyl() {
  if (net.role === "guest" || state.mode !== "spotify" || !state.track) return;
  if (activeGame() === "heardle") { setStatus("in Heardle the snippets decide when it plays"); return; }
  const playing = els.stage.classList.contains("playing");
  const at = currentElapsed();
  setPlaying(!playing); // the platter and the arm react right away
  let res = null;
  try { res = await playerCall(playing ? "pause" : "play"); } catch {}
  if (!res || !res.ok) {
    setPlaying(playing);
    setStatus(!res ? "couldn't reach Spotify" : res.status === 403 ? "pausing from here needs Spotify Premium"
      : res.status === 404 ? "no active Spotify player — press play in Spotify first" : "couldn't " + (playing ? "pause" : "play") + " (" + res.status + ")");
    return;
  }
  state.pos = { position_ms: at, timestamp_ms: Date.now(), speed: playing ? 0 : 1 };
  state.tapHold = Date.now() + 1500;
  setTimeout(pollSpotify, 1600);
}
