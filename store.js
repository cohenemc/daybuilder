// Storage layer: the ONLY file that touches localStorage. v2 swaps this adapter for a
// hosted DB (cross-device sync) behind the same API; nothing else in the page changes.
// Paths are doc keys: settings/main, cards/<id>, days/<id>, done/<placeId>, customPlaces/<id>.
window.store = (function () {
  const PREFIX = 'wp:';
  const FORMAT = 'wp-export';
  const VERSION = 1;
  const PATH_RE = /^(settings\/main|cards\/[A-Za-z0-9_-]{1,64}|days\/[A-Za-z0-9_-]{1,64}|done\/[A-Za-z0-9:_-]{1,80}|customPlaces\/[A-Za-z0-9_-]{1,64})$/;
  const PROBE = PREFIX + '__probe';
  const subs = [];

  function isDoc(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function rawGet(path) {
    try { return localStorage.getItem(PREFIX + path); } catch (e) { return null; }
  }
  function parse(raw) {
    if (raw == null) return null;
    try { const v = JSON.parse(raw); return isDoc(v) ? v : null; } catch (e) { return null; }
  }
  function keys() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX) && k !== PROBE) out.push(k.slice(PREFIX.length));
      }
    } catch (e) { /* storage blocked: behave as empty */ }
    return out;
  }
  function emit(path, source) {
    subs.forEach(fn => { try { fn({ path, source }); } catch (e) { console.error(e); } });
  }

  function get(path) { return parse(rawGet(path)); }

  // Writes only on change. Returns false when the browser refuses (private mode, quota).
  function set(path, obj) {
    if (!PATH_RE.test(path) || !isDoc(obj)) throw new Error('store.set: bad path or doc ' + path);
    const raw = JSON.stringify(obj);
    if (rawGet(path) === raw) return true;
    try { localStorage.setItem(PREFIX + path, raw); } catch (e) { return false; }
    emit(path, 'local');
    return true;
  }

  function remove(path) {
    try { localStorage.removeItem(PREFIX + path); } catch (e) { return false; }
    emit(path, 'local');
    return true;
  }

  // [{id, doc}] for one collection, e.g. list('days').
  function list(collection) {
    const pre = collection + '/';
    return keys().filter(k => k.startsWith(pre))
      .map(k => ({ id: k.slice(pre.length), doc: get(k) }))
      .filter(x => x.doc);
  }

  function exportAll() {
    const docs = {};
    keys().sort().forEach(k => { const d = get(k); if (d && PATH_RE.test(k)) docs[k] = d; });
    return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), docs };
  }

  // Checks an export file without writing. Returns {ok, docs, skipped, error}.
  function validate(json) {
    if (!isDoc(json) || json.format !== FORMAT) return { ok: false, error: 'This is not a Day Builder export file.' };
    if (typeof json.version !== 'number' || json.version > VERSION) return { ok: false, error: 'This export is from a newer version of the page.' };
    if (!isDoc(json.docs)) return { ok: false, error: 'The export file has no saved data in it.' };
    const docs = {};
    let skipped = 0;
    Object.keys(json.docs).forEach(k => {
      if (PATH_RE.test(k) && isDoc(json.docs[k])) docs[k] = json.docs[k]; else skipped++;
    });
    return { ok: true, docs, skipped };
  }

  // Replace-all import. Everything under the prefix is cleared first; if any write fails
  // (quota), the previous saves are put back exactly and the import reports failure.
  function importAll(json) {
    const v = validate(json);
    if (!v.ok) return v;
    const before = keys().map(k => [k, rawGet(k)]);
    const clear = () => keys().forEach(k => { try { localStorage.removeItem(PREFIX + k); } catch (e) { /* ignore */ } });
    clear();
    let written = 0;
    try {
      Object.keys(v.docs).forEach(k => { localStorage.setItem(PREFIX + k, JSON.stringify(v.docs[k])); written++; });
    } catch (e) {
      clear();
      before.forEach(([k, raw]) => { try { if (raw != null) localStorage.setItem(PREFIX + k, raw); } catch (e2) { /* ignore */ } });
      emit('*', 'local');
      return { ok: false, error: 'Import stopped: this browser is out of storage space. Your previous saves were kept.' };
    }
    emit('*', 'local');
    return { ok: true, written, skipped: v.skipped };
  }

  function onChange(fn) { subs.push(fn); }

  // Probed once: the probe write would otherwise reach other tabs as a storage event.
  let avail = null;
  function available() {
    if (avail === null) {
      try { localStorage.setItem(PROBE, '1'); localStorage.removeItem(PROBE); avail = true; } catch (e) { avail = false; }
    }
    return avail;
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Another tab on this device changed the saves.
  try {
    window.addEventListener('storage', e => {
      if (e.key === PROBE) return;
      if (e.key == null || e.key.startsWith(PREFIX)) emit(e.key ? e.key.slice(PREFIX.length) : '*', 'external');
    });
  } catch (e) { /* ignore */ }

  return { get, set, remove, list, exportAll, validate, importAll, onChange, available, newId };
})();
