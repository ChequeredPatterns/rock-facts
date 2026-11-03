# public/

## Adding the real company logo

Drop the company logo file into this folder named **`logo.png`**
(or `logo.svg`, `logo.webp`, `logo.jpg`). That is the whole job — the app
detects it automatically and uses it in place of the typeset wordmark. No code
change, no rebuild step to configure.

The supplied artwork is **black on white**, which would be invisible on this
dark interface, so it is inverted automatically in CSS. A file with an opaque
white background and one with transparency both come out correctly as white
lettering — this has been tested with both.

If you would rather supply a ready-made white version, that works too: delete
the `filter`/`mix-blend-mode` lines from `.logo-img` in
`src/app/globals.css` so it is shown as-is.
