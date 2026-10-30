# Consigli di classe

PWA in italiano per le classi 1A, 1B, 1C, 1M, 1N, 2B, 2C, 2D, 2E e 3A dell'IPSIA Dalmazio Birago.

## Cosa fa

- Una GitHub Action controlla ogni giorno la sezione pubblica delle circolari.
- Lo scanner cerca le convocazioni dei consigli, legge gli allegati PDF e seleziona gli orari delle classi configurate.
- La webapp mostra gli eventi trovati. L'inserimento avviene solo dopo aver selezionato gli eventi e aver premuto **Aggiungi selezionati**.
- Se una circolare aggiorna data o orario, la nuova versione viene proposta di nuovo; alla conferma l'evento Google Calendar esistente viene aggiornato invece di duplicarsi.
- L'app si può aggiungere alla schermata Home del telefono. L'installazione non attiva controlli in background sul dispositivo: il controllo giornaliero avviene su GitHub Actions.

## Dati iniziali

`public/data/convocations.json` contiene gli orari delle dieci classi estratti dalla circolare 46/DIDA di novembre 2026 fornita dall'utente. Il controllo automatico aggiornerà il feed quando troverà circolari pertinenti.

## Pubblicazione su GitHub Pages

1. Crea un repository GitHub (per esempio `consigli-classe-calendar`) e carica il contenuto di questa cartella.
2. In **Settings → Pages**, seleziona **GitHub Actions** come sorgente.
3. In **Settings → Actions → General → Workflow permissions**, abilita il permesso di lettura e scrittura dei contenuti: lo scanner aggiorna il feed nel repository.
4. Crea un progetto Google Cloud, abilita Google Calendar API e configura la schermata di consenso OAuth.
5. Crea un OAuth Client ID di tipo **Web application** e inserisci l'origine `https://NOME-UTENTE.github.io` tra le origini JavaScript autorizzate. Il client OAuth web usa un Client ID pubblico, non un client secret nella pagina.
6. Copia il Client ID in `public/config.js` al posto di `INSERISCI_CLIENT_ID.apps.googleusercontent.com`, quindi carica la modifica.
7. Dopo la prima pubblicazione, apri il sito su Android Chrome e scegli **Installa app** o **Aggiungi a schermata Home**.

La prima autorizzazione Google richiede il tuo accesso e il consenso a creare o aggiornare eventi nel calendario principale. Il token resta nella memoria della scheda e non viene salvato nel repository.

## Controllo programmato

`.github/workflows/check-circolari.yml` esegue il controllo ogni giorno alle 06:10 UTC (circa 07:10 in inverno e 08:10 in estate in Italia). GitHub può avviare i controlli programmati con ritardo. È disponibile anche l'avvio manuale dalla scheda **Actions**.

La versione iniziale non invia notifiche push quando il browser è chiuso: gli eventi rilevati si vedono aprendo la webapp. Le circolari nuove possono essere verificate anche dal link al sito della scuola dentro l'app.

## Note tecniche

- Il feed degli orari è pubblico perché viene servito da GitHub Pages. Non include credenziali Google o dati di accesso ad Argo.
- Lo scanner considera le prime pagine recenti della sezione Circolari, cerca titoli sui consigli di classe e legge gli allegati PDF pubblici.
- La data e l'orario vengono ricalcolati con il fuso `Europe/Rome`, inclusa l'ora legale.
- Se una convocazione è in un PDF scannerizzato o con una tabella non leggibile automaticamente, il riepilogo della circolare resta disponibile per la verifica manuale.
