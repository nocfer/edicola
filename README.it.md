[English](README.md) · **Italiano**

# Edicola

Edicola è un'edicola che si installa nel browser. Scegli i paesi che ti
interessano, attivi le testate dal catalogo che l'app porta con sé, e tutto
quello che è già stato scaricato si legge anche senza connessione.

Non c'è un account, non c'è un server nostro e non c'è niente da pagare. L'app
è una cartella di file statici: è il tuo browser a parlare direttamente con gli
editori, e quello che scarica resta nel suo database, su questo dispositivo.

## Cosa fa

Oggi è un'unica sequenza di titoli da tutte le testate che hai attivato, dai
più recenti, raggruppati per giorno. Toccando un titolo si apre la lettura con
l'articolo completo, le sue immagini, il nome della testata e il link alla
pagina dell'editore. Un titolo si segna come letto quando lo apri, non quando
gli scorri davanti. Quello che salvi resta finché non lo togli dai salvati, per
stretti che siano i limiti di conservazione.

Una sincronizzazione scarica il feed di ogni testata attiva e poi gli articoli
dei dieci titoli più recenti di ciascuna, immagini comprese. Parte
all'apertura, se l'ultima è più vecchia di un quarto d'ora, e quando trascini
Oggi verso il basso. Il catalogo contiene trenta testate, quindici italiane e
quindici britanniche, ordinate per paese e poi per categoria. Se ne manca una,
la aggiungi incollando l'indirizzo del sito: il feed lo cerca l'app.

La lingua dell'interfaccia, italiano o inglese, non ha niente a che vedere con
i paesi che segui: un italiano a Londra può tenere i menu in italiano e i
giornali inglesi.

Lo spazio occupato è tenuto a bada dalla conservazione, che si regola nelle
impostazioni. Di serie: trenta giorni, 500 MB in tutto, 5 MB di immagini per
articolo, cinquanta titoli per testata. Quello che esce da questi limiti viene
rimosso, tranne i salvati.

## Cosa non fa

Edicola scarica la pagina che l'editore serve a un visitatore anonimo e butta
via la navigazione, la pubblicità e i banner. Fa solo questo. Non scavalca i
paywall, e non imparerà a farlo: nessun browser finto, nessun cookie preso in
prestito, nessuna copia recuperata dagli archivi
([ADR-0004](docs/adr/0004-extraction-is-reader-mode-only-no-paywall-circumvention.md)).
Se l'editore manda tre paragrafi a chi non è abbonato, tu leggi tre paragrafi,
indicati come sommario e con il link all'originale. Capita spesso: diciassette
dei trenta feed del catalogo portano solo il sommario, quindi l'articolo va
recuperato dalla pagina dell'editore, e a volte lì non c'è niente da
recuperare.

Edicola non si spaccia mai per l'editore. Nella schermata di lettura ci sono
sempre il nome della testata e il link all'originale.

Non ci sono, e non sono previsti: la sincronizzazione fra dispositivi,
l'importazione e l'esportazione OPML, la ricerca negli articoli scaricati, le
notifiche push, i filtri per parola chiave e qualsiasi ordinamento più furbo di
"prima i più recenti".

## Come si installa

Edicola è un sito statico senza build, quindi la serve qualunque server web,
comprese le GitHub Pages. Apri la pagina nel browser e usa il comando di
installazione del browser stesso: "Installa" nella barra degli indirizzi di
Chrome, "Aggiungi alla schermata Home" nel menu di condivisione di Safari.
L'app non te lo chiede e non insiste. Funziona in entrambi i modi: il service
worker mette in cache i file dell'app al primo caricamento, installata o no.

## Leggere senza connessione

I file dell'app (la shell) stanno nella Cache API, quindi Edicola si apre anche
con la rete spenta. Titoli, articoli, immagini, stato di lettura, punto in cui
hai smesso di leggere e impostazioni stanno in un solo database IndexedDB
([ADR-0003](docs/adr/0003-dexie-indexeddb-is-the-single-content-store.md)).
Quello che era già stato scaricato prima che cadesse la connessione c'è; quello
che non c'era non compare, e l'app lo dice invece di girare a vuoto.

Due limiti che vale la pena conoscere. Le miniature delle schede di Oggi non
vengono conservate per scelta, quindi con la cache del browser fredda si
nascondono da sole quando sei offline; le immagini dentro l'articolo invece
sono salvate come blob e si vedono. E il browser può cancellare il database
quando lo spazio stringe: per questo alla prima sincronizzazione l'app chiede
lo spazio persistente. I browser lo concedono a un sito che si è guadagnato un
po' di frequentazione, e un rifiuto non è definitivo, perché Edicola torna a
chiederlo alla sincronizzazione dopo.

## Privacy

Dal dispositivo non esce niente oltre alle richieste che hai chiesto tu: il
feed di ogni testata attiva, la pagina di ogni articolo e le immagini che
contiene
([ADR-0009](docs/adr/0009-no-data-leaves-the-device.md)). Nessuna statistica,
nessun report di errori, nessuna configurazione remota, nessun account, nessun
indirizzo e-mail. Cosa hai letto, dove ti sei fermato e cosa hai salvato sono
righe nel database del tuo browser e non vengono mandate da nessuna parte. Se
cancelli i dati del sito le perdi, e non c'è modo di riaverle: è il prezzo di
non avere un server.

C'è un'eccezione, ed è il motivo della sezione che segue. Quasi nessun editore
manda le intestazioni CORS, quindi il browser non è autorizzato a leggere il
suo feed direttamente. Quelle richieste passano per un relay, e il relay vede
tutti gli indirizzi che scarichi.

## Gestire il proxy per conto tuo

Il proxy, che nelle impostazioni si chiama relay, è l'unico pezzo di
infrastruttura di cui Edicola non può fare a meno. Un'installazione appena
fatta punta a un piccolo Cloudflare Worker pubblico, così l'app funziona prima
di aver configurato qualsiasi cosa:

```
https://cors-get-proxy.sirjosh.workers.dev/?url={url}
```

È il progetto gratuito di qualcun altro. Può limitarti le richieste, smettere
di funzionare per un pomeriggio o spegnersi, e il 07/09/2026 ogni alternativa
provata stava facendo una di queste cose: corsproxy.io aveva iniziato a
chiedere una chiave API, allorigins e codetabs rispondevano Cloudflare 522, e
api.cors.lol limitava già la prima richiesta della giornata. Il relay
predefinito riscrive anche il `content-type` di ogni risposta in `text/plain`;
Edicola lo digerisce, perché guarda l'elemento radice del documento invece di
fidarsi dell'intestazione.

Gestirne uno tuo toglie di mezzo l'estraneo, e con lui il limite di richieste. È
un solo Cloudflare Worker sul piano gratuito, e conviene chiuderlo alla tua
copia di Edicola perché nessun altro possa usarlo come proxy aperto. In
[docs/self-hosted-proxy.md](docs/self-hosted-proxy.md) ci sono il codice, i
passaggi per pubblicarlo e la stringa esatta da incollare in Impostazioni →
Proxy. Appena la salvi, la sincronizzazione successiva la usa, e non cambia
nient'altro.

Se preferisci lasciare il predefinito, la conseguenza è circoscritta ma reale:
un servizio di terzi viene a sapere quali articoli apri, e può spegnersi senza
preavviso.

## Avviare l'app in locale

```
npm start          # un server statico su http://localhost:8000
```

Poi apri <http://localhost:8000/>. I moduli ES non si caricano da `file://`,
quindi aprire `index.html` dal disco non funziona.

Non c'è niente da installare e non c'è un bundler. Le librerie (lit-html,
Dexie, Readability, DOMPurify) arrivano da esm.sh a versione fissata al primo
uso e poi vengono servite dalla cache
([ADR-0002](docs/adr/0002-no-build-vanilla-es-modules-with-cdn-lit-html.md)).

## Aggiungere una testata

Per te, dentro l'app: Testate → Aggiungi da URL. Incolli l'indirizzo del sito o
del feed, Edicola legge i suggerimenti che la pagina espone, ti mostra quello
che ha trovato e attiva quello che scegli.

Per tutti, con una pull request: si aggiunge una voce a `data/catalog.json`. Le
regole, lo schema e i motivi per cui alcuni giornali noti non ci sono stanno in
[docs/catalog.md](docs/catalog.md) (in inglese, come tutto il repository).
Vanno in catalogo solo i feed che l'editore pubblicizza, una voce per testata,
e la CI scarica e legge ogni feed prima del merge. Nuovi paesi sono benvenuti e
non richiedono modifiche al codice.

## Contribuire

In [CONTRIBUTING.md](CONTRIBUTING.md) ci sono i cinque controlli obbligatori,
la regola del fixture prima della correzione e le convenzioni da leggere prima
del primo commit. Le decisioni di architettura sono in
[docs/adr/](docs/adr/), il vocabolario in cui è scritta l'app in
[CONTEXT.md](CONTEXT.md).

## Licenza

MIT.
