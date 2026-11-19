/**
 * Memory: turn over two cards at a time to find the pairs. The story waits
 * until they're all found, then gets the number of turns it took.
 *
 *   @memory play pairs=4 -> turns
 *   if turns <= @memory.perfect(4) + 2:     the fewest turns a round can take
 *   if new_best:                            set by the plugin (plugin.json "sets")
 *
 * The best round for each size is kept on the device (ctx.storage), across
 * playthroughs, and shown under the board.
 */
const FACES = ['🐚', '⚓', '🌊', '🐟', '⛵', '🦀', '🌙', '⭐'];
const size = (pairs) => Math.max(2, Math.min(FACES.length, Math.round(pairs ?? 4)));

/** @type {import('../emaki-plugin').PluginSetup} */
export default function memory(ctx) {
  const style = document.createElement('style');
  style.textContent = `
    .plugin-modal.plugin-memory { display: grid; place-items: center; background: rgb(8 12 20 / 0.72); }
    .memory-board { display: grid; gap: 1.2cqw; }
    .memory-card {
      width: 9cqw; aspect-ratio: 3 / 4; border-radius: 0.8cqw; border: 2px solid rgb(255 255 255 / 0.5);
      background: #24324a; color: transparent; font-size: 4cqw; cursor: pointer; transition: transform 0.2s;
    }
    .memory-card.up, .memory-card.done { background: #f3ead8; color: inherit; }
    .memory-card.done { opacity: 0.55; cursor: default; }
    .memory-card:focus-visible { outline: 3px solid #ffd27a; }
    .memory-turns { color: #fff; font: 600 2cqw system-ui, sans-serif; text-align: center; margin-top: 1.5cqw; }
  `;
  document.head.append(style);

  return {
    commands: {
      play(args) {
        const pairs = size(args.pairs);
        const deck = [...FACES.slice(0, pairs), ...FACES.slice(0, pairs)].sort(() => Math.random() - 0.5);
        const { root, close } = ctx.modal();
        const board = document.createElement('div');
        board.className = 'memory-board';
        board.style.gridTemplateColumns = `repeat(${Math.min(pairs, 4)}, auto)`;
        const counter = document.createElement('div');
        counter.className = 'memory-turns';
        counter.setAttribute('aria-live', 'polite');
        root.append(board, counter);
        let turns = 0, open = [], found = 0;
        const best = ctx.storage.get(`best${pairs}`);
        const show = () => { counter.textContent = `Turns: ${turns}${typeof best === 'number' ? ` · Best: ${best}` : ''}`; };
        show();
        /** @type {Promise<number>} */
        return new Promise((resolve) => {
          deck.forEach((face, i) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'memory-card';
            card.textContent = face;
            card.setAttribute('aria-label', `Card ${i + 1}`);
            card.addEventListener('click', (e) => {
              e.stopPropagation();
              if (card.classList.contains('up') || card.classList.contains('done') || open.length === 2) return;
              card.classList.add('up');
              card.setAttribute('aria-label', `Card ${i + 1}: ${face}`);
              open.push(card);
              if (open.length < 2) return;
              turns++;
              show();
              const [a, b] = open;
              const match = a.textContent === b.textContent;
              setTimeout(() => {
                for (const c of open) {
                  c.classList.remove('up');
                  if (match) c.classList.add('done'); else c.setAttribute('aria-label', `Card ${[...board.children].indexOf(c) + 1}`);
                }
                open = [];
                if (match && (found += 1) === pairs) {
                  const record = typeof best !== 'number' || turns < best;
                  if (record) ctx.storage.set(`best${pairs}`, turns);
                  ctx.set('new_best', record);
                  setTimeout(() => { close(); resolve(turns); }, 400);
                }
              }, match ? 250 : 700);
            });
            board.append(card);
          });
          board.querySelector('button')?.focus();
        });
      },
    },
    functions: {
      // With perfect luck, every turn finds a pair.
      perfect: (pairs) => size(pairs),
    },
  };
}
