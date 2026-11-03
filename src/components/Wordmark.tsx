/**
 * The Rock Factory wordmark.
 *
 * Rendered in CSS rather than as an image file so it stays crisp at any size
 * and sits correctly on the dark interface. The supplied logo artwork is
 * solid black, which would be invisible here; this version carries the same
 * stacked, heavy-condensed structure in the interface's own palette.
 *
 * TO USE THE REAL LOGO FILE INSTEAD:
 *   1. Save a WHITE version of the logo as `public/logo.png` (or .svg).
 *   2. Replace the returned markup below with:
 *        <img src="/logo.png" alt="The Rock Factory" style={{ height: 42 }} />
 *   Nothing else in the app needs to change.
 */

export function Wordmark({ size = 17 }: { size?: number }) {
  return (
    <span
      aria-label="The Rock Factory"
      style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        textTransform: 'uppercase',
        lineHeight: 0.86,
        letterSpacing: '-0.01em',
        fontSize: size,
        display: 'inline-block',
        color: 'var(--text)',
        textShadow: '0 0 26px rgba(61, 219, 245, 0.35)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'block',
          fontSize: '0.56em',
          letterSpacing: '0.34em',
          color: 'var(--cyan)',
        }}
      >
        The
      </span>
      <span aria-hidden="true" style={{ display: 'block', fontSize: '1.45em' }}>
        Rock
      </span>
      <span aria-hidden="true" style={{ display: 'block', fontSize: '1.45em' }}>
        Factory
        <span
          style={{
            fontSize: '0.4em',
            letterSpacing: '0.1em',
            color: 'var(--cyan)',
            verticalAlign: 'super',
            marginLeft: '0.12em',
          }}
        >
          .net
        </span>
      </span>
    </span>
  );
}
