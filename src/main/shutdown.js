'use strict';

/**
 * Stopping the LiteLLM proxy on the way out (NCOW-4).
 *
 * This reverses the app's original behaviour, where the pm2-supervised proxy
 * deliberately outlived the GUI. Quitting now takes the proxy with it, so
 * Claude Desktop and the Claude Code CLI stop routing through NIM once the
 * manager is closed — that is the intended trade, not an oversight.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It never kills the pm2 daemon. pm2 here runs against the shared default
 *    PM2_HOME (~/.pm2), so `pm2 kill` would take down every *other* app the
 *    user supervises with pm2. Only the litellm-nim app is stopped; the daemon
 *    is left exactly as any other pm2 user leaves it.
 *  - It never blocks the quit indefinitely. A wedged or unreachable pm2 must
 *    not make the app unquittable, so the stop is bounded and shutdown
 *    continues regardless of the outcome.
 *  - It never force-kills litellm itself. pm2 already escalates SIGINT to
 *    SIGKILL after the ecosystem file's kill_timeout, so a second killer here
 *    would only race the daemon that owns the process.
 *
 * Written as a factory over injected dependencies so it is unit-testable
 * without a live pm2 daemon, matching the engine modules.
 *
 * @param {{pm2Control: {getStatus: () => Promise<{status: string}>, stop: () => Promise<any>, disconnect?: () => void}, timeoutMs?: number, log?: (msg: string) => void}} deps
 */
function createProxyShutdown(deps) {
  // Deliberately above the generated ecosystem config's kill_timeout (10s).
  // pm2 is the thing that escalates SIGINT to SIGKILL when litellm refuses to
  // exit, so timing out at or below that would abandon the stop right before
  // pm2's own forced kill lands, and report a failure that was about to
  // succeed. Overshooting costs nothing: the common case returns in well under
  // a second.
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const log = deps.log ?? ((msg) => console.log(`[shutdown] ${msg}`));

  function withTimeout(promise) {
    let timer;
    const timeout = new Promise((_, reject) => {
      // Deliberately not unref'd: this timer is the only thing that will ever
      // settle the race when pm2 hangs, so letting the loop exit past it is
      // exactly the hang it exists to prevent. The finally below clears it.
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /**
   * @returns {Promise<{stopped: boolean, reason: string}>} Always resolves —
   *   the caller is quitting either way, so a rejection here would only ever
   *   translate into a hung exit.
   */
  return async function stopProxyForShutdown() {
    try {
      // Asking first is what makes quitting a genuine no-op when the proxy is
      // already stopped or was never set up: pm2.stop() on an unknown app name
      // errors, and an error on the quit path is pure noise.
      const { status } = await withTimeout(deps.pm2Control.getStatus());
      if (status !== 'running') {
        log(`proxy is ${status}; nothing to stop`);
        return { stopped: false, reason: status };
      }

      await withTimeout(deps.pm2Control.stop());
      log('proxy stopped');
      return { stopped: true, reason: 'stopped' };
    } catch (err) {
      // Quitting anyway is the point — see the header.
      log(`could not stop the proxy, quitting regardless: ${err.message}`);
      return { stopped: false, reason: 'failed' };
    } finally {
      try {
        deps.pm2Control.disconnect?.();
      } catch {
        // A failed disconnect cannot be allowed to hold up the exit either.
      }
    }
  };
}

module.exports = { createProxyShutdown };
