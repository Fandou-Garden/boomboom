/**
 * Local player profile (single-player static build).
 *
 * The original client keeps coins / 玄武石 in the account database; the static
 * build has no backend, so the smallest faithful equivalent is a versioned
 * localStorage document:
 *
 *   { version, coins, stones, claims: [{ id, coins, stones, at }], updatedAt }
 *
 * Rules:
 *   - every battle has a stable matchId; a reward can be claimed once per id,
 *     so a refresh, a double click or a re-opened result screen cannot pay twice;
 *   - a corrupt or foreign document is dropped and rebuilt, never thrown at the
 *     game loop;
 *   - claims keep the last CLAIM_HISTORY entries so the record cannot grow
 *     unbounded on a shared device.
 */

export const SAVE_KEY = 'gunny-wind-arena.profile.v1';
export const SAVE_VERSION = 1;
const CLAIM_HISTORY = 40;

const EMPTY = Object.freeze({ version: SAVE_VERSION, coins: 0, stones: 0, claims: [] });

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function normalize(raw) {
  const coins = num(raw?.coins);
  const stones = num(raw?.stones);
  const claims = Array.isArray(raw?.claims)
    ? raw.claims
      .filter((entry) => entry && typeof entry.id === 'string' && entry.id)
      .slice(-CLAIM_HISTORY)
      .map((entry) => ({
        id: entry.id,
        coins: num(entry.coins),
        stones: num(entry.stones),
        at: num(entry.at),
      }))
    : [];
  return { version: SAVE_VERSION, coins, stones, claims };
}

let cache = null;

/** Read the profile. A broken document is replaced by a fresh one. */
export function loadSave() {
  if (cache) return cache;
  let store = null;
  try {
    store = window.localStorage;
  } catch {
    cache = { ...EMPTY, claims: [] };
    return cache;
  }
  let text = null;
  try {
    text = store.getItem(SAVE_KEY);
  } catch {
    cache = { ...EMPTY, claims: [] };
    return cache;
  }
  if (!text) {
    cache = { ...EMPTY, claims: [] };
    return cache;
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    cache = normalize(parsed);
  } catch (error) {
    console.warn('[save] 存档损坏，已重建', error);
    cache = { ...EMPTY, claims: [] };
    try { store.removeItem(SAVE_KEY); } catch { /* storage disabled */ }
  }
  return cache;
}

/** Persist the cached profile; returns false when storage is unavailable. */
export function writeSave(next) {
  cache = normalize(next);
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
}

export function hasClaimed(matchId) {
  if (!matchId) return false;
  return loadSave().claims.some((entry) => entry.id === matchId);
}

/**
 * Credit one battle reward exactly once.
 * @returns {{ok: boolean, reason?: string, save: object}}
 */
export function claimReward(matchId, coins = 0, stones = 0) {
  const current = loadSave();
  if (!matchId) return { ok: false, reason: 'missing-id', save: current };
  if (hasClaimed(matchId)) return { ok: false, reason: 'already-claimed', save: current };
  const next = {
    version: SAVE_VERSION,
    coins: current.coins + num(coins),
    stones: current.stones + num(stones),
    claims: [...current.claims, { id: matchId, coins: num(coins), stones: num(stones), at: Date.now() }].slice(-CLAIM_HISTORY),
    updatedAt: Date.now(),
  };
  const stored = writeSave(next);
  return { ok: stored, reason: stored ? undefined : 'storage-unavailable', save: cache };
}

/** Wipe the profile (help panel entry point). */
export function resetSave() {
  cache = { ...EMPTY, claims: [] };
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch { /* storage disabled */ }
  return cache;
}

/** Presentation helper: "1.2k" for large balances. */
export function formatAmount(value) {
  const n = num(value);
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
  return `${(n / 1000000).toFixed(1)}m`;
}
