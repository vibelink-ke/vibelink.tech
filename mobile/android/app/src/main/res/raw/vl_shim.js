// Run by the app on every page of a Vibelink site (MainActivity). Connects the page to the phone: downloads and notifications.
(function () {
  if (window.__vlShim || !window.VibelinkNative) return;
  window.__vlShim = true;
  var phone = window.VibelinkNative;

  // ── downloads ──
  // A file the page made itself (a blob or data link with a download name): read here and handed to the phone to save.
  function save(url, name) {
    fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result);
        phone.saveFile(name || 'download', blob.type || '', text.slice(text.indexOf(',') + 1));
      };
      reader.readAsDataURL(blob);
    }).catch(function () { /* the link was already released: nothing to save */ });
  }
  window.__vlSaveUrl = save;

  function made(a) {
    return a && a.hasAttribute && a.hasAttribute('download') && /^(blob:|data:)/.test(a.href || '');
  }
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (made(this)) { save(this.href, this.getAttribute('download')); return; }
    return click.apply(this, arguments);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (made(a)) { e.preventDefault(); save(a.href, a.getAttribute('download')); }
  }, true);

  // ── notifications ──
  // The phone's token goes to the server once someone is signed in (the server answers 401 until then), and again on every launch.
  var token = null, tries = 0, timer = null;
  function send() {
    clearTimeout(timer);
    if (!token) return;
    fetch('/api/push/native-token', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, platform: 'android' })
    }).then(function (r) {
      if (r.ok) { phone.askNotifications(); return; }
      if (r.status === 401 && tries++ < 120) timer = setTimeout(send, 30000);   // not signed in yet
    }).catch(function () { if (tries++ < 120) timer = setTimeout(send, 60000); });
  }
  window.__vlPush = function (t) { token = t; tries = 0; send(); };
  document.addEventListener('visibilitychange', function () { if (!document.hidden && token) { tries = 0; send(); } });
  try { if (phone.pushReady()) phone.pushToken(); } catch (e) { /* an older build of the app */ }
})();
