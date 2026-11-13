/* RELAY v11 AI chat. Consumes the AI SDK UI message stream from /v11/api/chat and
   renders reasoning, text, tool calls, artifacts and embedded twin views. Messages
   are kept in the AI SDK UIMessage shape so they can be posted back unchanged. */
(() => {
'use strict';
if (document.documentElement.dataset.embed) return;

const $ = id => document.getElementById(id);
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const uid = () => Math.random().toString(36).slice(2, 12);
const el = (tag, className, html) => { const n = document.createElement(tag); if (className) n.className = className; if (html != null) n.innerHTML = html; return n; };

const STORE = 'relay.v11.chat';
const MAX_LIVE_TWINS = 2;   // each ground embed holds WebGL contexts; older ones pause
const WORD_INTERVAL_MS = 30;
const WORD_FADE_MS = 180;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const wordSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, {granularity: 'word'}) : null;
const unspacedScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const SUGGESTIONS = [
  'Summarise what is happening in the simulation right now',
  'Cancel a flight and show me how the ground twin reacts',
  'Build a control panel for playback and disruptions',
  'Place a critical cold-chain order to LHR and track it',
];
const TWIN_LABEL = {ground: 'Ground Twin', tower: 'Control Tower', customer: 'Customer Twin'};

const thread = $('chatThread'), scroller = $('chatScroll'), input = $('chatInput'), sendBtn = $('chatSend');
let messages = [], chatId = uid(), busy = false, abort = null, latestState = null, liveTwins = [], renderQueued = false;

/* ---------- markdown ---------- */
function inline(text) {
  const code = [];
  return esc(text)
    .replace(/`([^`\n]+)`/g, (_, c) => `\u0000${code.push(c) - 1}\u0000`)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[i]}</code>`);
}
const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
function markdown(source) {
  const lines = source.replace(/\r/g, '').split('\n'), out = [];
  const listItem = /^\s*(?:[-*]|(\d+)[.)])\s+(.*)$/;
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const body = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
    } else if (!line.trim()) {
      i++;
    } else if (/^#{1,6}\s/.test(line)) {
      const level = Math.min(line.match(/^#+/)[0].length, 3) + 2;
      out.push(`<h${level}>${inline(line.replace(/^#+\s+/, ''))}</h${level}>`);
      i++;
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i++;
    } else if (line.includes('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const head = cells(line), rows = [];
      for (i += 2; i < lines.length && lines[i].includes('|'); i++) rows.push(cells(lines[i]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (listItem.test(line)) {
      const tag = line.match(listItem)[1] ? 'ol' : 'ul', items = [];
      for (; i < lines.length && (listItem.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length)); i++) {
        const m = lines[i].match(listItem);
        if (m) items.push(m[2]); else items[items.length - 1] += ' ' + lines[i].trim();
      }
      out.push(`<${tag}>${items.map(x => `<li>${inline(x)}</li>`).join('')}</${tag}>`);
    } else if (/^\s*>/.test(line)) {
      const body = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${inline(body.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
    } else {
      const body = [];
      for (; i < lines.length && lines[i].trim() && !/^\s*```|^#{1,6}\s|^\s*>/.test(lines[i]) && !listItem.test(lines[i]); i++) body.push(lines[i]);
      out.push(`<p>${inline(body.join('\n')).replace(/\n/g, '<br>')}</p>`);
    }
  }
  return out.join('');
}

/* ---------- twin embeds ---------- */
const TWIN_TAG = /<relay-twin\b([^>]*?)\/?>(?:\s*<\/relay-twin>)?/g;
function splitTwins(text, streaming) {
  if (streaming) {  // hide a tag that is still being written
    const open = text.lastIndexOf('<'), tail = open < 0 ? '' : text.slice(open);
    if (tail && !tail.includes('>') && ('<relay-twin'.startsWith(tail) || tail.startsWith('<relay-twin') || '</relay-twin>'.startsWith(tail))) text = text.slice(0, open);
  }
  const segments = [];
  let last = 0;
  for (const m of text.matchAll(TWIN_TAG)) {
    segments.push({md: text.slice(last, m.index)});
    segments.push({twin: Object.fromEntries([...m[1].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)].map(a => [a[1], a[2]]))});
    last = m.index + m[0].length;
  }
  segments.push({md: text.slice(last)});
  return segments;
}
function twinEmbed(attrs) {
  const view = TWIN_LABEL[attrs.view] ? attrs.view : 'ground';
  const query = new URLSearchParams({embed: view});
  if (view === 'ground' && ['relay', 'fcfs'].includes(attrs.world)) query.set('world', attrs.world);
  if (view === 'customer' && attrs.awb) query.set('awb', attrs.awb);
  const detail = query.get('world') ? (attrs.world === 'relay' ? ' · RELAY' : ' · FCFS baseline') : attrs.awb ? ' · ' + attrs.awb : '';
  const node = el('figure', 'embed twin', `<figcaption><span class="embed-title">${esc(TWIN_LABEL[view] + detail)}</span>` +
    `<span class="embed-meta">Live view</span><button type="button" data-open-tab="${view}">Open tab</button></figcaption>` +
    `<div class="embed-body twin-${view}"></div>`);
  node._src = '/v11?' + query;
  startTwin(node);
  return node;
}
function startTwin(node) {
  const frame = el('iframe');
  frame.src = node._src;
  frame.title = node.querySelector('.embed-title').textContent;
  frame.loading = 'lazy';
  node.querySelector('.embed-body').replaceChildren(frame);
  liveTwins = liveTwins.filter(n => n !== node && n.isConnected !== false).concat(node);
  while (liveTwins.length > MAX_LIVE_TWINS) {
    liveTwins.shift().querySelector('.embed-body').replaceChildren(
      el('button', 'embed-resume', 'Paused to save resources. Resume live view'));
  }
}

/* ---------- artifacts ---------- */
const ARTIFACT_CSS = `:root{--ink:#183b40;--soft:#637c83;--line:#dce8e9;--teal:#087f74;--warn:#a06509;--bad:#b4482f;color:var(--ink);font:13px/1.5 'DM Sans','Segoe UI',system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;padding:14px;display:flow-root}h1,h2,h3{margin:0 0 8px;font-size:14px;font-weight:700}p{margin:0 0 8px}
button,input,select,textarea{font:inherit;color:inherit}
button{border:1px solid var(--line);background:#fff;border-radius:7px;padding:6px 11px;font-weight:600;cursor:pointer}
button:hover:not(:disabled){background:#f2f7f7}button:disabled{opacity:.5;cursor:default}
button.primary{background:var(--teal);border-color:var(--teal);color:#fff}button.primary:hover:not(:disabled){background:#06695f}
input,select,textarea{border:1px solid var(--line);border-radius:7px;padding:6px 8px;background:#fff;min-width:0}
input:focus,select:focus,textarea:focus,button:focus-visible{outline:2px solid #087f7455;outline-offset:1px}
label{display:grid;gap:3px;font-size:12px;color:var(--soft)}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
th{font-size:11px;font-weight:600;color:var(--soft)}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 10px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:0 0 10px}
.card{border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.kpi{border:1px solid var(--line);border-radius:8px;padding:9px 12px;font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.kpi small{display:block;font-size:11px;font-weight:500;color:var(--soft)}
.muted{color:var(--soft)}.pill{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:1px 8px;font-size:11px;color:var(--soft)}`;
const ARTIFACT_BRIDGE = `(()=>{let n=0,last=null;const wait=new Map(),subs=[],post=m=>parent.postMessage(Object.assign({relay:true},m),'*');
addEventListener('message',e=>{if(e.source!==parent)return;const m=e.data||{};
if(m.kind==='result'){const p=wait.get(m.id);if(!p)return;wait.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.result)}
if(m.kind==='state'){last=m.state;subs.forEach(f=>{try{f(last)}catch(x){console.error(x)}})}});
window.relay={call:(name,args)=>new Promise((resolve,reject)=>{const id=++n;wait.set(id,{resolve,reject});post({kind:'call',id,name,args:args||{}})}),
onState(fn){subs.push(fn);if(last)fn(last);post({kind:'subscribe'})},send:text=>post({kind:'prompt',text:String(text)})};
const size=()=>post({kind:'size',height:Math.ceil(document.body.getBoundingClientRect().height)});
addEventListener('DOMContentLoaded',()=>{new ResizeObserver(size).observe(document.body);size()});
addEventListener('error',e=>post({kind:'error',message:e.message}))})();`;
function artifactDocument(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; form-action 'none'">` +
    `<style>${ARTIFACT_CSS}</style><script>${ARTIFACT_BRIDGE}<\/script></head><body>${html}</body></html>`;
}
async function callTool(name, args) {
  const response = await fetch('/v11/api/chat/tool', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, arguments: args || {}})});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(typeof body.detail === 'string' ? body.detail : 'Tool call failed');
  return body.result;
}
addEventListener('message', event => {
  const m = event.data;
  if (!m || m.relay !== true) return;
  const frame = [...thread.querySelectorAll('iframe.artifact-frame')].find(f => f.contentWindow === event.source);
  if (!frame) return;
  const reply = data => frame.contentWindow?.postMessage(data, '*');
  if (m.kind === 'size') frame.style.height = Math.max(48, Math.min(Number(m.height) || 0, 720)) + 'px';
  else if (m.kind === 'subscribe') { frame._subscribed = true; if (latestState) reply({kind: 'state', state: latestState}); }
  else if (m.kind === 'call') callTool(String(m.name), m.args).then(result => reply({kind: 'result', id: m.id, result}), error => reply({kind: 'result', id: m.id, error: error.message}));
  else if (m.kind === 'prompt') send(String(m.text || ''));
  else if (m.kind === 'error') frame.closest('.embed').querySelector('.embed-meta').textContent = 'Script error: ' + String(m.message).slice(0, 80);
});
addEventListener('relay:state', event => {
  latestState = event.detail;
  for (const frame of thread.querySelectorAll('iframe.artifact-frame')) if (frame._subscribed) frame.contentWindow?.postMessage({kind: 'state', state: latestState}, '*');
});

/* ---------- part views ---------- */
const toolName = part => part.type.slice(5);
const pretty = value => { const s = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''; return s.length > 6000 ? s.slice(0, 6000) + '\n… truncated' : s; };
const visibleText = part => part.text.slice(0, part._visibleLength);
const hasPendingText = part => part._visibleLength < part.text?.length;

function fadeNewText(node, revealedLength) {
  const text = node.textContent;
  const previous = node._plainText || '';
  const now = performance.now();
  const animate = !reducedMotion.matches && revealedLength;
  let fades = animate ? (node._wordFades || []).filter(fade => now - fade.started < WORD_FADE_MS) : [];
  if (animate && text !== previous) {
    let start = Math.max(0, text.length - revealedLength);
    while (start < text.length && text[start] === previous[start]) start++;
    fades = fades.filter(fade => fade.end <= start);
    if (start < text.length) fades.push({start, end: text.length, started: now});
  }
  node._plainText = text;
  node._wordFades = fades;
  if (!fades.length) return;

  // Markdown is rebuilt as it arrives. Restore each active fade at its current progress.
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  for (let child; (child = walker.nextNode());) textNodes.push(child);
  const newestFirst = fades.slice().reverse();
  let offset = 0;
  for (const child of textNodes) {
    const end = offset + child.length;
    for (const fade of newestFirst) {
      const start = Math.max(offset, fade.start), stop = Math.min(end, fade.end);
      if (start >= stop) continue;
      const fragment = start === offset ? child : child.splitText(start - offset);
      if (stop - start < fragment.length) fragment.splitText(stop - start);
      if (fragment.data.trim()) {
        const span = el('span', 'chat-word-fade');
        span.style.animationDuration = `${WORD_FADE_MS}ms`;
        span.style.animationDelay = `${fade.started - now}ms`;
        fragment.replaceWith(span);
        span.append(fragment);
      }
    }
    offset = end;
  }
}

function updateText(part) {
  const node = part._el ||= el('div', 'part text');
  part._twins ||= [];
  const wanted = [];
  let twinIndex = 0;
  const streaming = part.state === 'streaming' || hasPendingText(part);
  for (const segment of splitTwins(visibleText(part), streaming)) {
    if (segment.twin) wanted.push(part._twins[twinIndex++] ||= twinEmbed(segment.twin));
    else if (segment.md.trim()) wanted.push({md: segment.md});
  }
  wanted.forEach((item, i) => {
    let child = node.children[i];
    if (item.md != null) {
      if (!child?.classList.contains('md')) { child = el('div', 'md'); node.insertBefore(child, node.children[i] || null); }
      if (child._source !== item.md) {
        child._source = item.md;
        child.innerHTML = markdown(item.md);
        fadeNewText(child, part._revealedLength);
      }
    } else if (child !== item) node.insertBefore(item, child || null);
  });
  while (node.children.length > wanted.length) node.lastChild.remove();
  return node;
}
function updateReasoning(part) {
  const playing = part.state === 'streaming' || hasPendingText(part);
  if (!part._el) {
    part._el = el('details', 'part thought', '<summary></summary><div class="thought-body"></div>');
    part._el.open = playing;
  }
  const body = part._el.lastChild;
  const text = visibleText(part);
  if (body.textContent !== text) {
    body.textContent = text;
    fadeNewText(body, part._revealedLength);
  }
  const lastFade = body._wordFades?.at(-1);
  const fadeRemaining = lastFade && !reducedMotion.matches ? lastFade.started + WORD_FADE_MS - performance.now() : 0;
  if (!playing && fadeRemaining > 0 && !part._collapseTimer) {
    part._collapseTimer = setTimeout(() => {
      part._collapseTimer = null;
      part._dirty = true;
      queueRender();
    }, fadeRemaining);
  }
  const streaming = playing || fadeRemaining > 0;
  if (part._wasStreaming && !streaming) part._el.open = false;
  part._wasStreaming = streaming;
  part._el.classList.toggle('streaming', streaming);
  part._el.firstChild.textContent = streaming ? 'Thinking' : part.seconds ? `Thought for ${part.seconds}s` : 'Thought';
  return part._el;
}
function argumentSummary(input) {
  if (!input || !Object.keys(input).length) return '';
  const flat = Object.values(input).length === 1 && typeof Object.values(input)[0] === 'object' ? Object.values(input)[0] : input;
  return Object.entries(flat || {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ').slice(0, 90);
}
function updateTool(part) {
  const node = part._el ||= el('details', 'part tool',
    '<summary><span class="tool-state"></span><code class="tool-name"></code><span class="tool-args"></span><span class="tool-note"></span></summary>' +
    '<div class="tool-detail"><span>Input</span><pre class="tool-input"></pre><span class="tool-output-label">Output</span><pre class="tool-output"></pre></div>');
  const failed = part.state === 'output-error', done = part.state === 'output-available';
  node.dataset.state = failed ? 'error' : done ? 'done' : 'running';
  node.querySelector('.tool-name').textContent = toolName(part);
  node.querySelector('.tool-args').textContent = argumentSummary(part.input);
  node.querySelector('.tool-note').textContent = failed ? 'failed' : done ? '' : 'running';
  node.querySelector('.tool-input').textContent = part.input ? pretty(part.input) : part.raw || '';
  node.querySelector('.tool-output-label').textContent = failed ? 'Error' : 'Output';
  node.querySelector('.tool-output').textContent = failed ? part.errorText : done ? pretty(part.output) : '…';
  return node;
}
function updateArtifact(part) {
  const node = part._el ||= el('figure', 'part embed artifact',
    '<figcaption><span class="embed-title"></span><span class="embed-meta"></span><button type="button" data-toggle-code>Code</button></figcaption>' +
    '<div class="embed-body"></div><pre class="artifact-code" hidden></pre>');
  const title = part.input?.title || part.raw?.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] || 'Artifact';
  node.querySelector('.embed-title').textContent = title;
  const meta = node.querySelector('.embed-meta'), body = node.querySelector('.embed-body');
  if (part.state === 'input-streaming') {
    meta.textContent = `Writing… ${((part.raw || '').length / 1000).toFixed(1)} kB`;
    if (!body.firstChild) body.append(el('div', 'artifact-pending'));
  } else if (part.state === 'output-error') {
    meta.textContent = 'Failed';
    body.replaceChildren(el('div', 'chat-error', esc(part.errorText || 'The artifact could not be rendered')));
  } else if (!part._mounted && typeof part.input?.html === 'string') {
    part._mounted = true;
    meta.textContent = 'Interactive';
    const frame = el('iframe', 'artifact-frame');
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    frame.title = title;
    frame.srcdoc = artifactDocument(part.input.html);
    body.replaceChildren(frame);
    node.querySelector('.artifact-code').textContent = part.input.html;
  }
  return node;
}
function updatePart(part) {
  if (part.type === 'text') return updateText(part);
  if (part.type === 'reasoning') return updateReasoning(part);
  if (part.type === 'tool-create_artifact') return updateArtifact(part);
  if (part.type.startsWith('tool-')) return updateTool(part);
  if (part.type === 'error') return part._el ||= el('div', 'part chat-error', esc(part.text));
  return null;
}

/* ---------- thread ---------- */
function renderMessage(message) {
  if (!message._el) {
    message._el = el('article', 'msg ' + message.role);
    thread.append(message._el);
  }
  if (message.role === 'user') { message._el.textContent = message.parts.map(p => p.text || '').join(''); return; }
  for (const part of message.parts) {
    if (!part._dirty && part._el) continue;
    part._dirty = false;
    const node = updatePart(part);
    part._revealedLength = 0;
    if (node && node.parentNode !== message._el) message._el.append(node);
  }
  message._el.classList.toggle('working', Boolean(message._working));
}
function render() {
  const pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
  if (!messages.length && !thread.querySelector('.chat-empty')) {
    thread.replaceChildren(el('div', 'chat-empty', '<h2>What do you want to do in the simulation?</h2><p>The assistant can read and operate the three twins, build small control panels, and show live 3D views inline.</p>' +
      `<div class="chat-suggestions">${SUGGESTIONS.map(s => `<button type="button" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div>`));
  }
  if (messages.length) thread.querySelector('.chat-empty')?.remove();
  messages.forEach(renderMessage);
  if (pinned) scroller.scrollTop = scroller.scrollHeight;
}
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({chatId, messages}, (key, value) => key.startsWith('_') || key === 'raw' ? undefined : value)); } catch { /* storage unavailable or full */ }
}
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved?.messages?.length) { chatId = saved.chatId || chatId; messages = saved.messages; }
  } catch { /* ignore a corrupt store */ }
}
function setBusy(value) {
  busy = value;
  sendBtn.textContent = value ? 'Stop' : 'Send';
  sendBtn.classList.toggle('stop', value);
}

/* ---------- stream ---------- */
function nextWordLength(pending, ended) {
  const match = /^(\s*)(\S+)\s*/u.exec(pending);
  if (!match) return ended ? pending.length : 0;
  const [span, leading, word] = match;
  if (wordSegmenter && unspacedScript.test(word)) {
    let foundWord = false;
    for (const segment of wordSegmenter.segment(word)) {
      if (!segment.isWordLike) continue;
      if (foundWord) return leading.length + segment.index;
      foundWord = true;
    }
  }
  // A delta can end in the middle of a word. Wait for its boundary or the end of the part.
  return ended || span.length > leading.length + word.length ? span.length : 0;
}

function paceText(reply, signal) {
  let timer = null, resolveDrain;
  function reveal(part, length, animate) {
    part._visibleLength += length;
    part._revealedLength = animate ? (part._revealedLength || 0) + length : 0;
    part._dirty = true;
    queueRender();
  }
  function flush() {
    clearTimeout(timer);
    timer = null;
    for (const part of reply.parts.filter(hasPendingText)) reveal(part, part.text.length - part._visibleLength, false);
    resolveDrain?.();
  }
  function schedule() {
    if (signal.aborted || document.hidden || reducedMotion.matches) {
      flush();
    } else if (!reply.parts.some(hasPendingText)) {
      resolveDrain?.();
    } else if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        if (document.hidden || reducedMotion.matches) { flush(); return; }
        const part = reply.parts.find(hasPendingText);
        const length = nextWordLength(part.text.slice(part._visibleLength), part.state === 'done');
        if (length) { reveal(part, length, true); schedule(); }
      }, WORD_INTERVAL_MS);
    }
  }
  // Stopping the request also completes playback of text already received.
  signal.addEventListener('abort', flush, {once: true});
  return {
    schedule,
    async finish() {
      await new Promise(resolve => { resolveDrain = resolve; schedule(); });
      signal.removeEventListener('abort', flush);
    },
  };
}

function applyEvent(message, event) {
  const parts = message.parts, byId = id => parts.findLast(p => p.id === id), byCall = id => parts.findLast(p => p.toolCallId === id);
  let part = null;
  switch (event.type) {
    case 'start': if (event.messageId) message.id = event.messageId; return;  // the server keys its history on this id
    case 'start-step': parts.push({type: 'step-start'}); return;
    case 'text-start': case 'reasoning-start':
      parts.push(part = {type: event.type.split('-')[0], id: event.id, text: '', state: 'streaming', _visibleLength: 0, _started: performance.now()}); break;
    case 'text-delta': case 'reasoning-delta':
      if ((part = byId(event.id))) part.text += event.delta;
      return;
    case 'text-end': case 'reasoning-end':
      if ((part = byId(event.id))) { part.state = 'done'; if (part.type === 'reasoning') part.seconds = Math.max(1, Math.round((performance.now() - part._started) / 1000)); } break;
    case 'tool-input-start':
      parts.push(part = {type: 'tool-' + event.toolName, toolCallId: event.toolCallId, state: 'input-streaming', raw: ''}); break;
    case 'tool-input-delta':
      if ((part = byCall(event.toolCallId))) part.raw += event.inputTextDelta; break;
    case 'tool-input-available':
      part = byCall(event.toolCallId) || parts[parts.push({type: 'tool-' + event.toolName, toolCallId: event.toolCallId}) - 1];
      part.state = 'input-available'; part.input = event.input; break;
    case 'tool-output-available':
      if ((part = byCall(event.toolCallId))) { part.state = 'output-available'; part.output = event.output; } break;
    case 'tool-output-error':
      if ((part = byCall(event.toolCallId))) { part.state = 'output-error'; part.errorText = event.errorText; } break;
    case 'error':
      parts.push(part = {type: 'error', text: event.errorText || 'The model request failed'}); break;
  }
  if (part) part._dirty = true;
}
async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  messages.push({id: uid(), role: 'user', parts: [{type: 'text', text}]});
  const reply = {id: uid(), role: 'assistant', parts: [], _working: true};
  setBusy(true);
  render();
  scroller.scrollTop = scroller.scrollHeight;
  abort = new AbortController();
  const reveal = paceText(reply, abort.signal);
  const body = JSON.stringify({id: chatId, messages}, (key, value) => key.startsWith('_') || key === 'raw' ? undefined : value);
  messages.push(reply);
  queueRender();
  try {
    const response = await fetch('/v11/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body, signal: abort.signal});
    if (!response.ok || !response.body) throw Error((await response.text()).slice(0, 300) || 'Chat request failed');
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    for (let buffer = '';;) {
      const {value, done} = await reader.read();
      if (done) break;
      buffer += value;
      for (let cut; (cut = buffer.indexOf('\n\n')) >= 0; buffer = buffer.slice(cut + 2)) {
        const line = buffer.slice(0, cut);
        if (line.startsWith('data: ') && line !== 'data: [DONE]') applyEvent(reply, JSON.parse(line.slice(6)));
      }
      reveal.schedule();
      queueRender();
    }
  } catch (error) {
    if (error.name !== 'AbortError') reply.parts.push({type: 'error', text: error.message});
  } finally {
    for (const part of reply.parts) {  // close whatever a stop or a dropped stream left open
      if (part.state === 'streaming') { part.state = 'done'; part._dirty = true; }
      if (part.state === 'input-streaming' || part.state === 'input-available') { part.state = 'output-error'; part.errorText = 'Stopped before the tool finished'; part._dirty = true; }
    }
    queueRender();
    await reveal.finish();
    reply._working = false;
    abort = null;
    setBusy(false);
    save();
    queueRender();
  }
}

/* ---------- wiring ---------- */
const resize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 168) + 'px'; };
function submit() {
  if (busy) { abort?.abort(); return; }
  const text = input.value;
  if (!text.trim()) return;
  input.value = '';
  resize();
  send(text);
}
$('chatForm').addEventListener('submit', event => { event.preventDefault(); submit(); });
input.addEventListener('input', resize);
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!busy) submit(); }
});
$('chatNew').addEventListener('click', () => {
  abort?.abort();
  messages = []; chatId = uid(); liveTwins = [];
  thread.replaceChildren();
  save();
  render();
  input.focus();
});
thread.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.suggest) send(target.dataset.suggest);
  else if (target.dataset.openTab) document.querySelector(`.tab[data-tab="${target.dataset.openTab}"]`)?.click();
  else if (target.classList.contains('embed-resume')) startTwin(target.closest('.embed'));
  else if ('toggleCode' in target.dataset) {
    const figure = target.closest('.embed'), code = figure.querySelector('.artifact-code');
    code.hidden = !code.hidden;
    figure.querySelector('.embed-body').hidden = !code.hidden;
    target.textContent = code.hidden ? 'Code' : 'Preview';
  }
});
$('chatMcpUrl').textContent = new URL('/mcp', window.location.origin).href;
$('chatMcp').addEventListener('click', () => $('chatMcpDialog').showModal());

restore();
render();
scroller.scrollTop = scroller.scrollHeight;
})();
