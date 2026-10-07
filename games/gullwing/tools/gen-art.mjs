// Generates the demo's placeholder art as SVG (backgrounds + Mira's expressions).
// Run: npm run art
// These are deliberately simple, hand-coded shapes — replace with real art any time;
// story.vn only refers to the file paths.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '../assets');

function write(rel, svg) {
  const path = resolve(assets, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, svg.trim() + '\n');
  console.log('wrote', rel);
}

// Deterministic pseudo-random so regenerating gives identical files.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const bg = (defs, body) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
  <defs>${defs}</defs>
  ${body}
</svg>`;

// ---------------------------------------------------------------- cliff road, dusk
{
  seed = 11;
  const stars = Array.from({ length: 70 }, () =>
    `<circle cx="${(rand() * 1920).toFixed(0)}" cy="${(rand() * 380).toFixed(0)}" r="${(rand() * 1.8 + 0.6).toFixed(1)}" fill="#fff" opacity="${(rand() * 0.6 + 0.2).toFixed(2)}"/>`).join('');
  write('bg/cliff_road_dusk.svg', bg(`
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d2148"/><stop offset="0.45" stop-color="#5a3f6e"/>
      <stop offset="0.75" stop-color="#c86b5a"/><stop offset="1" stop-color="#f2b56b"/>
    </linearGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3d4a6b"/><stop offset="1" stop-color="#141b2e"/>
    </linearGradient>
    <radialGradient id="beam" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff6d6" stop-opacity="0.95"/><stop offset="1" stop-color="#fff6d6" stop-opacity="0"/>
    </radialGradient>`, `
    <rect width="1920" height="1080" fill="url(#sky)"/>
    ${stars}
    <path d="M0 250 Q400 220 760 270 T1500 240 T1920 260 V300 Q1500 290 1100 310 T0 300Z" fill="#2a2347" opacity="0.55"/>
    <path d="M200 420 Q600 390 1000 430 T1920 410 V450 Q1500 440 1000 465 T200 450Z" fill="#7a4a63" opacity="0.4"/>
    <rect y="640" width="1920" height="440" fill="url(#sea)"/>
    <g stroke="#f2b56b" stroke-opacity="0.35" stroke-width="3">
      <line x1="300" y1="670" x2="520" y2="670"/><line x1="820" y1="700" x2="1100" y2="700"/>
      <line x1="560" y1="740" x2="700" y2="740"/><line x1="1200" y1="680" x2="1330" y2="680"/>
    </g>
    <path d="M1180 650 L1260 520 Q1330 470 1420 480 L1600 470 Q1700 480 1760 540 L1920 600 V1080 H1100Z" fill="#1b1a2b"/>
    <g transform="translate(1480 300)">
      <polygon points="-30,180 30,180 22,0 -22,0" fill="#e9e3d6"/>
      <rect x="-26" y="40" width="50" height="22" fill="#a8423a"/>
      <rect x="-28" y="110" width="56" height="22" fill="#a8423a"/>
      <rect x="-28" y="-34" width="56" height="34" fill="#2a2a38"/>
      <rect x="-20" y="-28" width="40" height="22" fill="#ffe9a8"/>
      <path d="M-34 -34 L0 -64 L34 -34Z" fill="#2a2a38"/>
      <ellipse cx="0" cy="-17" rx="160" ry="38" fill="url(#beam)" opacity="0.8"/>
      <rect x="-24" y="150" width="14" height="22" fill="#2a2a38"/>
    </g>
    <rect x="1700" y="590" width="70" height="44" fill="#26243a"/><rect x="1712" y="602" width="16" height="14" fill="#ffd27a"/>
    <path d="M0 760 Q500 700 900 720 Q1150 735 1250 650 L1300 660 Q1200 770 950 800 Q500 840 0 900Z" fill="#2c2738"/>
    <path d="M0 1080 L0 900 Q500 830 950 800 Q1200 780 1300 660 L1340 664 Q1260 840 1100 1080Z" fill="#3d3646"/>
    <path d="M380 1080 Q700 900 1020 810 Q1200 760 1310 662" stroke="#8a7f86" stroke-width="7" fill="none" stroke-dasharray="40 30" opacity="0.5"/>
    <g fill="#1a1724">
      <path d="M0 1080 L0 860 Q120 840 200 880 L260 1080Z"/>
      <path d="M1500 1080 Q1600 980 1920 960 V1080Z"/>
    </g>
    <g stroke="#1a1724" stroke-width="4">
      <line x1="140" y1="900" x2="150" y2="1080"/><line x1="160" y1="920" x2="190" y2="1080"/>
    </g>`));
}

// ---------------------------------------------------------------- kitchen, night
{
  seed = 23;
  const rain = Array.from({ length: 60 }, () => {
    const x = 180 + rand() * 420, y = 180 + rand() * 380;
    return `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x - 8).toFixed(0)}" y2="${(y + 28).toFixed(0)}"/>`;
  }).join('');
  const boards = Array.from({ length: 12 }, (_, i) => `<line x1="0" y1="${820 + i * 24}" x2="1920" y2="${820 + i * 24}"/>`).join('');
  write('bg/kitchen_night.svg', bg(`
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a1f1b"/><stop offset="1" stop-color="#4a3428"/>
    </linearGradient>
    <radialGradient id="lamp" cx="0.55" cy="0.35" r="0.6">
      <stop offset="0" stop-color="#ffcf7d" stop-opacity="0.55"/><stop offset="0.5" stop-color="#ff9f4a" stop-opacity="0.12"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="night" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0d1426"/><stop offset="1" stop-color="#22324f"/>
    </linearGradient>`, `
    <rect width="1920" height="1080" fill="url(#wall)"/>
    <rect y="800" width="1920" height="280" fill="#2b1d16"/>
    <g stroke="#1d130e" stroke-width="3">${boards}</g>
    <rect x="160" y="160" width="460" height="420" rx="6" fill="#1a120e"/>
    <rect x="180" y="180" width="420" height="380" fill="url(#night)"/>
    <path d="M180 470 Q300 430 400 470 T600 455 V560 H180Z" fill="#0a0f1c"/>
    <g stroke="#9fb4d6" stroke-opacity="0.45" stroke-width="2">${rain}</g>
    <rect x="386" y="180" width="8" height="380" fill="#1a120e"/><rect x="180" y="366" width="420" height="8" fill="#1a120e"/>
    <rect x="140" y="580" width="500" height="22" fill="#3a2a20"/>
    <rect x="1300" y="220" width="460" height="16" fill="#3b2a1f"/>
    <g fill="#6e5546"><rect x="1330" y="160" width="40" height="60"/><rect x="1390" y="176" width="34" height="44"/><circle cx="1480" cy="196" r="24"/></g>
    <rect x="1580" y="150" width="120" height="70" fill="#24363a"/><text x="1640" y="196" fill="#cfc6a8" font-family="Georgia" font-size="22" text-anchor="middle">1012</text>
    <circle cx="1640" cy="330" r="62" fill="#5a4636"/><circle cx="1640" cy="330" r="50" fill="#e8dfc8"/>
    <line x1="1640" y1="330" x2="1660" y2="296" stroke="#2a1f1b" stroke-width="5"/>
    <rect x="1100" y="120" width="6" height="140" fill="#1a120e"/>
    <path d="M1060 260 h86 l-12 50 h-62Z" fill="#c58a3b"/><ellipse cx="1103" cy="312" rx="34" ry="8" fill="#ffd98a"/>
    <rect width="1920" height="1080" fill="url(#lamp)"/>
    <path d="M520 760 L1460 760 L1560 860 L420 860Z" fill="#5c3f2c"/>
    <rect x="420" y="860" width="1140" height="26" fill="#3f2a1d"/>
    <rect x="480" y="886" width="34" height="194" fill="#3f2a1d"/><rect x="1466" y="886" width="34" height="194" fill="#3f2a1d"/>
    <path d="M620 765 L1340 765 L1400 840 L560 840Z" fill="#8a3c34" opacity="0.6"/>
    <g transform="translate(820 690)">
      <ellipse cx="0" cy="60" rx="80" ry="16" fill="#2a1f1b" opacity="0.5"/>
      <path d="M-70 60 Q-80 -10 0 -16 Q80 -10 70 60Z" fill="#2f4a5a"/>
      <path d="M68 10 Q120 -6 120 -40" stroke="#2f4a5a" stroke-width="14" fill="none"/>
      <path d="M-68 0 Q-110 0 -104 40 Q-96 60 -64 48" stroke="#2f4a5a" stroke-width="12" fill="none"/>
      <ellipse cx="0" cy="-16" rx="40" ry="10" fill="#26404e"/><circle cx="0" cy="-30" r="10" fill="#26404e"/>
    </g>
    <g transform="translate(1100 780) rotate(-6)">
      <rect x="-90" y="-36" width="180" height="96" fill="#efe6d2"/>
      <path d="M-90 -36 L0 20 L90 -36" stroke="#cfc3a8" stroke-width="3" fill="none"/>
      <circle cx="0" cy="18" r="13" fill="#9c2b26"/>
    </g>
    <g transform="translate(960 760)"><rect x="-26" y="-50" width="52" height="56" rx="6" fill="#e8dfc8"/><path d="M26 -36 q22 4 0 30" stroke="#e8dfc8" stroke-width="7" fill="none"/></g>`));
}

// ---------------------------------------------------------------- lamp room, night
{
  seed = 41;
  const rain = Array.from({ length: 140 }, () => {
    const x = rand() * 1920, y = rand() * 700;
    return `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x - 14).toFixed(0)}" y2="${(y + 46).toFixed(0)}"/>`;
  }).join('');
  const prisms = Array.from({ length: 9 }, (_, i) => {
    const y = 250 + i * 46, w = 230 - Math.abs(i - 4) * 18;
    return `<ellipse cx="960" cy="${y}" rx="${w}" ry="20" fill="url(#glass)" stroke="#d6b45c" stroke-opacity="0.5" stroke-width="2"/>`;
  }).join('');
  write('bg/lamp_room_night.svg', bg(`
    <linearGradient id="storm" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#070b16"/><stop offset="1" stop-color="#1b2740"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#1f3b44"/><stop offset="0.5" stop-color="#9ad1c8"/><stop offset="1" stop-color="#1f3b44"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.45" r="0.35">
      <stop offset="0" stop-color="#bfe8de" stop-opacity="0.35"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>`, `
    <rect width="1920" height="1080" fill="url(#storm)"/>
    <g stroke="#7f95b8" stroke-opacity="0.35" stroke-width="2">${rain}</g>
    <g fill="#0c0f17">
      <rect x="0" y="0" width="1920" height="70"/>
      ${[0, 300, 640, 1260, 1600, 1890].map((x) => `<rect x="${x}" y="0" width="30" height="760"/>`).join('')}
      <rect x="0" y="380" width="1920" height="18"/>
    </g>
    <rect width="1920" height="1080" fill="url(#glow)"/>
    <rect x="700" y="210" width="520" height="22" fill="#3a3326"/>
    ${prisms}
    <rect x="938" y="180" width="44" height="40" fill="#3a3326"/>
    <ellipse cx="960" cy="440" rx="54" ry="54" fill="#f7f1d6" opacity="0.18"/>
    <path d="M760 660 L1160 660 L1210 760 L710 760Z" fill="#2b2a2a"/>
    <rect x="690" y="760" width="540" height="40" fill="#1d1c1c"/>
    <ellipse cx="960" cy="660" rx="200" ry="20" fill="#8b8f96" opacity="0.7"/>
    <rect y="760" width="1920" height="320" fill="#121315"/>
    <g stroke="#2f3136" stroke-width="10">
      <line x1="0" y1="840" x2="1920" y2="840"/>
      ${Array.from({ length: 13 }, (_, i) => `<line x1="${i * 160}" y1="840" x2="${i * 160}" y2="1080"/>`).join('')}
    </g>
    <g transform="translate(1420 700)">
      <rect x="-50" y="0" width="100" height="120" fill="#2c2f36"/>
      <circle cx="0" cy="40" r="32" fill="#3d424b" stroke="#62676f" stroke-width="4"/>
      <line x1="0" y1="40" x2="60" y2="-10" stroke="#888c92" stroke-width="10" stroke-linecap="round"/>
      <circle cx="60" cy="-10" r="10" fill="#a9733d"/>
    </g>
    <g transform="translate(330 640)">
      <rect x="0" y="0" width="190" height="110" rx="6" fill="#2d332d"/>
      <rect x="16" y="16" width="100" height="40" fill="#9fd8a8" opacity="0.5"/>
      <circle cx="150" cy="36" r="16" fill="#1b1f1b"/><circle cx="40" cy="84" r="8" fill="#d9534f"/>
      <path d="M190 30 Q240 30 236 -40" stroke="#1b1f1b" stroke-width="6" fill="none"/>
      <rect x="220" y="-80" width="30" height="50" rx="8" fill="#1b1f1b"/>
    </g>`));
}

// ---------------------------------------------------------------- shore, dawn
{
  write('bg/shore_dawn.svg', bg(`
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7f9cc4"/><stop offset="0.5" stop-color="#e8b7a8"/><stop offset="1" stop-color="#ffd59a"/>
    </linearGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c79a86"/><stop offset="0.3" stop-color="#6b7f99"/><stop offset="1" stop-color="#2f3e57"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff4d1"/><stop offset="0.4" stop-color="#ffd48a" stop-opacity="0.8"/><stop offset="1" stop-color="#ffd48a" stop-opacity="0"/>
    </radialGradient>`, `
    <rect width="1920" height="1080" fill="url(#sky)"/>
    <circle cx="1180" cy="600" r="260" fill="url(#sun)"/>
    <circle cx="1180" cy="610" r="64" fill="#fff1c9"/>
    <path d="M0 300 Q300 270 700 300 T1400 280 T1920 300 V320 Q1500 310 1000 330 T0 330Z" fill="#fff" opacity="0.25"/>
    <rect y="610" width="1920" height="470" fill="url(#sea)"/>
    <g stroke="#fff3cf" stroke-linecap="round" opacity="0.8">
      ${[640, 670, 705, 745, 790, 840].map((y, i) => `<line x1="${1180 - 40 - i * 22}" y1="${y}" x2="${1180 + 40 + i * 22}" y2="${y}" stroke-width="${6 - i * 0.6}"/>`).join('')}
    </g>
    <g transform="translate(820 690)">
      <path d="M-90 0 L90 0 L70 30 L-74 30Z" fill="#3a3140"/>
      <rect x="-20" y="-40" width="50" height="40" fill="#4a4050"/>
      <line x1="0" y1="-40" x2="0" y2="-120" stroke="#3a3140" stroke-width="6"/>
      <path d="M0 -118 L56 -60 L0 -60Z" fill="#e9dccb" opacity="0.8"/>
    </g>
    <path d="M0 520 L120 500 Q200 470 260 480 L360 520 L420 610 L0 640Z" fill="#4b3f4c"/>
    <g transform="translate(200 300)">
      <polygon points="-22,180 22,180 16,0 -16,0" fill="#f2ece0"/>
      <rect x="-19" y="40" width="37" height="18" fill="#b2493f"/><rect x="-21" y="110" width="42" height="18" fill="#b2493f"/>
      <rect x="-20" y="-26" width="40" height="26" fill="#3a3346"/><rect x="-14" y="-20" width="28" height="16" fill="#fff0c4"/>
      <path d="M-24 -26 L0 -48 L24 -26Z" fill="#3a3346"/>
    </g>
    <path d="M0 640 L420 610 L520 700 L1000 760 Q1500 800 1920 820 V1080 H0Z" fill="#6d5a52"/>
    <path d="M0 760 Q600 780 1000 800 Q1500 830 1920 850 V1080 H0Z" fill="#a08670"/>
    <path d="M0 900 Q700 880 1920 940 V1080 H0Z" fill="#c4a988"/>
    <g fill="#5b4a43">
      <ellipse cx="1500" cy="960" rx="80" ry="22"/><ellipse cx="380" cy="1010" rx="60" ry="16"/><ellipse cx="1720" cy="890" rx="40" ry="12"/>
    </g>
    <g stroke="#3d3340" stroke-width="3" fill="none">
      <path d="M1320 360 q12 -10 24 0 q12 -10 24 0"/><path d="M1420 320 q9 -8 18 0 q9 -8 18 0"/>
    </g>`));
}

// ---------------------------------------------------------------- Mira
const expressions = {
  neutral: {
    brows: 'M236 236 Q260 228 286 232 M314 232 Q340 228 364 236',
    eyes: '<ellipse cx="262" cy="266" rx="9" ry="11" fill="#2b2420"/><ellipse cx="338" cy="266" rx="9" ry="11" fill="#2b2420"/>',
    mouth: 'M274 332 Q300 337 326 332',
    extra: '',
  },
  smile: {
    brows: 'M236 230 Q260 220 286 228 M314 228 Q340 220 364 230',
    eyes: '<path d="M250 268 Q262 256 274 268" stroke="#2b2420" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M326 268 Q338 256 350 268" stroke="#2b2420" stroke-width="5" fill="none" stroke-linecap="round"/>',
    mouth: 'M268 324 Q300 352 332 324',
    extra: '<ellipse cx="240" cy="300" rx="20" ry="11" fill="#d9776a" opacity="0.35"/><ellipse cx="360" cy="300" rx="20" ry="11" fill="#d9776a" opacity="0.35"/>',
  },
  stern: {
    brows: 'M236 226 L288 242 M312 242 L364 226',
    eyes: '<ellipse cx="262" cy="268" rx="9" ry="8" fill="#2b2420"/><ellipse cx="338" cy="268" rx="9" ry="8" fill="#2b2420"/>',
    mouth: 'M276 336 L324 336',
    extra: '<path d="M296 236 L298 250 M304 236 L302 250" stroke="#b07e62" stroke-width="2"/>',
  },
  sad: {
    brows: 'M236 240 Q262 232 286 224 M314 224 Q338 232 364 240',
    eyes: '<ellipse cx="262" cy="270" rx="9" ry="10" fill="#2b2420"/><ellipse cx="338" cy="270" rx="9" ry="10" fill="#2b2420"/>',
    mouth: 'M278 340 Q300 326 322 340',
    extra: '',
  },
};

for (const [name, x] of Object.entries(expressions)) {
  write(`sprites/mira_${name}.svg`, `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 1000">
  <defs>
    <linearGradient id="coat" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d8a33a"/><stop offset="1" stop-color="#9c6f1f"/>
    </linearGradient>
    <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e6bb98"/><stop offset="1" stop-color="#cf9f7c"/>
    </linearGradient>
    <linearGradient id="hair" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d9d6cf"/><stop offset="1" stop-color="#9c9890"/>
    </linearGradient>
  </defs>
  <!-- coat -->
  <path d="M110 1000 L132 560 Q150 450 300 432 Q450 450 468 560 L490 1000Z" fill="url(#coat)"/>
  <path d="M300 470 L300 1000" stroke="#7d5717" stroke-width="5"/>
  <g fill="#5e4210">${[560, 650, 740, 830, 920].map((y) => `<circle cx="318" cy="${y}" r="9"/>`).join('')}</g>
  <path d="M140 640 Q150 760 180 1000" stroke="#7d5717" stroke-width="4" fill="none" opacity="0.6"/>
  <path d="M460 640 Q450 760 420 1000" stroke="#7d5717" stroke-width="4" fill="none" opacity="0.6"/>
  <!-- sweater collar + neck -->
  <rect x="262" y="360" width="76" height="70" fill="url(#skin)"/>
  <path d="M232 410 Q300 450 368 410 L384 470 Q300 510 216 470Z" fill="#3b4a5a"/>
  <path d="M222 466 L300 520 L250 560 L196 480Z M378 466 L300 520 L350 560 L404 480Z" fill="#b8862c"/>
  <!-- hair back + bun -->
  <circle cx="300" cy="148" r="58" fill="url(#hair)"/>
  <ellipse cx="300" cy="236" rx="112" ry="120" fill="url(#hair)"/>
  <!-- face -->
  <ellipse cx="300" cy="270" rx="94" ry="112" fill="url(#skin)"/>
  <ellipse cx="206" cy="282" rx="14" ry="24" fill="#cf9f7c"/><ellipse cx="394" cy="282" rx="14" ry="24" fill="#cf9f7c"/>
  <!-- hair front -->
  <path d="M206 250 Q210 150 300 146 Q392 150 396 250 Q380 196 330 186 Q300 210 250 196 Q216 210 206 250Z" fill="url(#hair)"/>
  <path d="M250 196 Q280 176 330 186" stroke="#f1efe9" stroke-width="3" fill="none" opacity="0.6"/>
  <!-- age lines -->
  <path d="M232 280 l-12 6 M232 290 l-10 10 M368 280 l12 6 M368 290 l10 10" stroke="#b07e62" stroke-width="2"/>
  <path d="M262 352 Q300 362 338 352" stroke="#c48d6c" stroke-width="2" fill="none" opacity="0.6"/>
  <!-- features -->
  ${x.extra}
  <path d="${x.brows}" stroke="#8a857c" stroke-width="7" fill="none" stroke-linecap="round"/>
  ${x.eyes}
  <path d="M298 276 Q292 304 300 310 Q306 312 312 306" stroke="#b07e62" stroke-width="3" fill="none"/>
  <path d="${x.mouth}" stroke="#8c4a3e" stroke-width="5" fill="none" stroke-linecap="round"/>
</svg>`);
}
