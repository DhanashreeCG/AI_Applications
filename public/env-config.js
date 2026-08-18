/* Per-frontend API hosts for nginx static deploys.
   Leave a value empty to use the page origin (Nest serving /public).
   Safe to edit in production without rebuilding. */
window.__ENV__ = {
  FLASHCARDS_API_URL: "",
  WORKSHEETS_API_URL: ""
};
