/**
 * Weather: snow, rain or petals falling over the scene (a canvas in the
 * plugin's layer). Lasting, so a load or going back brings it back.
 *
 *   @weather start kind="petals" amount=60
 *   @weather stop
 */
/** @type {import('../emaki-plugin').PluginSetup} */
export default function weather(ctx) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  ctx.layer.append(canvas);
  const g = canvas.getContext('2d');
  let drops = [];
  let kind = null;
  let frame = 0;
  let last = 0;

  const STYLE = {
    snow: { color: 'rgba(255,255,255,0.9)', speed: [30, 70], size: [1.5, 4], drift: 20 },
    rain: { color: 'rgba(200,220,255,0.55)', speed: [600, 900], size: [1, 1.5], drift: 60 },
    petals: { color: 'rgba(255,190,210,0.9)', speed: [40, 90], size: [3, 6], drift: 50 },
  };
  const rand = ([a, b]) => a + Math.random() * (b - a);

  function fit() {
    canvas.width = ctx.stage.clientWidth;
    canvas.height = ctx.stage.clientHeight;
  }

  function spawn(top) {
    const s = STYLE[kind];
    return { x: Math.random() * canvas.width, y: top ? -10 : Math.random() * canvas.height, v: rand(s.speed), r: rand(s.size), p: Math.random() * Math.PI * 2 };
  }

  function draw() {
    const s = STYLE[kind];
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = s.color;
    g.strokeStyle = s.color;
    for (const d of drops) {
      if (kind === 'rain') {
        g.lineWidth = d.r;
        g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x - 3, d.y + 14); g.stroke();
      } else if (kind === 'petals') {
        g.beginPath(); g.ellipse(d.x, d.y, d.r * 1.6, d.r, d.p, 0, Math.PI * 2); g.fill();
      } else {
        g.beginPath(); g.arc(d.x, d.y, d.r, 0, Math.PI * 2); g.fill();
      }
    }
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    const s = STYLE[kind];
    for (const d of drops) {
      d.y += d.v * dt;
      d.p += dt;
      d.x += Math.sin(d.p) * s.drift * dt;
      if (d.y > canvas.height + 10) Object.assign(d, spawn(true));
    }
    draw();
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    kind = null;
    drops = [];
    g.clearRect(0, 0, canvas.width, canvas.height);
  }

  return {
    commands: {
      start(args) {
        stop();
        fit();
        kind = args.kind;
        drops = Array.from({ length: Math.max(1, Math.min(400, args.amount ?? 80)) }, () => spawn(false));
        // Less motion asked for: the weather is there, but holds still.
        if (ctx.reducedMotion) { draw(); return; }
        last = performance.now();
        frame = requestAnimationFrame(tick);
      },
      stop,
    },
    reset: stop,
    destroy: stop,
  };
}
