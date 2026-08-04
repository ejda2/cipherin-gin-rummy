/* Gin Rummy — meld-aware hand display, manual drag sorting, meld-break
   confirmation, and saved AI opponent profiles (style + skill) with
   persistent stats. */

(function(){
"use strict";

const SUITS = ["S","H","D","C"];
const SUIT_SYMBOL = { S:"\u2660", H:"\u2665", D:"\u2666", C:"\u2663" };
const RANK_LABEL = ["", "A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const TARGET_SCORE = 100;
const GIN_BONUS = 25;
const UNDERCUT_BONUS = 25;

const STYLE_META = {
  aggressive: { label: "Aggressive Knocker", blurb: "Knocks the moment deadwood hits 10 or less, keeping low cards to get there fast." },
  patient:    { label: "Patient Gin Seeker", blurb: "Holds out for a full Gin whenever it can, only knocking early if forced." },
  trapper:    { label: "Defensive Trapper",  blurb: "Tracks what you pick up and avoids discarding cards that could help you." }
};
const SKILL_META = {
  intermediate: { label: "Intermediate", blurb: "Manages its own deadwood but doesn't track your hand." },
  advanced:     { label: "Advanced",     blurb: "Remembers what you've picked up and plays around it." },
  expert:       { label: "Expert",       blurb: "Adapts its style to the score as the match develops." }
};

// ---------- basic card helpers ----------

function cardPoints(rank){ return rank >= 10 ? 10 : rank; }

function makeDeck(){
  const deck = [];
  let id = 0;
  for (const s of SUITS){
    for (let r = 1; r <= 13; r++){
      deck.push({ r, s, id: id++ });
    }
  }
  return deck;
}

function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardLabel(c){
  return RANK_LABEL[c.r] + SUIT_SYMBOL[c.s];
}

// Spades and clubs can look nearly identical at small sizes, especially on
// phones. Give clubs their own distinct color instead of lumping them in
// with spades as plain "black" so the two are never confused at a glance.
function suitClass(s){
  if (s === "H") return "hearts";
  if (s === "D") return "diamonds";
  if (s === "C") return "clubs";
  return "spades";
}

// Native "dblclick" is unreliable on iOS Safari, where a double-tap on an
// element without special handling triggers the browser's zoom gesture
// instead of two click events. This binds both a normal dblclick listener
// (desktop mouse) and a manual double-tap detector off touchend, so the
// same activation works consistently on phones and tablets.
// Tracks the most recent tap globally (not per-DOM-node), keyed by a
// stable id (a card's id, or "stock"/"discard"). This matters because a
// single tap on a hand card also fires a "click" that selects it and
// re-renders the whole hand into fresh DOM elements — if the tap timer
// lived on the element itself, the second tap of a double-tap would land
// on a brand-new element with no memory of the first tap.
let lastTap = { key: null, time: 0, x: 0, y: 0 };

function bindDoubleActivate(elem, key, handler){
  let cooldown = false;

  function fire(){
    if (cooldown) return;
    cooldown = true;
    handler();
    setTimeout(() => { cooldown = false; }, 400);
  }

  elem.addEventListener("dblclick", fire);

  elem.addEventListener("touchend", (e) => {
    const t = e.changedTouches && e.changedTouches[0];
    const now = Date.now();
    const x = t ? t.clientX : 0;
    const y = t ? t.clientY : 0;
    const dt = now - lastTap.time;
    const moved = Math.abs(x - lastTap.x) > 28 || Math.abs(y - lastTap.y) > 28;
    if (lastTap.key === key && dt > 0 && dt < 500 && !moved){
      lastTap = { key: null, time: 0, x: 0, y: 0 };
      e.preventDefault();
      fire();
    } else {
      lastTap = { key, time: now, x, y };
    }
  }, { passive: false });
}

// ---------- meld / deadwood engine (subset DP over <=11 cards) ----------

function combinations(arr, k){
  const results = [];
  const combo = [];
  function go(start){
    if (combo.length === k){ results.push(combo.slice()); return; }
    for (let i = start; i < arr.length; i++){
      combo.push(arr[i]);
      go(i + 1);
      combo.pop();
    }
  }
  go(0);
  return results;
}

function candidateMelds(hand){
  const melds = [];

  const byRank = new Map();
  hand.forEach((c, i) => {
    if (!byRank.has(c.r)) byRank.set(c.r, []);
    byRank.get(c.r).push(i);
  });
  for (const idxs of byRank.values()){
    if (idxs.length >= 3){
      for (let k = 3; k <= idxs.length; k++){
        for (const combo of combinations(idxs, k)){
          melds.push(combo.reduce((m, i) => m | (1 << i), 0));
        }
      }
    }
  }

  const bySuit = new Map();
  hand.forEach((c, i) => {
    if (!bySuit.has(c.s)) bySuit.set(c.s, []);
    bySuit.get(c.s).push(i);
  });
  for (const idxs of bySuit.values()){
    const sorted = idxs.slice().sort((a, b) => hand[a].r - hand[b].r);
    let runStart = 0;
    for (let i = 1; i <= sorted.length; i++){
      const brokeRun = i === sorted.length || hand[sorted[i]].r !== hand[sorted[i-1]].r + 1;
      if (brokeRun){
        const runLen = i - runStart;
        if (runLen >= 3){
          for (let len = 3; len <= runLen; len++){
            for (let start = runStart; start + len <= i; start++){
              let mask = 0;
              for (let k = start; k < start + len; k++) mask |= (1 << sorted[k]);
              melds.push(mask);
            }
          }
        }
        runStart = i;
      }
    }
  }

  return melds;
}

function analyzeHand(hand){
  const n = hand.length;
  const melds = candidateMelds(hand);
  const meldValue = new Map();
  for (const m of melds){
    let v = 0;
    for (let i = 0; i < n; i++) if (m & (1 << i)) v += cardPoints(hand[i].r);
    meldValue.set(m, v);
  }
  const fullMask = (1 << n) - 1;
  const memo = new Map();

  function dp(mask){
    if (mask === 0) return 0;
    if (memo.has(mask)) return memo.get(mask);
    const low = mask & (-mask);
    let best = dp(mask ^ low);
    for (const m of melds){
      if ((m & low) && (m & mask) === m){
        const cand = meldValue.get(m) + dp(mask ^ m);
        if (cand > best) best = cand;
      }
    }
    memo.set(mask, best);
    return best;
  }

  const bestMeldPoints = dp(fullMask);

  const deadwoodIdx = [];
  const meldMasks = [];
  let mask = fullMask;
  while (mask !== 0){
    const low = mask & (-mask);
    if (dp(mask) === dp(mask ^ low)){
      deadwoodIdx.push(Math.log2(low));
      mask ^= low;
      continue;
    }
    let picked = null;
    for (const m of melds){
      if ((m & low) && (m & mask) === m){
        if (meldValue.get(m) + dp(mask ^ m) === dp(mask)){ picked = m; break; }
      }
    }
    if (picked === null){
      deadwoodIdx.push(Math.log2(low));
      mask ^= low;
      continue;
    }
    meldMasks.push(picked);
    mask ^= picked;
  }

  let totalPoints = 0;
  hand.forEach(c => totalPoints += cardPoints(c.r));
  const deadwoodPoints = totalPoints - bestMeldPoints;

  return { deadwoodIdx, meldMasks, deadwoodPoints, totalPoints };
}

function bestDiscardOptions(hand11){
  const options = [];
  for (let i = 0; i < hand11.length; i++){
    const remaining = hand11.filter((_, idx) => idx !== i);
    const a = analyzeHand(remaining);
    options.push({ discardIndex: i, deadwood: a.deadwoodPoints, analysis: a, remaining });
  }
  options.sort((a, b) => a.deadwood - b.deadwood);
  return options;
}

// ---------- meld shape / layoff / ruin helpers ----------

function meldShape(hand, meldMask){
  const idxs = [];
  for (let i = 0; i < hand.length; i++) if (meldMask & (1 << i)) idxs.push(i);
  const cards = idxs.map(i => hand[i]);
  const isSet = cards.every(c => c.r === cards[0].r);
  if (isSet) return { type: "set", rank: cards[0].r, cards };
  const suit = cards[0].s;
  const ranks = cards.map(c => c.r).sort((a,b) => a-b);
  return { type: "run", suit, min: ranks[0], max: ranks[ranks.length-1], cards };
}

function computeLayoffs(knockerHand, knockerMeldMasks, defenderDeadwoodCards){
  const shapes = knockerMeldMasks.map(m => meldShape(knockerHand, m));
  const laidOff = [];
  const remaining = [];
  for (const card of defenderDeadwoodCards){
    let attached = false;
    for (const shape of shapes){
      if (shape.type === "set" && shape.cards.length < 4 && card.r === shape.rank){
        shape.cards.push(card);
        laidOff.push(card);
        attached = true;
        break;
      }
      if (shape.type === "run" && card.s === shape.suit && (card.r === shape.min - 1 || card.r === shape.max + 1)){
        if (card.r === shape.min - 1) shape.min = card.r; else shape.max = card.r;
        shape.cards.push(card);
        laidOff.push(card);
        attached = true;
        break;
      }
    }
    if (!attached) remaining.push(card);
  }
  return { laidOff, remainingDeadwood: remaining };
}

function meldRemainsValid(hand, meldMask, removeBitIdx){
  const remainingMask = meldMask & ~(1 << removeBitIdx);
  const idxs = [];
  for (let i = 0; i < hand.length; i++) if (remainingMask & (1 << i)) idxs.push(i);
  if (idxs.length < 3) return false;
  const cards = idxs.map(i => hand[i]);
  if (cards.every(c => c.r === cards[0].r)) return true;
  if (cards.every(c => c.s === cards[0].s)){
    const ranks = cards.map(c => c.r).sort((a,b) => a-b);
    const noDup = new Set(ranks).size === ranks.length;
    if (noDup && ranks[ranks.length-1] - ranks[0] + 1 === ranks.length) return true;
  }
  return false;
}

function findMeldContaining(meldMasks, bitIdx){
  for (const m of meldMasks) if (m & (1 << bitIdx)) return m;
  return null;
}

function meldDescription(hand, meldMask){
  const idxs = [];
  for (let i = 0; i < hand.length; i++) if (meldMask & (1 << i)) idxs.push(i);
  const cards = idxs.map(i => hand[i]);
  if (cards.every(c => c.r === cards[0].r)){
    return `${RANK_LABEL[cards[0].r]}s (${cards.map(cardLabel).join(" ")})`;
  }
  const sorted = cards.slice().sort((a,b) => a.r - b.r);
  return `${sorted.map(cardLabel).join("-")} run`;
}

function groupLabel(type, items){
  if (type === "deadwood") return "Unmelded";
  const cards = items.map(x => x.c);
  if (cards.every(c => c.r === cards[0].r)) return `${RANK_LABEL[cards[0].r]} Set`;
  return `${SUIT_SYMBOL[cards[0].s]} Run`;
}

// ---------- danger tracking for style/skill-aware AI ----------

function dangerScore(card, pickupLog){
  let score = 0;
  for (const p of pickupLog){
    if (card.r === p.r) score += 2;
    else if (card.s === p.s && Math.abs(card.r - p.r) <= 2) score += 1;
  }
  return score;
}

function usesDangerAwareness(persona){
  return persona.style === "trapper" || persona.skill === "advanced" || persona.skill === "expert";
}

// ---------- player profile storage (Firestore) ----------
//
// Saved players used to live in localStorage on a single device. They now
// live in Firestore under users/{uid}, one document per signed-in user
// holding a `profiles` array — same shape the app always used, just synced
// across devices instead of pinned to one browser. window.firebaseDB is
// set up by firebase-init.js before this ever runs (see the boot section
// at the bottom of this file).

function defaultSideStats(){
  return {
    handsWon: 0, handsLost: 0,
    scoreSum: 0, scoreCount: 0, lowestScore: null, highestScore: null,
    deadwoodSum: 0, deadwoodCount: 0,
    knockCount: 0, ginCount: 0, undercutCount: 0,
    curWinStreak: 0, longestWinStreak: 0, curLoseStreak: 0, longestLoseStreak: 0,
    gamesWon: 0, gamesLost: 0,
    gameScoreSum: 0, gameScoreCount: 0, highestGameScore: 0,
    curGameWinStreak: 0, longestGameWinStreak: 0, curGameLoseStreak: 0, longestGameLoseStreak: 0,
    handsPerGameSum: 0, handsPerGameCount: 0,
    shutoutCount: 0
  };
}

function defaultStats(){
  return {
    since: Date.now(),
    handsStarted: 0, handsFinished: 0,
    totalHandTimeMs: 0, shortestHandMs: null, longestHandMs: null,
    you: defaultSideStats(),
    opp: defaultSideStats()
  };
}

// Older saved profiles used a flatter stats shape. Give them a fresh
// detailed record rather than guessing at a lossy conversion.
function migrateStatsIfNeeded(profile){
  if (!profile.stats || !profile.stats.you || !profile.stats.opp){
    profile.stats = defaultStats();
  }
  return profile;
}

async function loadProfiles(uid){
  try{
    const { db, doc, getDoc } = window.firebaseDB;
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return [];
    const data = snap.data();
    const parsed = Array.isArray(data.profiles) ? data.profiles : [];
    return parsed.map(migrateStatsIfNeeded);
  } catch(e){
    console.error("Could not load saved players from Firestore:", e);
    return [];
  }
}

function saveProfiles(profiles){
  if (!state.currentUid) return;
  try{
    const { db, doc, setDoc } = window.firebaseDB;
    setDoc(doc(db, "users", state.currentUid), { profiles }, { merge: true })
      .catch(e => console.error("Could not save players to Firestore:", e));
  } catch(e){
    console.error("Could not save players to Firestore:", e);
  }
}

function escapeHtml(s){
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ---------- game state ----------

const DEFAULT_OPPONENT = { id: null, name: "Computer", gender: "", style: "aggressive", skill: "intermediate" };

const state = {
  deck: [],
  stock: [],
  discard: [],
  playerHand: [],
  computerHand: [],
  playerScore: 0,
  computerScore: 0,
  round: 1,
  dealerIsPlayer: true,
  turn: null,
  phase: null,
  selectedIndex: null,
  sortMode: "suit",
  manualOrder: [],
  locked: false,
  profiles: [],
  currentUid: null,
  opponent: DEFAULT_OPPONENT,
  humanPickupLog: [],
  handStartTime: null,
  roundHistory: [],
  playerJustDrawnFromDiscardId: null,
  computerJustDrawnFromDiscardId: null,
};

let editingProfileId = null;
let dragSourceId = null;
let cardDragCtx = null;

// ---------- DOM refs ----------

const el = {
  computerHand: document.getElementById("computer-hand"),
  playerHand: document.getElementById("player-hand"),
  computerCount: document.getElementById("computer-count"),
  playerCount: document.getElementById("player-count"),
  computerNameLabel: document.getElementById("computer-name-label"),
  computerScoreLabel: document.getElementById("computer-score-label"),
  opponentLine: document.getElementById("opponent-line"),
  stockPile: document.getElementById("stock-pile"),
  stockCount: document.getElementById("stock-count"),
  discardPile: document.getElementById("discard-pile"),
  playerScore: document.getElementById("player-score"),
  computerScore: document.getElementById("computer-score"),
  roundNum: document.getElementById("round-num"),
  statusLog: document.getElementById("status-log"),
  knockBtn: document.getElementById("knock-btn"),
  sortSuitBtn: document.getElementById("sort-suit-btn"),
  sortRankBtn: document.getElementById("sort-rank-btn"),
  sortManualBtn: document.getElementById("sort-manual-btn"),
  deadwoodReadout: document.getElementById("deadwood-readout"),
  newMatchBtn: document.getElementById("new-match-btn"),
  playersBtn: document.getElementById("players-btn"),
  howToPlayBtn: document.getElementById("how-to-play-btn"),
  rulesModal: document.getElementById("rules-modal"),
  rulesCloseBtn: document.getElementById("rules-close-btn"),
  roundModal: document.getElementById("round-modal"),
  roundTitle: document.getElementById("round-title"),
  roundBody: document.getElementById("round-body"),
  continueBtn: document.getElementById("continue-btn"),
  matchModal: document.getElementById("match-modal"),
  matchTitle: document.getElementById("match-title"),
  matchBody: document.getElementById("match-body"),
  restartBtn: document.getElementById("restart-btn"),
  confirmModal: document.getElementById("confirm-modal"),
  confirmBody: document.getElementById("confirm-body"),
  confirmYesBtn: document.getElementById("confirm-yes-btn"),
  confirmNoBtn: document.getElementById("confirm-no-btn"),
  playersModal: document.getElementById("players-modal"),
  playersRequiredNote: document.getElementById("players-required-note"),
  playersList: document.getElementById("players-list"),
  playerForm: document.getElementById("player-form"),
  playerFormTitle: document.getElementById("player-form-title"),
  pfName: document.getElementById("pf-name"),
  pfGender: document.getElementById("pf-gender"),
  pfStyle: document.getElementById("pf-style"),
  pfStyleBlurb: document.getElementById("pf-style-blurb"),
  pfSkill: document.getElementById("pf-skill"),
  pfSkillBlurb: document.getElementById("pf-skill-blurb"),
  pfSaveBtn: document.getElementById("pf-save-btn"),
  pfCancelBtn: document.getElementById("pf-cancel-btn"),
  addPlayerBtn: document.getElementById("add-player-btn"),
  playersCloseBtn: document.getElementById("players-close-btn"),
  statsModal: document.getElementById("stats-modal"),
  statsTitle: document.getElementById("stats-title"),
  statsMetaTable: document.getElementById("stats-meta-table"),
  statsOppName: document.getElementById("stats-opp-name"),
  statsYouHand: document.getElementById("stats-you-hand"),
  statsYouGame: document.getElementById("stats-you-game"),
  statsOppHand: document.getElementById("stats-opp-hand"),
  statsOppGame: document.getElementById("stats-opp-game"),
  statsCloseBtn: document.getElementById("stats-close-btn"),
};

function oppName(){
  return (state.opponent && state.opponent.name) ? state.opponent.name : "Computer";
}

// ---------- logging ----------

function log(msg, cls){
  const line = document.createElement("div");
  line.className = "log-line" + (cls ? " " + cls : "");
  line.textContent = msg;
  el.statusLog.appendChild(line);
  el.statusLog.scrollTop = el.statusLog.scrollHeight;
}

function clearLog(){
  el.statusLog.innerHTML = "";
}

// ---------- rendering ----------

function sortComparator(sortMode){
  return sortMode === "suit"
    ? (a, b) => (SUITS.indexOf(a.c.s) - SUITS.indexOf(b.c.s)) || (a.c.r - b.c.r)
    : (a, b) => (a.c.r - b.c.r) || (SUITS.indexOf(a.c.s) - SUITS.indexOf(b.c.s));
}

function computeDisplayGroups(hand, sortMode){
  const analysis = analyzeHand(hand);
  const cmp = sortComparator(sortMode);
  const usedIdx = new Set();
  analysis.meldMasks.forEach(m => {
    for (let i = 0; i < hand.length; i++) if (m & (1 << i)) usedIdx.add(i);
  });

  const meldGroups = analysis.meldMasks.map(m => {
    const items = [];
    for (let i = 0; i < hand.length; i++) if (m & (1 << i)) items.push({ c: hand[i], i });
    items.sort(cmp);
    return items;
  });
  meldGroups.sort((g1, g2) => cmp(g1[0], g2[0]));

  const groups = meldGroups.map(items => ({ type: "meld", items }));

  const deadwoodItems = [];
  for (let i = 0; i < hand.length; i++) if (!usedIdx.has(i)) deadwoodItems.push({ c: hand[i], i });
  deadwoodItems.sort(cmp);
  if (deadwoodItems.length) groups.push({ type: "deadwood", items: deadwoodItems });

  return groups;
}

function syncManualOrder(){
  const currentIds = state.playerHand.map(c => c.id);
  const idSet = new Set(currentIds);
  state.manualOrder = state.manualOrder.filter(id => idSet.has(id));
  currentIds.forEach(id => { if (!state.manualOrder.includes(id)) state.manualOrder.push(id); });
}

function renderCardFace(c){
  const wrap = document.createElement("div");
  wrap.className = "card-face";
  const top = document.createElement("div");
  top.className = "corner corner-top";
  top.innerHTML = `<div class="corner-rank">${RANK_LABEL[c.r]}</div><div class="corner-suit">${SUIT_SYMBOL[c.s]}</div>`;
  const bottom = document.createElement("div");
  bottom.className = "corner corner-bottom";
  bottom.innerHTML = `<div class="corner-rank">${RANK_LABEL[c.r]}</div><div class="corner-suit">${SUIT_SYMBOL[c.s]}</div>`;
  const center = document.createElement("div");
  center.className = "card-suit-center";
  center.textContent = SUIT_SYMBOL[c.s];
  wrap.appendChild(top);
  wrap.appendChild(bottom);
  wrap.appendChild(center);
  return wrap;
}

function buildCardEl(c, isMeld, isSelected){
  const div = document.createElement("div");
  div.className = "card " + suitClass(c.s);
  if (isMeld) div.classList.add("meld");
  if (isSelected) div.classList.add("selected");
  div.appendChild(renderCardFace(c));
  return div;
}

function renderPlayerHand(){
  el.playerHand.innerHTML = "";
  syncManualOrder();

  const analysis = analyzeHand(state.playerHand);
  const meldIndexSet = new Set();
  analysis.meldMasks.forEach(m => {
    for (let i = 0; i < state.playerHand.length; i++) if (m & (1 << i)) meldIndexSet.add(i);
  });

  if (state.sortMode === "manual"){
    const row = document.createElement("div");
    row.className = "cards-row manual-row";
    const order = state.manualOrder
      .map(id => state.playerHand.findIndex(c => c.id === id))
      .filter(i => i !== -1);
    order.forEach(i => {
      const c = state.playerHand[i];
      const div = buildCardEl(c, meldIndexSet.has(i), state.selectedIndex === i);
      div.draggable = true;
      div.dataset.cardId = c.id;
      div.addEventListener("click", () => onPlayerCardClick(i));
      bindDoubleActivate(div, `card-${c.id}`, () => onPlayerCardDblClick(i));
      div.addEventListener("dragstart", onDragStart);
      div.addEventListener("dragover", onDragOver);
      div.addEventListener("drop", onDrop);
      div.addEventListener("dragend", onDragEnd);
      row.appendChild(div);
    });
    el.playerHand.appendChild(row);
  } else {
    const groups = computeDisplayGroups(state.playerHand, state.sortMode);
    groups.forEach(g => {
      const groupDiv = document.createElement("div");
      groupDiv.className = "card-group " + (g.type === "meld" ? "meld-group" : "deadwood-group");
      const label = document.createElement("div");
      label.className = "group-label";
      label.textContent = groupLabel(g.type, g.items);
      groupDiv.appendChild(label);
      const row = document.createElement("div");
      row.className = "cards-row";
      g.items.forEach(({ c, i }) => {
        const div = buildCardEl(c, meldIndexSet.has(i), state.selectedIndex === i);
        div.addEventListener("click", () => onPlayerCardClick(i));
        bindDoubleActivate(div, `card-${c.id}`, () => onPlayerCardDblClick(i));
        bindCardDragToDiscard(div, c.id);
        row.appendChild(div);
      });
      groupDiv.appendChild(row);
      el.playerHand.appendChild(groupDiv);
    });
  }

  el.playerCount.textContent = state.playerHand.length;
  updateDeadwoodReadout();
}

function onDragStart(e){
  dragSourceId = Number(e.currentTarget.dataset.cardId);
  e.dataTransfer.effectAllowed = "move";
  e.currentTarget.classList.add("dragging");
}
function onDragOver(e){
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}
function onDrop(e){
  e.preventDefault();
  const targetId = Number(e.currentTarget.dataset.cardId);
  if (dragSourceId === null || targetId === dragSourceId) return;
  const from = state.manualOrder.indexOf(dragSourceId);
  const to = state.manualOrder.indexOf(targetId);
  if (from === -1 || to === -1) return;
  state.manualOrder.splice(from, 1);
  state.manualOrder.splice(to, 0, dragSourceId);
  renderAll();
}
function onDragEnd(e){
  e.currentTarget.classList.remove("dragging");
  dragSourceId = null;
}

// Pointer Events (not native HTML5 drag-and-drop) power dragging a card to
// the discard pile in Sort by Suit / Sort by Value mode, because iOS
// Safari does not fire native drag events for touch input — only mouse.
// Pointer Events fire consistently for mouse, touch, and pen alike.
const DRAG_THRESHOLD = 10;

function isPointOverElement(x, y, elem){
  const r = elem.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function bindCardDragToDiscard(div, cardId){
  div.addEventListener("pointerdown", (e) => {
    if (state.turn !== "player" || state.phase !== "discard" || state.locked) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cardDragCtx = { pointerId: e.pointerId, cardId, startX: e.clientX, startY: e.clientY, active: false, el: div };
    try { div.setPointerCapture(e.pointerId); } catch(err) { /* ignore */ }
  });

  div.addEventListener("pointermove", (e) => {
    if (!cardDragCtx || cardDragCtx.el !== div || cardDragCtx.pointerId !== e.pointerId) return;
    const dx = e.clientX - cardDragCtx.startX;
    const dy = e.clientY - cardDragCtx.startY;
    if (!cardDragCtx.active){
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      cardDragCtx.active = true;
      div.classList.add("dragging-to-discard");
    }
    e.preventDefault();
    div.style.transform = `translate(${dx}px, ${dy}px)`;
    el.discardPile.classList.toggle("drop-hover", isPointOverElement(e.clientX, e.clientY, el.discardPile));
  });

  function endDrag(e, allowDrop){
    if (!cardDragCtx || cardDragCtx.el !== div || cardDragCtx.pointerId !== e.pointerId) return;
    const wasActive = cardDragCtx.active;
    const overDiscard = allowDrop && wasActive && isPointOverElement(e.clientX, e.clientY, el.discardPile);
    const draggedCardId = cardDragCtx.cardId;
    div.style.transform = "";
    div.classList.remove("dragging-to-discard");
    el.discardPile.classList.remove("drop-hover");
    cardDragCtx = null;
    if (overDiscard){
      const idx = state.playerHand.findIndex(c => c.id === draggedCardId);
      if (idx !== -1){
        state.selectedIndex = null;
        finalizeDiscard(idx, false);
      }
    }
  }

  div.addEventListener("pointerup", (e) => endDrag(e, true));
  div.addEventListener("pointercancel", (e) => endDrag(e, false));
}

function renderComputerHand(){
  el.computerHand.innerHTML = "";
  for (let i = 0; i < state.computerHand.length; i++){
    const div = document.createElement("div");
    div.className = "card card-back";
    el.computerHand.appendChild(div);
  }
  el.computerCount.textContent = state.computerHand.length;
}

function renderPiles(){
  el.stockCount.textContent = state.stock.length;
  el.discardPile.innerHTML = "";
  if (state.discard.length === 0){
    el.discardPile.className = "card pile discard empty";
  } else {
    const top = state.discard[state.discard.length - 1];
    el.discardPile.className = "card pile discard " + suitClass(top.s);
    el.discardPile.appendChild(renderCardFace(top));
  }
}

function updateDeadwoodReadout(){
  if (state.playerHand.length === 10){
    const a = analyzeHand(state.playerHand);
    el.deadwoodReadout.textContent = `Deadwood: ${a.deadwoodPoints}`;
  } else if (state.playerHand.length === 11){
    const options = bestDiscardOptions(state.playerHand);
    el.deadwoodReadout.textContent = `Best possible after discard: ${options[0].deadwood}`;
  } else {
    el.deadwoodReadout.textContent = "";
  }
}

function updateOpponentLine(){
  let text = `vs ${oppName()}`;
  if (state.opponent && state.opponent.id){
    text += ` · ${STYLE_META[state.opponent.style].label} · ${SKILL_META[state.opponent.skill].label}`;
  }
  el.opponentLine.textContent = text;
  el.computerNameLabel.textContent = oppName();
  el.computerScoreLabel.textContent = oppName();
}

function renderAll(){
  renderPlayerHand();
  renderComputerHand();
  renderPiles();
  el.playerScore.textContent = state.playerScore;
  el.computerScore.textContent = state.computerScore;
  el.roundNum.textContent = state.round;
  updateOpponentLine();
  updateButtons();
}

function updateButtons(){
  const isPlayerDraw = state.turn === "player" && state.phase === "draw" && !state.locked;
  const isPlayerDiscard = state.turn === "player" && state.phase === "discard" && !state.locked;

  el.stockPile.classList.toggle("disabled", !(isPlayerDraw && state.stock.length > 2));
  el.discardPile.classList.toggle("disabled", !(isPlayerDraw && state.discard.length > 0));

  let canKnock = false;
  if (isPlayerDiscard && state.selectedIndex !== null){
    const remaining = state.playerHand.filter((_, idx) => idx !== state.selectedIndex);
    const a = analyzeHand(remaining);
    canKnock = a.deadwoodPoints <= 10;
  }
  el.knockBtn.disabled = !canKnock;

  el.sortSuitBtn.classList.toggle("active", state.sortMode === "suit");
  el.sortRankBtn.classList.toggle("active", state.sortMode === "rank");
  el.sortManualBtn.classList.toggle("active", state.sortMode === "manual");
}

// ---------- generic confirm modal ----------

function showConfirmModal(message, onConfirm){
  el.confirmBody.textContent = message;
  el.confirmModal.classList.remove("hidden");
  function cleanup(){
    el.confirmModal.classList.add("hidden");
    el.confirmYesBtn.removeEventListener("click", yesHandler);
    el.confirmNoBtn.removeEventListener("click", noHandler);
  }
  function yesHandler(){ cleanup(); onConfirm(); }
  function noHandler(){ cleanup(); }
  el.confirmYesBtn.addEventListener("click", yesHandler);
  el.confirmNoBtn.addEventListener("click", noHandler);
}

// ---------- game flow ----------

function newMatch(){
  state.playerScore = 0;
  state.computerScore = 0;
  state.round = 1;
  state.dealerIsPlayer = true;
  state.roundHistory = [];
  el.matchModal.classList.add("hidden");
  clearLog();
  startRound();
}

function startRound(){
  state.deck = shuffle(makeDeck());
  state.playerHand = [];
  state.computerHand = [];
  state.selectedIndex = null;
  state.locked = false;
  state.humanPickupLog = [];
  state.handStartTime = Date.now();
  state.playerJustDrawnFromDiscardId = null;
  state.computerJustDrawnFromDiscardId = null;

  if (state.opponent && state.opponent.id){
    state.opponent.stats.handsStarted += 1;
    saveProfiles(state.profiles);
  }

  for (let i = 0; i < 10; i++){
    state.playerHand.push(state.deck.pop());
    state.computerHand.push(state.deck.pop());
  }
  state.discard = [state.deck.pop()];
  state.stock = state.deck;
  state.manualOrder = state.playerHand.map(c => c.id);

  clearLog();
  log(`Hand ${state.round} dealt. ${state.dealerIsPlayer ? oppName() : "You"} act first.`, "intro");

  state.turn = state.dealerIsPlayer ? "computer" : "player";
  state.phase = "draw";

  renderAll();

  if (state.turn === "computer"){
    state.locked = true;
    setTimeout(computerTurn, 700);
  }
}

function onPlayerCardClick(i){
  if (state.turn !== "player" || state.phase !== "discard" || state.locked) return;
  state.selectedIndex = (state.selectedIndex === i) ? null : i;
  renderAll();
}

function onPlayerCardDblClick(i){
  if (state.turn !== "player" || state.phase !== "discard" || state.locked) return;
  state.selectedIndex = null;
  finalizeDiscard(i, false);
}

function finalizeDiscard(i, asKnock){
  const hand = state.playerHand;

  if (hand[i].id === state.playerJustDrawnFromDiscardId){
    log("You can't discard the card you just picked up from the discard pile — choose a different card.", "important");
    state.selectedIndex = null;
    renderAll();
    return;
  }

  const preAnalysis = analyzeHand(hand);
  const meldMask = findMeldContaining(preAnalysis.meldMasks, i);
  if (meldMask !== null && !meldRemainsValid(hand, meldMask, i)){
    const card = hand[i];
    const description = meldDescription(hand, meldMask);
    showConfirmModal(
      `Discarding ${cardLabel(card)} will break up your ${description} meld and send those cards to your deadwood. Discard it anyway?`,
      () => performDiscard(i, asKnock)
    );
    return;
  }
  performDiscard(i, asKnock);
}

function performDiscard(i, asKnock){
  const card = state.playerHand[i];
  const remaining = state.playerHand.filter((_, idx) => idx !== i);
  const a = analyzeHand(remaining);

  if (asKnock && a.deadwoodPoints > 10){
    log("That discard leaves too much deadwood to knock.", "important");
    state.selectedIndex = null;
    renderAll();
    return;
  }

  state.playerHand = remaining;
  state.discard.push(card);
  state.selectedIndex = null;
  log(`You discarded ${cardLabel(card)}.`, "you");

  if (a.deadwoodPoints === 0){
    renderAll();
    endRound({ type: "gin", knocker: "player" });
    return;
  }

  if (asKnock){
    renderAll();
    endRound({ type: "knock", knocker: "player" });
    return;
  }

  renderAll();

  if (state.stock.length <= 2){
    endRound({ type: "wash" });
    return;
  }

  state.turn = "computer";
  state.phase = "draw";
  state.locked = true;
  renderAll();
  setTimeout(computerTurn, 700);
}

el.knockBtn.addEventListener("click", () => {
  if (el.knockBtn.disabled || state.selectedIndex === null) return;
  finalizeDiscard(state.selectedIndex, true);
});

bindDoubleActivate(el.stockPile, "stock", () => {
  const isPlayerDraw = state.turn === "player" && state.phase === "draw" && !state.locked;
  if (!isPlayerDraw || state.stock.length <= 2) return;
  const card = state.stock.pop();
  state.playerHand.push(card);
  state.phase = "discard";
  state.playerJustDrawnFromDiscardId = null;
  log("You drew from the stock.", "you");
  renderAll();
});

bindDoubleActivate(el.discardPile, "discard", () => {
  const isPlayerDraw = state.turn === "player" && state.phase === "draw" && !state.locked;
  if (!isPlayerDraw || state.discard.length === 0) return;
  const card = state.discard.pop();
  state.playerHand.push(card);
  state.humanPickupLog.push(card);
  state.phase = "discard";
  state.playerJustDrawnFromDiscardId = card.id;
  log(`You drew ${cardLabel(card)} from the discard pile.`, "you");
  renderAll();
});

// Dragging a card (native HTML5 drag, used by Manual Order mode) onto the
// discard pile discards it — an alternate to double-tap for anyone who
// finds tapping error-prone.
el.discardPile.addEventListener("dragover", (e) => {
  if (dragSourceId === null) return;
  e.preventDefault();
  el.discardPile.classList.add("drop-hover");
});
el.discardPile.addEventListener("dragleave", () => {
  el.discardPile.classList.remove("drop-hover");
});
el.discardPile.addEventListener("drop", (e) => {
  el.discardPile.classList.remove("drop-hover");
  if (dragSourceId === null) return;
  e.preventDefault();
  const isPlayerDiscard = state.turn === "player" && state.phase === "discard" && !state.locked;
  if (!isPlayerDiscard) return;
  const idx = state.playerHand.findIndex(c => c.id === dragSourceId);
  dragSourceId = null;
  if (idx === -1) return;
  state.selectedIndex = null;
  finalizeDiscard(idx, false);
});

el.sortSuitBtn.addEventListener("click", () => { state.sortMode = "suit"; renderAll(); });
el.sortRankBtn.addEventListener("click", () => { state.sortMode = "rank"; renderAll(); });
el.sortManualBtn.addEventListener("click", () => { state.sortMode = "manual"; renderAll(); });

el.newMatchBtn.addEventListener("click", () => {
  if (!state.opponent || !state.opponent.id){
    promptForOpponent();
    return;
  }
  if (confirm("Start a new match? Current scores will be reset.")) newMatch();
});
el.restartBtn.addEventListener("click", () => {
  if (!state.opponent || !state.opponent.id){
    promptForOpponent();
    return;
  }
  newMatch();
});

// ---------- computer AI ----------

function personaEffectiveStyle(persona){
  if (persona.skill === "expert"){
    const diff = state.computerScore - state.playerScore;
    if (diff <= -20) return "aggressive";
    if (diff >= 20) return "patient";
  }
  return persona.style;
}

function knockThreshold(style){
  if (style === "patient") return 0;
  if (style === "trapper") return 7;
  return 10;
}

function pickWithDangerAwareness(candidates, persona, hand){
  if (candidates.length === 1) return candidates[0];
  if (usesDangerAwareness(persona) && state.humanPickupLog.length){
    let bestC = candidates[0], bestScore = Infinity;
    for (const c of candidates){
      const score = dangerScore(hand[c.discardIndex], state.humanPickupLog);
      if (score < bestScore){ bestScore = score; bestC = c; }
    }
    return bestC;
  }
  let bestC = candidates[0], bestPoints = -1;
  for (const c of candidates){
    const pts = cardPoints(hand[c.discardIndex].r);
    if (pts > bestPoints){ bestPoints = pts; bestC = c; }
  }
  return bestC;
}

function computerChooseDraw(persona){
  const currentAnalysis = analyzeHand(state.computerHand);
  if (state.discard.length === 0) return "stock";
  const topDiscard = state.discard[state.discard.length - 1];
  const hypothetical = state.computerHand.concat([topDiscard]);
  const options = bestDiscardOptions(hypothetical);
  const bestWithDiscard = options[0].deadwood;

  if (bestWithDiscard < currentAnalysis.deadwoodPoints || bestWithDiscard <= 10) return "discard";

  if (persona.style === "trapper" && state.humanPickupLog.length){
    const danger = dangerScore(topDiscard, state.humanPickupLog);
    if (danger >= 2 && bestWithDiscard <= currentAnalysis.deadwoodPoints + 2) return "discard";
  }
  return "stock";
}

function computerTurn(){
  const persona = state.opponent;
  const draw = computerChooseDraw(persona);
  let drawnCard;
  if (draw === "discard" && state.discard.length > 0){
    drawnCard = state.discard.pop();
    state.computerHand.push(drawnCard);
    state.computerJustDrawnFromDiscardId = drawnCard.id;
    log(`${oppName()} drew ${cardLabel(drawnCard)} from the discard pile.`, "comp");
  } else {
    drawnCard = state.stock.pop();
    state.computerHand.push(drawnCard);
    state.computerJustDrawnFromDiscardId = null;
    log(`${oppName()} drew from the stock.`, "comp");
  }
  renderAll();

  setTimeout(() => {
    const hand = state.computerHand;
    let options = bestDiscardOptions(hand);
    if (state.computerJustDrawnFromDiscardId !== null){
      const legal = options.filter(o => hand[o.discardIndex].id !== state.computerJustDrawnFromDiscardId);
      if (legal.length) options = legal;
    }
    const best = options[0];

    if (best.deadwood === 0){
      const card = hand[best.discardIndex];
      state.computerHand = best.remaining;
      state.discard.push(card);
      log(`${oppName()} discards ${cardLabel(card)} and declares Gin!`, "comp important");
      renderAll();
      endRound({ type: "gin", knocker: "computer" });
      return;
    }

    const effectiveStyle = personaEffectiveStyle(persona);
    const threshold = knockThreshold(effectiveStyle);
    const stockLow = state.stock.length <= 6;
    const canKnockNow = best.deadwood <= 10 && (best.deadwood <= threshold || stockLow);

    if (canKnockNow){
      const knockCandidates = options.filter(o => o.deadwood === best.deadwood);
      const chosen = pickWithDangerAwareness(knockCandidates, persona, hand);
      const card = hand[chosen.discardIndex];
      state.computerHand = chosen.remaining;
      state.discard.push(card);
      log(`${oppName()} discards ${cardLabel(card)} and knocks with ${chosen.deadwood} deadwood.`, "comp important");
      renderAll();
      endRound({ type: "knock", knocker: "computer" });
      return;
    }

    const nearBest = options.filter(o => o.deadwood <= best.deadwood + 1);
    const chosen = pickWithDangerAwareness(nearBest, persona, hand);
    const card = hand[chosen.discardIndex];
    state.computerHand = chosen.remaining;
    state.discard.push(card);
    log(`${oppName()} discards ${cardLabel(card)}.`, "comp");
    renderAll();

    if (state.stock.length <= 2){
      endRound({ type: "wash" });
      return;
    }

    state.turn = "player";
    state.phase = "draw";
    state.locked = false;
    renderAll();
  }, 650);
}

// ---------- scoring ----------

function recordHandTiming(){
  if (!state.opponent || !state.opponent.id) return;
  const stats = state.opponent.stats;
  const elapsed = state.handStartTime ? (Date.now() - state.handStartTime) : 0;
  stats.handsFinished += 1;
  stats.totalHandTimeMs += elapsed;
  stats.shortestHandMs = (stats.shortestHandMs === null) ? elapsed : Math.min(stats.shortestHandMs, elapsed);
  stats.longestHandMs = (stats.longestHandMs === null) ? elapsed : Math.max(stats.longestHandMs, elapsed);
  saveProfiles(state.profiles);
}

// winnerSide/loserSide/knockerSide: 'you' | 'opp'. result: 'gin' | 'knock' | 'undercut'.
function recordHandOutcome({ winnerSide, loserSide, pts, yourDeadwoodFinal, oppDeadwoodFinal, knockerSide, result }){
  if (!state.opponent || !state.opponent.id) return;
  const stats = state.opponent.stats;
  const you = stats.you, opp = stats.opp;
  const winner = winnerSide === "you" ? you : opp;
  const loser = loserSide === "you" ? you : opp;

  winner.handsWon += 1;
  loser.handsLost += 1;

  winner.scoreSum += pts;
  winner.scoreCount += 1;
  winner.lowestScore = (winner.lowestScore === null) ? pts : Math.min(winner.lowestScore, pts);
  winner.highestScore = (winner.highestScore === null) ? pts : Math.max(winner.highestScore, pts);

  you.deadwoodSum += yourDeadwoodFinal;
  you.deadwoodCount += 1;
  opp.deadwoodSum += oppDeadwoodFinal;
  opp.deadwoodCount += 1;

  if (result === "gin"){
    (knockerSide === "you" ? you : opp).ginCount += 1;
  } else {
    (knockerSide === "you" ? you : opp).knockCount += 1;
    if (result === "undercut") winner.undercutCount += 1;
  }

  winner.curWinStreak += 1;
  winner.longestWinStreak = Math.max(winner.longestWinStreak, winner.curWinStreak);
  winner.curLoseStreak = 0;
  loser.curLoseStreak += 1;
  loser.longestLoseStreak = Math.max(loser.longestLoseStreak, loser.curLoseStreak);
  loser.curWinStreak = 0;

  saveProfiles(state.profiles);
}

// Computes match-summary totals (Total Score, Game/Line/Shutout bonuses,
// Grand Total) from state.roundHistory. Shared by the match-stats recorder
// and the end-of-match scorecard modal so the two can never disagree.
function computeMatchTotals(){
  let playerTotal = 0, computerTotal = 0;
  state.roundHistory.forEach(entry => {
    playerTotal += entry.playerScore + entry.playerBonus;
    computerTotal += entry.computerScore + entry.computerBonus;
  });

  const youWonMatch = state.playerScore > state.computerScore;
  const youHandsWon = state.roundHistory.filter(e => (e.playerScore + e.playerBonus) > 0).length;
  const oppHandsWon = state.roundHistory.filter(e => (e.computerScore + e.computerBonus) > 0).length;

  const youGameBonus = youWonMatch ? 100 : 0;
  const oppGameBonus = youWonMatch ? 0 : 100;
  const youLineBonus = youHandsWon * 25;
  const oppLineBonus = oppHandsWon * 25;
  const youShutout = (youWonMatch && computerTotal === 0) ? playerTotal : 0;
  const oppShutout = (!youWonMatch && playerTotal === 0) ? computerTotal : 0;
  const youGrand = playerTotal + youGameBonus + youLineBonus + youShutout;
  const oppGrand = computerTotal + oppGameBonus + oppLineBonus + oppShutout;

  return { playerTotal, computerTotal, youWonMatch, youHandsWon, oppHandsWon,
    youGameBonus, oppGameBonus, youLineBonus, oppLineBonus,
    youShutout, oppShutout, youGrand, oppGrand };
}

function recordMatchOutcome(){
  if (!state.opponent || !state.opponent.id) return;
  const stats = state.opponent.stats;
  const you = stats.you, opp = stats.opp;
  const playerWon = state.playerScore > state.computerScore;
  const winner = playerWon ? you : opp;
  const loser = playerWon ? opp : you;
  const totals = computeMatchTotals();

  winner.gamesWon += 1;
  loser.gamesLost += 1;

  you.gameScoreSum += totals.youGrand;
  you.gameScoreCount += 1;
  you.highestGameScore = Math.max(you.highestGameScore, totals.youGrand);
  opp.gameScoreSum += totals.oppGrand;
  opp.gameScoreCount += 1;
  opp.highestGameScore = Math.max(opp.highestGameScore, totals.oppGrand);

  winner.curGameWinStreak += 1;
  winner.longestGameWinStreak = Math.max(winner.longestGameWinStreak, winner.curGameWinStreak);
  winner.curGameLoseStreak = 0;
  loser.curGameLoseStreak += 1;
  loser.longestGameLoseStreak = Math.max(loser.longestGameLoseStreak, loser.curGameLoseStreak);
  loser.curGameWinStreak = 0;

  you.handsPerGameSum += state.round;
  you.handsPerGameCount += 1;
  opp.handsPerGameSum += state.round;
  opp.handsPerGameCount += 1;

  const loserFinalScore = playerWon ? state.computerScore : state.playerScore;
  if (loserFinalScore === 0) winner.shutoutCount += 1;

  saveProfiles(state.profiles);
}

function endRound({ type, knocker }){
  state.locked = true;
  state.phase = null;
  recordHandTiming();

  if (type === "wash"){
    state.roundHistory.push({ round: state.round, playerScore: 0, playerBonus: 0, computerScore: 0, computerBonus: 0, result: "Wash" });
    el.roundTitle.textContent = "Stock Exhausted";
    el.roundBody.innerHTML = `<p>Neither player knocked before the stock ran low. This hand is a wash — no points scored.</p>`;
    showRoundModal(() => afterRound());
    return;
  }

  const playerAnalysis = analyzeHand(state.playerHand);
  const computerAnalysis = analyzeHand(state.computerHand);

  let title, bodyHtml;

  if (type === "gin"){
    if (knocker === "player"){
      const pts = computerAnalysis.deadwoodPoints + GIN_BONUS;
      state.playerScore += pts;
      recordHandOutcome({ winnerSide: "you", loserSide: "opp", pts, yourDeadwoodFinal: 0, oppDeadwoodFinal: computerAnalysis.deadwoodPoints, knockerSide: "you", result: "gin" });
      state.roundHistory.push({ round: state.round, playerScore: computerAnalysis.deadwoodPoints, playerBonus: GIN_BONUS, computerScore: 0, computerBonus: 0, result: "Gin" });
      title = "Gin! You win the hand.";
      bodyHtml = `<p>Your hand was completely clear of deadwood.</p>
        <table>
          <tr><td>${oppName()}'s deadwood</td><td class="num">${computerAnalysis.deadwoodPoints}</td></tr>
          <tr><td>Gin bonus</td><td class="num">${GIN_BONUS}</td></tr>
          <tr><td><strong>You score</strong></td><td class="num">${pts}</td></tr>
        </table>`;
    } else {
      const pts = playerAnalysis.deadwoodPoints + GIN_BONUS;
      state.computerScore += pts;
      recordHandOutcome({ winnerSide: "opp", loserSide: "you", pts, yourDeadwoodFinal: playerAnalysis.deadwoodPoints, oppDeadwoodFinal: 0, knockerSide: "opp", result: "gin" });
      state.roundHistory.push({ round: state.round, playerScore: 0, playerBonus: 0, computerScore: playerAnalysis.deadwoodPoints, computerBonus: GIN_BONUS, result: "Gin" });
      title = `${oppName()} scores Gin.`;
      bodyHtml = `<p>${oppName()} cleared their hand of deadwood before you could knock.</p>
        <table>
          <tr><td>Your deadwood</td><td class="num">${playerAnalysis.deadwoodPoints}</td></tr>
          <tr><td>Gin bonus</td><td class="num">${GIN_BONUS}</td></tr>
          <tr><td><strong>${oppName()} scores</strong></td><td class="num">${pts}</td></tr>
        </table>`;
    }
  } else if (type === "knock"){
    if (knocker === "player"){
      const layoff = computeLayoffs(state.playerHand, playerAnalysis.meldMasks,
        computerAnalysis.deadwoodIdx.map(i => state.computerHand[i]));
      const knockerDW = playerAnalysis.deadwoodPoints;
      const defenderDW = layoff.remainingDeadwood.reduce((s,c) => s + cardPoints(c.r), 0);

      if (defenderDW < knockerDW){
        const pts = (knockerDW - defenderDW) + UNDERCUT_BONUS;
        state.computerScore += pts;
        recordHandOutcome({ winnerSide: "opp", loserSide: "you", pts, yourDeadwoodFinal: knockerDW, oppDeadwoodFinal: defenderDW, knockerSide: "you", result: "undercut" });
        state.roundHistory.push({ round: state.round, playerScore: 0, playerBonus: 0, computerScore: knockerDW - defenderDW, computerBonus: UNDERCUT_BONUS, result: "Undercut" });
        title = `Undercut! ${oppName()} scores.`;
        bodyHtml = `<p>You knocked with ${knockerDW} deadwood, but ${oppName()}'s deadwood was ${defenderDW} after laying off — equal or lower undercuts the knocker.</p>
          <table>
            <tr><td>Your deadwood</td><td class="num">${knockerDW}</td></tr>
            <tr><td>${oppName()}'s deadwood (after layoffs)</td><td class="num">${defenderDW}</td></tr>
            <tr><td>Undercut bonus</td><td class="num">${UNDERCUT_BONUS}</td></tr>
            <tr><td><strong>${oppName()} scores</strong></td><td class="num">${pts}</td></tr>
          </table>`;
      } else {
        const pts = defenderDW - knockerDW;
        state.playerScore += pts;
        recordHandOutcome({ winnerSide: "you", loserSide: "opp", pts, yourDeadwoodFinal: knockerDW, oppDeadwoodFinal: defenderDW, knockerSide: "you", result: "knock" });
        state.roundHistory.push({ round: state.round, playerScore: defenderDW - knockerDW, playerBonus: 0, computerScore: 0, computerBonus: 0, result: "Knock" });
        title = "You knock and win the hand.";
        bodyHtml = `<p>You knocked with ${knockerDW} deadwood.</p>
          <table>
            <tr><td>Your deadwood</td><td class="num">${knockerDW}</td></tr>
            <tr><td>${oppName()}'s deadwood (after layoffs)</td><td class="num">${defenderDW}</td></tr>
            <tr><td>${layoff.laidOff.length ? "Cards laid off: " + layoff.laidOff.map(cardLabel).join(", ") : "No layoffs"}</td><td></td></tr>
            <tr><td><strong>You score</strong></td><td class="num">${pts}</td></tr>
          </table>`;
      }
    } else {
      const layoff = computeLayoffs(state.computerHand, computerAnalysis.meldMasks,
        playerAnalysis.deadwoodIdx.map(i => state.playerHand[i]));
      const knockerDW = computerAnalysis.deadwoodPoints;
      const defenderDW = layoff.remainingDeadwood.reduce((s,c) => s + cardPoints(c.r), 0);

      if (defenderDW < knockerDW){
        const pts = (knockerDW - defenderDW) + UNDERCUT_BONUS;
        state.playerScore += pts;
        recordHandOutcome({ winnerSide: "you", loserSide: "opp", pts, yourDeadwoodFinal: defenderDW, oppDeadwoodFinal: knockerDW, knockerSide: "opp", result: "undercut" });
        state.roundHistory.push({ round: state.round, playerScore: knockerDW - defenderDW, playerBonus: UNDERCUT_BONUS, computerScore: 0, computerBonus: 0, result: "Undercut" });
        title = "Undercut! You score.";
        bodyHtml = `<p>${oppName()} knocked with ${knockerDW} deadwood, but your deadwood was only ${defenderDW} after laying off — you undercut the knock.</p>
          <table>
            <tr><td>${oppName()}'s deadwood</td><td class="num">${knockerDW}</td></tr>
            <tr><td>Your deadwood (after layoffs)</td><td class="num">${defenderDW}</td></tr>
            <tr><td>Undercut bonus</td><td class="num">${UNDERCUT_BONUS}</td></tr>
            <tr><td><strong>You score</strong></td><td class="num">${pts}</td></tr>
          </table>`;
      } else {
        const pts = defenderDW - knockerDW;
        state.computerScore += pts;
        recordHandOutcome({ winnerSide: "opp", loserSide: "you", pts, yourDeadwoodFinal: defenderDW, oppDeadwoodFinal: knockerDW, knockerSide: "opp", result: "knock" });
        state.roundHistory.push({ round: state.round, playerScore: 0, playerBonus: 0, computerScore: defenderDW - knockerDW, computerBonus: 0, result: "Knock" });
        title = `${oppName()} knocks and wins the hand.`;
        bodyHtml = `<p>${oppName()} knocked with ${knockerDW} deadwood.</p>
          <table>
            <tr><td>${oppName()}'s deadwood</td><td class="num">${knockerDW}</td></tr>
            <tr><td>Your deadwood (after layoffs)</td><td class="num">${defenderDW}</td></tr>
            <tr><td>${layoff.laidOff.length ? "Cards laid off: " + layoff.laidOff.map(cardLabel).join(", ") : "No layoffs"}</td><td></td></tr>
            <tr><td><strong>${oppName()} scores</strong></td><td class="num">${pts}</td></tr>
          </table>`;
      }
    }
  }

  el.roundTitle.textContent = title;
  el.roundBody.innerHTML = bodyHtml;
  showRoundModal(() => afterRound());
}

function showRoundModal(onContinue){
  el.roundModal.classList.remove("hidden");
  const handler = () => {
    el.roundModal.classList.add("hidden");
    el.continueBtn.removeEventListener("click", handler);
    onContinue();
  };
  el.continueBtn.addEventListener("click", handler);
}

function buildScoreSummaryHtml(){
  let rows = "";
  state.roundHistory.forEach(entry => {
    const playerRoundTotal = entry.playerScore + entry.playerBonus;
    const computerRoundTotal = entry.computerScore + entry.computerBonus;
    rows += `<tr>
      <td>${entry.round}</td>
      <td class="num">${entry.playerScore || ""}</td>
      <td class="num">${entry.playerBonus || ""}</td>
      <td class="num">${playerRoundTotal || ""}</td>
      <td class="num">${entry.computerScore || ""}</td>
      <td class="num">${entry.computerBonus || ""}</td>
      <td class="num">${computerRoundTotal || ""}</td>
      <td>${entry.result}</td>
    </tr>`;
  });

  const {
    playerTotal, computerTotal,
    youGameBonus, oppGameBonus, youLineBonus, oppLineBonus,
    youShutout, oppShutout, youGrand, oppGrand
  } = computeMatchTotals();

  const oppLabel = escapeHtml(oppName());

  return `
    <div class="score-summary-wrap">
      <table class="score-summary-table">
        <thead>
          <tr>
            <th>Round</th>
            <th colspan="3">You</th>
            <th colspan="3">${oppLabel}</th>
            <th>Result</th>
          </tr>
          <tr class="sub-head">
            <th></th>
            <th>Score</th><th>Bonus</th><th>Total</th>
            <th>Score</th><th>Bonus</th><th>Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><td>Total Score</td><td></td><td></td><td class="num">${playerTotal}</td><td></td><td></td><td class="num">${computerTotal}</td><td></td></tr>
          <tr><td>Game Bonus</td><td></td><td></td><td class="num">${youGameBonus}</td><td></td><td></td><td class="num">${oppGameBonus}</td><td></td></tr>
          <tr><td>Line Bonus</td><td></td><td></td><td class="num">${youLineBonus}</td><td></td><td></td><td class="num">${oppLineBonus}</td><td></td></tr>
          <tr><td>Shutout Bonus</td><td></td><td></td><td class="num">${youShutout}</td><td></td><td></td><td class="num">${oppShutout}</td><td></td></tr>
          <tr class="grand-row"><td>Grand Total</td><td></td><td></td><td class="num">${youGrand}</td><td></td><td></td><td class="num">${oppGrand}</td><td></td></tr>
        </tfoot>
      </table>
    </div>`;
}

function afterRound(){
  if (state.playerScore >= TARGET_SCORE || state.computerScore >= TARGET_SCORE){
    const playerWon = state.playerScore > state.computerScore;
    recordMatchOutcome();
    el.matchTitle.textContent = playerWon ? "You win the match!" : `${oppName()} wins the match.`;
    el.matchBody.innerHTML = buildScoreSummaryHtml();
    el.matchModal.classList.remove("hidden");
    return;
  }
  state.round += 1;
  state.dealerIsPlayer = !state.dealerIsPlayer;
  startRound();
}

// ---------- player profile management ----------

function openPlayersModal(){
  renderPlayersList();
  el.playerForm.classList.add("hidden");
  el.playersModal.classList.remove("hidden");
  el.playersCloseBtn.classList.remove("hidden");
  el.playersRequiredNote.classList.add("hidden");
}
el.playersBtn.addEventListener("click", openPlayersModal);

// Used at first launch, and any time New Match is clicked without an
// opponent chosen yet. Unlike openPlayersModal, this hides the Close
// button and shows an explanatory note, since a match can't start until
// someone's picked or created — there's nothing to save stats against
// (or, later, for the adaptive opponent to learn from) otherwise.
function promptForOpponent(){
  renderPlayersList();
  el.playerForm.classList.add("hidden");
  el.playersModal.classList.remove("hidden");
  el.playersCloseBtn.classList.add("hidden");
  el.playersRequiredNote.classList.remove("hidden");
}
el.howToPlayBtn.addEventListener("click", () => el.rulesModal.classList.remove("hidden"));
el.rulesCloseBtn.addEventListener("click", () => el.rulesModal.classList.add("hidden"));
el.playersCloseBtn.addEventListener("click", () => el.playersModal.classList.add("hidden"));

function renderPlayersList(){
  el.playersList.innerHTML = "";
  if (state.profiles.length === 0){
    const p = document.createElement("p");
    p.className = "empty-note";
    p.textContent = "No players yet. Add up to 10 opponents to play against and track your record.";
    el.playersList.appendChild(p);
    return;
  }
  state.profiles.forEach(profile => {
    const row = document.createElement("div");
    row.className = "player-row";
    const record = `${profile.stats.you.gamesWon}-${profile.stats.you.gamesLost}`;
    row.innerHTML = `
      <div class="player-row-main">
        <div class="player-row-name">${escapeHtml(profile.name)}</div>
        <div class="player-row-meta">${profile.gender ? escapeHtml(profile.gender) + " · " : ""}${STYLE_META[profile.style].label} · ${SKILL_META[profile.skill].label}</div>
        <div class="player-row-record">Your record vs them: ${record} &middot; ${profile.stats.handsFinished} hands played</div>
      </div>
      <div class="player-row-actions">
        <button class="chip-btn play-btn">Play</button>
        <button class="chip-btn stats-btn">Stats</button>
        <button class="chip-btn edit-btn">Edit</button>
        <button class="chip-btn delete-btn">Delete</button>
      </div>`;
    row.querySelector(".play-btn").addEventListener("click", () => startMatchAgainst(profile));
    row.querySelector(".stats-btn").addEventListener("click", () => openStatsModal(profile));
    row.querySelector(".edit-btn").addEventListener("click", () => openEditForm(profile));
    row.querySelector(".delete-btn").addEventListener("click", () => deleteProfile(profile.id));
    el.playersList.appendChild(row);
  });
}

function updateBlurbs(){
  el.pfStyleBlurb.textContent = STYLE_META[el.pfStyle.value].blurb;
  el.pfSkillBlurb.textContent = SKILL_META[el.pfSkill.value].blurb;
}
el.pfStyle.addEventListener("change", updateBlurbs);
el.pfSkill.addEventListener("change", updateBlurbs);

el.addPlayerBtn.addEventListener("click", () => {
  if (state.profiles.length >= 10){
    alert("You can save up to 10 players. Delete one to add another.");
    return;
  }
  openAddForm();
});

function openAddForm(){
  editingProfileId = null;
  el.playerFormTitle.textContent = "Add Player";
  el.pfName.value = "";
  el.pfGender.value = "";
  el.pfStyle.value = "aggressive";
  el.pfSkill.value = "intermediate";
  updateBlurbs();
  el.playerForm.classList.remove("hidden");
}

function openEditForm(profile){
  editingProfileId = profile.id;
  el.playerFormTitle.textContent = "Edit Player";
  el.pfName.value = profile.name;
  el.pfGender.value = profile.gender || "";
  el.pfStyle.value = profile.style;
  el.pfSkill.value = profile.skill;
  updateBlurbs();
  el.playerForm.classList.remove("hidden");
}

el.pfCancelBtn.addEventListener("click", () => el.playerForm.classList.add("hidden"));

el.pfSaveBtn.addEventListener("click", () => {
  const name = el.pfName.value.trim();
  if (!name){ alert("Give this player a name."); return; }

  if (editingProfileId){
    const p = state.profiles.find(pr => pr.id === editingProfileId);
    if (p){
      p.name = name;
      p.gender = el.pfGender.value;
      p.style = el.pfStyle.value;
      p.skill = el.pfSkill.value;
    }
  } else {
    if (state.profiles.length >= 10){ alert("You can save up to 10 players."); return; }
    const profile = {
      id: "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, gender: el.pfGender.value, style: el.pfStyle.value, skill: el.pfSkill.value,
      stats: defaultStats()
    };
    state.profiles.push(profile);
  }
  saveProfiles(state.profiles);
  el.playerForm.classList.add("hidden");
  renderPlayersList();
  renderAll();
});

function deleteProfile(id){
  if (!confirm("Delete this player and their saved stats? This can't be undone.")) return;
  state.profiles = state.profiles.filter(p => p.id !== id);
  saveProfiles(state.profiles);
  if (state.opponent && state.opponent.id === id){
    state.opponent = Object.assign({}, DEFAULT_OPPONENT);
  }
  renderPlayersList();
  renderAll();
}

function startMatchAgainst(profile){
  state.opponent = profile;
  el.playersCloseBtn.classList.remove("hidden");
  el.playersRequiredNote.classList.add("hidden");
  el.playersModal.classList.add("hidden");
  newMatch();
}

// ---------- statistics modal ----------

function formatDuration(ms){
  if (ms === null || ms === undefined) return "—";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = n => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function formatDate(ts){
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function pctPair(count, total){
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return `${count}/${total} (${pct}%)`;
}

function safeAvg(sum, count, decimals){
  return count > 0 ? (sum / count).toFixed(decimals) : (0).toFixed(decimals);
}

function renderStatsTable(tableEl, rows){
  tableEl.innerHTML = rows.map(([label, value]) =>
    `<tr><td>${escapeHtml(label)}</td><td class="num">${value}</td></tr>`
  ).join("");
}

function buildHandRows(side, handsTotal){
  return [
    ["Won hands", pctPair(side.handsWon, handsTotal)],
    ["Lost hands", pctPair(side.handsLost, handsTotal)],
    ["Average score", safeAvg(side.scoreSum, side.scoreCount, 2)],
    ["Lowest score", side.lowestScore ?? 0],
    ["Highest score", side.highestScore ?? 0],
    ["Average deadwood", safeAvg(side.deadwoodSum, side.deadwoodCount, 1)],
    ["Knock count", pctPair(side.knockCount, handsTotal)],
    ["Gin count", pctPair(side.ginCount, handsTotal)],
    ["Undercut count", pctPair(side.undercutCount, handsTotal)],
    ["Current winning streak", side.curWinStreak],
    ["Longest winning streak", side.longestWinStreak],
    ["Longest losing streak", side.longestLoseStreak],
  ];
}

function buildGameRows(side, gamesTotal){
  return [
    ["Won games", pctPair(side.gamesWon, gamesTotal)],
    ["Lost games", pctPair(side.gamesLost, gamesTotal)],
    ["Average game score", safeAvg(side.gameScoreSum, side.gameScoreCount, 2)],
    ["Highest game score", side.highestGameScore],
    ["Current winning streak", side.curGameWinStreak],
    ["Longest winning streak", side.longestGameWinStreak],
    ["Longest losing streak", side.longestGameLoseStreak],
    ["Average nr. of hands", safeAvg(side.handsPerGameSum, side.handsPerGameCount, 1)],
    ["Shutout bonus count", pctPair(side.shutoutCount, gamesTotal)],
  ];
}

function openStatsModal(profile){
  const stats = profile.stats;
  const handsTotal = stats.handsFinished;
  const gamesTotal = stats.you.gamesWon + stats.you.gamesLost;

  el.statsTitle.textContent = `Statistics vs ${profile.name}`;
  el.statsOppName.textContent = profile.name;

  el.statsMetaTable.innerHTML = `
    <tr><td>Statistics collected since</td><td class="num">${formatDate(stats.since)}</td></tr>
    <tr><td>Hands started</td><td class="num">${stats.handsStarted}</td></tr>
    <tr><td>Hands finished</td><td class="num">${stats.handsFinished}</td></tr>
    <tr><td>Total time spent</td><td class="num">${formatDuration(stats.totalHandTimeMs)}</td></tr>
    <tr><td>Average time per hand</td><td class="num">${formatDuration(handsTotal > 0 ? stats.totalHandTimeMs / handsTotal : 0)}</td></tr>
    <tr><td>Shortest hand</td><td class="num">${formatDuration(stats.shortestHandMs)}</td></tr>
    <tr><td>Longest hand</td><td class="num">${formatDuration(stats.longestHandMs)}</td></tr>
  `;

  renderStatsTable(el.statsYouHand, buildHandRows(stats.you, handsTotal));
  renderStatsTable(el.statsYouGame, buildGameRows(stats.you, gamesTotal));
  renderStatsTable(el.statsOppHand, buildHandRows(stats.opp, handsTotal));
  renderStatsTable(el.statsOppGame, buildGameRows(stats.opp, gamesTotal));

  el.statsModal.classList.remove("hidden");
}

el.statsCloseBtn.addEventListener("click", () => el.statsModal.classList.add("hidden"));

// ---------- boot ----------
//
// The game no longer boots itself on script load. firebase-init.js calls
// startGinRummyGame(uid) once someone's signed in (loading their saved
// players from Firestore first), and stopGinRummyGame() when they sign
// out, so a second person signing in on the same device never sees the
// previous person's saved players.

window.startGinRummyGame = function(uid){
  state.currentUid = uid;
  loadProfiles(uid).then(profiles => {
    state.profiles = profiles;
    promptForOpponent();
  });
};

window.stopGinRummyGame = function(){
  state.currentUid = null;
  state.profiles = [];
  state.opponent = Object.assign({}, DEFAULT_OPPONENT);
};

})();
