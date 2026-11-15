// Weather, Fires and Earthquake categories. Relies on globals `map` and `$` from app.js (used only at call time).
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function drawBars(canvasId, labels, values, colors) {
  const c = $(canvasId), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const max = Math.max(1, ...values), slot = c.width / values.length, bw = slot - 8;
  values.forEach((v, i) => {
    const h = (v / max) * (c.height - 40), x = i * slot + 4;
    g.fillStyle = Array.isArray(colors) ? colors[i] : colors;
    g.fillRect(x, c.height - 20 - h, bw, h);
    g.fillStyle = '#dbe4ff'; g.font = '10px system-ui'; g.textAlign = 'center';
    g.fillText(v, x + bw / 2, c.height - 24 - h);
    g.fillText(labels[i], x + bw / 2, c.height - 6);
  });
}

function stat(id, value) { $(id).textContent = value; }

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* ---------------- Weather (Open-Meteo, no key) ---------------- */
const CITIES = [
  ['Reykjavik', 64.15, -21.94], ['London', 51.51, -0.13], ['Paris', 48.86, 2.35], ['Madrid', 40.42, -3.70],
  ['Berlin', 52.52, 13.41], ['Rome', 41.90, 12.50], ['Athens', 37.98, 23.73], ['Moscow', 55.76, 37.62],
  ['Helsinki', 60.17, 24.94], ['Istanbul', 41.01, 28.98], ['Cairo', 30.04, 31.24], ['Tel Aviv', 32.09, 34.78],
  ['Riyadh', 24.71, 46.68], ['Dubai', 25.20, 55.27], ['Tehran', 35.69, 51.39], ['Karachi', 24.86, 67.01],
  ['Delhi', 28.61, 77.21], ['Mumbai', 19.08, 72.88], ['Dhaka', 23.81, 90.41], ['Bangkok', 13.76, 100.50],
  ['Singapore', 1.35, 103.82], ['Jakarta', -6.21, 106.85], ['Beijing', 39.90, 116.41], ['Shanghai', 31.23, 121.47],
  ['Hong Kong', 22.32, 114.17], ['Seoul', 37.57, 126.98], ['Tokyo', 35.68, 139.69], ['Manila', 14.60, 120.98],
  ['Sydney', -33.87, 151.21], ['Perth', -31.95, 115.86], ['Auckland', -36.85, 174.76], ['Novosibirsk', 55.03, 82.92],
  ['Ulaanbaatar', 47.89, 106.91], ['Tashkent', 41.30, 69.24], ['Lagos', 6.52, 3.38], ['Accra', 5.60, -0.19],
  ['Nairobi', -1.29, 36.82], ['Addis Ababa', 9.03, 38.74], ['Johannesburg', -26.20, 28.05], ['Cape Town', -33.92, 18.42],
  ['Casablanca', 33.57, -7.59], ['Kinshasa', -4.44, 15.27], ['Antananarivo', -18.88, 47.51], ['New York', 40.71, -74.01],
  ['Toronto', 43.65, -79.38], ['Chicago', 41.88, -87.63], ['Denver', 39.74, -104.99], ['Los Angeles', 34.05, -118.24],
  ['Anchorage', 61.22, -149.90], ['Vancouver', 49.28, -123.12], ['Mexico City', 19.43, -99.13], ['Havana', 23.11, -82.37],
  ['Bogota', 4.71, -74.07], ['Lima', -12.05, -77.04], ['Manaus', -3.12, -60.02], ['Sao Paulo', -23.55, -46.63],
  ['Buenos Aires', -34.60, -58.38], ['Santiago', -33.45, -70.67], ['Honolulu', 21.31, -157.86], ['Nuuk', 64.18, -51.72],
];
const WMO = c => c === 0 ? 'Clear' : c <= 3 ? 'Cloudy' : c <= 48 ? 'Fog' : c <= 67 ? 'Rain' : c <= 77 ? 'Snow' : c <= 82 ? 'Showers' : 'Thunderstorm';
const tempColor = t => t < -10 ? '#6a7bff' : t < 0 ? '#4fb3ff' : t < 10 ? '#4fe3d0' : t < 20 ? '#a8e65c' : t < 28 ? '#ffd166' : t < 35 ? '#ff9a4d' : '#ff4d4d';

const GRID = [];
for (let lat = -75; lat <= 75; lat += 15) for (let lon = -180; lon < 180; lon += 15) GRID.push(['', lat, lon]);

const STOPS = [[-30, [90, 60, 200]], [-10, [60, 120, 255]], [0, [70, 200, 255]], [10, [70, 220, 150]], [18, [180, 230, 80]], [25, [255, 210, 70]], [32, [255, 130, 50]], [40, [230, 40, 40]]];
function gradientColor(t) {
  if (t <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i], f = (t - t0) / (t1 - t0);
      return c0.map((v, k) => v + (c1[k] - v) * f);
    }
  }
  return STOPS.at(-1)[1];
}

// Inverse-distance-weighted temperature surface, drawn at low resolution per tile and smoothly upscaled
const HeatLayer = L.GridLayer.extend({
  points: [],
  createTile(coords) {
    const N = 32, size = this.getTileSize(), tile = L.DomUtil.create('canvas', 'leaflet-tile');
    tile.width = N; tile.height = N; tile.style.width = size.x + 'px'; tile.style.height = size.y + 'px';
    const g = tile.getContext('2d'), img = g.createImageData(N, N), pts = this.points;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const ll = map.unproject(L.point(coords.x * size.x + (x + .5) * size.x / N, coords.y * size.y + (y + .5) * size.y / N), coords.z);
      let sw = 0, st = 0;
      const k = Math.cos(ll.lat * Math.PI / 180);
      for (const p of pts) {
        let dl = Math.abs(p.lng - ll.lng) % 360; if (dl > 180) dl = 360 - dl;
        const d2 = (p.lat - ll.lat) ** 2 + (dl * k) ** 2 + 1, w = 1 / (d2 * d2);
        sw += w; st += w * p.t;
      }
      const c = gradientColor(st / sw), i = (y * N + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 215;
    }
    g.putImageData(img, 0, 0);
    return tile;
  },
});

const weather = {
  layer: null, heat: null, timer: null,
  async enter() {
    this.layer = this.layer || L.layerGroup();
    this.heat = this.heat || new HeatLayer({ opacity: 1, maxZoom: 7 });
    this.heat.addTo(map);
    this.layer.addTo(map);
    await this.load();
    this.timer = setInterval(() => this.load(), 10 * 60 * 1000);
  },
  leave() { clearInterval(this.timer); map.removeLayer(this.layer); map.removeLayer(this.heat); },
  async load() {
    $('status').textContent = 'Loading weather…';
    try {
      const all = CITIES.concat(GRID);
      const url = 'https://api.open-meteo.com/v1/forecast?current=temperature_2m,wind_speed_10m,weather_code,relative_humidity_2m'
        + '&latitude=' + all.map(c => c[1]).join(',') + '&longitude=' + all.map(c => c[2]).join(',');
      let data = await getJson(url);
      if (!Array.isArray(data)) data = [data];
      this.layer.clearLayers();
      this.heat.points = data.map((d, i) => ({ lat: all[i][1], lng: all[i][2], t: d.current.temperature_2m }));
      this.heat.redraw();
      data = data.slice(0, CITIES.length);
      const rows = data.map((d, i) => ({ name: CITIES[i][0], t: d.current.temperature_2m, w: d.current.wind_speed_10m, h: d.current.relative_humidity_2m, code: d.current.weather_code, lat: CITIES[i][1], lng: CITIES[i][2] }));
      for (const r of rows) {
        L.circleMarker([r.lat, r.lng], { radius: 4 + Math.min(r.w, 40) / 10, color: '#fff', weight: 1, fillColor: tempColor(r.t), fillOpacity: .9 })
          .bindTooltip(`<b>${esc(r.name)}</b><br>${r.t}°C, ${WMO(r.code)}<br>Wind ${r.w} km/h, humidity ${r.h}%`)
          .addTo(this.layer);
      }
      const by = k => [...rows].sort((a, b) => b[k] - a[k]);
      const hot = by('t')[0], cold = by('t').at(-1), wind = by('w')[0];
      stat('w-avg', (rows.reduce((s, r) => s + r.t, 0) / rows.length).toFixed(1));
      $('w-info').innerHTML = `🔥 Hottest: <b>${esc(hot.name)}</b> ${hot.t}°C<br>🥶 Coldest: <b>${esc(cold.name)}</b> ${cold.t}°C<br>💨 Windiest: <b>${esc(wind.name)}</b> ${wind.w} km/h`;
      const bins = [[-99, 0], [0, 10], [10, 20], [20, 30], [30, 99]];
      drawBars('w-chart', ['<0', '0-10', '10-20', '20-30', '30+'], bins.map(([a, b]) => rows.filter(r => r.t >= a && r.t < b).length), ['#4fb3ff', '#4fe3d0', '#a8e65c', '#ffd166', '#ff4d4d']);
      $('status').textContent = `Weather updated ${new Date().toLocaleTimeString()} (Open-Meteo, ${rows.length} cities)`;
    } catch (e) { $('status').textContent = 'Weather failed: ' + e.message; }
  },
};

/* ---------------- Fires (NASA EONET, no key) ---------------- */
const fires = {
  layer: null, timer: null,
  async enter() {
    this.layer = this.layer || L.layerGroup();
    this.layer.addTo(map);
    await this.load();
    this.timer = setInterval(() => this.load(), 10 * 60 * 1000);
  },
  leave() { clearInterval(this.timer); map.removeLayer(this.layer); },
  async load() {
    $('status').textContent = 'Loading wildfires…';
    try {
      const data = await getJson('https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&days=30&limit=2000');
      this.layer.clearLayers();
      const events = data.events.map(ev => {
        const g = ev.geometry.at(-1);
        return g && g.type === 'Point' ? { ev, lng: g.coordinates[0], lat: g.coordinates[1], date: g.date, mag: g.magnitudeValue, unit: g.magnitudeUnit } : null;
      }).filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date));
      for (const f of events) {
        const src = f.ev.sources?.[0]?.url;
        L.circleMarker([f.lat, f.lng], { radius: f.mag ? Math.min(14, 5 + Math.log10(f.mag + 1) * 2) : 5, color: '#ffe08a', weight: 1, fillColor: '#ff5a1f', fillOpacity: .8 })
          .bindPopup(`<b>${esc(f.ev.title)}</b><br>${new Date(f.date).toLocaleString()}` + (f.mag ? `<br>${f.mag} ${esc(f.unit || '')}` : '') + (src ? `<br><a href="${esc(src)}" target="_blank" rel="noopener">source</a>` : ''))
          .addTo(this.layer);
      }
      stat('f-count', events.length);
      const day = Date.now() - 864e5;
      stat('f-new', events.filter(f => new Date(f.date).getTime() > day).length);
      $('f-list').innerHTML = events.slice(0, 8).map((f, i) => `<a href="#" data-i="${i}">${esc(f.ev.title)}</a> <small>${new Date(f.date).toLocaleDateString()}</small>`).join('<br>');
      $('f-list').onclick = e => { const a = e.target.closest('a'); if (a) { e.preventDefault(); const f = events[a.dataset.i]; map.flyTo([f.lat, f.lng], 6); } };
      $('status').textContent = `Fires updated ${new Date().toLocaleTimeString()} (NASA EONET)`;
    } catch (e) { $('status').textContent = 'Fires failed: ' + e.message; }
  },
};

/* ---------------- Earthquakes (USGS, no key) ---------------- */
const quakes = {
  layer: null, timer: null,
  async enter() {
    this.layer = this.layer || L.layerGroup();
    this.layer.addTo(map);
    await this.load();
    this.timer = setInterval(() => this.load(), 60 * 1000);
  },
  leave() { clearInterval(this.timer); map.removeLayer(this.layer); },
  async load() {
    $('status').textContent = 'Loading earthquakes…';
    try {
      const data = await getJson(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${$('q-feed').value}.geojson`);
      this.layer.clearLayers();
      const list = data.features.filter(f => f.properties.mag != null).map(f => ({ mag: f.properties.mag, place: f.properties.place, time: f.properties.time, url: f.properties.url, depth: f.geometry.coordinates[2], lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
      const depthColor = d => d < 70 ? '#ffd166' : d < 300 ? '#ff7a45' : '#b14cff';
      for (const q of list.sort((a, b) => a.mag - b.mag)) {
        L.circleMarker([q.lat, q.lng], { radius: Math.max(3, q.mag * 2.5), color: '#fff', weight: .5, fillColor: depthColor(q.depth), fillOpacity: .6 })
          .bindPopup(`<b>M${q.mag.toFixed(1)}</b> ${esc(q.place || '')}<br>Depth ${q.depth} km<br>${new Date(q.time).toLocaleString()}<br><a href="${esc(q.url)}" target="_blank" rel="noopener">details</a>`)
          .addTo(this.layer);
      }
      list.sort((a, b) => b.mag - a.mag);
      stat('q-count', list.length);
      stat('q-max', list.length ? list[0].mag.toFixed(1) : '–');
      stat('q-avg', list.length ? (list.reduce((s, q) => s + q.mag, 0) / list.length).toFixed(1) : '–');
      const bins = [[-9, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 99]];
      drawBars('q-chart', ['<2', '2-3', '3-4', '4-5', '5-6', '6+'], bins.map(([a, b]) => list.filter(q => q.mag >= a && q.mag < b).length), '#ff7a45');
      $('q-list').innerHTML = list.slice(0, 5).map((q, i) => `<a href="#" data-i="${i}">M${q.mag.toFixed(1)} ${esc(q.place || '')}</a>`).join('<br>');
      $('q-list').onclick = e => { const a = e.target.closest('a'); if (a) { e.preventDefault(); const q = list[a.dataset.i]; map.flyTo([q.lat, q.lng], 6); } };
      $('status').textContent = `Earthquakes updated ${new Date().toLocaleTimeString()} (USGS)`;
    } catch (e) { $('status').textContent = 'Earthquakes failed: ' + e.message; }
  },
};
document.getElementById('q-feed').addEventListener('change', () => quakes.load());
