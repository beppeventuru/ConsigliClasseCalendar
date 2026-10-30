(() => {
  const classes = ['1A','1B','1C','1M','1N','2B','2C','2D','2E','3A'];
  const storageKey = 'consigli-classe-added-v1';
  const state = {events: [], tokenClient: null, token: null, apiReady: false, gisReady: false, installPrompt: null};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const addedSet = () => new Set(JSON.parse(localStorage.getItem(storageKey) || '[]'));
  function romeOffset(date, time) {
    const instant = new Date(`${date}T${time}:00`);
    const part = new Intl.DateTimeFormat('en', {timeZone:'Europe/Rome', timeZoneName:'shortOffset'}).formatToParts(instant).find(p => p.type === 'timeZoneName')?.value || 'GMT+1';
    const match = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    return match ? `${match[1]}${match[2].padStart(2,'0')}:${match[3] || '00'}` : '+01:00';
  }

  function render() {
    const list = $('eventsList');
    const alreadyAdded = addedSet();
    const fresh = state.events.filter(e => !alreadyAdded.has(e.key));
    $('pendingCount').textContent = fresh.length;
    $('eventHeading').textContent = fresh.length ? 'Eventi trovati' : 'Nessun nuovo evento';
    $('emptyState').hidden = fresh.length > 0;
    list.innerHTML = fresh.map((event, index) => {
      const d = new Date(`${event.date}T12:00:00`);
      const day = new Intl.DateTimeFormat('it-IT', {day:'2-digit'}).format(d);
      const month = new Intl.DateTimeFormat('it-IT', {month:'short'}).format(d).replace('.', '');
      return `<article class="event-card">
        <div class="event-date"><strong>${day}</strong><span>${esc(month)} ${d.getFullYear()}</span></div>
        <div class="event-main"><h3>Consiglio di classe ${esc(event.class)}</h3>
          <div class="event-time">${esc(event.start)} – ${esc(event.end)}</div>
          <div class="event-meta"><span class="tag">Aula ${esc(event.room || 'da verificare')}</span><span class="tag">Da confermare</span></div>
          <a class="source-link" href="${esc(event.sourceUrl || 'https://ipsiabirago.edu.it/circolare/')}" target="_blank" rel="noreferrer">Circolare ${esc(event.sourceLabel || '')} ↗</a>
        </div>
        <input class="event-select" type="checkbox" checked aria-label="Seleziona ${esc(event.class)}" data-index="${index}" />
      </article>`;
    }).join('');
    $('addButton').disabled = fresh.length === 0 || !state.token;
    $('addButton').textContent = state.token ? `Aggiungi selezionati (${fresh.length})` : 'Aggiungi selezionati';
  }

  async function loadEvents() {
    $('scanStatus').textContent = 'Controllo completato';
    try {
      const response = await fetch(`data/convocations.json?v=${Date.now()}`, {cache:'no-store'});
      if (!response.ok) throw new Error('Dati non disponibili');
      const data = await response.json();
      state.events = (data.events || []).filter(e => classes.includes(e.class));
      $('lastChecked').textContent = data.checkedAt ? `Ultimo controllo: ${new Intl.DateTimeFormat('it-IT',{dateStyle:'medium',timeStyle:'short'}).format(new Date(data.checkedAt))}` : 'Controllo giornaliero attivo';
      if (data.warning) {
        $('scanStatus').textContent = 'Controllo da verificare';
        $('lastChecked').textContent += ` · ${data.warning}`;
      }
    } catch (error) {
      $('scanStatus').textContent = 'Dati momentaneamente non disponibili';
      $('lastChecked').textContent = 'Riprova tra poco o apri direttamente il sito della scuola.';
    }
    render();
  }

  function initGoogle() {
    const clientId = window.APP_CONFIG?.googleClientId;
    if (!clientId || clientId.includes('INSERISCI')) {
      $('calendarMessage').textContent = 'Per collegare Calendar va configurato il Client ID Google prima della pubblicazione.';
      return;
    }
    const timer = setInterval(() => {
      if (window.gapi && window.google?.accounts?.oauth2) {
        clearInterval(timer);
        gapi.load('client', async () => {
          await gapi.client.init({discoveryDocs:['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest']});
          state.apiReady = true;
          state.gisReady = true;
          state.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: 'https://www.googleapis.com/auth/calendar.events',
            callback: (response) => {
              if (response.error) { $('calendarMessage').textContent = 'Accesso Google non completato.'; return; }
              state.token = response.access_token;
              gapi.client.setToken({access_token: response.access_token});
              $('calendarMessage').textContent = 'Google Calendar collegato. Rivedi la selezione e conferma.';
              render();
            },
          });
          $('connectButton').textContent = 'Collega Google Calendar';
        });
      }
    }, 250);
    setTimeout(() => clearInterval(timer), 15000);
  }

  async function addSelected() {
    const checks = [...document.querySelectorAll('.event-select:checked')];
    if (!state.token || !checks.length) return;
    const previous = addedSet();
    const currentFresh = state.events.filter(e => !previous.has(e.key));
    const selected = checks.map(c => currentFresh[Number(c.dataset.index)]).filter(Boolean);
    $('addButton').disabled = true;
    $('calendarMessage').textContent = 'Aggiunta degli eventi in corso…';
    let success = 0;
    for (const event of selected) {
      try {
        const body = {
          summary: `Consiglio di classe ${event.class}`,
          location: event.room ? `Aula ${event.room}, IPSIA Dalmazio Birago, Torino` : 'IPSIA Dalmazio Birago, Torino',
          description: `Convocazione da ${event.sourceLabel || 'circolare scolastica'}.\n${event.sourceUrl || 'https://ipsiabirago.edu.it/circolare/'}`,
          start: {dateTime:`${event.date}T${event.start}:00${romeOffset(event.date,event.start)}`, timeZone:'Europe/Rome'},
          end: {dateTime:`${event.date}T${event.end}:00${romeOffset(event.date,event.end)}`, timeZone:'Europe/Rome'},
          extendedProperties: {private:{consiglioIdentity:`${event.sourceId}:${event.date}:${event.class}`}},
        };
        const prior = await gapi.client.calendar.events.list({calendarId:'primary', timeMin:`${event.date}T00:00:00${romeOffset(event.date,'00:00')}`, timeMax:`${event.date}T23:59:59${romeOffset(event.date,'23:59')}`, privateExtendedProperty:`consiglioIdentity=${event.sourceId}:${event.date}:${event.class}`, maxResults:10});
        if (prior.result.items?.length) {
          const existing = prior.result.items[0];
          await gapi.client.calendar.events.update({calendarId:'primary', eventId:existing.id, resource:{...existing,...body}});
        } else {
          await gapi.client.calendar.events.insert({calendarId:'primary', resource:body});
        }
        previous.add(event.key);
        success++;
      } catch (error) {
        if (error.status === 401) state.token = null;
        $('calendarMessage').textContent = `Inserimento interrotto: ${error.result?.error?.message || 'controlla la connessione e riprova.'}`;
        break;
      }
    }
    localStorage.setItem(storageKey, JSON.stringify([...previous]));
    if (success) $('calendarMessage').textContent = `${success} ${success === 1 ? 'evento aggiunto' : 'eventi aggiunti'} a Google Calendar.`;
    render();
  }

  $('connectButton').addEventListener('click', () => {
    if (!window.APP_CONFIG?.googleClientId || window.APP_CONFIG.googleClientId.includes('INSERISCI')) {
      $('calendarMessage').textContent = 'Prima della pubblicazione va configurato il Client ID OAuth in public/config.js.';
      return;
    }
    if (!state.tokenClient) { $('calendarMessage').textContent = 'Google si sta caricando. Attendi qualche secondo e riprova.'; return; }
    state.tokenClient.requestAccessToken({prompt: state.token ? '' : 'consent'});
  });
  $('addButton').addEventListener('click', addSelected);
  $('refreshButton').addEventListener('click', loadEvents);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); state.installPrompt = event; $('installButton').hidden = false;
  });
  $('installButton').addEventListener('click', async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; $('installButton').hidden = true;
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  initGoogle();
  loadEvents();
})();
