const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The scripts in js/ share one global scope, so a name declared twice silently replaces the
// first (this has caused real bugs). Keep every top-level name unique.
test('no top-level name is declared in two scripts', () => {
  const dir = path.join(__dirname, '..', 'js'),
    seen = {};
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/^(?:async\s+)?function\s+([\w$]+)|^(?:const|let|var)\s+([\w$]+)/gm))
      (seen[m[1] || m[2]] = seen[m[1] || m[2]] || []).push(f);
  }
  expect(Object.entries(seen).filter(([, files]) => files.length > 1)).toEqual([]);
});
