// Tiny in-memory rate limiter and alert throttle. No dependencies.
// State lives in the process, which is fine here: there is a single replica,
// and losing the counters on a restart only makes the limits a little looser.

/* Sliding window: at most `max` hits per `windowMs` for each key. */
export function makeLimiter({ max, windowMs }) {
  const hits = new Map();
  let lastSweep = 0;
  return function allow(key, now = Date.now()) {
    // drop stale keys now and then so the map cannot grow without bound
    if (now - lastSweep > windowMs) {
      lastSweep = now;
      for (const [k, arr] of hits) if (!arr.length || now - arr[arr.length - 1] > windowMs) hits.delete(k);
    }
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { hits.set(key, arr); return false; }
    arr.push(now);
    hits.set(key, arr);
    return true;
  };
}

/* Brute-force guard: after `max` FAILURES from one key inside the window the key is
   blocked, and while it is blocked callers must refuse BEFORE checking the secret,
   so a blocked client cannot keep guessing. A success resets the key. */
export function makeFailGuard({ max, windowMs }) {
  const fails = new Map();
  const live = (key, now) => (fails.get(key) || []).filter((t) => now - t < windowMs);
  return {
    blocked: (key, now = Date.now()) => live(key, now).length >= max,
    fail: (key, now = Date.now()) => { fails.set(key, [...live(key, now), now]); },
    reset: (key) => { fails.delete(key); },
  };
}

/* Alert throttle: the same alert key fires at most once per window.
   Returns true when the alert should be sent. */
export function makeThrottle(windowMs) {
  const last = new Map();
  return function shouldAlert(key, now = Date.now()) {
    const t = last.get(key);
    if (t !== undefined && now - t < windowMs) return false;
    last.set(key, now);
    return true;
  };
}

// First hop of X-Forwarded-For (the app sits behind Railway's proxy), else the socket address.
export function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket?.remoteAddress || 'unknown';
}
