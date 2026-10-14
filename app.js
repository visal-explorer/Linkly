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
    folderPlus: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M12 11v4M10 13h4"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
    folderOpen: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h7a2 2 0 012 2v1"/><path d="M3 7v10a2 2 0 002 2h12.5a2 2 0 001.9-1.4l1.6-5A1.5 1.5 0 0019.6 11H7.4a2 2 0 00-1.9 1.4L3 19"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/></svg>',
    hash: '<svg viewBox="0 0 24 24"><path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
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
    const cats = ['Work', 'Learning', 'Tools', 'Social', 'Finance'].map((name) => ({ id: uid(), name, collapsed: false, groups: [] }));
    const [work, learning, tools, social, finance] = cats.map((c) => c.id);
    const F = (name, parentId = null) => ({ id: uid(), name, collapsed: false, parentId });
    const [tech, stocks, trading] = ['Technology', 'Stocks', 'Trading'].map((name) => F(name));
    const webDev = F('Web development', tech.id);
    cats[1].groups = [tech, webDev, stocks, trading];
    const L = (url, title, categoryId, note, tags, pinned = false, groupId = null) => ({
      id: uid(), url, title, categoryId, groupId, note, tags, pinned, favicon: '', attachment: null,
      createdAt: Date.now(), lastOpened: 0, pinnedAt: pinned ? Date.now() : 0,
    });
    return {
      version: 1,
      categories: cats,
      links: [
        L('https://mail.google.com', 'Gmail', work, 'Inbox and email.', ['daily', 'email'], true),
        L('https://calendar.google.com', 'Google Calendar', work, 'Meetings and schedule.', ['daily'], true),
        L('https://www.notion.so', 'Notion', work, 'Docs, wiki, and project notes.', ['docs', 'notes']),
        L('https://www.coursera.org', 'Coursera', learning, 'Online courses.', ['courses']),
        L('https://developer.mozilla.org', 'MDN Web Docs', learning, 'Reference for HTML, CSS and JavaScript.', ['docs', 'reference', 'web'], false, webDev.id),
        L('https://www.freecodecamp.org', 'freeCodeCamp', learning, 'Free coding curriculum.', ['courses', 'web'], false, webDev.id),
        L('https://news.ycombinator.com', 'Hacker News', learning, 'Tech news and discussion.', ['news'], false, tech.id),
        L('https://www.investopedia.com', 'Investopedia', learning, 'Investing terms and guides.', ['investing', 'reference'], false, stocks.id),
        L('https://www.tradingview.com', 'TradingView', learning, 'Charts and trading ideas.', ['charts'], false, trading.id),
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
      .map((c) => ({
        id: String(c.id || uid()),
        name: c.name.slice(0, 40),
        collapsed: !!c.collapsed,
        groups: (Array.isArray(c.groups) ? c.groups : [])
          .filter((g) => g && typeof g.name === 'string')
          .map((g) => ({ id: String(g.id || uid()), name: g.name.slice(0, 40), collapsed: !!g.collapsed, parentId: g.parentId ? String(g.parentId) : null })),
      }));
    // Folders nest via parentId; drop parents that are missing or would form a loop.
    for (const cat of categories) {
      const byId = new Map(cat.groups.map((g) => [g.id, g]));
      for (const g of cat.groups) {
        const seen = new Set([g.id]);
        for (let p = g.parentId; p; p = byId.get(p)?.parentId) {
          if (!byId.has(p) || seen.has(p)) { g.parentId = null; break; }
          seen.add(p);
        }
      }
    }
    if (!categories.length) categories.push({ id: uid(), name: 'Links', collapsed: false, groups: [] });
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
        groupId: l.groupId ? String(l.groupId) : null,
        pinned: !!l.pinned,
        pinnedAt: Number(l.pinnedAt) || 0,
        favicon: typeof l.favicon === 'string' ? l.favicon : '',
        attachment: l.attachment && l.attachment.name
          ? { name: String(l.attachment.name), type: String(l.attachment.type || ''), size: Number(l.attachment.size) || 0 }
          : null,
        createdAt: Number(l.createdAt) || Date.now(),
        lastOpened: Number(l.lastOpened) || 0,
      }));
    // Drop group references that don't belong to the link's category.
    for (const l of links) {
      const cat = categories.find((c) => c.id === l.categoryId);
      if (l.groupId && !cat.groups.some((g) => g.id === l.groupId)) l.groupId = null;
    }
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
  const getGroup = (catId, groupId) => (groupId ? getCat(catId)?.groups.find((g) => g.id === groupId) : null);
  // Folders ("groups") live flat in cat.groups and nest through parentId; array order is sibling order.
  const childFolders = (cat, parentId) => cat.groups.filter((g) => (g.parentId || null) === (parentId || null));
  /** Folders from the top level down to `groupId`. */
  function folderPath(catId, groupId) {
    const path = [];
    for (let g = getGroup(catId, groupId); g; g = getGroup(catId, g.parentId)) path.unshift(g);
    return path;
  }
  /** A folder's id plus the ids of every folder nested inside it. */
  function folderAndDescendants(cat, id) {
    const ids = new Set([id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const g of cat.groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) { ids.add(g.id); grew = true; }
    }
    return ids;
  }
  /** Depth-first list of a category's folders, as [{ folder, depth }]. */
  function folderTree(cat, parentId = null, depth = 0, out = []) {
    for (const g of childFolders(cat, parentId)) {
      out.push({ folder: g, depth });
      folderTree(cat, g.id, depth + 1, out);
    }
    return out;
  }
  // Category + folder are picked together in one <select> as "catId|groupId".
  const placeValue = (catId, groupId) => `${catId}|${groupId || ''}`;
  const parsePlace = (v) => { const [c, g] = String(v || '').split('|'); return { categoryId: c, groupId: g || null }; };

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
    const folders = folderPath(link.categoryId, link.groupId).map((g) => g.name).join(' ');
    const hay = [link.title, link.note, link.tags.join(' '), cat ? cat.name : '', folders, hostOf(link.url), link.attachment?.name || '']
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
          ${safeHref(link.url) ? `<button type="button" class="icon-btn" data-action="copy" title="Copy link" aria-label="Copy link to ${title}">${ICON.copy}</button>` : ''}
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

  const NEW_GROUP = '__new-group';

  function renderCategorySelects() {
    const opts = state.categories.map((c) =>
      `<option value="${placeValue(c.id)}">${escapeHtml(c.name)}</option>` +
      folderTree(c).map(({ folder }) => `<option value="${placeValue(c.id, folder.id)}">${escapeHtml(placeName({ categoryId: c.id, groupId: folder.id }))}</option>`).join('')).join('');
    for (const sel of [$('#qaCategory'), $('#linkForm').elements.categoryId]) {
      const prev = sel.value;
      sel.innerHTML = opts + `<option value="${NEW_GROUP}">＋ New folder here…</option>`;
      const { categoryId, groupId } = parsePlace(prev);
      if (getCat(categoryId)) sel.value = placeValue(categoryId, getGroup(categoryId, groupId) ? groupId : null);
      sel.dataset.prev = sel.value;
    }
  }

  // Choosing "New folder here…" in a place picker creates a folder inside whatever was selected.
  function onPlaceChange(e) {
    const sel = e.target;
    if (sel.value !== NEW_GROUP) { sel.dataset.prev = sel.value; return; }
    const { categoryId, groupId } = parsePlace(sel.dataset.prev);
    sel.value = sel.dataset.prev;
    openGroupDialog(categoryId, null, (group) => { sel.value = placeValue(categoryId, group.id); sel.dataset.prev = sel.value; }, groupId);
  }
  $('#qaCategory').addEventListener('change', onPlaceChange);
  $('#linkForm').elements.categoryId.addEventListener('change', onPlaceChange);

  function renderTagbar() {
    const counts = new Map();
    for (const l of state.links) for (const t of l.tags) counts.set(t, (counts.get(t) || 0) + 1);
    for (const t of [...activeTags]) if (!counts.has(t)) activeTags.delete(t);
    const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    $('#tagbar').innerHTML = !tags.length ? '' :
      tags.map(([t, n]) => `<button type="button" class="chip" data-tag="${escapeHtml(t)}" aria-pressed="${activeTags.has(t)}">#${escapeHtml(t)} <span class="chip-count">${n}</span></button>`).join('') +
      (activeTags.size ? '<button type="button" class="chip chip-clear" data-action="clear-tags">Clear filter</button>' : '');
  }

  /** One folder section, with its own links first and then its sub-folders (recursively). */
  function folderHTML(cat, g, all, items, filtering, depth) {
    const ids = folderAndDescendants(cat, g.id);
    const total = all.filter((l) => ids.has(l.groupId)).length;
    const shown = items.filter((l) => ids.has(l.groupId)).length;
    if (filtering && !shown) return '';
    const direct = items.filter((l) => l.groupId === g.id);
    const children = childFolders(cat, g.id);
    const siblings = childFolders(cat, g.parentId);
    const pos = siblings.indexOf(g);
    const collapsed = g.collapsed && !filtering;
    const label = escapeHtml(placeName({ categoryId: cat.id, groupId: g.id }));
    const showGrid = filtering ? direct.length : (direct.length || !children.length);
    return `
      <div class="group${collapsed ? ' collapsed' : ''}" data-cat="${cat.id}" data-group="${g.id}" data-depth="${depth}">
        <div class="group-head" data-cat="${cat.id}" data-group="${g.id}">
          <h3 class="group-heading"><button type="button" class="group-toggle" data-action="toggle-group" aria-expanded="${!collapsed}">
            ${ICON.chevron}<span class="group-icon">${collapsed ? ICON.folder : ICON.folderOpen}</span><span class="group-title">${escapeHtml(g.name)}</span>
            <span class="cat-count">${filtering ? `${shown}/${total}` : total}</span>
          </button></h3>
          <div class="cat-actions">
            <button type="button" class="icon-btn" data-action="add-to-group" title="Add link to ${label}" aria-label="Add link to ${label}">${ICON.plus}</button>
            <button type="button" class="icon-btn" data-action="add-subfolder" title="New sub-folder in ${label}" aria-label="New sub-folder in ${label}">${ICON.folderPlus}</button>
            <button type="button" class="icon-btn" data-action="group-up" title="Move folder up" aria-label="Move ${label} up" ${pos === 0 ? 'disabled' : ''}>${ICON.up}</button>
            <button type="button" class="icon-btn" data-action="group-down" title="Move folder down" aria-label="Move ${label} down" ${pos === siblings.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
            <button type="button" class="icon-btn" data-action="edit-group" title="Rename or delete folder" aria-label="Edit ${label}">${ICON.edit}</button>
          </div>
        </div>
        <div class="group-body">
          ${showGrid ? `<div class="grid" data-cat="${cat.id}" data-group="${g.id}">
            ${direct.length ? direct.map(cardHTML).join('') : '<div class="grid-empty">Empty folder — drag links here or use +.</div>'}
          </div>` : ''}
          ${children.map((c) => folderHTML(cat, c, all, items, filtering, depth + 1)).join('')}
        </div>
      </div>`;
  }

  /** Folder tree for quick navigation on wide screens. */
  function renderSidebar(visible, filtering) {
    const count = (catId, ids) => visible.filter((l) => l.categoryId === catId && (!ids || ids.has(l.groupId))).length;
    const item = (attrs, label, n, depth, icon) => `
      <button type="button" class="tree-item" ${attrs} style="--depth:${depth}" ${filtering && !n ? 'disabled' : ''}>
        ${icon}<span class="tree-label">${escapeHtml(label)}</span><span class="tree-count">${n}</span>
      </button>`;
    $('#sidebar').innerHTML = `<div class="tree-title">Browse</div>` + state.categories.map((cat) =>
      item(`data-jump-cat="${cat.id}"`, cat.name, count(cat.id), 0, ICON.hash) +
      folderTree(cat).map(({ folder, depth }) =>
        item(`data-jump-cat="${cat.id}" data-jump-group="${folder.id}"`, folder.name, count(cat.id, folderAndDescendants(cat, folder.id)), depth + 1, ICON.folder)).join('')
    ).join('');
  }

  function jumpTo(catId, groupId) {
    revealPlace({ categoryId: catId, groupId });
    save();
    render();
    const target = groupId ? $(`.group-head[data-group="${CSS.escape(groupId)}"]`) : $(`.cat-head[data-cat="${CSS.escape(catId)}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.animate([{ background: 'var(--accent-soft)' }, { background: 'transparent' }], { duration: 1400, easing: 'ease-out' });
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
      const ungrouped = items.filter((l) => !getGroup(cat.id, l.groupId));
      const topFolders = childFolders(cat, null);
      const showUngrouped = ungrouped.length || !topFolders.length;
      const groupsHTML = topFolders.map((g) => folderHTML(cat, g, all, items, filtering, 1)).join('');
      html.push(`
        <section class="category${collapsed ? ' collapsed' : ''}" data-cat="${cat.id}">
          <div class="cat-head" data-cat="${cat.id}">
            <h2 class="cat-heading"><button type="button" class="cat-toggle" data-action="toggle-cat" aria-expanded="${!collapsed}">
              ${ICON.chevron}<span class="cat-title">${escapeHtml(cat.name)}</span>
              <span class="cat-count">${filtering ? `${items.length}/${all.length}` : all.length}</span>
            </button></h2>
            <div class="cat-actions">
              <button type="button" class="icon-btn" data-action="add-to-cat" title="Add link to ${escapeHtml(cat.name)}" aria-label="Add link to ${escapeHtml(cat.name)}">${ICON.plus}</button>
              <button type="button" class="icon-btn" data-action="add-group" title="New folder in ${escapeHtml(cat.name)}" aria-label="New folder in ${escapeHtml(cat.name)}">${ICON.folderPlus}</button>
              <button type="button" class="icon-btn" data-action="cat-up" title="Move category up" aria-label="Move ${escapeHtml(cat.name)} up" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
              <button type="button" class="icon-btn" data-action="cat-down" title="Move category down" aria-label="Move ${escapeHtml(cat.name)} down" ${i === state.categories.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
              <button type="button" class="icon-btn" data-action="edit-cat" title="Rename or delete category" aria-label="Edit ${escapeHtml(cat.name)}">${ICON.edit}</button>
            </div>
          </div>
          <div class="cat-body">
            ${showUngrouped ? `<div class="grid" data-cat="${cat.id}" data-group="">
              ${ungrouped.length ? ungrouped.map(cardHTML).join('') : '<div class="grid-empty">No links yet — drag one here or use + to add.</div>'}
            </div>` : ''}
            ${groupsHTML}
          </div>
        </section>`);
    });
    $('#categories').innerHTML = html.join('');
    renderSidebar(visible, filtering);

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

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback for browsers/contexts without the async clipboard API (e.g. some file:// pages).
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
      return ok;
    }
  }

  async function copyLink(id, btn) {
    const link = getLink(id);
    if (!link?.url) return;
    if (!(await copyText(link.url))) { toast('Could not copy — your browser blocked clipboard access.'); return; }
    toast('Link copied to clipboard');
    // Briefly swap the icon to a check mark as confirmation.
    if (btn?.isConnected) {
      btn.innerHTML = ICON.check;
      btn.classList.add('copied');
      setTimeout(() => { if (btn.isConnected) { btn.innerHTML = ICON.copy; btn.classList.remove('copied'); } }, 1500);
    }
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

  /** Re-insert a link into a category/group, before `beforeId` (or at the end of that group). */
  function moveLink(id, { categoryId, groupId = null }, beforeId) {
    const from = state.links.findIndex((l) => l.id === id);
    if (from < 0) return;
    const [link] = state.links.splice(from, 1);
    link.categoryId = categoryId;
    link.groupId = getGroup(categoryId, groupId) ? groupId : null;
    let to = beforeId ? state.links.findIndex((l) => l.id === beforeId) : -1;
    if (to < 0) {
      // After the last link of the target group, else of the category, else at the very end.
      let lastInGroup = -1;
      let lastInCat = -1;
      state.links.forEach((l, i) => {
        if (l.categoryId !== categoryId) return;
        lastInCat = i;
        if (l.groupId === link.groupId) lastInGroup = i;
      });
      const last = lastInGroup >= 0 ? lastInGroup : lastInCat;
      to = last >= 0 ? last + 1 : state.links.length;
    }
    state.links.splice(to, 0, link);
    save();
    render();
  }

  function nudgeLink(id, delta) {
    const link = getLink(id);
    const siblings = state.links.filter((l) => l.categoryId === link.categoryId && l.groupId === link.groupId);
    const i = siblings.indexOf(link);
    const j = i + delta;
    if (j < 0 || j >= siblings.length) return;
    // Moving down by one means inserting before the item two places ahead.
    const before = delta < 0 ? siblings[j] : siblings[j + 1];
    moveLink(id, link, before ? before.id : null);
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

  function placeName({ categoryId, groupId }) {
    const cat = getCat(categoryId);
    return cat ? [cat.name, ...folderPath(categoryId, groupId).map((g) => g.name)].join(' › ') : '';
  }

  /** Expand a collapsed category/group so a link landing there is visible. */
  function revealPlace({ categoryId, groupId }) {
    const cat = getCat(categoryId);
    if (cat) cat.collapsed = false;
    for (const g of folderPath(categoryId, groupId)) g.collapsed = false;
  }

  function findDuplicate(url, exceptId) {
    return state.links.find((l) => l.url && l.url === url && l.id !== exceptId);
  }

  $('#quickAdd').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = $('#qaUrl').value;
    if (!raw.trim()) {
      openLinkDialog(null, { place: $('#qaCategory').value, tags: $('#qaTags').value });
      return;
    }
    const url = normalizeUrl(raw);
    if (!url) { toast('That does not look like a valid URL.'); $('#qaUrl').focus(); return; }
    const dup = findDuplicate(url);
    if (dup) {
      toast(`Already saved in ${placeName(dup) || 'your hub'}.`);
      flash(dup.id);
      return;
    }
    const title = guessTitle(url);
    const place = parsePlace($('#qaCategory').value);
    if (!getCat(place.categoryId)) place.categoryId = state.categories[0].id;
    const link = {
      id: uid(), url, title, note: '', tags: parseTags($('#qaTags').value),
      categoryId: place.categoryId, groupId: null,
      pinned: false, pinnedAt: 0, favicon: '', attachment: null, createdAt: Date.now(), lastOpened: 0,
    };
    state.links.push(link);
    revealPlace(place);
    moveLink(link.id, place, null);
    $('#qaUrl').value = '';
    $('#qaTags').value = '';
    flash(link.id);
    toast(`Added to ${placeName(link)}`, { label: 'Edit', run: () => openLinkDialog(link.id) });
    autofill(link.id, title);
  });

  $('#qaMore').addEventListener('click', () => {
    openLinkDialog(null, { url: $('#qaUrl').value, place: $('#qaCategory').value, tags: $('#qaTags').value });
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
    f.categoryId.value = link ? placeValue(link.categoryId, link.groupId) : (preset.place || placeValue(state.categories[0].id));
    if (!f.categoryId.value) f.categoryId.value = placeValue(state.categories[0].id);
    f.categoryId.dataset.prev = f.categoryId.value;
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

    const place = parsePlace(f.categoryId.value);
    if (!getCat(place.categoryId)) place.categoryId = state.categories[0].id;
    revealPlace(place);
    if (!existing) {
      link.categoryId = place.categoryId;
      link.groupId = null;
      state.links.push(link);
      moveLink(id, place, null);
    } else if (existing.categoryId !== place.categoryId || existing.groupId !== place.groupId) {
      moveLink(id, place, null);
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
  // One small "name" dialog serves both categories and groups.
  const catDialog = $('#catDialog');
  const catForm = $('#catForm');
  let nameDialog = null; // { onSave(name), onDelete?() }

  function openNameDialog({ title, value = '', onSave, onDelete }) {
    nameDialog = { onSave, onDelete };
    $('#catDialogTitle').textContent = title;
    catForm.elements.name.value = value;
    $('#deleteCatBtn').hidden = !onDelete;
    catDialog.showModal();
    catForm.elements.name.select();
  }

  function openCatDialog(id) {
    const cat = id ? getCat(id) : null;
    openNameDialog({
      title: cat ? 'Edit category' : 'New category',
      value: cat ? cat.name : '',
      onSave: (name) => {
        if (cat) cat.name = name;
        else state.categories.push({ id: uid(), name, collapsed: false, groups: [] });
      },
      onDelete: cat && state.categories.length > 1 ? () => {
        const others = state.categories.filter((c) => c.id !== cat.id);
        const count = state.links.filter((l) => l.categoryId === cat.id).length;
        const target = others[0];
        if (count && !confirm(`Delete “${cat.name}”? Its ${count} ${count === 1 ? 'link' : 'links'} will move to “${target.name}”.`)) return false;
        state.links.forEach((l) => { if (l.categoryId === cat.id) { l.categoryId = target.id; l.groupId = null; } });
        state.categories = others;
      } : null,
    });
  }

  function openGroupDialog(catId, groupId, afterCreate, parentId = null) {
    const cat = getCat(catId);
    const group = getGroup(catId, groupId);
    const where = placeName({ categoryId: catId, groupId: group ? group.parentId : parentId });
    openNameDialog({
      title: group ? 'Edit folder' : `New folder in ${where}`,
      value: group ? group.name : '',
      onSave: (name) => {
        if (group) { group.name = name; return; }
        const created = { id: uid(), name, collapsed: false, parentId: getGroup(catId, parentId) ? parentId : null };
        cat.groups.push(created);
        revealPlace({ categoryId: catId, groupId: created.parentId });
        if (afterCreate) setTimeout(() => afterCreate(created), 0);
      },
      onDelete: group ? () => {
        const ids = folderAndDescendants(cat, group.id);
        const linkCount = state.links.filter((l) => l.groupId === group.id).length;
        const subCount = ids.size - 1;
        const what = [linkCount && `${linkCount} ${linkCount === 1 ? 'link' : 'links'}`, subCount && `${subCount} ${subCount === 1 ? 'sub-folder' : 'sub-folders'}`].filter(Boolean).join(' and ');
        if (what && !confirm(`Delete folder “${group.name}”? Its ${what} will move up into ${where}.`)) return false;
        // Contents move up one level rather than being deleted.
        state.links.forEach((l) => { if (l.groupId === group.id) l.groupId = group.parentId; });
        cat.groups.forEach((g) => { if (g.parentId === group.id) g.parentId = group.parentId; });
        cat.groups = cat.groups.filter((g) => g.id !== group.id);
      } : null,
    });
  }

  catForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = catForm.elements.name.value.trim();
    if (!name) return;
    nameDialog.onSave(name);
    save();
    render();
    catDialog.close();
  });

  $('#deleteCatBtn').addEventListener('click', () => {
    if (nameDialog.onDelete() === false) return;
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

    const jump = e.target.closest('[data-jump-cat]');
    if (jump) { jumpTo(jump.dataset.jumpCat, jump.dataset.jumpGroup || null); return; }

    const tagBtn = e.target.closest('[data-tag]');
    if (tagBtn) { toggleTag(tagBtn.dataset.tag); return; }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('.card');
    const catEl = btn.closest('[data-cat]');
    const id = card?.dataset.id;
    const catId = catEl?.dataset.cat;
    const groupId = btn.closest('[data-group]')?.dataset.group || null;
    const filtering = searchInput.value.trim() || activeTags.size;

    switch (btn.dataset.action) {
      case 'pin': togglePin(id); break;
      case 'edit': openLinkDialog(id); break;
      case 'delete': deleteLink(id); break;
      case 'toggle-note':
        if (expandedNotes.has(id)) expandedNotes.delete(id); else expandedNotes.add(id);
        render();
        break;
      case 'toggle-cat': {
        if (filtering) break; // always expanded while filtering
        const cat = getCat(catId);
        cat.collapsed = !cat.collapsed;
        save();
        render();
        break;
      }
      case 'add-to-cat': openLinkDialog(null, { place: placeValue(catId) }); break;
      case 'edit-cat': openCatDialog(catId); break;
      case 'add-group': openGroupDialog(catId, null); break;
      case 'toggle-group': {
        if (filtering) break;
        const group = getGroup(catId, groupId);
        group.collapsed = !group.collapsed;
        save();
        render();
        break;
      }
      case 'add-to-group': openLinkDialog(null, { place: placeValue(catId, groupId) }); break;
      case 'add-subfolder': openGroupDialog(catId, null, null, groupId); break;
      case 'copy': copyLink(id, btn); break;
      case 'edit-group': openGroupDialog(catId, groupId); break;
      case 'group-up':
      case 'group-down': {
        // Swap with the neighbouring folder that shares the same parent.
        const groups = getCat(catId).groups;
        const me = getGroup(catId, groupId);
        const siblings = childFolders(getCat(catId), me.parentId);
        const other = siblings[siblings.indexOf(me) + (btn.dataset.action === 'group-up' ? -1 : 1)];
        if (!other) break;
        const i = groups.indexOf(me);
        const j = groups.indexOf(other);
        [groups[i], groups[j]] = [groups[j], groups[i]];
        save();
        render();
        $(`.group-head[data-group="${CSS.escape(groupId)}"] [data-action="${btn.dataset.action}"]`)?.focus();
        break;
      }
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

    const head = el.closest('.cat-head, .group-head');
    if (head) {
      // Dropping on a header (useful when collapsed) appends to that category or group.
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
      const place = { categoryId: d.headTarget.dataset.cat, groupId: d.headTarget.dataset.group || null };
      revealPlace(place);
      moveLink(d.id, place, null);
    } else {
      const grid = d.placeholder.parentElement;
      let next = d.placeholder.nextElementSibling;
      while (next && !(next.classList.contains('card') && !next.classList.contains('dragging'))) next = next.nextElementSibling;
      if (grid?.dataset.cat) moveLink(d.id, { categoryId: grid.dataset.cat, groupId: grid.dataset.group || null }, next ? next.dataset.id : null);
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
    // Match categories (and groups within them) by name; create the ones that don't exist yet.
    const catMap = new Map();
    const groupMap = new Map();
    const sameName = (a, b) => a.name.toLowerCase() === b.name.toLowerCase();
    for (const c of data.categories) {
      let mine = state.categories.find((x) => sameName(x, c));
      if (!mine) { mine = { id: uid(), name: c.name, collapsed: false, groups: [] }; state.categories.push(mine); }
      catMap.set(c.id, mine.id);
      // Parents before children, so each folder can be matched inside its mapped parent.
      for (const { folder: g } of folderTree(c)) {
        const parentId = g.parentId ? groupMap.get(g.parentId) : null;
        let myGroup = mine.groups.find((x) => (x.parentId || null) === parentId && sameName(x, g));
        if (!myGroup) { myGroup = { id: uid(), name: g.name, collapsed: false, parentId }; mine.groups.push(myGroup); }
        groupMap.set(g.id, myGroup.id);
      }
    }
    let added = 0;
    for (const link of data.links) {
      if (link.url && state.links.some((l) => l.url === link.url)) continue;
      const oldId = link.id;
      link.id = uid();
      link.categoryId = catMap.get(link.categoryId);
      link.groupId = link.groupId ? groupMap.get(link.groupId) || null : null;
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
