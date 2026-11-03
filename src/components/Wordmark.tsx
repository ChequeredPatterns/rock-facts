/**
 * The Rock Factory wordmark.
 *
 * This is a CSS rendering of the company logo, used so the app has no binary
 * asset dependency and stays crisp at any size and in dark mode.
 *
 * TO USE THE REAL LOGO FILE INSTEAD:
 *   1. Save the logo as `public/logo.png` (or .svg).
 *   2. Replace the <span> block below with:
 *        <img src="/logo.png" alt="The Rock Factory" style={{ height: 44 }} />
 *   Nothing else in the app needs to change.
 *
 * Note the supplied logo is solid black, so on a dark background it will need
 * a white version — which is exactly why the CSS version below is the default:
 * it follows the colour scheme automatically.
 */

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }} aria-label="The Rock Factory">
      <span className="wm-the" aria-hidden="true">
        The
      </span>
      <span className="wm-main" aria-hidden="true">
        Rock
      </span>
      <span className="wm-main" aria-hidden="true">
        Factory<span className="wm-net">.net</span>
      </span>
    </span>
  );
}
