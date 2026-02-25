// Выполняется в контексте страницы (world: MAIN) — перехват fetch/XHR
window.RECORDING = false;
window.START_URL = null;

var origFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
  var args = arguments;
  if (!window.RECORDING) return origFetch.apply(this, args);

  var url = typeof input === 'string' ? input : (input && input.url);
  var method = ((init && init.method) || 'GET').toUpperCase();
  var request = { url: url, method: method };

  return origFetch.apply(this, args)
    .then(function (response) {
      var cloned = response.clone();
      cloned.text().then(function (body) {
        var headers = {};
        cloned.headers.forEach(function (v, k) { headers[k] = v; });
        window.postMessage({
          type: 'REQUEST_CAPTURED_PAGE',
          data: {
            request: request,
            response: { status: cloned.status, headers: headers, body: body },
            success: true,
          },
        }, '*');
      }).catch(function () {
        window.postMessage({
          type: 'REQUEST_CAPTURED_PAGE',
          data: { request: request, response: null, success: false },
        }, '*');
      });
      return response;
    })
    .catch(function (err) {
      window.postMessage({
        type: 'REQUEST_CAPTURED_PAGE',
        data: { request: request, response: null, success: false },
      }, '*');
      throw err;
    });
};

var XHROpen = XMLHttpRequest.prototype.open;
var XHRSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function (method, url) {
  this._captureData = { method: (method || 'GET').toUpperCase(), url: url };
  return XHROpen.apply(this, arguments);
};

XMLHttpRequest.prototype.send = function () {
  var xhr = this;
  var data = xhr._captureData;
  if (!data || !window.RECORDING) return XHRSend.apply(this, arguments);

  function report(success, response) {
    window.postMessage({
      type: 'REQUEST_CAPTURED_PAGE',
      data: {
        request: { url: data.url, method: data.method },
        response: response,
        success: success,
      },
    }, '*');
  }

  xhr.addEventListener('load', function () {
    var headers = {};
    (xhr.getAllResponseHeaders() || '').split(/\r?\n/).forEach(function (line) {
      var i = line.indexOf(': ');
      if (i > 0) headers[line.slice(0, i)] = line.slice(i + 2);
    });
    report(true, { status: xhr.status, headers: headers, body: xhr.responseText });
  });
  xhr.addEventListener('error', function () { report(false, null); });
  xhr.addEventListener('abort', function () { report(false, null); });

  return XHRSend.apply(this, arguments);
};

window.addEventListener('message', function (e) {
  if (e.source !== window || !e.data) return;
  if (e.data.type === 'START_RECORDING') {
    window.RECORDING = true;
    window.START_URL = e.data.startUrl || null;
  } else if (e.data.type === 'STOP_RECORDING') {
    window.RECORDING = false;
  }
});

var origPushState = history.pushState.bind(history);
history.pushState = function() {
  origPushState.apply(history, arguments);
  if (window.RECORDING) {
    var url = arguments[2];
    if (url) {
      var resolved = new URL(url, location.href).href;
      window.postMessage({ type: 'SPA_NAVIGATION', url: resolved }, '*');
    }
  }
};

var origReplaceState = history.replaceState.bind(history);
history.replaceState = function() {
  origReplaceState.apply(history, arguments);
  if (window.RECORDING) {
    var url = arguments[2];
    if (url) {
      var resolved = new URL(url, location.href).href;
      window.postMessage({ type: 'SPA_NAVIGATION', url: resolved }, '*');
    }
  }
};

window.addEventListener('popstate', function() {
  if (window.RECORDING) {
    window.postMessage({ type: 'SPA_NAVIGATION', url: location.href }, '*');
  }
});
