// Ambient declarations for the few globals the app stashes on `window`.
// Type-only; no runtime effect. Keeps checkJs (jsconfig.json) honest.

interface Window {
  /** Set by main.js once boot succeeds; read by the self-heal watchdog in index.html. */
  __edicolaBooted?: boolean;
}
