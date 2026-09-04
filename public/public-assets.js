/**
 * Shared public/ asset resolver for separately deployed flashcards.html
 * and worksheets.html. Load after env-config.js.
 *
 * Resolution order for PUBLIC_ASSET_URL:
 * 1. window.__ENV__.PUBLIC_ASSET_URL
 * 2. Directory of env-config.js / public-assets.js (same folder as the HTML)
 * 3. Directory of the current page
 */
(function () {
  function trimSlash(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function env() {
    return window.__ENV__ || {};
  }

  function scriptDirectory() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i += 1) {
      var src = scripts[i].getAttribute('src') || '';
      if (!src) continue;
      if (!/(^|\/)(env-config|public-assets)\.js(\?|$)/i.test(src)) continue;
      try {
        return new URL(src, location.href).href.replace(/[^/]+$/, '');
      } catch (error) {
        return src.replace(/[^/]+$/, '');
      }
    }
    return '';
  }

  function pageDirectory() {
    return location.href.replace(/[?#].*$/, '').replace(/[^/]+$/, '');
  }

  function assetBase() {
    var configured = trimSlash(env().PUBLIC_ASSET_URL || env().ASSETS_URL || '');
    if (configured) return configured;
    return trimSlash(scriptDirectory() || pageDirectory());
  }

  function publicAssetUrl(path) {
    if (!path) return path;
    if (/^(https?:|data:|blob:)/i.test(path)) return path;
    var base = assetBase();
    var suffix = path.charAt(0) === '/' ? path : '/' + path;
    if (!base) return suffix;
    try {
      return new URL(suffix.replace(/^\//, ''), base.endsWith('/') ? base : base + '/').href;
    } catch (error) {
      return base + suffix;
    }
  }

  window.publicAssetBase = assetBase;
  window.publicAssetUrl = publicAssetUrl;

  function applyPublicLinks() {
    document.querySelectorAll('link[data-public-href]').forEach(function (link) {
      link.href = publicAssetUrl(link.getAttribute('data-public-href'));
    });
    document.querySelectorAll('img[data-public-src]').forEach(function (img) {
      img.src = publicAssetUrl(img.getAttribute('data-public-src'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyPublicLinks);
  } else {
    applyPublicLinks();
  }
})();
