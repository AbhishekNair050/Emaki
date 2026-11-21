const chapterNav = document.querySelector('[aria-label="Guide chapters"]');
const chapterLinks = [...chapterNav.querySelectorAll('a')];
const chapters = chapterLinks.map(link => document.querySelector(link.hash));
const header = document.querySelector('.top');

let currentLink;
let scrollMargin = 0;
let frame = 0;

function showCurrentChapter() {
  frame = 0;
  const readingLine = header.getBoundingClientRect().bottom + scrollMargin + 2;
  const index = chapters.findLastIndex(chapter => chapter.getBoundingClientRect().top <= readingLine);
  const nextLink = chapterLinks[Math.max(0, index)];
  if (currentLink === nextLink) return;

  currentLink?.removeAttribute('aria-current');
  nextLink.setAttribute('aria-current', 'location');
  currentLink = nextLink;

  const navBounds = chapterNav.getBoundingClientRect();
  const linkBounds = nextLink.getBoundingClientRect();
  const left = Math.min(0, linkBounds.left - navBounds.left) || Math.max(0, linkBounds.right - navBounds.right);
  const top = Math.min(0, linkBounds.top - navBounds.top) || Math.max(0, linkBounds.bottom - navBounds.bottom);
  chapterNav.scrollBy({ left, top });
}

function scheduleUpdate() {
  if (!frame) frame = requestAnimationFrame(showCurrentChapter);
}

function updateReadingLine() {
  scrollMargin = parseFloat(getComputedStyle(chapters[0]).scrollMarginTop);
  scheduleUpdate();
}

window.addEventListener('scroll', scheduleUpdate, { passive: true });
window.addEventListener('hashchange', scheduleUpdate);
window.addEventListener('pageshow', updateReadingLine);
window.addEventListener('resize', updateReadingLine);
updateReadingLine();
