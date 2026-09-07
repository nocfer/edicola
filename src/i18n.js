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
  "today.loading": "Opening your newsstand…",
  "today.loadError": "Today could not be read from storage.",
  "today.retry": "Try again",
  "today.neverSynced":
    "Your Publications are on. Refresh to fetch the first Items.",
  "today.offlineEmpty":
    "You are offline and nothing has been downloaded yet. Connect once and Edicola fills up.",
  "today.empty": "Nothing came through on the last refresh. Try again later.",
  "today.emptyFilter": "Nothing from {name} inside the last {days} days.",
  "today.today": "Today",
  "today.yesterday": "Yesterday",
  "today.all": "All",
  "today.refresh": "Refresh",
  "today.filters": "Filter by Publication",
  "today.filterTo": "Show only {name}",
  "today.filterAll": "Show every Publication",
  "today.unreadCount": "{count} unread",
  "today.unread": "Unread",
  "today.moreAria": "More actions for {name}",
  "today.markAllRead": "Mark all read",
  "today.markedAllRead": "{name}: everything marked read.",
  "today.summaryOnly": "Summary only",
  "today.pull": "Pull to refresh",
  "today.release": "Release to refresh",
  "today.refreshing": "Refreshing…",
  "today.bounded":
    "Today keeps the last {days} days. Older Items stay on their Publication.",
  "today.cardAria": "{title} — {publication}, {when}",

  "saved.title": "Saved",
  "saved.placeholder": "Items you save stay here and are never removed.",

  "pubs.title": "Publications",
  "pubs.intro": "Switch on the Publications you want to read.",
  "pubs.loading": "Loading the Catalog…",
  "pubs.loadError": "The Catalog could not be loaded.",
  "pubs.retry": "Try again",
  "pubs.placeholder": "The Catalog is empty. Add a Publication by URL below.",
  "pubs.nations": "Nations",
  "pubs.needNation": "At least one Nation must stay selected.",
  "pubs.enabledCount": "{enabled} of {total} on",
  "pubs.truncated": "full text fetched from the site",
  "pubs.notInCatalog": "no longer in the Catalog",
  "pubs.toggleAria": "Switch {name} on or off",
  "pubs.groupAria": "{category}, {count} Publications",
  "pubs.syncStarted": "Syncing {name}…",
  "pubs.remove": "Remove",
  "pubs.removedToast": "{name} removed.",

  "pubs.category.news": "News",
  "pubs.category.politics": "Politics",
  "pubs.category.business": "Business",
  "pubs.category.technology": "Technology",
  "pubs.category.science": "Science",
  "pubs.category.culture": "Culture",
  "pubs.category.sport": "Sport",
  "pubs.category.local": "Local",
  "pubs.category.custom": "Added by you",

  "pubs.add.title": "Add by URL",
  "pubs.add.hint": "Paste a Publication's address: its site or its Feed.",
  "pubs.add.placeholder": "example.com or example.com/feed",
  "pubs.add.find": "Find Feeds",
  "pubs.add.looking": "Looking for Feeds…",
  "pubs.add.found": "Feeds found",
  "pubs.add.items": "{count} Items",
  "pubs.add.use": "Use this Feed",
  "pubs.add.cancel": "Cancel",
  "pubs.add.confirm": "Add Publication",
  "pubs.add.name": "Name",
  "pubs.add.nation": "Nation",
  "pubs.add.language": "Language",
  "pubs.add.added": "{name} added and switched on.",

  "pubs.error.invalidUrl": "That does not look like a web address.",
  "pubs.error.offline": "You are offline. Connect and try again.",
  "pubs.error.blocked":
    "The publisher refused the request. It may block anonymous readers.",
  "pubs.error.notFound": "There is nothing at that address.",
  "pubs.error.timeout": "The site took too long to answer.",
  "pubs.error.tooLarge": "That document is too large to read.",
  "pubs.error.proxy":
    "No Proxy is configured and the site cannot be reached directly.",
  "pubs.error.noFeed": "No Feed was found at that address.",
  "pubs.error.unknown": "That could not be checked. Try again.",

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
  "today.loading": "Apertura dell'edicola…",
  "today.loadError": "Impossibile leggere Oggi dall'archivio.",
  "today.retry": "Riprova",
  "today.neverSynced":
    "Le tue testate sono attive. Aggiorna per scaricare i primi titoli.",
  "today.offlineEmpty":
    "Sei offline e non è ancora stato scaricato nulla. Collegati una volta e l'edicola si riempie.",
  "today.empty":
    "Nell'ultimo aggiornamento non è arrivato nulla. Riprova più tardi.",
  "today.emptyFilter": "Niente da {name} negli ultimi {days} giorni.",
  "today.today": "Oggi",
  "today.yesterday": "Ieri",
  "today.all": "Tutte",
  "today.refresh": "Aggiorna",
  "today.filters": "Filtra per testata",
  "today.filterTo": "Mostra solo {name}",
  "today.filterAll": "Mostra tutte le testate",
  "today.unreadCount": "{count} da leggere",
  "today.unread": "Da leggere",
  "today.moreAria": "Altre azioni per {name}",
  "today.markAllRead": "Segna tutto come letto",
  "today.markedAllRead": "{name}: tutto segnato come letto.",
  "today.summaryOnly": "Solo sommario",
  "today.pull": "Trascina per aggiornare",
  "today.release": "Rilascia per aggiornare",
  "today.refreshing": "Aggiornamento…",
  "today.bounded":
    "Oggi conserva gli ultimi {days} giorni. I titoli più vecchi restano sulla loro testata.",
  "today.cardAria": "{title} — {publication}, {when}",

  "saved.title": "Salvati",
  "saved.placeholder":
    "Gli articoli che salvi restano qui e non vengono mai rimossi.",

  "pubs.title": "Testate",
  "pubs.intro": "Attiva le testate che vuoi leggere.",
  "pubs.loading": "Caricamento del catalogo…",
  "pubs.loadError": "Impossibile caricare il catalogo.",
  "pubs.retry": "Riprova",
  "pubs.placeholder":
    "Il catalogo è vuoto. Aggiungi una testata da URL qui sotto.",
  "pubs.nations": "Paesi",
  "pubs.needNation": "Almeno un paese deve restare selezionato.",
  "pubs.enabledCount": "{enabled} di {total} attive",
  "pubs.truncated": "il testo completo viene scaricato dal sito",
  "pubs.notInCatalog": "non è più nel catalogo",
  "pubs.toggleAria": "Attiva o disattiva {name}",
  "pubs.groupAria": "{category}, {count} testate",
  "pubs.syncStarted": "Sincronizzazione di {name}…",
  "pubs.remove": "Rimuovi",
  "pubs.removedToast": "{name} rimossa.",

  "pubs.category.news": "Notizie",
  "pubs.category.politics": "Politica",
  "pubs.category.business": "Economia",
  "pubs.category.technology": "Tecnologia",
  "pubs.category.science": "Scienza",
  "pubs.category.culture": "Cultura",
  "pubs.category.sport": "Sport",
  "pubs.category.local": "Locale",
  "pubs.category.custom": "Aggiunte da te",

  "pubs.add.title": "Aggiungi da URL",
  "pubs.add.hint": "Incolla l'indirizzo di una testata: il sito o il feed.",
  "pubs.add.placeholder": "esempio.it o esempio.it/feed",
  "pubs.add.find": "Cerca i feed",
  "pubs.add.looking": "Ricerca dei feed…",
  "pubs.add.found": "Feed trovati",
  "pubs.add.items": "{count} titoli",
  "pubs.add.use": "Usa questo feed",
  "pubs.add.cancel": "Annulla",
  "pubs.add.confirm": "Aggiungi testata",
  "pubs.add.name": "Nome",
  "pubs.add.nation": "Paese",
  "pubs.add.language": "Lingua",
  "pubs.add.added": "{name} aggiunta e attivata.",

  "pubs.error.invalidUrl": "Non sembra un indirizzo web.",
  "pubs.error.offline": "Sei offline. Connettiti e riprova.",
  "pubs.error.blocked":
    "L'editore ha rifiutato la richiesta: può bloccare i lettori anonimi.",
  "pubs.error.notFound": "A quell'indirizzo non c'è nulla.",
  "pubs.error.timeout": "Il sito ha risposto troppo lentamente.",
  "pubs.error.tooLarge": "Il documento è troppo grande da leggere.",
  "pubs.error.proxy":
    "Nessun proxy configurato e il sito non è raggiungibile direttamente.",
  "pubs.error.noFeed": "Nessun feed trovato a quell'indirizzo.",
  "pubs.error.unknown": "Controllo non riuscito. Riprova.",

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
