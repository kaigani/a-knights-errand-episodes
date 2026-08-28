/* A Knight's Errand — double-buffered branching video player.
 *
 * Gapless strategy: clips are latent-chained at generation time, so the
 * child's opening frames are pixel-identical to the parent's tail. We start
 * the (primed) incoming <video> when SWAP_LEAD seconds remain and reveal it
 * on its first actually-rendered frame (requestVideoFrameCallback) — the
 * few dropped tail frames of the parent are invisible by construction.
 * MSE/SourceBuffer in sequence mode would be the true-gapless upgrade;
 * unnecessary while the content itself hides the seam.
 */

"use strict";

const qs = new URLSearchParams(location.search);
const DEBUG = qs.get("debug") === "1";
const MANIFEST_URL = qs.get("manifest") || "manifest.json";
const SWAP_LEAD = 0.12; // seconds before end to start the incoming video

const GLYPHS = {
  ArrowUp: "▲", ArrowDown: "▼",
  ArrowLeft: "◀", ArrowRight: "▶",
};
const RING_C = 125.66; // 2πr for r=20

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const titlePanel = $("title"), endPanel = $("end");
const beginBtn = $("begin"), restartBtn = $("restart");
const loadFill = $("loadfill");
const choiceBar = $("choicebar"), ring = $("ring");
const ringFg = ring.querySelector(".ring-fg");
const choiceBtns = [$("c0"), $("c1")];
const hud = $("hud");

let manifest = null;
const blobs = {}; // id -> objectURL
let active = $("vidA"), hidden = $("vidB");

// global sound state — starts muted (autoplay-honest); the speaker toggle
// overlay controls it everywhere: splash, gameplay, end screens. If the
// player never touches the toggle, Begin (a real gesture) turns sound on.
let soundOn = false;
let soundTouched = false;

function setSound(on) {
  soundOn = on;
  $("muteicon").src = on ? "assets/icon-unmuted.webp" : "assets/icon-muted.webp";
  $("muteicon").alt = on ? "sound is on" : "sound is off";
}

let mode = "title"; // title | playing | ended
let currentId = null;
let path = [];
let armed = null;      // clip id loaded into `hidden`
let swapping = false;
let choice = null;     // {info, at, phase: pending|open|locked, picked}
let swapT0 = 0;

if (DEBUG) hud.classList.add("visible");

// ------------------------------------------------------------- preload

async function preloadAll(onProgress) {
  const ids = Object.keys(manifest.clips);
  let done = 0;
  await Promise.all(ids.map(async (id) => {
    const r = await fetch(manifest.clips[id].src);
    if (!r.ok) throw new Error(`fetch ${manifest.clips[id].src}: ${r.status}`);
    blobs[id] = URL.createObjectURL(await r.blob());
    onProgress(++done / ids.length);
  }));
}

async function boot() {
  try {
    const r = await fetch(MANIFEST_URL);
    if (!r.ok) throw new Error(`manifest: ${r.status}`);
    manifest = await r.json();
    await preloadAll((f) => { loadFill.style.width = `${f * 100}%`; });
    beginBtn.textContent = "Begin the Errand";
    beginBtn.disabled = false;
  } catch (e) {
    beginBtn.textContent = "Clips not ready";
    $("loadbar").style.display = "none";
    console.error(e);
  }
}

// ------------------------------------------------------------- playback

function begin() {
  const splash = $("splashvid");
  if (splash) splash.pause();
  // sound on by default when starting the game, unless the player has
  // explicitly used the mute toggle — then their choice stands
  if (!soundTouched) setSound(true);
  // autoplay bless inside the gesture: `active` is blessed by its own real
  // unmuted play() below; `hidden` gets a play->pause bless of its own.
  // (Never bless `active` with a deferred pause() — it races startClip's
  // play() and freezes the first clip.)
  hidden.src = blobs[manifest.start];
  hidden.muted = !soundOn;
  hidden.play().then(() => hidden.pause()).catch(() => {});

  titlePanel.classList.remove("visible");
  endPanel.classList.remove("visible");
  mode = "playing";
  path = [];
  startClip(manifest.start, active);
}

function beginClipState(id) {
  currentId = id;
  path.push(id);
  armed = null;
  swapping = false;
  const info = manifest.clips[id];
  choice = info.choice
    ? { info: info.choice, phase: "pending", picked: null }
    : null;
  hideChoiceUI();
  if (DEBUG) window.__state = { currentId, path: path.slice(), mode };
}

// fresh start (title / restart) — for swaps the incoming video is already
// playing and must NOT be rewound (its skipped opening frames are pixel-
// identical to the outgoing clip's dropped tail by latent-chain design)
function startClip(id, el) {
  beginClipState(id);
  if (el.src !== blobs[id]) el.src = blobs[id];
  el.muted = !soundOn;
  el.currentTime = 0;
  el.play().catch((e) => console.error("play failed", e));
}

function armNext(nextId) {
  armed = nextId;
  const el = hidden;
  el.src = blobs[nextId];
  el.load();
  el.muted = true; // prime the decode pipeline silently
  el.play().then(() => {
    // if the swap already started (late choice / auto-default), this stale
    // prime callback must NOT pause the now-revealing video — that race
    // froze the incoming clip at t=0
    if (swapping || el === active) return;
    el.pause();
    el.currentTime = 0;
  }).catch(() => {});
}

function doSwap() {
  swapping = true;
  swapT0 = performance.now();
  hidden.muted = !soundOn;
  hidden.play().catch(() => {});
  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    const dt = performance.now() - swapT0;
    hidden.style.zIndex = 2;
    active.style.zIndex = 1;
    active.muted = true;
    active.pause();
    [active, hidden] = [hidden, active];
    const next = armed;
    if (DEBUG) console.log(`[swap] ${currentId} -> ${next} reveal ${dt.toFixed(0)}ms`);
    beginClipState(next);
  };
  if (hidden.requestVideoFrameCallback) {
    hidden.requestVideoFrameCallback(() => reveal());
  } else if (!hidden.paused && hidden.currentTime > 0) {
    // the prime play() was never paused (its promise lost the race with this
    // swap) — "playing" won't re-fire on an already-playing video, so the
    // once-listener below would never call reveal
    requestAnimationFrame(() => reveal());
  } else {
    hidden.addEventListener("playing", () => reveal(), { once: true });
  }
  // once swapping is set every watchdog is fenced off — if the incoming
  // video never presents a frame (decode stall, wedged media pipeline),
  // force the swap rather than freezing on the parent's last frame
  setTimeout(() => {
    if (revealed) return;
    if (DEBUG) console.log(`[swap] ${currentId} -> ${armed} forced (no frame in 1s)`);
    hidden.play().catch(() => {});
    reveal();
  }, 1000);
}

function clipEnded(el) {
  if (mode !== "playing" || el !== active) return;
  if (swapping) return;
  // occluded/throttled windows starve rAF: if the choice never resolved,
  // take the default now so the game always makes progress
  if (choice && choice.phase === "open") pick(choice.info.default, true);
  if (choice && choice.phase === "pending") {
    choice.phase = "open";
    pick(choice.info.default, true);
  }
  if (armed) { doSwap(); return; } // safety net: rAF swap path misfired
  const info = manifest.clips[currentId];
  if (info.outcome) showEnd(info.outcome);
}

// --------------------------------------------------------------- choices

function showChoiceUI() {
  const opts = choice.info.options;
  choiceBtns.forEach((btn, i) => {
    btn.querySelector(".glyph").textContent = GLYPHS[opts[i].key] || "?";
    btn.querySelector(".label").textContent = opts[i].label;
    btn.classList.remove("selected", "dimmed");
  });
  ring.classList.remove("frozen");
  ringFg.style.strokeDashoffset = 0;
  choiceBar.classList.add("visible");
  choice.phase = "open";
}

function hideChoiceUI() {
  choiceBar.classList.remove("visible");
  choiceBtns.forEach((b) => b.classList.remove("selected", "dimmed"));
}

function pick(i, auto = false) {
  if (!choice || choice.phase !== "open") return;
  // key/click callers always pass 0/1; this catches a malformed manifest
  // `default` on the timeout path, where bailing out would freeze the game
  if (!Number.isInteger(i) || i < 0 || i >= choice.info.options.length) {
    console.error(`[choice] bad option index ${i} on ${currentId}, using 0`);
    i = 0;
  }
  choice.phase = "locked";
  choice.picked = i;
  choiceBtns[i].classList.add("selected");
  choiceBtns[1 - i].classList.add("dimmed");
  ring.classList.add("frozen");
  const next = choice.info.options[i].next;
  if (DEBUG) console.log(`[choice] ${currentId}: ${auto ? "auto" : "input"} -> ${next}`);
  armNext(next);
}

// ------------------------------------------------------------- main loop

// core per-frame logic — called from the rAF loop AND from the videos'
// timeupdate events, so an occluded window (rAF starved) still progresses
function logicStep() {
  if (mode !== "playing" || !active.duration) return;
  const v = active;
  // watchdog: nothing should ever leave the active video paused mid-clip
  if (v.paused && !swapping && v.currentTime < v.duration - 0.05) {
    v.play().catch(() => {});
  }
  if (choice) {
    // real element duration wins over manifest (may differ by a frame)
    const at = v.duration - choice.info.window;
    if (choice.phase === "pending" && v.currentTime >= at) showChoiceUI();
    if (choice.phase === "open") {
      const f = Math.min(1, (v.currentTime - at) / choice.info.window);
      ringFg.style.strokeDashoffset = RING_C * f;
      // default must fire early enough to arm + prime the swap —
      // 0.35s before end, not at the final frame
      if (v.duration - v.currentTime <= 0.35) pick(choice.info.default, true);
    }
  }
  if (armed && !swapping && v.duration - v.currentTime <= SWAP_LEAD) doSwap();
}

function tick() {
  logicStep();
  if (DEBUG && mode === "playing" && active.duration) {
    hud.textContent =
      `node   ${currentId}\n` +
      `t      ${active.currentTime.toFixed(2)} / ${active.duration.toFixed(2)}\n` +
      `armed  ${armed || "-"}\n` +
      `path   ${path.join(" > ")}`;
  }
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------ end screens

function showEnd(outcome) {
  mode = "ended";
  hideChoiceUI();
  if (DEBUG) window.__state = { currentId, path: path.slice(), mode, outcome };
  endPanel.className = `panel visible ${outcome}`;
  const logo = $("endlogo");
  logo.src = outcome === "win" ? "assets/title-win.webp" : "assets/title-end.webp";
  logo.alt = outcome === "win" ? "The Enchantment is Broken!" : "The Quest Ends Here…";
  const names = path.map((id) => manifest.clips[id].title || id);
  $("endPath").innerHTML =
    `Your path: ${names.join(" → ")}` +
    (outcome === "win" ? "<br>The Ship Sails Free!" : "<br>The grotto keeps its treasure. Try once more.");
  restartBtn.focus();
}

// ---------------------------------------------------------------- input

document.addEventListener("keydown", (e) => {
  if (mode === "title" && !beginBtn.disabled && (e.key === "Enter" || e.key === " ")) {
    begin();
    return;
  }
  if (mode === "ended" && e.key === "Enter") { begin(); return; }
  if (mode === "playing" && choice && choice.phase === "open") {
    const opts = choice.info.options;
    const i = opts.findIndex((o) => o.key === e.key);
    if (i >= 0) {
      e.preventDefault();
      pick(i);
      return;
    }
  }
  if (e.key.startsWith("Arrow")) e.preventDefault();
});

choiceBtns.forEach((btn, i) => btn.addEventListener("click", () => pick(i)));
beginBtn.addEventListener("click", begin);
restartBtn.addEventListener("click", begin);
[$("vidA"), $("vidB")].forEach((v) => {
  v.addEventListener("ended", () => clipEnded(v));
  v.addEventListener("timeupdate", () => { if (v === active) logicStep(); });
  // event-driven un-pause: in occluded windows rAF and timeupdate both
  // starve, so a stray pause (decoder handoff, policy, stale callback)
  // would otherwise deadlock the game on a frozen frame
  v.addEventListener("pause", () => {
    if (mode === "playing" && v === active && !swapping
        && v.duration && v.currentTime < v.duration - 0.05) {
      v.play().catch(() => {});
    }
  });
});

// ---------------------------------------------------------- sound toggle
// The 50%-transparent speaker overlay is the one sound control, live on the
// splash, during play, and on end screens. Starts muted (autoplay-honest);
// the toggle click is itself the user gesture that legitimizes audio.

function splashOver(s) {
  return s.duration && s.currentTime >= s.duration - 0.05; // frozen tableau
}

function startSplash() {
  const s = $("splashvid");
  if (!s || mode !== "title" || splashOver(s)) return;
  s.muted = !soundOn;
  s.play().catch(() => {});
}

$("mutebtn").addEventListener("click", (e) => {
  soundTouched = true;
  setSound(!soundOn);
  const s = $("splashvid");
  if (mode === "title" && s) {
    s.muted = !soundOn;
    if (s.paused && !splashOver(s)) s.play().catch(() => {});
  }
  if (mode === "playing") active.muted = !soundOn;
  e.currentTarget.blur(); // keep Enter/Space for the game, not the toggle
});

// hidden tabs defer autoplay: kick the splash when the page becomes visible
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && mode === "title") startSplash();
});

startSplash();
boot();
requestAnimationFrame(tick);
