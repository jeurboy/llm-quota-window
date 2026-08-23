// Minimal in-process pub/sub so provider modules can notify the app shell
// (renderer windows, quota refresh) without depending on main.js directly.
const listeners = new Map();

function subscribe(channel, listener) {
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel).add(listener);
  return () => listeners.get(channel)?.delete(listener);
}

function publish(channel, payload) {
  for (const listener of listeners.get(channel) || []) {
    try {
      listener(payload);
    } catch {
      // A faulty listener must not break the publisher.
    }
  }
}

module.exports = { subscribe, publish };
