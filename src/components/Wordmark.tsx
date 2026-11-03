/**
 * The Rock Factory wordmark.
 *
 * TWO MODES, chosen automatically at render time:
 *
 * 1. REAL ARTWORK (preferred). Drop the company logo file into `public/` as
 *    `logo.png`, `logo.svg`, `logo.jpg` or `logo.webp` and it is picked up
 *    automatically — no code change. The original artwork is black-on-white,
 *    so it is inverted for the dark interface (see `.logo-img` in globals.css).
 *
 * 2. TYPESET FALLBACK. Until that file exists, the wordmark is reproduced in
 *    CSS using Anton — a heavy condensed grotesque very close to the original
 *    lettering — laid out in the same structure as the real mark: a vertical
 *    "THE" beside a large "ROCK", over "FACTORY." with a vertical "net".
 *
 * The detection runs on the server (this is a server component), so it costs
 * nothing at request time beyond a cached filesystem check.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Checked in order; the first that exists wins. */
const CANDIDATES = ['logo.svg', 'logo.png', 'logo.webp', 'logo.jpg', 'logo.jpeg'];

/** Resolved once per server process rather than on every render. */
let resolved: string | null | undefined;

function findLogoFile(): string | null {
  if (resolved !== undefined) return resolved;
  try {
    const publicDir = path.join(process.cwd(), 'public');
    resolved = CANDIDATES.find((f) => fs.existsSync(path.join(publicDir, f))) ?? null;
  } catch {
    resolved = null;
  }
  return resolved;
}

export function Wordmark({ size = 17 }: { size?: number }) {
  const file = findLogoFile();

  if (file) {
    return (
      <img
        src={`/${file}`}
        alt="The Rock Factory"
        className="logo-img"
        style={{ height: size * 2.9 }}
      />
    );
  }

  return (
    <span className="logo-type" style={{ fontSize: size }} aria-label="The Rock Factory">
      <span className="logo-row" aria-hidden="true">
        <span className="logo-the">The</span>
        <span className="logo-big">Rock</span>
      </span>
      <span className="logo-row" aria-hidden="true">
        <span className="logo-big">Factory.</span>
        <span className="logo-net">net</span>
      </span>
    </span>
  );
}
