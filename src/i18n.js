// UI Language (ADR-0006): English and Italian dictionaries, `t()` lookup, the
// static-copy translator for index.html, and Intl helpers for dates.
//
// Conventions for later screens:
// - Keys are `<screen>.<thing>` (`today.title`, `reader.back`); the screen
//   tickets own their prefix. Shared chrome lives under `app.*` and `nav.*`.
// - Every key must exist in both dictionaries; test/i18n.test.js enforces it.
// - `{name}` placeholders are interpolated by `t(key, { name })`.
// - Strings never carry markup unless rendered through `unsafeHTML` or set from
//   a `data-i18n-html` attribute (first-party copy only).
// - The codebase is English; the `it` table below is the only Italian in src/.

export const en = {
  "app.name": "Edicola",
  "app.tagline": "Your newsstand, offline.",
  "app.loading": "Loading…",
  "app.offline": "Offline",

  "nav.aria": "Sections",
  "nav.today": "Today",
  "nav.saved": "Saved",
  "nav.publications": "Publications",
  "nav.settings": "Settings",

  "today.title": "Today",
  "today.placeholder":
    "Nothing here yet. Switch on some Publications to fill your newsstand.",
  "today.choosePublications": "Choose Publications",

  "saved.title": "Saved",
  "saved.placeholder": "Items you save stay here and are never removed.",

  "pubs.title": "Publications",
  "pubs.placeholder": "The Catalog of Publications will appear here.",

  "settings.title": "Settings",
  "settings.appearance": "Appearance",
  "settings.theme": "Theme",
  "settings.theme.system": "System",
  "settings.theme.light": "Light",
  "settings.theme.dark": "Dark",
  "settings.language": "Language",
  "settings.language.en": "English",
  "settings.language.it": "Italiano",

  "sync.title": "Sync",
  "sync.now": "Sync now",
  "sync.running": "Syncing…",
  "sync.lastSynced": "Last synced",
  "sync.never": "Never",
  "sync.feeds": "Feeds {done} of {total}",
  "sync.articles": "Articles {done} of {total}",
  "sync.summary": "{items} Items, {articles} Articles, {images} images",
  "sync.failed": "{count} Feeds could not be reached",
  "sync.error": "Sync could not finish. Check your connection.",

  "reader.title": "Reader",
  "reader.back": "Back",
  "reader.placeholder": "Article {id} will be shown here.",

  "notFound.title": "Page not found",
  "notFound.body": "That address does not exist in Edicola.",
  "notFound.home": "Go to Today",
};

export const it = {
  "app.name": "Edicola",
  "app.tagline": "La tua edicola, anche offline.",
  "app.loading": "Caricamento…",
  "app.offline": "Offline",

  "nav.aria": "Sezioni",
  "nav.today": "Oggi",
  "nav.saved": "Salvati",
  "nav.publications": "Testate",
  "nav.settings": "Impostazioni",

  "today.title": "Oggi",
  "today.placeholder":
    "Ancora niente qui. Attiva qualche testata per riempire la tua edicola.",
  "today.choosePublications": "Scegli le testate",

  "saved.title": "Salvati",
  "saved.placeholder":
    "Gli articoli che salvi restano qui e non vengono mai rimossi.",

  "pubs.title": "Testate",
  "pubs.placeholder": "Qui comparirà il catalogo delle testate.",

  "settings.title": "Impostazioni",
  "settings.appearance": "Aspetto",
  "settings.theme": "Tema",
  "settings.theme.system": "Sistema",
  "settings.theme.light": "Chiaro",
  "settings.theme.dark": "Scuro",
  "settings.language": "Lingua",
  "settings.language.en": "English",
  "settings.language.it": "Italiano",

  "sync.title": "Sincronizzazione",
  "sync.now": "Sincronizza ora",
  "sync.running": "Sincronizzazione…",
  "sync.lastSynced": "Ultima sincronizzazione",
  "sync.never": "Mai",
  "sync.feeds": "Feed {done} di {total}",
  "sync.articles": "Articoli {done} di {total}",
  "sync.summary": "{items} titoli, {articles} articoli, {images} immagini",
  "sync.failed": "{count} feed non raggiungibili",
  "sync.error": "Sincronizzazione non completata. Controlla la connessione.",

  "reader.title": "Lettura",
  "reader.back": "Indietro",
  "reader.placeholder": "Qui verrà mostrato l'articolo {id}.",

  "notFound.title": "Pagina non trovata",
  "notFound.body": "Questo indirizzo non esiste in Edicola.",
  "notFound.home": "Vai a Oggi",
};

/** @typedef {'en'|'it'} Lang */

export const DICTIONARIES = { en, it };

/** @type {Lang[]} */
export const LANGS = ["en", "it"];

/** BCP 47 tags handed to Intl for each Language (the seed Nations: GB, IT). */
export const LOCALES = { en: "en-GB", it: "it-IT" };

/** localStorage key shared with the pre-paint script in index.html. */
export const LANG_KEY = "edicola.lang";

/** @type {Lang} */
let lang = "en";

/** Narrow an arbitrary value to a Lang, or null. */
function asLang(value) {
  return value === "en" || value === "it" ? value : null;
}

/**
 * Pick the Language at boot: the saved one, else the browser's (Italian when
 * the browser is Italian, English otherwise). Mirrors the pre-paint script.
 * @returns {Lang}
 */
export function initLang() {
  try {
    const saved = asLang(localStorage.getItem(LANG_KEY));
    if (saved) lang = saved;
    else {
      const nav = (navigator.language || "en").toLowerCase();
      lang = nav.startsWith("it") ? "it" : "en";
    }
  } catch {
    lang = "en";
  }
  return lang;
}

/** @returns {Lang} */
export function getLang() {
  return lang;
}

/**
 * Set and persist the Language. Does not touch the DOM: main.js re-renders and
 * calls `applyStaticI18n()` when `state.lang` changes.
 * @param {string} next
 * @returns {Lang}
 */
export function setLang(next) {
  lang = asLang(next) || "en";
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Private mode or storage disabled: the choice lasts for this session only.
  }
  return lang;
}

/**
 * Translate a key in the current Language, falling back to English and then
 * to the key itself. `{name}` placeholders are replaced from `params`.
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
export function t(key, params) {
  const table = DICTIONARIES[lang] || en;
  let s = key in table ? table[key] : key in en ? en[key] : key;
  if (params) {
    for (const k in params) s = s.split(`{${k}}`).join(String(params[k]));
  }
  return s;
}

/**
 * Translate the static copy in index.html. Attributes:
 * `data-i18n` → textContent, `data-i18n-html` → innerHTML (first-party copy
 * only), `data-i18n-ph` → placeholder, `data-i18n-aria` → aria-label + title.
 * @param {ParentNode} [root]
 */
export function applyStaticI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const s = t(el.getAttribute("data-i18n-aria"));
    el.setAttribute("aria-label", s);
    el.setAttribute("title", s);
  });
}

/** @param {Date|number|string} value */
function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Format a date for the current Language with `Intl.DateTimeFormat`.
 * @param {Date|number|string} value
 * @param {Intl.DateTimeFormatOptions} [options]  default: medium date
 * @returns {string}
 */
export function formatDate(value, options = { dateStyle: "medium" }) {
  return new Intl.DateTimeFormat(LOCALES[lang], options).format(toDate(value));
}

// Largest unit first; anything under a minute reads as "now".
const RELATIVE_UNITS =
  /** @type {Array<[Intl.RelativeTimeFormatUnit, number]>} */ ([
    ["year", 365 * 86400],
    ["month", 30 * 86400],
    ["week", 7 * 86400],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ]);

/**
 * "3 hours ago", "yesterday", "in 2 days" in the current Language via
 * `Intl.RelativeTimeFormat` with `numeric: "auto"`.
 * @param {Date|number|string} value
 * @param {Date|number} [now]
 * @returns {string}
 */
export function formatRelative(value, now = Date.now()) {
  const seconds = (toDate(value).getTime() - toDate(now).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(LOCALES[lang], { numeric: "auto" });
  const abs = Math.abs(seconds);
  for (const [unit, size] of RELATIVE_UNITS) {
    if (abs >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(0, "second");
}
