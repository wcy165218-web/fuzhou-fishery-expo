import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function findMainContentCloseIndex(source) {
  const mainOpen = source.match(/<div\b[^>]*\bid=["']main-content["'][^>]*>/i);
  assert.ok(mainOpen, 'index.html should contain #main-content');

  const start = mainOpen.index + mainOpen[0].length;
  const divTagPattern = /<\/?div\b[^>]*>/gi;
  divTagPattern.lastIndex = start;

  let depth = 1;
  let match;
  while ((match = divTagPattern.exec(source))) {
    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return match.index;
    } else {
      depth += 1;
    }
  }

  assert.fail('#main-content closing </div> was not found');
}

const mainCloseIndex = findMainContentCloseIndex(html);
const expectedSections = [
  'sec-home',
  'sec-config',
  'sec-booth-map',
  'sec-booth',
  'sec-order-entry',
  'sec-order-list'
];

for (const sectionId of expectedSections) {
  const sectionIndex = html.indexOf(`id="${sectionId}"`);
  assert.ok(sectionIndex >= 0, `${sectionId} should exist in index.html`);
  assert.ok(
    sectionIndex < mainCloseIndex,
    `${sectionId} should stay inside #main-content; check for an extra closing </div> before it`
  );
}

console.log('Index layout tests passed');
