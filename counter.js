const sb = supabase.createClient('https://yznhzcqqtufxkdkxxqmv.supabase.co', 'sb_publishable__PLrzW0x4Gqd8fq1gFwPIw_fgK-CWbY');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dstr = (d) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const pf = (a) => (a && a.length ? a.map((n) => 'PSI-' + n).join(', ') : 'No PSI');
const gKey = () => localStorage.getItem('gmkey');
let ME = null, members = [], picked = null, G = {}, myShops = [], day = dstr(Date.now()), timer = null;

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
  $('app').classList.remove('hide');
  const pickable = members.filter((x) => x.role === 'driver' || x.user_id === ME.id);
  $('driver').innerHTML = pickable.map((x) => `<option value="${x.user_id}">${esc(x.display_name || 'Driver')}${x.user_id === ME.id ? ' (me, for testing)' : ''}</option>`).join('');
  const last = localStorage.getItem('cdriver'); if (last && pickable.some((x) => x.user_id === last)) $('driver').value = last;
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
  const ids = members.filter((x) => x.role === 'driver' || x.user_id === ME.id).map((x) => x.user_id);
  const a = new Date(day + 'T00:00:00'), b = new Date(a.getTime() + 864e5);
  const [s, d, p] = await Promise.all([
    sb.from('plan_stops').select('*').in('user_id', ids).eq('done', false).order('sort_order').order('created_at'),
    sb.from('deliveries').select('*').in('user_id', ids).gte('delivered_at', a.toISOString()).lt('delivered_at', b.toISOString()).order('delivered_at'),
    sb.from('pickups').select('*').in('user_id', ids).gte('picked_at', a.toISOString()).lt('picked_at', b.toISOString()).order('picked_at'),
  ]);
  const err = s.error || d.error || p.error; if (err) return toast(err.message);
  const isToday = day === dstr(Date.now());
  $('boards').innerHTML = ids.map((id) => {
    const m = members.find((x) => x.user_id === id);
    const ps = isToday ? (s.data || []).filter((x) => x.user_id === id) : [];
    const ds = (d.data || []).filter((x) => x.user_id === id), pk = (p.data || []).filter((x) => x.user_id === id);
    const total = ps.length + ds.length, pct = total ? Math.round((ds.length / total) * 100) : 0;
    return `<div class="card"><div class="row sp"><b style="font-size:17px">${esc(m.display_name || 'Driver')}</b><span class="mut">${ds.length} of ${total} done</span></div><div class="bar"><i style="width:${pct}%"></i></div>`
      + (ps.length ? `<div class="sec">Still to deliver</div>` + ps.map((x) => `<div class="ln"><span>${esc(x.shop_name)}<br><span class="mut">${esc(pf(x.psi))}${x.note ? ' · ' + esc(x.note) : ''}</span></span><button class="g s" data-rm="${x.id}">Remove</button></div>`).join('') : '')
      + (ds.length ? `<div class="sec">Done</div>` + ds.map((l) => `<div class="ln"><span>${fmt(l.delivered_at)} · ${esc(l.shop_name)}<br>${l.status === 'failed' ? `<span class="bad">Not delivered · ${esc(l.reason || '')}</span>` : `<span class="mut">${esc(pf(l.psi))}${l.note ? ' · ' + esc(l.note) : ''}</span>`}</span></div>`).join('') : '')
      + (pk.length ? `<div class="sec">Pickups</div>` + pk.map((x) => `<div class="ln"><span>↩ ${fmt(x.picked_at)} · ${esc(x.shop_name)}${x.note ? '<br><span class="mut">' + esc(x.note) + '</span>' : ''}</span></div>`).join('') : '')
      + (!ps.length && !ds.length && !pk.length ? '<p class="mut">Nothing yet.</p>' : '') + '</div>';
  }).join('') || '<p class="mut">No drivers in this team yet.</p>';
}
$('boards').onclick = async (e) => {
  const b = e.target.closest('button'); if (!b || !b.dataset.rm) return;
  if (!confirm('Remove this delivery from the driver’s list?')) return;
  const r = await sb.from('plan_stops').delete().eq('id', b.dataset.rm);
  if (r.error) toast(r.error.message); else loadBoard();
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

/* ---------- Google search ---------- */
function setupMaps() {
  const key = gKey();
  if (!key) { $('keybox').classList.remove('hide'); return; }
  window.gm_authFailure = () => toast('Google rejected the key. Check it and the enabled APIs.');
  new Promise((res, rej) => { window.__gm = res; const s = document.createElement('script'); s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&loading=async&region=NZ&language=en-NZ&callback=__gm'; s.onerror = rej; document.head.appendChild(s); })
    .then(async () => { G.places = await google.maps.importLibrary('places'); mountSearch(); $('cmechon').onchange = mountSearch; })
    .catch(() => toast('Google search is unavailable. You can still type a shop name.'));
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
