const sb = supabase.createClient('https://yznhzcqqtufxkdkxxqmv.supabase.co', 'sb_publishable__PLrzW0x4Gqd8fq1gFwPIw_fgK-CWbY');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dstr = (d) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const pf = (a) => (a && a.length ? a.map((n) => 'PSI-' + n).join(', ') : 'No PSI');
const gKey = () => localStorage.getItem('gmkey');
const COLORS = ['#6a9bd8', '#e0963c', '#4fae94', '#a77ad1', '#d8789f', '#c9b13f', '#4fb3c9', '#8d9db5'];
let ME = null, members = [], drivers = [], picked = null, G = {}, myShops = [], day = dstr(Date.now()), timer = null, only = null;
let DATA = { s: [], d: [], p: [] }, map = null, pins = [], iw = null;
const colorOf = (id) => COLORS[Math.max(0, drivers.findIndex((x) => x.user_id === id)) % COLORS.length];
const nameOf = (id) => (members.find((x) => x.user_id === id) || {}).display_name || 'Driver';

function toast(t, ms = 4500) { const e = $('toast'); e.textContent = t; e.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => (e.style.display = 'none'), ms); }
const nums = (sel) => [...document.querySelectorAll(sel)].map((i) => parseFloat(i.value)).filter((n) => !isNaN(n));
function addField(c, cls) { const i = document.createElement('input'); i.className = cls; i.placeholder = 'PSI'; i.inputMode = 'decimal'; c.appendChild(i); return i; }

/* ---------- sign in ---------- */
(async () => { const { data } = await sb.auth.getSession(); data.session ? start() : $('login').classList.remove('hide'); })();
$('loginBtn').onclick = async () => {
  const { error } = await sb.auth.signInWithPassword({ email: $('em').value.trim(), password: $('pw').value });
  if (error) toast(error.message); else { $('login').classList.add('hide'); start(); }
};
const signOut = async () => { await sb.auth.signOut(); location.reload(); };
$('out').onclick = signOut; $('out2').onclick = signOut;
$('print').onclick = () => window.print();

async function start() {
  const { data: u } = await sb.auth.getUser(); ME = u.user;
  const m = await sb.from('members').select('*');
  if (m.error) return toast(m.error.message);
  const mine = (m.data || []).find((x) => x.user_id === ME.id && x.role === 'counter');
  if (!mine) { $('noaccess').classList.remove('hide'); return; }
  members = (m.data || []).filter((x) => x.team_id === mine.team_id);
  drivers = members.filter((x) => x.role === 'driver' || x.user_id === ME.id);
  $('app').classList.remove('hide');
  $('driver').innerHTML = drivers.map((x) => `<option value="${x.user_id}">${esc(x.display_name || 'Driver')}${x.user_id === ME.id ? ' (me, for testing)' : ''}</option>`).join('');
  const last = localStorage.getItem('cdriver'); if (last && drivers.some((x) => x.user_id === last)) $('driver').value = last;
  $('day').value = day; $('day').onchange = () => { day = $('day').value; loadBoard(); };
  await Promise.all([loadShops(), loadBoard()]);
  setupMaps();
  const again = () => { clearTimeout(timer); timer = setTimeout(loadBoard, 500); };
  sb.channel('board')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_stops' }, again)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, again)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pickups' }, again)
    .subscribe();
  setInterval(loadBoard, 30000);
}

/* ---------- live board ---------- */
async function loadBoard() {
  const ids = drivers.map((x) => x.user_id);
  const a = new Date(day + 'T00:00:00'), b = new Date(a.getTime() + 864e5);
  const [s, d, p] = await Promise.all([
    sb.from('plan_stops').select('*').in('user_id', ids).eq('done', false).order('sort_order').order('created_at'),
    sb.from('deliveries').select('*').in('user_id', ids).gte('delivered_at', a.toISOString()).lt('delivered_at', b.toISOString()).order('delivered_at'),
    sb.from('pickups').select('*').in('user_id', ids).gte('picked_at', a.toISOString()).lt('picked_at', b.toISOString()).order('picked_at'),
  ]);
  const err = s.error || d.error || p.error; if (err) return toast(err.message);
  DATA = { s: s.data || [], d: d.data || [], p: p.data || [] };
  renderAll();
}
function view() {
  const isToday = day === dstr(Date.now());
  const f = (a) => (only ? a.filter((x) => x.user_id === only) : a);
  return { S: f(isToday ? DATA.s : []), D: f(DATA.d), P: f(DATA.p), isToday };
}
function renderAll() {
  const { S, D, P } = view();
  const bad = D.filter((x) => x.status === 'failed').length;
  $('stats').innerHTML = [['Still to deliver', S.length], ['Delivered', D.length - bad], ['Not delivered', bad], ['Pickups', P.length]].map(([t, n]) => `<div class="stat"><div class="n">${n}</div><div class="mut">${t}</div></div>`).join('');
  $('dchips').innerHTML = `<button class="g s ${only === null ? 'on' : ''}" data-d="">All drivers</button>` + drivers.map((x) => `<button class="g s ${only === x.user_id ? 'on' : ''}" data-d="${x.user_id}"><i class="dot" style="background:${colorOf(x.user_id)}"></i>${esc(x.display_name || 'Driver')}</button>`).join('');
  const show = drivers.filter((x) => !only || x.user_id === only);
  $('boards').innerHTML = show.map((m) => {
    const id = m.user_id;
    const ps = S.filter((x) => x.user_id === id), ds = D.filter((x) => x.user_id === id), pk = P.filter((x) => x.user_id === id);
    const total = ps.length + ds.length, pct = total ? Math.round((ds.length / total) * 100) : 0;
    const photo = (path) => (path ? ` <button class="g s" data-ph="${esc(path)}">📎 Photo</button>` : '');
    return `<div class="card"><div class="row sp"><b style="font-size:17px"><i class="dot" style="background:${colorOf(id)}"></i>${esc(m.display_name || 'Driver')}</b><span class="mut">${ds.length} of ${total} done</span></div><div class="bar"><i style="width:${pct}%"></i></div>`
      + (ps.length ? `<div class="sec">Still to deliver</div>` + ps.map((x) => `<div class="ln"><span>${esc(x.shop_name)}<br><span class="mut">${esc(pf(x.psi))}${x.note ? ' · ' + esc(x.note) : ''}</span></span><span class="row"><button class="g s" data-mv="${x.id}">Move</button><button class="g s" data-rm="${x.id}">Remove</button></span></div>`).join('') : '')
      + (ds.length ? `<div class="sec">Done</div>` + ds.map((l) => `<div class="ln"><span>${fmt(l.delivered_at)} · ${esc(l.shop_name)}<br>${l.status === 'failed' ? `<span class="bad">Not delivered · ${esc(l.reason || '')}</span>` : `<span class="mut">${esc(pf(l.psi))}${l.note ? ' · ' + esc(l.note) : ''}</span>`}</span>${photo(l.invoice_path)}</div>`).join('') : '')
      + (pk.length ? `<div class="sec">Pickups</div>` + pk.map((x) => `<div class="ln"><span>↩ ${fmt(x.picked_at)} · ${esc(x.shop_name)}${x.note ? '<br><span class="mut">' + esc(x.note) + '</span>' : ''}</span>${photo(x.photo_path)}</div>`).join('') : '')
      + (!ps.length && !ds.length && !pk.length ? '<p class="mut">Nothing yet.</p>' : '') + '</div>';
  }).join('') || '<p class="mut">No drivers in this team yet.</p>';
  renderMap(S, D, P);
}
$('dchips').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; only = b.dataset.d || null; renderAll(); };
$('boards').onclick = async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.rm) {
    if (!confirm('Remove this delivery from the driver’s list?')) return;
    const r = await sb.from('plan_stops').delete().eq('id', b.dataset.rm);
    if (r.error) toast(r.error.message); else loadBoard();
  } else if (b.dataset.mv) openMove(b.dataset.mv);
  else if (b.dataset.ph) openPhoto(b.dataset.ph);
};
function openMove(id) {
  const st = DATA.s.find((x) => x.id === id); if (!st) return;
  const opts = drivers.filter((x) => x.user_id !== st.user_id);
  if (!opts.length) return toast('There’s no one else to move it to.');
  $('dlgbody').innerHTML = `<b style="font-size:18px">Move to another driver</b><div class="mut" style="margin:2px 0 12px">${esc(st.shop_name)}</div><select id="mv-to">${opts.map((x) => `<option value="${x.user_id}">${esc(x.display_name || 'Driver')}</option>`).join('')}</select><div class="row"><button id="mv-ok" style="flex:1">Move</button><button class="g" id="mv-x">Cancel</button></div>`;
  $('dlg').showModal();
  $('mv-x').onclick = () => $('dlg').close();
  $('mv-ok').onclick = async () => {
    const r = await sb.from('plan_stops').update({ user_id: $('mv-to').value, assigned_by: ME.id }).eq('id', id);
    if (r.error) return toast(r.error.message);
    $('dlg').close(); toast('Moved.'); loadBoard();
  };
}
async function openPhoto(path) {
  $('dlgbody').innerHTML = '<p class="mut">Loading…</p><button class="g" id="ph-x">Close</button>';
  $('dlg').showModal();
  const r = await sb.storage.from('invoices').createSignedUrl(path, 3600);
  $('dlgbody').innerHTML = (r.data ? `<img src="${r.data.signedUrl}" alt="Photo" style="max-width:100%;border-radius:10px;margin-bottom:10px">` : '<p class="mut">Couldn’t load the photo.</p>') + '<button class="g" id="ph-x" style="width:100%">Close</button>';
  $('ph-x').onclick = () => $('dlg').close();
}

/* ---------- map ---------- */
function renderMap(S, D, P) {
  if (!G.maps) { $('mapnote').textContent = gKey() ? 'Loading the map…' : 'Add your Google key above to see the map.'; return; }
  if (!map) map = new G.maps.Map($('cmap'), { center: { lat: -39.0556, lng: 174.0752 }, zoom: 11, minZoom: 5, restriction: { latLngBounds: { north: -33.5, south: -48, west: 165.5, east: 179.5 }, strictBounds: false }, mapId: 'DEMO_MAP_ID', streetViewControl: false, mapTypeControl: false });
  pins.forEach((m) => (m.map = null)); pins = []; iw = iw || new google.maps.InfoWindow();
  const g = {};
  const add = (x, kind) => { if (x.lat == null) return; const k = x.place_id || x.lat + ',' + x.lng; (g[k] = g[k] || { lat: x.lat, lng: x.lng, name: x.shop_name, address: x.address, items: [] }).items.push({ ...x, kind }); };
  S.forEach((x) => add(x, 'pending')); D.forEach((x) => add(x, x.status === 'failed' ? 'failed' : 'done')); P.forEach((x) => add(x, 'pickup'));
  const bounds = new google.maps.LatLngBounds(); let n = 0;
  Object.values(g).forEach((loc) => {
    const pend = loc.items.find((i) => i.kind === 'pending'), fail = loc.items.find((i) => i.kind === 'failed'), done = loc.items.some((i) => i.kind === 'done');
    const opt = { background: pend ? colorOf(pend.user_id) : fail && !done ? '#d9534f' : colorOf(loc.items[0].user_id), borderColor: '#00000055', glyphColor: '#ffffff' };
    if (!pend) opt.glyph = fail && !done ? '!' : '✓';
    const pin = new G.marker.PinElement(opt);
    const m = new G.marker.AdvancedMarkerElement({ map, position: { lat: loc.lat, lng: loc.lng }, title: loc.name, content: pin.element });
    m.addListener('click', () => {
      const line = (i) => `<i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${colorOf(i.user_id)};margin-right:5px"></i>${esc(nameOf(i.user_id))}: ` + (i.kind === 'pending' ? 'to deliver · ' + esc(pf(i.psi)) : i.kind === 'failed' ? `<b>not delivered</b> ${fmt(i.delivered_at)} · ${esc(i.reason || '')}` : i.kind === 'done' ? `delivered ${fmt(i.delivered_at)} · ${esc(pf(i.psi))}` : `pickup ${fmt(i.picked_at)}`) + (i.note ? ' · ' + esc(i.note) : '');
      iw.setContent(`<div class="iw"><b>${esc(loc.name)}</b><br>${esc(loc.address || '')}<hr>${loc.items.map(line).join('<br>')}</div>`);
      iw.open({ map, anchor: m });
    });
    pins.push(m); bounds.extend(m.position); n++;
  });
  if (n > 1) map.fitBounds(bounds, 60); else if (n === 1) { map.setCenter(bounds.getCenter()); map.setZoom(15); }
  const noPin = S.length + D.length + P.length - Object.values(g).reduce((a, l) => a + l.items.length, 0);
  $('mapnote').textContent = (n ? n + ' location' + (n > 1 ? 's' : '') + ' on the map. Tap a pin for details.' : 'No locations to show for this day.') + (noPin > 0 ? ' ' + noPin + ' stop(s) have no map position.' : '');
}

/* ---------- search and export ---------- */
$('sgo').onclick = search; $('sq').onkeydown = (e) => { if (e.key === 'Enter') search(); };
async function search() {
  const q = $('sq').value.trim().replace(/[,()%*]/g, ''); if (!q) return;
  let flt = `shop_name.ilike.%${q}%`; if (/^\d+(\.\d+)?$/.test(q)) flt += `,psi.cs.{${q}}`;
  const r = await sb.from('deliveries').select('*').in('user_id', drivers.map((x) => x.user_id)).or(flt).order('delivered_at', { ascending: false }).limit(60);
  if (r.error) return toast(r.error.message);
  $('sres').innerHTML = (r.data || []).map((l) => `<div class="ln"><span>${new Date(l.delivered_at).toLocaleDateString([], { day: 'numeric', month: 'short' })} ${fmt(l.delivered_at)} · <b>${esc(l.shop_name)}</b><br><span class="mut">${esc(nameOf(l.user_id))} · ${l.status === 'failed' ? 'Not delivered · ' + esc(l.reason || '') : esc(pf(l.psi))}</span></span></div>`).join('') || '<p class="mut">No matches.</p>';
}
$('export').onclick = () => {
  const { D, P } = view(); if (!D.length && !P.length) return toast('Nothing to export for this day.');
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const t = (x) => new Date(x).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const rows = [...D.map((l) => [day, t(l.delivered_at), nameOf(l.user_id), l.shop_name, l.address, l.status === 'failed' ? 'Not delivered' : 'Delivered', (l.psi || []).map((n) => 'PSI-' + n).join(' '), l.reason, l.note]),
    ...P.map((l) => [day, t(l.picked_at), nameOf(l.user_id), l.shop_name, l.address, 'Pickup', '', '', l.note])];
  const csv = '\ufeffDate,Time,Driver,Shop,Address,Type,PSI,Reason,Note\n' + rows.map((r) => r.map(q).join(',')).join('\n');
  const u = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), a = document.createElement('a');
  a.href = u; a.download = 'team_' + day + '.csv'; a.click(); URL.revokeObjectURL(u);
};

/* ---------- send a delivery ---------- */
async function loadShops() { const r = await sb.from('shops').select('*').order('name'); if (!r.error) { myShops = r.data || []; renderChips(); } }
function renderChips() {
  const q = ($('cfilter').value || '').trim().toLowerCase();
  const list = myShops.filter((s) => !q || s.name.toLowerCase().includes(q));
  $('cchips').innerHTML = list.map((s) => `<button class="g s" data-sh="${s.id}">${esc(s.name)}</button>`).join('') || '<span class="mut">Shops you send to are saved here.</span>';
  $('csel').innerHTML = picked ? `📍 <b>${esc(picked.name)}</b> <button class="g s" id="cclr">✕</button>` : '';
  if ($('cclr')) $('cclr').onclick = () => { picked = null; renderChips(); };
}
$('cfilter').oninput = renderChips;
$('cchips').onclick = (e) => { const b = e.target.closest('button'); if (!b || !b.dataset.sh) return; const s = myShops.find((x) => x.id === b.dataset.sh); if (s) { picked = { name: s.name, address: s.address, lat: s.lat, lng: s.lng, place_id: s.place_id }; renderChips(); } };
$('cmore').onclick = () => addField($('cpsis'), 'cpsi').focus();
async function saveShop(x) {
  const key = x.place_id || String(x.name).trim().toLowerCase();
  if (myShops.some((s) => s.key === key)) return;
  const r = await sb.from('shops').upsert({ name: x.name, key, place_id: x.place_id || null, address: x.address || null, lat: x.lat ?? null, lng: x.lng ?? null }, { onConflict: 'user_id,key', ignoreDuplicates: true });
  if (!r.error) loadShops();
}
$('send').onclick = async () => {
  const name = ((picked && picked.name) || (G.ac ? G.ac.value : ($('plain') || {}).value) || '').trim();
  if (!name) return toast('Pick or search for a shop.');
  const driver = $('driver').value; localStorage.setItem('cdriver', driver);
  const mx = await sb.from('plan_stops').select('sort_order').eq('user_id', driver).order('sort_order', { ascending: false }).limit(1);
  const next = mx.data && mx.data[0] ? mx.data[0].sort_order + 1 : 0;
  const row = { user_id: driver, assigned_by: ME.id, shop_name: name, psi: nums('.cpsi'), note: $('cnote').value.trim() || null, sort_order: next };
  if (picked) Object.assign(row, { place_id: picked.place_id, address: picked.address, lat: picked.lat, lng: picked.lng });
  $('send').disabled = true;
  const r = await sb.from('plan_stops').insert(row);
  $('send').disabled = false;
  if (r.error) return toast(r.error.message);
  saveShop({ name, place_id: row.place_id, address: row.address, lat: row.lat, lng: row.lng });
  toast('Sent to ' + $('driver').selectedOptions[0].textContent.replace(' (me, for testing)', '') + ': ' + name);
  picked = null; $('cnote').value = ''; $('cpsis').innerHTML = '<input class="cpsi" placeholder="PSI" inputmode="decimal">';
  if (G.ac) G.ac.value = ''; else $('plain').value = '';
  renderChips(); loadBoard();
};

/* ---------- Google search + map libraries ---------- */
function setupMaps() {
  const key = gKey();
  if (!key) { $('keybox').classList.remove('hide'); renderAll(); return; }
  window.gm_authFailure = () => toast('Google rejected the key. Check it and the enabled APIs.');
  new Promise((res, rej) => { window.__gm = res; const s = document.createElement('script'); s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&loading=async&region=NZ&language=en-NZ&callback=__gm'; s.onerror = rej; document.head.appendChild(s); })
    .then(async () => {
      G.places = await google.maps.importLibrary('places'); G.maps = await google.maps.importLibrary('maps'); G.marker = await google.maps.importLibrary('marker');
      mountSearch(); $('cmechon').onchange = mountSearch; renderAll();
    })
    .catch(() => toast('Google is unavailable. You can still type a shop name.'));
}
$('keysave').onclick = () => { const k = $('keyin').value.trim(); if (!k) return; localStorage.setItem('gmkey', k); location.reload(); };
function mountSearch() {
  const o = { includedRegionCodes: ['nz'], locationBias: { center: { lat: -39.35, lng: 174.2 }, radius: 50000 } };
  if ($('cmechon').checked) o.includedPrimaryTypes = ['car_repair', 'car_dealer', 'car_wash', 'gas_station'];
  const el = new G.places.PlaceAutocompleteElement(o);
  const h = async (e) => {
    try {
      const p = e.placePrediction ? e.placePrediction.toPlace() : e.place;
      await p.fetchFields({ fields: ['displayName', 'formattedAddress', 'location', 'id'] });
      picked = { name: p.displayName, address: p.formattedAddress, lat: p.location.lat(), lng: p.location.lng(), place_id: p.id }; renderChips();
    } catch (x) { toast('Couldn’t load that place. Try again.'); }
  };
  el.addEventListener('gmp-select', h); el.addEventListener('gmp-placeselect', h);
  $('csearch').innerHTML = ''; $('csearch').appendChild(el); G.ac = el; picked = null; renderChips(); $('cmech').classList.remove('hide');
}
