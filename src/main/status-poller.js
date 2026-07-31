'use strict';

/**
 * Single source of truth for proxy status, feeding both the window (via
 * broadcast) and the tray. One interval, not one per consumer.
 */
function startStatusPoller({ pm2Control, onStatus, intervalMs = 5000 }) {
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      const status = await pm2Control.getStatus();
      onStatus(status);
    } catch {
      onStatus({ status: 'errored' });
    }
  }

  tick();
  const timer = setInterval(tick, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

module.exports = { startStatusPoller };
