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
  "saved.loading": "Opening your Saved Items…",
  "saved.loadError": "Saved could not be read from storage.",
  "saved.retry": "Try again",
  "saved.empty": "Nothing Saved yet.",
  "saved.emptyBody":
    "Save an Item from the Reader and it stays here. A Saved Item and its Article are never removed, however old they get or how full storage becomes.",
  "saved.toToday": "Go to Today",
  "saved.count": "{count} Saved",
  "saved.savedWhen": "Saved {when}",
  "saved.unread": "Unread",
  "saved.summaryOnly": "Summary only",
  "saved.unsave": "Unsave",
  "saved.unsaveAria": "Unsave {title}",
  "saved.unsavedToast": "Unsaved. This Item can be removed again by Retention.",
  "saved.unsaveFailed": "That could not be unsaved.",
  "saved.cardAria": "{title} — {publication}, saved {when}",

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
  "reader.loading": "Opening the article…",
  "reader.loadError": "This Item could not be read from storage.",
  "reader.retry": "Try again",
  "reader.missing": "This Item is no longer in your newsstand.",
  "reader.toToday": "Go to Today",
  "reader.original": "Open original",
  "reader.originalAria": "Open the original on {publication}",
  "reader.source": "From {publication}",
  "reader.words": "{count} words",
  "reader.save": "Save",
  "reader.saved": "Saved",
  "reader.saveAria": "Save this Item",
  "reader.unsaveAria": "Remove from Saved",
  "reader.savedToast": "Saved. This Item and its Article are never removed.",
  "reader.unsavedToast": "Removed from Saved.",
  "reader.saveFailed": "That could not be saved.",
  "reader.share": "Share",
  "reader.shareCopied": "Link copied.",
  "reader.shareFailed": "The link could not be shared.",
  "reader.summaryTitle": "Summary",
  "reader.summaryOnly": "Summary only",
  "reader.summaryOnlyBody":
    "This publisher does not send the full article to non-subscribers.",
  "reader.noSummary": "This Item came without a Summary as well.",
  "reader.notFetched": "The full article has not been fetched yet.",
  "reader.fetching": "Fetching the full article…",
  "reader.fetchArticle": "Fetch the full article",
  "reader.fetchFailed": "The full article could not be fetched.",
  "reader.offline": "You are offline, so the full article cannot be fetched.",
  "reader.reason.no-content":
    "The page carried no article text: it may be an index, a video or a photo gallery.",
  "reader.reason.too-short": "The page carried only a teaser.",
  "reader.reason.blocked": "The publisher refused the request.",
  "reader.reason.not-found": "The original page is gone.",
  "reader.reason.offline": "There was no connection when Edicola tried.",
  "reader.reason.timeout": "The site took too long to answer.",
  "reader.reason.too-large": "The page was too large to read.",
  "reader.reason.proxy-unconfigured":
    "No Proxy is configured and the site cannot be reached directly.",
  "reader.reason.no-link": "The Feed gave no address for this Item.",

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
  "saved.loading": "Apertura dei salvati…",
  "saved.loadError": "Impossibile leggere i salvati dall'archivio.",
  "saved.retry": "Riprova",
  "saved.empty": "Non hai ancora salvato nulla.",
  "saved.emptyBody":
    "Salva un titolo dal lettore e resta qui. Un titolo salvato e il suo articolo non vengono mai rimossi, per vecchi che siano e per quanto pieno sia l'archivio.",
  "saved.toToday": "Vai a Oggi",
  "saved.count": "{count} salvati",
  "saved.savedWhen": "Salvato {when}",
  "saved.unread": "Da leggere",
  "saved.summaryOnly": "Solo sommario",
  "saved.unsave": "Rimuovi",
  "saved.unsaveAria": "Rimuovi {title} dai salvati",
  "saved.unsavedToast":
    "Rimosso dai salvati. Ora la conservazione può eliminarlo.",
  "saved.unsaveFailed": "Impossibile rimuoverlo dai salvati.",
  "saved.cardAria": "{title} — {publication}, salvato {when}",

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
  "reader.loading": "Apertura dell'articolo…",
  "reader.loadError": "Questo titolo non è leggibile dall'archivio.",
  "reader.retry": "Riprova",
  "reader.missing": "Questo titolo non è più nella tua edicola.",
  "reader.toToday": "Vai a Oggi",
  "reader.original": "Apri l'originale",
  "reader.originalAria": "Apri l'originale su {publication}",
  "reader.source": "Da {publication}",
  "reader.words": "{count} parole",
  "reader.save": "Salva",
  "reader.saved": "Salvato",
  "reader.saveAria": "Salva questo titolo",
  "reader.unsaveAria": "Togli dai salvati",
  "reader.savedToast":
    "Salvato. Questo titolo e il suo articolo non vengono mai rimossi.",
  "reader.unsavedToast": "Rimosso dai salvati.",
  "reader.saveFailed": "Non è stato possibile salvare.",
  "reader.share": "Condividi",
  "reader.shareCopied": "Link copiato.",
  "reader.shareFailed": "Non è stato possibile condividere il link.",
  "reader.summaryTitle": "Sommario",
  "reader.summaryOnly": "Solo sommario",
  "reader.summaryOnlyBody":
    "Questa testata non invia l'articolo completo a chi non è abbonato.",
  "reader.noSummary": "Questo titolo è arrivato anche senza sommario.",
  "reader.notFetched": "L'articolo completo non è ancora stato recuperato.",
  "reader.fetching": "Recupero dell'articolo completo…",
  "reader.fetchArticle": "Recupera l'articolo completo",
  "reader.fetchFailed": "Non è stato possibile recuperare l'articolo completo.",
  "reader.offline":
    "Sei offline: l'articolo completo non può essere recuperato ora.",
  "reader.reason.no-content":
    "La pagina non conteneva testo dell'articolo: può essere un indice, un video o una galleria fotografica.",
  "reader.reason.too-short": "La pagina conteneva solo un'anteprima.",
  "reader.reason.blocked": "La testata ha rifiutato la richiesta.",
  "reader.reason.not-found": "La pagina originale non esiste più.",
  "reader.reason.offline": "Non c'era connessione quando Edicola ha provato.",
  "reader.reason.timeout": "Il sito ha risposto troppo lentamente.",
  "reader.reason.too-large": "La pagina era troppo grande da leggere.",
  "reader.reason.proxy-unconfigured":
    "Nessun proxy configurato e il sito non è raggiungibile direttamente.",
  "reader.reason.no-link":
    "Il feed non ha indicato un indirizzo per questo titolo.",

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
