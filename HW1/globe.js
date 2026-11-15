// Optional 3D globe view (globe.gl). Mirrors whatever the active category has put on the Leaflet map,
// so each category needs no globe-specific code. Relies on globals from app.js / other.js.
const BASE_TEX = 'https://unpkg.com/three-globe@2.34.4/example/img/earth-blue-marble.jpg';
const globeView = {
  on: false, g: null, base: null, timer: null, texPts: null,

  init() {
    this.g = Globe()($('globe'))
      .globeImageUrl(BASE_TEX).backgroundColor('#0b0f1a')
      .atmosphereColor('#6ee7ff')
      .pointLat('lat').pointLng('lng').pointAltitude('alt').pointRadius('r').pointColor('color')
      .pointLabel('label').onPointClick(p => { if (p.marker && !p.marker.getPopup()) p.marker.fire('click'); })
      .pathPointLat(p => p[0]).pathPointLng(p => p[1]).pathColor(() => 'rgba(255,255,255,.8)')
      .pathStroke(0.4).pathDashLength(0.02).pathDashGap(0.02).pathPointAlt(0.01);
    this.g.controls().autoRotate = $('g-rotate').checked;
    this.g.controls().autoRotateSpeed = 0.6;
    this.size();
    addEventListener('resize', () => this.size());
    // Stop spinning while the user drags, resume afterwards
    $('globe').addEventListener('pointerdown', () => { this.g.controls().autoRotate = false; });
    $('globe').addEventListener('pointerup', () => { this.g.controls().autoRotate = $('g-rotate').checked; });
  },

  size() { if (this.g) this.g.width(innerWidth).height(innerHeight); },

  toggle(on) {
    this.on = on;
    if (on && !this.g) this.init();
    $('globe').hidden = !on;
    $('map').style.visibility = on ? 'hidden' : '';
    $('g-rotate-row').hidden = !on;
    clearInterval(this.timer);
    if (on) { this.sync(); this.timer = setInterval(() => this.sync(), 1000); this.size(); }
  },

  rgba(hex, a) {
    if (!/^#[0-9a-f]{3,6}$/i.test(hex || '')) return hex || '#fff';
    if (hex.length === 4) hex = '#' + [...hex.slice(1)].map(c => c + c).join('');
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${a})`;
  },

  sync() {
    const pts = [], paths = [];
    map.eachLayer(l => {
      if (l instanceof L.CircleMarker && !(l instanceof L.Polyline)) {
        const o = l.options, ll = l.getLatLng();
        if (o.fillOpacity === 0 || o.opacity === 0 || (ll.lat === 0 && ll.lng === 0)) return;
        const tip = l.getTooltip() || l.getPopup();
        const c = tip && tip.getContent();
        pts.push({
          lat: ll.lat, lng: ll.lng, r: l.getRadius() * 0.12, marker: l,
          alt: l.altKm != null ? Math.min(l.altKm, 36000) / 6371 * 0.25 : 0.005,
          color: this.rgba(o.fillColor || o.color, o.fillOpacity ?? 0.8),
          label: typeof c === 'string' ? c : '',
        });
      } else if (l instanceof L.Polyline) {
        const arr = l.getLatLngs();
        for (const seg of Array.isArray(arr[0]) ? arr : [arr]) paths.push(seg.map(p => [p.lat, p.lng]));
      }
    });
    this.g.pointsMerge(pts.length > 3000).pointsData(pts).pathsData(paths);
    const heat = typeof weather !== 'undefined' && weather.heat && map.hasLayer(weather.heat) ? weather.heat.points : null;
    if (heat !== this.texPts) { this.texPts = heat; this.setTexture(heat); }
  },

  // Equirectangular IDW temperature texture (same formula as HeatLayer), blended over the base texture
  setTexture(heat) {
    if (!heat || !heat.length) { this.g.globeImageUrl(BASE_TEX); return; }
    const W = 180, H = 90, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d'), img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const lat = 90 - (y + .5) * 180 / H, lng = (x + .5) * 360 / W - 180, k = Math.cos(lat * Math.PI / 180);
      let sw = 0, st = 0;
      for (const p of heat) {
        let dl = Math.abs(p.lng - lng) % 360; if (dl > 180) dl = 360 - dl;
        const d2 = (p.lat - lat) ** 2 + (dl * k) ** 2 + 1, w = 1 / (d2 * d2);
        sw += w; st += w * p.t;
      }
      const col = gradientColor(st / sw), i = (y * W + x) * 4;
      img.data.set([col[0], col[1], col[2], 215], i);
    }
    g.putImageData(img, 0, 0);
    const out = document.createElement('canvas');
    out.width = 1440; out.height = 720;
    const o = out.getContext('2d');
    const done = () => { o.imageSmoothingEnabled = true; o.globalAlpha = .8; o.drawImage(c, 0, 0, out.width, out.height); this.g.globeImageUrl(out.toDataURL()); };
    if (this.base) { o.drawImage(this.base, 0, 0, out.width, out.height); done(); return; }
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { this.base = im; if (this.texPts === heat) { o.drawImage(im, 0, 0, out.width, out.height); done(); } };
    im.onerror = done;
    im.src = BASE_TEX;
  },
};

// Keep "fly to" links (fires, quakes) working in globe view
const _flyTo = map.flyTo;
map.flyTo = function (ll, z, opts) {
  if (globeView.on && globeView.g) {
    const p = L.latLng(ll);
    globeView.g.pointOfView({ lat: p.lat, lng: p.lng, altitude: 1.2 }, 1000);
  }
  return _flyTo.apply(this, arguments);
};

$('g-toggle').addEventListener('change', e => globeView.toggle(e.target.checked));
$('g-rotate').addEventListener('change', e => { if (globeView.g) globeView.g.controls().autoRotate = e.target.checked; });
globeView.toggle($('g-toggle').checked);
