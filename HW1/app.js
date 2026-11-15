const API = 'https://celestrak.org/NORAD/elements/gp.php?FORMAT=json&GROUP=';
const CLASSES = [
  { name: 'LEO <2000', max: 2000, color: '#6ee7ff' },
  { name: 'MEO', max: 30000, color: '#ffd166' },
  { name: 'GEO+', max: Infinity, color: '#ff6b9d' },
];

const map = L.map('map', { worldCopyJump: true, minZoom: 2, preferCanvas: true }).setView([20, 0], 2);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri | Orbits: CelesTrak', maxZoom: 7,
}).addTo(map);

const $ = id => document.getElementById(id);
let sats = [];            // { name, id, rec, marker }
let selected = null;
let orbitLine = null;
const layer = L.layerGroup();

function classOf(alt) { return CLASSES.find(c => alt < c.max); }

async function load(group) {
  $('status').textContent = 'Downloading orbital data…';
  layer.clearLayers();
  sats = [];
  select(null);
  try {
    const res = await fetch(API + group);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error(typeof data === 'string' ? data : 'No data');
    for (const omm of data) {
      try {
        const rec = satellite.json2satrec(omm);
        const marker = L.circleMarker([0, 0], { radius: group === 'stations' ? 6 : 3, weight: 0, fillOpacity: .9 });
        const s = { name: omm.OBJECT_NAME, id: omm.NORAD_CAT_ID, rec, marker, epoch: omm.EPOCH };
        marker.on('click', () => select(s));
        marker.bindTooltip(s.name);
        marker.addTo(layer);
        sats.push(s);
      } catch { /* skip malformed record */ }
    }
    if (active === 'pulse') $('status').textContent = `Orbit data loaded ${new Date().toLocaleTimeString()}`;
    tick();
  } catch (e) {
    $('status').textContent = 'Failed to load data: ' + e.message;
  }
}

function position(s, date) {
  const pv = satellite.propagate(s.rec, date);
  if (!pv.position) return null;
  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(pv.position, gmst);
  const v = pv.velocity;
  return {
    lat: satellite.degreesLat(geo.latitude),
    lng: satellite.degreesLong(geo.longitude),
    alt: geo.height,
    speed: Math.hypot(v.x, v.y, v.z),
  };
}

function tick() {
  const now = new Date();
  const term = $('search').value.trim().toLowerCase();
  let n = 0, altSum = 0, speedSum = 0;
  const counts = CLASSES.map(() => 0);
  for (const s of sats) {
    const p = position(s, now);
    s.pos = p;
    if (!p || isNaN(p.lat)) { s.marker.setStyle({ opacity: 0, fillOpacity: 0 }); continue; }
    const cls = classOf(p.alt);
    const hit = term && s.name.toLowerCase().includes(term);
    s.marker.setLatLng([p.lat, p.lng]);
    s.marker.setStyle({ fillColor: hit ? '#fff' : cls.color, fillOpacity: term && !hit ? .15 : .9 });
    n++; altSum += p.alt; speedSum += p.speed;
    counts[CLASSES.indexOf(cls)]++;
  }
  $('s-count').textContent = n;
  $('s-alt').textContent = n ? Math.round(altSum / n).toLocaleString() : '–';
  $('s-speed').textContent = n ? (speedSum / n).toFixed(2) : '–';
  drawChart(counts);
  if (selected) showInfo();
}

function drawChart(counts) {
  const c = $('chart'), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const max = Math.max(1, ...counts), bw = 70;
  counts.forEach((v, i) => {
    const h = (v / max) * 80, x = 15 + i * 90;
    g.fillStyle = CLASSES[i].color;
    g.fillRect(x, 95 - h, bw, h);
    g.fillStyle = '#dbe4ff'; g.font = '11px system-ui'; g.textAlign = 'center';
    g.fillText(v, x + bw / 2, 90 - h);
    g.fillText(CLASSES[i].name, x + bw / 2, 112);
  });
}

function select(s) {
  selected = s;
  if (orbitLine) { map.removeLayer(orbitLine); orbitLine = null; }
  if (!s) { $('info').textContent = 'Click a satellite on the map.'; return; }
  // Ground track for the next ~100 minutes, split where it crosses the date line
  const segs = [[]];
  const t0 = Date.now();
  for (let m = 0; m <= 100; m++) {
    const p = position(s, new Date(t0 + m * 60000));
    if (!p) continue;
    const seg = segs[segs.length - 1];
    if (seg.length && Math.abs(seg[seg.length - 1][1] - p.lng) > 180) segs.push([]);
    segs[segs.length - 1].push([p.lat, p.lng]);
  }
  orbitLine = L.polyline(segs, { color: '#fff', weight: 1.5, dashArray: '4 4' }).addTo(map);
  showInfo();
}

function showInfo() {
  const p = selected.pos;
  if (!p) { $('info').textContent = selected.name + ': no position'; return; }
  $('info').innerHTML = `<b>${selected.name}</b><br>NORAD ID: ${selected.id}<br>
    Lat/Lon: ${p.lat.toFixed(2)}°, ${p.lng.toFixed(2)}°<br>
    Altitude: ${Math.round(p.alt).toLocaleString()} km<br>
    Speed: ${p.speed.toFixed(2)} km/s (${Math.round(p.speed * 3600).toLocaleString()} km/h)<br>
    Orbit data epoch: ${selected.epoch}`;
}

$('group').addEventListener('change', e => load(e.target.value));
$('search').addEventListener('input', tick);

const pulse = {
  async enter() { layer.addTo(map); if (!sats.length) await load($('group').value); else tick(); },
  leave() { map.removeLayer(layer); select(null); },
};
const categories = { pulse, weather, fires, quakes };
let active = null;

async function show(name) {
  if (active) categories[active].leave();
  active = name;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.cat === name));
  for (const key of Object.keys(categories)) $('cat-' + key).hidden = key !== name;
  map.setView([20, 0], 2);
  await categories[name].enter();
}

document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.cat)));
setInterval(() => { if (active === 'pulse') tick(); }, 1000);
show('pulse');
