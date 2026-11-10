/**
 * Memory: turn over two cards at a time to find the pairs. The story waits
 * until they're all found, then gets the number of turns it took.
 *
 *   @memory play pairs=4 -> turns
 */
const FACES = ['🐚', '⚓', '🌊', '🐟', '⛵', '🦀', '🌙', '⭐'];

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
        const pairs = Math.max(2, Math.min(FACES.length, Math.round(args.pairs ?? 4)));
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
        const show = () => { counter.textContent = `Turns: ${turns}`; };
        show();
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
  };
}
