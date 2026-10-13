/* Linkly — a personal link hub. Plain JS, no build step.
 * Link data lives in localStorage; attached files live in IndexedDB. */
(() => {
  'use strict';

  const DATA_KEY = 'linkly.data';
  const THEME_KEY = 'linkly.theme';
  const RECENT_LIMIT = 8;
  // Optional metadata service used to auto-fill titles for sites that block
  // cross-origin requests. Set to '' to keep every lookup inside the browser.
  const META_SERVICE = 'https://api.microlink.io/?url=';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const uid = () => (crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------------------ */
  /* Icons                                                               */
  /* ------------------------------------------------------------------ */
  const ICON = {
    grip: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 17v5M8 3h8l-1 6 3 3v2H6v-2l3-3z"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    clip: '<svg viewBox="0 0 24 24"><path d="M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7"/></svg>',
    chevron: '<svg class="cat-chevron" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  };

  /* ------------------------------------------------------------------ */
  /* IndexedDB for attachments                                           */
  /* ------------------------------------------------------------------ */
  const idb = (() => {
    let dbp;
    const open = () => dbp || (dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('linkly', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
    const tx = async (mode, fn) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction('files', mode);
        const result = fn(t.objectStore('files'));
        t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    };
    return {
      get: (k) => tx('readonly', (s) => s.get(k)),
      put: (k, v) => tx('readwrite', (s) => s.put(v, k)),
      del: (k) => tx('readwrite', (s) => s.delete(k)),
      clear: () => tx('readwrite', (s) => s.clear()),
      keys: () => tx('readonly', (s) => s.getAllKeys()),
    };
  })();

  const fileUrls = new Map(); // link id -> object URL

  async function loadFiles() {
    try {
      const keys = await idb.keys();
      await Promise.all(keys.map(async (k) => {
        const blob = await idb.get(k);
        if (blob) fileUrls.set(k, URL.createObjectURL(blob));
      }));
    } catch (e) {
      console.warn('Linkly: could not load attachments', e);
    }
  }

  async function storeFile(id, blob) {
    await idb.put(id, blob);
    if (fileUrls.has(id)) URL.revokeObjectURL(fileUrls.get(id));
    fileUrls.set(id, URL.createObjectURL(blob));
  }

  async function removeFile(id) {
    await idb.del(id).catch(() => {});
    if (fileUrls.has(id)) URL.revokeObjectURL(fileUrls.get(id));
    fileUrls.delete(id);
  }

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  function seed() {
    const cats = ['Work', 'Learning', 'Tools', 'Social', 'Finance'].map((name) => ({ id: uid(), name, collapsed: false }));
    const [work, learning, tools, social, finance] = cats.map((c) => c.id);
    const L = (url, title, categoryId, note, tags, pinned = false) => ({
      id: uid(), url, title, categoryId, note, tags, pinned, favicon: '', attachment: null,
      createdAt: Date.now(), lastOpened: 0, pinnedAt: pinned ? Date.now() : 0,
    });
    return {
      version: 1,
      categories: cats,
      links: [
        L('https://mail.google.com', 'Gmail', work, 'Inbox and email.', ['daily', 'email'], true),
        L('https://calendar.google.com', 'Google Calendar', work, 'Meetings and schedule.', ['daily'], true),
        L('https://www.notion.so', 'Notion', work, 'Docs, wiki, and project notes.', ['docs', 'notes']),
        L('https://developer.mozilla.org', 'MDN Web Docs', learning, 'Reference for HTML, CSS and JavaScript.', ['docs', 'reference', 'web']),
        L('https://www.coursera.org', 'Coursera', learning, 'Online courses.', ['courses']),
        L('https://www.freecodecamp.org', 'freeCodeCamp', learning, 'Free coding curriculum.', ['courses', 'web']),
        L('https://github.com', 'GitHub', tools, 'Code, issues and pull requests.', ['daily', 'code'], true),
        L('https://claude.ai', 'Claude', tools, 'AI assistant.', ['ai', 'daily']),
        L('https://www.figma.com', 'Figma', tools, 'Design and prototyping.', ['design']),
        L('https://www.linkedin.com', 'LinkedIn', social, 'Professional network.', ['network']),
        L('https://www.youtube.com', 'YouTube', social, 'Videos and subscriptions.', ['video']),
        L('https://www.paypal.com', 'PayPal', finance, 'Payments.', ['payments']),
        L('https://finance.yahoo.com', 'Yahoo Finance', finance, 'Markets and portfolio.', ['investing']),
      ],
    };
  }

  function normalizeState(raw) {
    if (!raw || !Array.isArray(raw.categories) || !Array.isArray(raw.links)) throw new Error('Not a Linkly backup');
    const categories = raw.categories
      .filter((c) => c && typeof c.name === 'string')
      .map((c) => ({ id: String(c.id || uid()), name: c.name.slice(0, 40), collapsed: !!c.collapsed }));
    if (!categories.length) categories.push({ id: uid(), name: 'Links', collapsed: false });
    const catIds = new Set(categories.map((c) => c.id));
    const links = raw.links
      .filter((l) => l && (typeof l.url === 'string' || l.attachment))
      .map((l) => ({
        id: String(l.id || uid()),
        url: typeof l.url === 'string' ? l.url : '',
        title: String(l.title || ''),
        note: String(l.note || ''),
        tags: Array.isArray(l.tags) ? cleanTags(l.tags) : [],
        categoryId: catIds.has(l.categoryId) ? l.categoryId : categories[0].id,
        pinned: !!l.pinned,
        pinnedAt: Number(l.pinnedAt) || 0,
        favicon: typeof l.favicon === 'string' ? l.favicon : '',
        attachment: l.attachment && l.attachment.name
          ? { name: String(l.attachment.name), type: String(l.attachment.type || ''), size: Number(l.attachment.size) || 0 }
          : null,
        createdAt: Number(l.createdAt) || Date.now(),
        lastOpened: Number(l.lastOpened) || 0,
      }));
    return { version: 1, categories, links };
  }

  function load() {
    try {
      const raw = localStorage.getItem(DATA_KEY);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch (e) {
      console.warn('Linkly: stored data unreadable, starting fresh', e);
    }
    return seed();
  }

  let state = load();

  function save() {
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(state));
    } catch (e) {
      toast('Could not save — browser storage is full or disabled.');
    }
  }

  const getLink = (id) => state.links.find((l) => l.id === id);
  const getCat = (id) => state.categories.find((c) => c.id === id);

  /* ------------------------------------------------------------------ */
  /* URL helpers                                                         */
  /* ------------------------------------------------------------------ */
  const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:', 'ftp:'];

  function normalizeUrl(input) {
    let s = String(input || '').trim();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
    try {
      const u = new URL(s);
      if (!SAFE_PROTOCOLS.includes(u.protocol)) return null;
      if ((u.protocol === 'http:' || u.protocol === 'https:') && !u.hostname.includes('.') && u.hostname !== 'localhost') return null;
      return u.href;
    } catch {
      return null;
    }
  }

  function safeHref(url) {
    try {
      const u = new URL(url);
      return SAFE_PROTOCOLS.includes(u.protocol) ? u.href : '';
    } catch {
      return '';
    }
  }

  function hostOf(url) {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '') || u.protocol.replace(':', '');
    } catch {
      return '';
    }
  }

  const KNOWN_NAMES = {
    github: 'GitHub', gitlab: 'GitLab', youtube: 'YouTube', linkedin: 'LinkedIn', stackoverflow: 'Stack Overflow',
    paypal: 'PayPal', chatgpt: 'ChatGPT', openai: 'OpenAI', whatsapp: 'WhatsApp', tiktok: 'TikTok',
    freecodecamp: 'freeCodeCamp', dropbox: 'Dropbox', icloud: 'iCloud', x: 'X', mdn: 'MDN',
  };

  function guessTitle(url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'mailto:') return u.pathname;
      const parts = u.hostname.replace(/^www\./, '').split('.');
      // Pick the registrable name: "docs.google.com" -> "Google Docs", "github.com" -> "GitHub".
      const sld = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
      const pretty = (w) => KNOWN_NAMES[w] || (w.charAt(0).toUpperCase() + w.slice(1));
      let title = pretty(sld);
      const sub = parts.length > 2 ? parts[0] : '';
      if (sub && !['m', 'app', 'en', 'web'].includes(sub)) title += ' ' + pretty(sub);
      const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
      if (seg && seg.length <= 40 && !/^\d+$/.test(seg)) title += ' – ' + seg.replace(/[-_]+/g, ' ').replace(/\.\w+$/, '');
      return title;
    } catch {
      return url;
    }
  }

  const faviconFor = (link) => {
    if (link.favicon) return link.favicon;
    const host = hostOf(link.url);
    if (!host || !/^https?:/.test(link.url)) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  };

  async function fetchWithTimeout(url, ms, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  /** Best-effort lookup of a page's title and icon. Resolves to {} on failure. */
  async function fetchMeta(url) {
    if (!/^https?:/.test(url)) return {};
    // 1) Directly, which only works for sites that allow cross-origin reads.
    try {
      const res = await fetchWithTimeout(url, 3000, { mode: 'cors', credentials: 'omit' });
      if (res.ok && (res.headers.get('content-type') || '').includes('html')) {
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const title = doc.querySelector('meta[property="og:title"]')?.content || doc.title;
        const iconHref = doc.querySelector('link[rel~="icon"], link[rel="apple-touch-icon"]')?.getAttribute('href');
        const favicon = iconHref ? new URL(iconHref, res.url || url).href : '';
        if (title) return { title: title.trim(), favicon };
      }
    } catch { /* blocked by CORS or offline — fall through */ }
    // 2) Through the metadata service.
    if (!META_SERVICE) return {};
    try {
      const res = await fetchWithTimeout(META_SERVICE + encodeURIComponent(url), 6000);
      const json = await res.json();
      if (json.status === 'success' && json.data) {
        return { title: (json.data.title || '').trim(), favicon: json.data.logo?.url || '' };
      }
    } catch { /* ignore */ }
    return {};
  }

  /* ------------------------------------------------------------------ */
  /* Misc helpers                                                        */
  /* ------------------------------------------------------------------ */
  function cleanTags(list) {
    const out = [];
    for (const t of list) {
      const tag = String(t).trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').slice(0, 30);
      if (tag && !out.includes(tag)) out.push(tag);
    }
    return out;
  }
  const parseTags = (s) => cleanTags(String(s || '').split(/[,]+|\s{2,}/));

  function hue(str) {
    let h = 0;
    for (const ch of str) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return `${bytes.toFixed(i ? 1 : 0)} ${units[i]}`;
  }

  const PREVIEWABLE = /^(application\/pdf|image\/|text\/|video\/|audio\/)/;

  /* ------------------------------------------------------------------ */
  /* UI state                                                            */
  /* ------------------------------------------------------------------ */
  const searchInput = $('#search');
  const activeTags = new Set();
  const expandedNotes = new Set();

  function matches(link, tokens) {
    for (const t of activeTags) if (!link.tags.includes(t)) return false;
    if (!tokens.length) return true;
    const cat = getCat(link.categoryId);
    const hay = [link.title, link.note, link.tags.join(' '), cat ? cat.name : '', hostOf(link.url), link.attachment?.name || '']
      .join(' ').toLowerCase();
    return tokens.every((t) => hay.includes(t.replace(/^#/, '')));
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */
  function favHTML(link) {
    const src = faviconFor(link);
    const letter = escapeHtml((link.title || hostOf(link.url) || link.attachment?.name || '?').trim().charAt(0).toUpperCase());
    const bg = `hsl(${hue(link.title || link.url || '')} 55% 50%)`;
    if (!src) {
      if (!link.url && link.attachment) return `<span class="fav" style="background:var(--accent-soft);color:var(--accent)">${ICON.clip}</span>`;
      return `<span class="fav" style="background:${bg}">${letter}</span>`;
    }
    return `<span class="fav has-img" data-letter="${letter}" data-bg="${bg}"><img src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`;
  }

  /** Where clicking a link goes: its URL, or its attachment when there is no URL. */
  function primaryHref(link) {
    const href = safeHref(link.url);
    if (href) return { href, isFile: false };
    if (link.attachment && fileUrls.has(link.id)) return { href: fileUrls.get(link.id), isFile: true };
    return { href: '', isFile: false };
  }

  function attachHTML(link) {
    if (!link.attachment) return '';
    const url = fileUrls.get(link.id);
    const name = escapeHtml(link.attachment.name);
    const title = `${name}${link.attachment.size ? ' · ' + formatSize(link.attachment.size) : ''}`;
    if (!url) return `<span class="attach" title="File missing — re-attach it from Edit">${ICON.clip}<span>${name}</span></span>`;
    const dl = PREVIEWABLE.test(link.attachment.type) ? '' : ` download="${name}"`;
    return `<a class="attach" href="${url}" target="_blank" rel="noopener" data-open data-id="${link.id}" title="${title}"${dl}>${ICON.clip}<span>${name}</span></a>`;
  }

  function cardHTML(link) {
    const { href, isFile } = primaryHref(link);
    const title = escapeHtml(link.title || hostOf(link.url) || link.attachment?.name || 'Untitled');
    const sub = escapeHtml(link.url ? hostOf(link.url) : (link.attachment ? `File · ${formatSize(link.attachment.size)}` : ''));
    const note = link.note ? `<p class="card-note">${escapeHtml(link.note)}</p>` : '';
    const longNote = link.note && (link.note.length > 110 || link.note.includes('\n'));
    const expanded = expandedNotes.has(link.id);
    const dl = isFile && !PREVIEWABLE.test(link.attachment.type) ? ` download="${escapeHtml(link.attachment.name)}"` : '';
    const tags = link.tags.map((t) => `<button type="button" class="tag${activeTags.has(t) ? ' active' : ''}" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`).join('');
    return `
      <article class="card${expanded ? ' expanded' : ''}" data-id="${link.id}">
        <div class="card-top">
          ${favHTML(link)}
          <div class="card-main">
            <a class="card-title" ${href ? `href="${escapeHtml(href)}" target="_blank" rel="noopener"` : ''} data-open data-id="${link.id}"${dl} title="${title}">${title}</a>
            <div class="card-host">${sub}</div>
          </div>
        </div>
        ${note}
        ${longNote ? `<button type="button" class="note-more" data-action="toggle-note">${expanded ? 'Show less' : 'Show more'}</button>` : ''}
        ${(tags || link.attachment || link.pinned) ? `<div class="card-foot">${link.pinned ? `<span class="pin-badge" title="Pinned">${ICON.pin}</span>` : ''}${attachHTML(link)}${tags}</div>` : ''}
        <div class="card-actions">
          <button type="button" class="icon-btn drag-handle" title="Drag to reorder (or use arrow keys)" aria-label="Reorder ${title}">${ICON.grip}</button>
          <button type="button" class="icon-btn${link.pinned ? ' pin-on' : ''}" data-action="pin" title="${link.pinned ? 'Unpin' : 'Pin'}" aria-label="${link.pinned ? 'Unpin' : 'Pin'} ${title}" aria-pressed="${link.pinned}">${ICON.pin}</button>
          <button type="button" class="icon-btn" data-action="edit" title="Edit" aria-label="Edit ${title}">${ICON.edit}</button>
          <button type="button" class="icon-btn" data-action="delete" title="Delete" aria-label="Delete ${title}">${ICON.trash}</button>
        </div>
      </article>`;
  }

  function miniHTML(link) {
    const { href, isFile } = primaryHref(link);
    const title = escapeHtml(link.title || hostOf(link.url) || link.attachment?.name || 'Untitled');
    const dl = isFile && !PREVIEWABLE.test(link.attachment.type) ? ` download="${escapeHtml(link.attachment.name)}"` : '';
    return `<a class="mini" ${href ? `href="${escapeHtml(href)}" target="_blank" rel="noopener"` : ''} data-open data-id="${link.id}" title="${title}"${dl}>${favHTML(link)}<span>${title}</span></a>`;
  }

  function renderCategorySelects() {
    const opts = state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    for (const sel of [$('#qaCategory'), $('#linkForm').elements.categoryId]) {
      const prev = sel.value;
      sel.innerHTML = opts;
      if (getCat(prev)) sel.value = prev;
    }
  }

  function renderTagbar() {
    const counts = new Map();
    for (const l of state.links) for (const t of l.tags) counts.set(t, (counts.get(t) || 0) + 1);
    for (const t of [...activeTags]) if (!counts.has(t)) activeTags.delete(t);
    const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    $('#tagbar').innerHTML = !tags.length ? '' :
      tags.map(([t, n]) => `<button type="button" class="chip" data-tag="${escapeHtml(t)}" aria-pressed="${activeTags.has(t)}">#${escapeHtml(t)} <span class="chip-count">${n}</span></button>`).join('') +
      (activeTags.size ? '<button type="button" class="chip chip-clear" data-action="clear-tags">Clear filter</button>' : '');
  }

  function render() {
    renderCategorySelects();
    renderTagbar();

    const tokens = searchInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtering = tokens.length > 0 || activeTags.size > 0;
    const visible = state.links.filter((l) => matches(l, tokens));

    // Pinned and recent rows (hidden while searching to keep results focused).
    const pinned = filtering ? [] : state.links.filter((l) => l.pinned).sort((a, b) => (a.pinnedAt || 0) - (b.pinnedAt || 0));
    $('#pinnedSection').hidden = !pinned.length;
    $('#pinnedRow').innerHTML = pinned.map(miniHTML).join('');

    const recent = filtering ? [] : state.links.filter((l) => l.lastOpened).sort((a, b) => b.lastOpened - a.lastOpened).slice(0, RECENT_LIMIT);
    $('#recentSection').hidden = !recent.length;
    $('#recentRow').innerHTML = recent.map(miniHTML).join('');

    // Category sections.
    const html = [];
    state.categories.forEach((cat, i) => {
      const all = state.links.filter((l) => l.categoryId === cat.id);
      const items = all.filter((l) => visible.includes(l));
      if (filtering && !items.length) return;
      const collapsed = cat.collapsed && !filtering;
      html.push(`
        <section class="category${collapsed ? ' collapsed' : ''}" data-cat="${cat.id}">
          <div class="cat-head" data-cat="${cat.id}">
            <h2 class="cat-heading"><button type="button" class="cat-toggle" data-action="toggle-cat" aria-expanded="${!collapsed}">
              ${ICON.chevron}<span class="cat-title">${escapeHtml(cat.name)}</span>
              <span class="cat-count">${filtering ? `${items.length}/${all.length}` : all.length}</span>
            </button></h2>
            <div class="cat-actions">
              <button type="button" class="icon-btn" data-action="add-to-cat" title="Add link to ${escapeHtml(cat.name)}" aria-label="Add link to ${escapeHtml(cat.name)}">${ICON.plus}</button>
              <button type="button" class="icon-btn" data-action="cat-up" title="Move category up" aria-label="Move ${escapeHtml(cat.name)} up" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
              <button type="button" class="icon-btn" data-action="cat-down" title="Move category down" aria-label="Move ${escapeHtml(cat.name)} down" ${i === state.categories.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
              <button type="button" class="icon-btn" data-action="edit-cat" title="Rename or delete category" aria-label="Edit ${escapeHtml(cat.name)}">${ICON.edit}</button>
            </div>
          </div>
          <div class="grid" data-cat="${cat.id}">
            ${items.length ? items.map(cardHTML).join('') : '<div class="grid-empty">No links yet — drag one here or use + to add.</div>'}
          </div>
        </section>`);
    });
    $('#categories').innerHTML = html.join('');

    const status = $('#status');
    if (filtering) {
      const parts = [];
      if (tokens.length) parts.push(`“${escapeHtml(searchInput.value.trim())}”`);
      if (activeTags.size) parts.push([...activeTags].map((t) => '#' + escapeHtml(t)).join(' + '));
      status.innerHTML = `${visible.length} ${visible.length === 1 ? 'link' : 'links'} matching ${parts.join(' and ')}`;
    } else {
      status.textContent = '';
    }

    const empty = $('#emptyState');
    if (filtering && !visible.length) {
      empty.hidden = false;
      empty.textContent = 'Nothing matches. Try a different search or clear the tag filter.';
    } else if (!state.links.length) {
      empty.hidden = false;
      empty.textContent = 'Your hub is empty. Paste a URL above to add your first link.';
    } else {
      empty.hidden = true;
    }
  }

  // Replace broken favicons with a lettered tile.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const fav = img.closest('.fav');
    if (!fav) return;
    fav.classList.remove('has-img');
    fav.style.background = fav.dataset.bg;
    fav.textContent = fav.dataset.letter || '?';
  }, true);

  /* ------------------------------------------------------------------ */
  /* Toast                                                               */
  /* ------------------------------------------------------------------ */
  let toastTimer;
  function toast(message, action) {
    const el = $('#toast');
    el.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = message;
    el.append(span);
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = action.label;
      btn.onclick = () => { el.hidden = true; action.run(); };
      el.append(btn);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3000);
  }

  function flash(id) {
    const card = $(`#categories .card[data-id="${CSS.escape(id)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    card.animate([{ boxShadow: '0 0 0 3px var(--accent)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1200, easing: 'ease-out' });
  }

  /* ------------------------------------------------------------------ */
  /* Link operations                                                     */
  /* ------------------------------------------------------------------ */
  function markOpened(id) {
    const link = getLink(id);
    if (!link) return;
    link.lastOpened = Date.now();
    save();
    // Defer so the browser finishes following the link before the DOM is rebuilt.
    setTimeout(render, 100);
  }

  function togglePin(id) {
    const link = getLink(id);
    link.pinned = !link.pinned;
    link.pinnedAt = link.pinned ? Date.now() : 0;
    save();
    render();
  }

  async function deleteLink(id) {
    const index = state.links.findIndex((l) => l.id === id);
    if (index < 0) return;
    const [link] = state.links.splice(index, 1);
    let blob = null;
    if (link.attachment) {
      blob = await idb.get(id).catch(() => null);
      await removeFile(id);
    }
    save();
    render();
    toast(`Deleted “${link.title || 'link'}”`, {
      label: 'Undo',
      run: async () => {
        state.links.splice(Math.min(index, state.links.length), 0, link);
        if (blob) await storeFile(id, blob);
        save();
        render();
      },
    });
  }

  /** Re-insert a link into a category, before `beforeId` (or at the end). */
  function moveLink(id, categoryId, beforeId) {
    const from = state.links.findIndex((l) => l.id === id);
    if (from < 0) return;
    const [link] = state.links.splice(from, 1);
    link.categoryId = categoryId;
    let to = beforeId ? state.links.findIndex((l) => l.id === beforeId) : -1;
    if (to < 0) {
      // After the last link of the target category, or at the very end.
      let last = -1;
      state.links.forEach((l, i) => { if (l.categoryId === categoryId) last = i; });
      to = last >= 0 ? last + 1 : state.links.length;
    }
    state.links.splice(to, 0, link);
    save();
    render();
  }

  function nudgeLink(id, delta) {
    const link = getLink(id);
    const siblings = state.links.filter((l) => l.categoryId === link.categoryId);
    const i = siblings.indexOf(link);
    const j = i + delta;
    if (j < 0 || j >= siblings.length) return;
    // Moving down by one means inserting before the item two places ahead.
    const before = delta < 0 ? siblings[j] : siblings[j + 1];
    moveLink(id, link.categoryId, before ? before.id : null);
    $(`#categories .card[data-id="${CSS.escape(id)}"] .drag-handle`)?.focus();
  }

  /* ------------------------------------------------------------------ */
  /* Quick add                                                           */
  /* ------------------------------------------------------------------ */
  async function autofill(id, guessed) {
    const link = getLink(id);
    if (!link) return;
    const meta = await fetchMeta(link.url);
    const fresh = getLink(id);
    if (!fresh) return;
    let changed = false;
    // Only replace the title if the user has not edited it in the meantime.
    if (meta.title && fresh.title === guessed) { fresh.title = meta.title.slice(0, 120); changed = true; }
    if (meta.favicon && !fresh.favicon && /^https:/.test(meta.favicon)) { fresh.favicon = meta.favicon; changed = true; }
    if (changed) { save(); render(); }
  }

  function findDuplicate(url, exceptId) {
    return state.links.find((l) => l.url && l.url === url && l.id !== exceptId);
  }

  $('#quickAdd').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = $('#qaUrl').value;
    if (!raw.trim()) {
      openLinkDialog(null, { categoryId: $('#qaCategory').value, tags: $('#qaTags').value });
      return;
    }
    const url = normalizeUrl(raw);
    if (!url) { toast('That does not look like a valid URL.'); $('#qaUrl').focus(); return; }
    const dup = findDuplicate(url);
    if (dup) {
      toast(`Already saved in ${getCat(dup.categoryId)?.name || 'your hub'}.`);
      flash(dup.id);
      return;
    }
    const title = guessTitle(url);
    const link = {
      id: uid(), url, title, note: '', tags: parseTags($('#qaTags').value),
      categoryId: $('#qaCategory').value || state.categories[0].id,
      pinned: false, pinnedAt: 0, favicon: '', attachment: null, createdAt: Date.now(), lastOpened: 0,
    };
    state.links.push(link);
    moveLink(link.id, link.categoryId, null);
    $('#qaUrl').value = '';
    $('#qaTags').value = '';
    const cat = getCat(link.categoryId);
    if (cat.collapsed) { cat.collapsed = false; save(); render(); }
    flash(link.id);
    toast(`Added to ${cat.name}`, { label: 'Edit', run: () => openLinkDialog(link.id) });
    autofill(link.id, title);
  });

  $('#qaMore').addEventListener('click', () => {
    openLinkDialog(null, { url: $('#qaUrl').value, categoryId: $('#qaCategory').value, tags: $('#qaTags').value });
  });

  /* ------------------------------------------------------------------ */
  /* Link dialog                                                         */
  /* ------------------------------------------------------------------ */
  const linkDialog = $('#linkDialog');
  const linkForm = $('#linkForm');
  let editing = null; // { id, pendingFile, removeFile, guessed }

  function renderAttachField() {
    const box = $('#attachCurrent');
    const link = editing.id ? getLink(editing.id) : null;
    let info = '';
    if (editing.pendingFile) info = `${editing.pendingFile.name} · ${formatSize(editing.pendingFile.size)} (new)`;
    else if (link?.attachment && !editing.removeFile) info = `${link.attachment.name} · ${formatSize(link.attachment.size)}`;
    box.innerHTML = info ? `${ICON.clip}<span>${escapeHtml(info)}</span><button type="button" data-action="remove-file">Remove</button>` : '';
    linkForm.querySelector('.file-btn span').textContent = info ? 'Replace file…' : 'Choose file…';
  }

  function openLinkDialog(id, preset = {}) {
    const link = id ? getLink(id) : null;
    editing = { id, pendingFile: null, removeFile: false, guessed: '' };
    renderCategorySelects();
    const f = linkForm.elements;
    $('#linkDialogTitle').textContent = link ? 'Edit link' : 'Add link';
    f.url.value = link ? link.url : (preset.url || '');
    f.title.value = link ? link.title : '';
    f.note.value = link ? link.note : '';
    f.tags.value = link ? link.tags.join(', ') : (preset.tags || '');
    f.categoryId.value = link ? link.categoryId : (preset.categoryId || state.categories[0].id);
    f.pinned.checked = link ? link.pinned : false;
    f.file.value = '';
    $('#deleteLinkBtn').hidden = !link;
    $('#linkFormError').textContent = '';
    renderAttachField();
    linkDialog.showModal();
    if (!link && f.url.value) onDialogUrlChange();
    (link ? f.title : f.url).focus();
  }

  async function onDialogUrlChange() {
    const f = linkForm.elements;
    const url = normalizeUrl(f.url.value);
    if (!url) return;
    if (!f.title.value.trim() || f.title.value === editing.guessed) {
      editing.guessed = guessTitle(url);
      f.title.value = editing.guessed;
      const token = editing;
      const meta = await fetchMeta(url);
      if (editing === token && meta.title && f.title.value === editing.guessed && normalizeUrl(f.url.value) === url) {
        f.title.value = meta.title.slice(0, 120);
        editing.guessed = f.title.value;
        editing.favicon = meta.favicon && /^https:/.test(meta.favicon) ? meta.favicon : '';
      }
    }
  }

  linkForm.elements.url.addEventListener('change', onDialogUrlChange);
  linkForm.elements.url.addEventListener('paste', () => setTimeout(onDialogUrlChange, 0));

  linkForm.elements.file.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    editing.pendingFile = file;
    editing.removeFile = false;
    const f = linkForm.elements;
    if (!f.title.value.trim() && !f.url.value.trim()) f.title.value = file.name.replace(/\.[^.]+$/, '');
    renderAttachField();
  });

  $('#attachCurrent').addEventListener('click', (e) => {
    if (!e.target.closest('[data-action="remove-file"]')) return;
    editing.pendingFile = null;
    editing.removeFile = true;
    linkForm.elements.file.value = '';
    renderAttachField();
  });

  linkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = linkForm.elements;
    const err = $('#linkFormError');
    const existing = editing.id ? getLink(editing.id) : null;
    const hasFile = !!editing.pendingFile || (existing?.attachment && !editing.removeFile);
    let url = '';
    if (f.url.value.trim()) {
      url = normalizeUrl(f.url.value);
      if (!url) { err.textContent = 'Please enter a valid URL (http, https, or mailto).'; f.url.focus(); return; }
    } else if (!hasFile) {
      err.textContent = 'Add a URL, attach a file, or both.'; f.url.focus(); return;
    }
    const dup = url && findDuplicate(url, editing.id);
    if (dup && !existing) { err.textContent = `This URL is already saved as “${dup.title}”.`; return; }

    const id = editing.id || uid();
    const link = existing || {
      id, createdAt: Date.now(), lastOpened: 0, pinned: false, pinnedAt: 0, favicon: '', attachment: null,
    };
    if (existing && existing.url !== url) link.favicon = '';
    if (!existing && editing.favicon) link.favicon = editing.favicon;
    link.url = url;
    link.title = f.title.value.trim() || (url ? guessTitle(url) : editing.pendingFile?.name || 'Untitled');
    link.note = f.note.value.trim();
    link.tags = parseTags(f.tags.value);
    if (f.pinned.checked !== link.pinned) { link.pinned = f.pinned.checked; link.pinnedAt = link.pinned ? Date.now() : 0; }

    try {
      if (editing.pendingFile) {
        const file = editing.pendingFile;
        await storeFile(id, file);
        link.attachment = { name: file.name, type: file.type, size: file.size };
      } else if (editing.removeFile && link.attachment) {
        await removeFile(id);
        link.attachment = null;
      }
    } catch (ex) {
      err.textContent = 'Could not store the file in this browser (it may be too large).';
      return;
    }

    const newCat = f.categoryId.value;
    if (!existing) {
      link.categoryId = newCat;
      state.links.push(link);
      moveLink(id, newCat, null);
    } else if (existing.categoryId !== newCat) {
      moveLink(id, newCat, null);
    } else {
      save();
      render();
    }
    const titleWasGuess = !existing && url && link.title === guessTitle(url);
    linkDialog.close();
    flash(id);
    if (titleWasGuess) autofill(id, link.title);
  });

  $('#deleteLinkBtn').addEventListener('click', () => {
    const id = editing.id;
    linkDialog.close();
    deleteLink(id);
  });

  /* ------------------------------------------------------------------ */
  /* Category dialog                                                     */
  /* ------------------------------------------------------------------ */
  const catDialog = $('#catDialog');
  const catForm = $('#catForm');
  let editingCat = null;

  function openCatDialog(id) {
    editingCat = id;
    const cat = id ? getCat(id) : null;
    $('#catDialogTitle').textContent = cat ? 'Edit category' : 'New category';
    catForm.elements.name.value = cat ? cat.name : '';
    $('#deleteCatBtn').hidden = !cat || state.categories.length <= 1;
    catDialog.showModal();
    catForm.elements.name.select();
  }

  catForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = catForm.elements.name.value.trim();
    if (!name) return;
    if (editingCat) getCat(editingCat).name = name;
    else state.categories.push({ id: uid(), name, collapsed: false });
    save();
    render();
    catDialog.close();
  });

  $('#deleteCatBtn').addEventListener('click', () => {
    const cat = getCat(editingCat);
    const others = state.categories.filter((c) => c.id !== cat.id);
    const count = state.links.filter((l) => l.categoryId === cat.id).length;
    const target = others[0];
    if (count && !confirm(`Delete “${cat.name}”? Its ${count} ${count === 1 ? 'link' : 'links'} will move to “${target.name}”.`)) return;
    state.links.forEach((l) => { if (l.categoryId === cat.id) l.categoryId = target.id; });
    state.categories = others;
    save();
    render();
    catDialog.close();
  });

  // Generic close buttons inside dialogs.
  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (closer) closer.closest('dialog').close();
  });
  // Clicking the backdrop closes a dialog.
  for (const d of $$('dialog')) {
    d.addEventListener('mousedown', (e) => { if (e.target === d) d.close(); });
  }

  /* ------------------------------------------------------------------ */
  /* Main click handling (event delegation)                              */
  /* ------------------------------------------------------------------ */
  function toggleTag(tag) {
    if (activeTags.has(tag)) activeTags.delete(tag);
    else activeTags.add(tag);
    render();
  }

  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) {
      if (open.hasAttribute('href')) markOpened(open.dataset.id);
      return;
    }

    const tagBtn = e.target.closest('[data-tag]');
    if (tagBtn) { toggleTag(tagBtn.dataset.tag); return; }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('.card');
    const catEl = btn.closest('[data-cat]');
    const id = card?.dataset.id;
    const catId = catEl?.dataset.cat;

    switch (btn.dataset.action) {
      case 'pin': togglePin(id); break;
      case 'edit': openLinkDialog(id); break;
      case 'delete': deleteLink(id); break;
      case 'toggle-note':
        if (expandedNotes.has(id)) expandedNotes.delete(id); else expandedNotes.add(id);
        render();
        break;
      case 'toggle-cat': {
        if (searchInput.value.trim() || activeTags.size) break; // always expanded while filtering
        const cat = getCat(catId);
        cat.collapsed = !cat.collapsed;
        save();
        render();
        break;
      }
      case 'add-to-cat': openLinkDialog(null, { categoryId: catId }); break;
      case 'edit-cat': openCatDialog(catId); break;
      case 'cat-up':
      case 'cat-down': {
        const i = state.categories.findIndex((c) => c.id === catId);
        const j = i + (btn.dataset.action === 'cat-up' ? -1 : 1);
        if (j < 0 || j >= state.categories.length) break;
        [state.categories[i], state.categories[j]] = [state.categories[j], state.categories[i]];
        save();
        render();
        $(`.cat-head[data-cat="${CSS.escape(catId)}"] [data-action="${btn.dataset.action}"]`)?.focus();
        break;
      }
      case 'clear-tags': activeTags.clear(); render(); break;
    }
  });

  // Middle-click opens count as "opened" too.
  document.addEventListener('auxclick', (e) => {
    const open = e.target.closest('[data-open]');
    if (open && e.button === 1 && open.hasAttribute('href')) markOpened(open.dataset.id);
  });

  // Keyboard reordering on the drag handle.
  document.addEventListener('keydown', (e) => {
    const handle = e.target.closest?.('.drag-handle');
    if (!handle) return;
    const delta = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    nudgeLink(handle.closest('.card').dataset.id, delta);
  });

  /* ------------------------------------------------------------------ */
  /* Drag and drop (pointer events: works with mouse, touch, and pen)    */
  /* ------------------------------------------------------------------ */
  let drag = null;

  document.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || e.button !== 0) return;
    const card = handle.closest('.card');
    if (!card || !card.closest('#categories')) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    drag = { id: card.dataset.id, card, handle, startX: e.clientX, startY: e.clientY, started: false, pointerId: e.pointerId };
  });

  function startDrag(e) {
    const { card } = drag;
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    document.body.append(ghost);
    const placeholder = document.createElement('div');
    placeholder.className = 'drop-placeholder';
    placeholder.style.height = rect.height + 'px';
    card.after(placeholder);
    card.classList.add('dragging');
    card.style.display = 'none';
    Object.assign(drag, { started: true, ghost, placeholder, offX: e.clientX - rect.left, offY: e.clientY - rect.top, headTarget: null });
    document.body.classList.add('is-dragging');
  }

  function autoScroll(y) {
    const edge = 70;
    if (y < edge) window.scrollBy(0, -Math.ceil((edge - y) / 4));
    else if (y > window.innerHeight - edge) window.scrollBy(0, Math.ceil((y - (window.innerHeight - edge)) / 4));
  }

  document.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) return;
      startDrag(e);
    }
    drag.ghost.style.left = e.clientX - drag.offX + 'px';
    drag.ghost.style.top = e.clientY - drag.offY + 'px';
    autoScroll(e.clientY);

    const el = document.elementFromPoint(e.clientX, e.clientY);
    drag.headTarget?.classList.remove('drop-target');
    drag.headTarget = null;
    if (!el) return;

    const head = el.closest('.cat-head');
    if (head) {
      // Dropping on a header (useful when the category is collapsed) appends to it.
      head.classList.add('drop-target');
      drag.headTarget = head;
      return;
    }
    const overCard = el.closest('#categories .card:not(.dragging)');
    if (overCard) {
      const r = overCard.getBoundingClientRect();
      const singleColumn = overCard.parentElement.clientWidth < r.width * 2;
      const after = singleColumn ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
      if (after) overCard.after(drag.placeholder); else overCard.before(drag.placeholder);
      return;
    }
    const grid = el.closest('#categories .grid');
    if (grid && drag.placeholder.parentElement !== grid) {
      grid.querySelector('.grid-empty')?.remove();
      grid.append(drag.placeholder);
    }
  });

  function endDrag(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.handle.hasPointerCapture?.(d.pointerId)) d.handle.releasePointerCapture(d.pointerId);
    if (!d.started) return;
    document.body.classList.remove('is-dragging');
    d.ghost.remove();
    d.headTarget?.classList.remove('drop-target');
    if (!commit) { render(); return; }

    if (d.headTarget) {
      moveLink(d.id, d.headTarget.dataset.cat, null);
    } else {
      const grid = d.placeholder.parentElement;
      let next = d.placeholder.nextElementSibling;
      while (next && !(next.classList.contains('card') && !next.classList.contains('dragging'))) next = next.nextElementSibling;
      if (grid?.dataset.cat) moveLink(d.id, grid.dataset.cat, next ? next.dataset.id : null);
      else render();
    }
    flash(d.id);
  }

  document.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.pointerId) endDrag(true); });
  document.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.pointerId) endDrag(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag?.started) endDrag(false); });

  /* ------------------------------------------------------------------ */
  /* Search & keyboard shortcuts                                         */
  /* ------------------------------------------------------------------ */
  searchInput.addEventListener('input', render);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      render();
      searchInput.blur();
    } else if (e.key === 'Enter') {
      // Enter opens the first result.
      const first = $('#categories .card .card-title[href]');
      if (first) first.click();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || $('dialog[open]')) return;
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  });

  /* ------------------------------------------------------------------ */
  /* Theme                                                               */
  /* ------------------------------------------------------------------ */
  $('#themeToggle').addEventListener('click', () => {
    const root = document.documentElement;
    const current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
  });

  /* ------------------------------------------------------------------ */
  /* Menu, export & import                                               */
  /* ------------------------------------------------------------------ */
  const menuBtn = $('#menuBtn');
  const menuList = $('#menuList');
  const setMenu = (open) => { menuList.hidden = !open; menuBtn.setAttribute('aria-expanded', open); };
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menuList.hidden); });
  document.addEventListener('click', (e) => { if (!menuList.hidden && !e.target.closest('.menu')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menuList.hidden) { setMenu(false); menuBtn.focus(); } });

  menuList.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    setMenu(false);
    if (action === 'add-category') openCatDialog(null);
    if (action === 'export') exportData();
    if (action === 'import') $('#importFile').click();
    if (action === 'clear-recent') {
      state.links.forEach((l) => { l.lastOpened = 0; });
      save();
      render();
    }
  });

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  async function exportData() {
    const files = {};
    for (const link of state.links) {
      if (!link.attachment) continue;
      const blob = await idb.get(link.id).catch(() => null);
      if (blob) files[link.id] = await blobToDataUrl(blob);
    }
    const data = { app: 'linkly', version: 1, exportedAt: new Date().toISOString(), categories: state.categories, links: state.links, files };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `linkly-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Exported ${state.links.length} links${Object.keys(files).length ? ` and ${Object.keys(files).length} files` : ''}.`);
  }

  let pendingImport = null;

  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      const data = normalizeState(raw);
      const files = raw.files && typeof raw.files === 'object' ? raw.files : {};
      pendingImport = { data, files };
      const fileCount = Object.keys(files).length;
      $('#importSummary').textContent =
        `This backup has ${data.links.length} links in ${data.categories.length} categories${fileCount ? ` and ${fileCount} attached files` : ''}. ` +
        'Merge adds new links to what you have; Replace all swaps your current hub for the backup.';
      $('#importDialog').showModal();
    } catch (ex) {
      toast('That file is not a valid Linkly backup.');
    }
  });

  async function restoreFile(id, dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return false;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await storeFile(id, blob);
      return true;
    } catch {
      return false;
    }
  }

  $('#importReplace').addEventListener('click', async () => {
    if (!pendingImport) return;
    const { data, files } = pendingImport;
    pendingImport = null;
    $('#importDialog').close();
    await idb.clear().catch(() => {});
    for (const url of fileUrls.values()) URL.revokeObjectURL(url);
    fileUrls.clear();
    for (const link of data.links) {
      if (link.attachment && !(await restoreFile(link.id, files[link.id]))) link.attachment = null;
    }
    state = data;
    activeTags.clear();
    save();
    render();
    toast(`Imported ${data.links.length} links.`);
  });

  $('#importMerge').addEventListener('click', async () => {
    if (!pendingImport) return;
    const { data, files } = pendingImport;
    pendingImport = null;
    $('#importDialog').close();
    // Match categories by name; create the ones that don't exist yet.
    const catMap = new Map();
    for (const c of data.categories) {
      let mine = state.categories.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
      if (!mine) { mine = { id: uid(), name: c.name, collapsed: false }; state.categories.push(mine); }
      catMap.set(c.id, mine.id);
    }
    let added = 0;
    for (const link of data.links) {
      if (link.url && state.links.some((l) => l.url === link.url)) continue;
      const oldId = link.id;
      link.id = uid();
      link.categoryId = catMap.get(link.categoryId);
      if (link.attachment && !(await restoreFile(link.id, files[oldId]))) link.attachment = null;
      state.links.push(link);
      added++;
    }
    // Keep links grouped by category order so drag-and-drop indices stay tidy.
    const order = new Map(state.categories.map((c, i) => [c.id, i]));
    state.links = state.links.map((l, i) => [l, i]).sort((a, b) => order.get(a[0].categoryId) - order.get(b[0].categoryId) || a[1] - b[1]).map(([l]) => l);
    save();
    render();
    toast(`Merged ${added} new ${added === 1 ? 'link' : 'links'}.`);
  });

  // Keep multiple tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key === DATA_KEY && e.newValue) {
      try { state = normalizeState(JSON.parse(e.newValue)); render(); } catch { /* ignore */ }
    }
  });

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  render();
  loadFiles().then(render);
  if (!localStorage.getItem(DATA_KEY)) save();
})();
