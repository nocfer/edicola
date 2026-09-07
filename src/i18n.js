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

  "settings.proxy": "Proxy",
  "settings.proxy.about":
    "Feeds and Articles are fetched from the publisher directly whenever it allows it, and through a relay when it does not. Nothing else leaves your device.",
  "settings.proxy.default": "Default relay",
  "settings.proxy.defaultNote":
    "The default relay is a small community service and can go away without notice. It also rewrites every response to text/plain, which Edicola parses anyway. Running your own is one click.",
  "settings.proxy.inUse": "In use",
  "settings.proxy.usingDefault": "The default relay",
  "settings.proxy.usingCustom": "Your own relay",
  "settings.proxy.custom": "Your own relay",
  "settings.proxy.hint":
    "A full URL containing {url}, where the address to fetch goes.",
  "settings.proxy.save": "Save",
  "settings.proxy.useDefault": "Use the default",
  "settings.proxy.test": "Test",
  "settings.proxy.testing": "Testing…",
  "settings.proxy.testOk": "Works: a real Feed came back ({bytes}).",
  "settings.proxy.testDirect":
    "That Feed was reachable without a relay, so the relay was not tested.",
  "settings.proxy.testFailed": "No Feed came back ({kind}).",
  "settings.proxy.saved": "Proxy saved",
  "settings.proxy.selfHost": "How to run your own relay",
  "settings.proxy.invalid.missing-placeholder":
    "The template must contain {url}.",
  "settings.proxy.invalid.malformed": "That is not a valid address.",
  "settings.proxy.invalid.insecure-scheme":
    "Use https. Plain http only works on localhost.",

  "settings.retention": "Retention",
  "settings.retention.about":
    "How much Edicola keeps. Saved Items are never removed, whatever these say.",
  "settings.retention.maxAgeDays": "Days kept",
  "settings.retention.maxTotalBytes": "Total size cap",
  "settings.retention.maxImageBytesPerArticle": "Images per Article",
  "settings.retention.keepPerPublication": "Items per Publication",
  "settings.retention.prefetchPerPublication": "Pre-fetch per Publication",
  "settings.retention.unit.days": "days",
  "settings.retention.unit.bytes": "MB",
  "settings.retention.unit.items": "Items",
  "settings.retention.default": "default {value}",
  "settings.retention.save": "Save",
  "settings.retention.reset": "Restore defaults",
  "settings.retention.saved": "Retention saved",
  "settings.retention.evicted": "Retention saved — {count} Items removed",
  "settings.retention.evictionPending":
    "Retention saved. The smaller limits apply at the next Sync.",

  "settings.storage": "Storage",
  "settings.storage.about":
    "Everything Edicola stores lives in one database on this device (ADR-0003). The browser reports a padded total for the whole site; the breakdown is measured from the rows.",
  "settings.storage.used": "Reported by the browser",
  "settings.storage.quota": "Available to this site",
  "settings.storage.content": "Measured content",
  "settings.storage.unknown": "Unknown",
  "settings.storage.persistent": "Persistent storage",
  "settings.storage.persistent.granted": "Granted",
  "settings.storage.persistent.denied": "Not granted yet",
  "settings.storage.persistent.unsupported": "Not supported here",
  "settings.storage.persistent.unknown": "Not asked yet",
  "settings.storage.savedItems": "Saved Items",
  "settings.storage.tables": "By table",
  "settings.storage.rows": "{rows} rows",
  "settings.storage.measure": "Measure",
  "settings.storage.measuring": "Measuring…",
  "settings.storage.table.publications": "Publications",
  "settings.storage.table.items": "Items",
  "settings.storage.table.articles": "Articles",
  "settings.storage.table.images": "Images",
  "settings.storage.table.settings": "Settings",
  "settings.storage.table.meta": "Meta",
  "settings.storage.clear": "Clear all content",
  "settings.storage.clear.hint":
    "Removes every Item, Article and image. Your Enabled Publications and these settings stay.",
  "settings.storage.clear.confirm":
    "Remove every Item, Article and image? Your Enabled Publications and settings stay. Saved Items go too.",
  "settings.storage.clear.done": "Content cleared",
  "settings.storage.reset": "Reset app",
  "settings.storage.reset.hint":
    "Deletes the database and every preference, then reloads. The app itself stays installed and still opens offline.",
  "settings.storage.reset.confirm":
    "Delete everything, including your Enabled Publications, Saved Items and settings? This cannot be undone.",

  "settings.sync.noPublications": "No Publications enabled yet",
  "settings.sync.choose": "Choose Publications",

  "settings.update.available": "New version available",
  "settings.update.reload": "Reload",
  "settings.update.applying": "Updating…",
  "settings.update.later": "Later",

  "settings.about": "About",
  "settings.about.version": "Version",
  "settings.about.schema": "Database schema",
  "settings.about.shell": "Shell",
  "settings.error": "That did not work. Try again.",

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

  "settings.proxy": "Proxy",
  "settings.proxy.about":
    "I feed e gli articoli vengono scaricati direttamente dall'editore quando è possibile, e attraverso un relay quando non lo è. Nient'altro lascia questo dispositivo.",
  "settings.proxy.default": "Relay predefinito",
  "settings.proxy.defaultNote":
    "Il relay predefinito è un piccolo servizio della comunità e può sparire senza preavviso. Riscrive anche ogni risposta in text/plain, che Edicola interpreta comunque. Metterne in piedi uno tuo richiede un clic.",
  "settings.proxy.inUse": "In uso",
  "settings.proxy.usingDefault": "Il relay predefinito",
  "settings.proxy.usingCustom": "Il tuo relay",
  "settings.proxy.custom": "Il tuo relay",
  "settings.proxy.hint":
    "Un indirizzo completo che contiene {url}, dove va la pagina da scaricare.",
  "settings.proxy.save": "Salva",
  "settings.proxy.useDefault": "Usa il predefinito",
  "settings.proxy.test": "Prova",
  "settings.proxy.testing": "Prova in corso…",
  "settings.proxy.testOk": "Funziona: è arrivato un feed vero ({bytes}).",
  "settings.proxy.testDirect":
    "Quel feed era raggiungibile senza relay, quindi il relay non è stato provato.",
  "settings.proxy.testFailed": "Nessun feed è arrivato ({kind}).",
  "settings.proxy.saved": "Proxy salvato",
  "settings.proxy.selfHost": "Come gestire il tuo relay",
  "settings.proxy.invalid.missing-placeholder":
    "Il modello deve contenere {url}.",
  "settings.proxy.invalid.malformed": "Non è un indirizzo valido.",
  "settings.proxy.invalid.insecure-scheme":
    "Usa https. Il semplice http funziona solo su localhost.",

  "settings.retention": "Conservazione",
  "settings.retention.about":
    "Quanto Edicola conserva. Gli articoli salvati non vengono mai rimossi, qualunque cosa dicano questi limiti.",
  "settings.retention.maxAgeDays": "Giorni conservati",
  "settings.retention.maxTotalBytes": "Spazio massimo totale",
  "settings.retention.maxImageBytesPerArticle": "Immagini per articolo",
  "settings.retention.keepPerPublication": "Titoli per testata",
  "settings.retention.prefetchPerPublication": "Pre-scaricati per testata",
  "settings.retention.unit.days": "giorni",
  "settings.retention.unit.bytes": "MB",
  "settings.retention.unit.items": "titoli",
  "settings.retention.default": "predefinito {value}",
  "settings.retention.save": "Salva",
  "settings.retention.reset": "Ripristina i predefiniti",
  "settings.retention.saved": "Conservazione salvata",
  "settings.retention.evicted":
    "Conservazione salvata — {count} titoli rimossi",
  "settings.retention.evictionPending":
    "Conservazione salvata. I limiti più bassi valgono dalla prossima sincronizzazione.",

  "settings.storage": "Spazio",
  "settings.storage.about":
    "Tutto ciò che Edicola conserva vive in un solo database su questo dispositivo (ADR-0003). Il browser dichiara un totale arrotondato per tutto il sito; il dettaglio è misurato sulle righe.",
  "settings.storage.used": "Dichiarato dal browser",
  "settings.storage.quota": "Disponibile per questo sito",
  "settings.storage.content": "Contenuti misurati",
  "settings.storage.unknown": "Non disponibile",
  "settings.storage.persistent": "Spazio persistente",
  "settings.storage.persistent.granted": "Concesso",
  "settings.storage.persistent.denied": "Non ancora concesso",
  "settings.storage.persistent.unsupported": "Non supportato qui",
  "settings.storage.persistent.unknown": "Non ancora richiesto",
  "settings.storage.savedItems": "Articoli salvati",
  "settings.storage.tables": "Per tabella",
  "settings.storage.rows": "{rows} righe",
  "settings.storage.measure": "Misura",
  "settings.storage.measuring": "Misurazione…",
  "settings.storage.table.publications": "Testate",
  "settings.storage.table.items": "Titoli",
  "settings.storage.table.articles": "Articoli",
  "settings.storage.table.images": "Immagini",
  "settings.storage.table.settings": "Impostazioni",
  "settings.storage.table.meta": "Meta",
  "settings.storage.clear": "Cancella i contenuti",
  "settings.storage.clear.hint":
    "Rimuove ogni titolo, articolo e immagine. Le testate attive e queste impostazioni restano.",
  "settings.storage.clear.confirm":
    "Rimuovere ogni titolo, articolo e immagine? Le testate attive e le impostazioni restano. Anche gli articoli salvati vengono rimossi.",
  "settings.storage.clear.done": "Contenuti cancellati",
  "settings.storage.reset": "Reimposta l'app",
  "settings.storage.reset.hint":
    "Cancella il database e ogni preferenza, poi ricarica. L'app resta installata e si apre ancora offline.",
  "settings.storage.reset.confirm":
    "Cancellare tutto, comprese le testate attive, gli articoli salvati e le impostazioni? L'operazione è definitiva.",

  "settings.sync.noPublications": "Nessuna testata ancora attiva",
  "settings.sync.choose": "Scegli le testate",

  "settings.update.available": "Nuova versione disponibile",
  "settings.update.reload": "Ricarica",
  "settings.update.applying": "Aggiornamento…",
  "settings.update.later": "Più tardi",

  "settings.about": "Informazioni",
  "settings.about.version": "Versione",
  "settings.about.schema": "Schema del database",
  "settings.about.shell": "Shell",
  "settings.error": "Non ha funzionato. Riprova.",

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
