'use strict';

function parseBackendMessage(line) {
  if (Buffer.byteLength(line) > 65536) throw Error('Backend message exceeds the maximum size.');
  const message = JSON.parse(line);
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw Error('Invalid backend message.');
  if (message.type === 'error') {
    if (typeof message.message !== 'string' || !message.message.trim()) throw Error('Invalid backend error message.');
    return { type: 'error', message: message.message.slice(0, 8192) };
  }
  if (message.type !== 'ready' || typeof message.url !== 'string') throw Error('Unexpected backend message.');
  const url = new URL(message.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Backend must report a local HTTP application URL.');
  return { type: 'ready', url: url.href };
}

function isAppNavigation(value, origin) {
  try { const url = new URL(value); return url.protocol === 'http:' && !url.username && !url.password && url.origin === origin; }
  catch { return false; }
}

function externalHTTPS(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

function stopBackend(child, { timeoutMs = 10000, onStopped, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let done = false, timer, forced = false;
  const finish = confirmed => { if (done) return; done = true; if (timer) clearTimer(timer); onStopped({ confirmed, forced }); };
  if (!child || child.exitCode !== null || child.signalCode !== null) { finish(true); return; }
  child.once('exit', () => finish(true));
  child.stdin?.once?.('error', () => { /* An asynchronous EPIPE must not interrupt the exit/termination wait. */ });
  timer = setTimer(() => {
    forced = true;
    try { child.kill('SIGKILL'); } catch { /* The final timeout reports that termination was not confirmed. */ }
    if (!done) timer = setTimer(() => finish(false), 1000);
  }, timeoutMs);
  try { child.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`); child.stdin.end(); }
  catch { /* EOF or process exit will still trigger the server's shutdown path. */ }
}

module.exports = { parseBackendMessage, isAppNavigation, externalHTTPS, stopBackend };
