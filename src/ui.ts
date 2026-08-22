export const WIZARD_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TikTok LIVE Inbox</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0c0d12;
        --panel: #151721;
        --line: #2b2f3d;
        --text: #f4f6fb;
        --muted: #9299ac;
        --pink: #ff4f91;
        --cyan: #21d4e8;
        --green: #62e6a7;
        --danger: #ff7b93;
      }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      body { background: radial-gradient(circle at 90% 0%, rgba(255, 79, 145, .14), transparent 33%), radial-gradient(circle at 0% 100%, rgba(33, 212, 232, .10), transparent 32%), var(--bg); }
      button, input { font: inherit; }
      button { border: 0; border-radius: 11px; cursor: pointer; transition: transform .15s ease, filter .15s ease; }
      button:hover { filter: brightness(1.12); }
      button:active { transform: translateY(1px); }
      button:disabled { cursor: not-allowed; opacity: .55; }
      .shell { display: flex; flex-direction: column; width: min(100%, 960px); height: 100%; margin: 0 auto; padding: 28px 32px 24px; }
      .brand { display: flex; align-items: center; gap: 16px; margin-bottom: 28px; }
      .brand-mark { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 13px; background: linear-gradient(135deg, var(--pink), #a95bff 52%, var(--cyan)); box-shadow: 0 8px 28px rgba(255, 79, 145, .25); font-size: 20px; font-weight: 900; }
      .brand-copy { flex: 1; }
      .eyebrow { margin: 0 0 4px; color: var(--cyan); font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
      h1 { margin: 0; font-size: 23px; letter-spacing: -.03em; }
      .brand-note { margin: 5px 0 0; color: var(--muted); font-size: 13px; }
      .tray-note { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; white-space: nowrap; }
      .tray-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); box-shadow: 0 0 12px var(--green); }
      .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; margin-bottom: 22px; }
      .step { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; color: var(--muted); background: rgba(21, 23, 33, .68); font-size: 12px; font-weight: 700; }
      .step-number { display: grid; flex: 0 0 auto; width: 22px; height: 22px; place-items: center; border-radius: 50%; background: #1b1e2a; color: var(--muted); font-size: 11px; }
      .step.active { border-color: rgba(33, 212, 232, .52); color: var(--text); background: rgba(33, 212, 232, .08); }
      .step.active .step-number { background: var(--cyan); color: #071116; }
      .step.done { border-color: rgba(98, 230, 167, .38); color: var(--green); }
      .step.done .step-number { background: var(--green); color: #071116; }
      .card { display: flex; flex: 1; min-height: 0; flex-direction: column; padding: 28px; border: 1px solid var(--line); border-radius: 20px; background: rgba(21, 23, 33, .88); box-shadow: 0 24px 80px rgba(0, 0, 0, .28); }
      .view { display: flex; min-height: 0; flex: 1; flex-direction: column; }
      .view[hidden] { display: none; }
      .view h2 { margin: 0; font-size: 25px; letter-spacing: -.04em; }
      .lead { max-width: 650px; margin: 9px 0 24px; color: var(--muted); font-size: 14px; line-height: 1.55; }
      .form { width: min(100%, 620px); }
      label { display: block; margin: 0 0 8px; color: #cdd2de; font-size: 12px; font-weight: 800; letter-spacing: .03em; }
      input { width: 100%; padding: 13px 14px; border: 1px solid var(--line); border-radius: 11px; outline: none; background: #0f1118; color: var(--text); font-size: 14px; }
      input:focus { border-color: var(--cyan); box-shadow: 0 0 0 3px rgba(33, 212, 232, .12); }
      input::placeholder { color: #5e6577; }
      .field { margin-bottom: 18px; }
      .hint, .footer { color: var(--muted); font-size: 12px; line-height: 1.5; }
      .hint { margin: 8px 0 0; }
      .hint code, .footer code, .lead code { color: #d4dcf0; }
      .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: auto; padding-top: 24px; }
      .primary { padding: 12px 17px; background: linear-gradient(135deg, var(--pink), #bd5dff); color: white; font-weight: 800; }
      .secondary { padding: 11px 16px; border: 1px solid var(--line); background: transparent; color: #d9deea; font-weight: 700; }
      .danger { padding: 11px 16px; background: rgba(255, 123, 147, .12); color: var(--danger); font-weight: 800; }
      .error { margin-top: 13px; padding: 11px 13px; border: 1px solid rgba(255, 123, 147, .3); border-radius: 10px; background: rgba(255, 123, 147, .08); color: var(--danger); font-size: 12px; line-height: 1.45; }
      .error[hidden] { display: none; }
      .live-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
      .live-title { margin: 6px 0 0; color: var(--muted); font-size: 13px; }
      .status { display: inline-flex; align-items: center; gap: 7px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: 11px; font-weight: 800; white-space: nowrap; }
      .status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #697184; }
      .status.online { border-color: rgba(98, 230, 167, .35); color: var(--green); }
      .status.online::before { background: var(--green); box-shadow: 0 0 10px var(--green); }
      .status.busy { border-color: rgba(33, 212, 232, .32); color: var(--cyan); }
      .status.busy::before { background: var(--cyan); box-shadow: 0 0 10px var(--cyan); }
      .message-list { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 8px; overflow: auto; padding: 3px 5px 3px 0; }
      .message-list::-webkit-scrollbar { width: 7px; }
      .message-list::-webkit-scrollbar-thumb { border-radius: 9px; background: #333849; }
      .empty { display: grid; flex: 1; place-items: center; min-height: 160px; color: var(--muted); font-size: 13px; text-align: center; }
      .message { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 11px; align-items: start; padding: 11px 12px; border: 1px solid rgba(43, 47, 61, .8); border-radius: 12px; background: rgba(15, 17, 24, .72); }
      .message-bar { width: 4px; min-height: 27px; border-radius: 9px; background: var(--cyan); }
      .message.gift .message-bar { background: #e39aff; }
      .message.social .message-bar { background: var(--green); }
      .message.like .message-bar { background: #ffb45c; }
      .message.member .message-bar { background: var(--pink); }
      .message-author { margin-bottom: 3px; color: #dfe5f3; font-size: 12px; font-weight: 850; }
      .message-text { color: #aeb6c8; font-size: 13px; line-height: 1.42; overflow-wrap: anywhere; }
      .message-time { color: #666e82; font-size: 11px; white-space: nowrap; }
      .count { color: var(--muted); font-size: 12px; }
      .footer { margin-top: 15px; color: #687086; font-size: 11px; }
      @media (max-width: 650px) {
        .shell { padding: 20px 18px 18px; }
        .card { padding: 21px; }
        .tray-note { display: none; }
        .steps { gap: 6px; }
        .step { padding: 8px; }
        .step span:last-child { display: none; }
        .live-header { flex-direction: column; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="brand">
        <div class="brand-mark">♪</div>
        <div class="brand-copy">
          <p class="eyebrow">Desktop example</p>
          <h1>TikTok LIVE Inbox</h1>
          <p class="brand-note">A small native WebView for real-time live chat.</p>
        </div>
        <div class="tray-note"><span class="tray-dot"></span>Runs from the tray</div>
      </header>
      <nav class="steps" aria-label="Setup progress">
        <div class="step active" data-step="1"><span class="step-number">1</span><span>Session</span></div>
        <div class="step" data-step="2"><span class="step-number">2</span><span>Live channel</span></div>
        <div class="step" data-step="3"><span class="step-number">3</span><span>Messages</span></div>
      </nav>
      <section class="card">
        <section class="view" id="view-session">
          <div>
            <h2>Choose your session mode</h2>
            <p class="lead">Leave the cookie blank to use TikTok’s anonymous guest bootstrap. You can optionally paste an authenticated Cookie header for account-based transport.</p>
            <form class="form" id="session-form">
              <div class="field">
                <label for="session-cookie">Cookie header</label>
                <input id="session-cookie" type="password" autocomplete="off" spellcheck="false" placeholder="Optional: ttwid=... or sessionid=..." />
                <p class="hint">Leave blank for anonymous guest mode. Or paste the Cookie request header from a logged-in browser.</p>
              </div>
              <div class="error" id="session-error" hidden></div>
              <div class="actions"><button class="primary" type="submit">Continue</button></div>
            </form>
          </div>
          <p class="footer">Do not share this value or commit it. The cookie is kept in memory only.</p>
        </section>
        <section class="view" id="view-channel" hidden>
          <div>
            <h2>Choose a LIVE</h2>
            <p class="lead">Enter the creator handle you want to monitor. The creator must be live when you connect.</p>
            <form class="form" id="channel-form">
              <div class="field">
                <label for="unique-id">Creator handle</label>
                <input id="unique-id" type="text" autocomplete="off" spellcheck="false" placeholder="@creator" />
                <p class="hint">The leading <code>@</code> is optional.</p>
              </div>
              <div class="error" id="channel-error" hidden></div>
              <div class="actions">
                <button class="secondary" id="back-session" type="button">Back</button>
                <button class="secondary" id="pick-live" type="button">Pick a live automatically</button>
                <button class="primary" type="submit">Connect to LIVE</button>
              </div>
            </form>
          </div>
        </section>
        <section class="view" id="view-messages" hidden>
          <div class="live-header">
            <div><h2>Live messages</h2><p class="live-title" id="live-title">Waiting for connection…</p></div>
            <div class="status busy" id="live-status">Connecting</div>
          </div>
          <div class="message-list" id="message-list"><div class="empty" id="message-empty">Messages will appear here when the room starts sending events.</div></div>
          <div class="actions">
            <span class="count" id="message-count">0 messages</span>
            <span style="flex: 1"></span>
            <button class="danger" id="disconnect" type="button">Disconnect</button>
          </div>
        </section>
      </section>
    </main>
    <script>
      (() => {
        const state = { cookie: '', uniqueId: '', messageCount: 0 };
        const $ = (id) => document.getElementById(id);
        const views = { session: $('view-session'), channel: $('view-channel'), messages: $('view-messages') };
        const steps = Array.from(document.querySelectorAll('[data-step]'));
        const sessionError = $('session-error');
        const channelError = $('channel-error');
        const messageList = $('message-list');
        const send = (message) => window.ipc.postMessage(JSON.stringify(message));
        const showError = (element, message) => { element.textContent = message; element.hidden = !message; };
        const setStep = (step) => {
          views.session.hidden = step !== 1;
          views.channel.hidden = step !== 2;
          views.messages.hidden = step !== 3;
          steps.forEach((item) => {
            const number = Number(item.dataset.step);
            item.classList.toggle('active', number === step);
            item.classList.toggle('done', number < step);
          });
        };
        const setStatus = (text, kind) => {
          const element = $('live-status');
          element.textContent = text;
          element.className = 'status ' + kind;
        };
        const addEvent = (event) => {
          const empty = $('message-empty');
          if (empty) empty.remove();
          const row = document.createElement('article');
          row.className = 'message ' + event.kind;
          const bar = document.createElement('span');
          bar.className = 'message-bar';
          row.appendChild(bar);
          const body = document.createElement('div');
          const author = document.createElement('div');
          author.className = 'message-author';
          author.textContent = event.author;
          const text = document.createElement('div');
          text.className = 'message-text';
          text.textContent = event.text;
          body.append(author, text);
          row.appendChild(body);
          const time = document.createElement('time');
          time.className = 'message-time';
          time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          row.appendChild(time);
          messageList.appendChild(row);
          while (messageList.children.length > 150) messageList.firstElementChild.remove();
          state.messageCount += 1;
          $('message-count').textContent = state.messageCount + (state.messageCount === 1 ? ' message' : ' messages');
          messageList.scrollTop = messageList.scrollHeight;
        };
        $('session-form').addEventListener('submit', (event) => {
          event.preventDefault();
          const cookie = $('session-cookie').value.trim();
          state.cookie = cookie;
          showError(sessionError, '');
          setStep(2);
          $('unique-id').focus();
        });
        $('channel-form').addEventListener('submit', (event) => {
          event.preventDefault();
          const uniqueId = $('unique-id').value.trim();
          if (!uniqueId) {
            showError(channelError, 'Enter a creator handle.');
            return;
          }
          state.uniqueId = uniqueId;
          state.messageCount = 0;
          $('message-count').textContent = '0 messages';
          $('message-list').innerHTML = '<div class="empty" id="message-empty">Connecting to the room…</div>';
          showError(channelError, '');
          setStep(3);
          setStatus('Connecting', 'busy');
          $('live-title').textContent = '@' + uniqueId.replace(/^@/, '');
          send({ type: 'connect', uniqueId, sessionCookie: state.cookie });
        });
        $('pick-live').addEventListener('click', () => {
          state.messageCount = 0;
          $('message-count').textContent = '0 messages';
          $('message-list').innerHTML = '<div class="empty" id="message-empty">Finding a live room…</div>';
          showError(channelError, '');
          setStep(3);
          setStatus('Finding a live', 'busy');
          $('live-title').textContent = 'Searching TikTok live rooms…';
          send({ type: 'pick-live', sessionCookie: state.cookie });
        });
        $('back-session').addEventListener('click', () => { showError(sessionError, ''); setStep(1); });
        $('disconnect').addEventListener('click', () => {
          send({ type: 'disconnect' });
          setStatus('Disconnected', 'offline');
          setStep(2);
        });
        window.__webview_on_message__ = (raw) => {
          let message;
          try { message = JSON.parse(raw); } catch { return; }
          if (message.type === 'connection') {
            if (message.status === 'connecting') {
              setStatus('Connecting', 'busy');
              if (message.title) $('live-title').textContent = message.title;
            }
            if (message.status === 'connected') {
              setStatus('Live', 'online');
              $('live-title').textContent = message.title ? message.title : '@' + message.uniqueId;
            }
            if (message.status === 'disconnected') setStatus('Disconnected', 'offline');
          }
          if (message.type === 'live-event') addEvent(message.event);
          if (message.type === 'reconnecting') setStatus('Retrying · ' + message.attempt, 'busy');
          if (message.type === 'error') {
            setStatus('Needs attention', 'offline');
            if (message.phase === 'connect') {
              setStep(2);
              showError(channelError, message.message);
            } else {
              addEvent({ kind: 'member', author: 'System', text: message.message });
            }
          }
        };
      })();
    </script>
  </body>
</html>`;
