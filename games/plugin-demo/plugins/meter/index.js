/**
 * Meter: a bar for screens, filled to a number out of a maximum.
 *
 *   screen hud:
 *     @meter bar value=trust max=10 label="Trust" at 3% 4% size 20% 2%
 */
export default function meter() {
  return {
    elements: {
      bar(args) {
        const max = args.max ?? 100;
        const share = Math.max(0, Math.min(1, args.value / max));
        const bar = document.createElement('div');
        bar.setAttribute('role', 'meter');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', String(max));
        bar.setAttribute('aria-valuenow', String(args.value));
        if (args.label) bar.setAttribute('aria-label', args.label);
        bar.style.cssText = 'background: rgb(0 0 0 / 0.45); border: 1px solid rgb(255 255 255 / 0.6); border-radius: 999px; overflow: hidden; min-height: 8px;';
        const fill = document.createElement('div');
        fill.style.cssText = `height: 100%; min-height: 8px; width: ${share * 100}%; background: ${args.color ?? '#f2a7b8'}; transition: width 0.4s;`;
        bar.append(fill);
        return bar;
      },
    },
  };
}
