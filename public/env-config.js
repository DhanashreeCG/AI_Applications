/* Per-frontend hosts for nginx / VPS static deploys.
   Copy this whole `public/` folder (HTML + fonts + logos + css + this file).
   Leave a URL empty to use the HTML folder (same-origin relative assets).

   FLASHCARDS_API_URL / WORKSHEETS_API_URL — Nest API origin
   PUBLIC_ASSET_URL — where this `public/` tree is served (fonts, logos, css).
     Empty: assets next to the HTML file (recommended same-structure deploy).
     Example: "https://api.example.com" if nginx hosts HTML and Nest still serves /public. */
window.__ENV__ = {
  FLASHCARDS_API_URL: "",
  WORKSHEETS_API_URL: "",
  PUBLIC_ASSET_URL: ""
};
