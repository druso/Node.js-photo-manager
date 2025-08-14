// Global console timestamp prefixer
// Replaces console methods to add an ISO timestamp at the beginning of every line.
// Usage: require this module as early as possible in the server startup.

(function attachTimestampConsole() {
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const originals = {};

  const timestamp = () => new Date().toISOString();

  for (const m of methods) {
    originals[m] = console[m].bind(console);
    console[m] = function (...args) {
      // Prefix timestamp; keep original formatting for rest of args
      originals[m](`[${timestamp()}]`, ...args);
    };
  }
})();
