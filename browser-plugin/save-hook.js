(function () {
  "use strict";

  // Prevent double-installation if the script is injected more than once
  if (window.__FLOWLENZ_SAVE_HOOK_INSTALLED__) {
    return;
  }

  window.__FLOWLENZ_SAVE_HOOK_INSTALLED__ = true;

  // Returns the flow ID if the request is a POST to the Genesys flow versions endpoint, otherwise null
  function getSavedFlowId(url, method) {
    if (typeof method !== "string" || method.toUpperCase() !== "POST") {
      return null;
    }

    try {
      const parsedUrl = new URL(url, window.location.origin);
      const match = parsedUrl.pathname.match(/\/api\/v2\/flows\/([0-9a-f-]{36})\/versions\/?$/i);
      return match ? match[1] : null;
    } catch (error) {
      return null;
    }
  }

  // Broadcasts a save-completed event to the window so save-bridge.js can relay it to the extension
  function notifySaveCompleted(flowId) {
    window.postMessage(
      { source: "FLOWLENZ_SAVE_HOOK", type: "ARCHITECT_SAVE_COMPLETED", flowId: flowId },
      "*"
    );
  }

  /*
   * Watch fetch()
   */
  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;

    window.fetch = function (input, init) {
      let requestUrl = "";
      let requestMethod = "GET";

      try {
        // Resolve URL and method from either a string or a Request object
        if (typeof input === "string") {
          requestUrl = input;
        } else if (input && typeof input.url === "string") {
          requestUrl = input.url;
          if (input.method) {
            requestMethod = input.method;
          }
        }

        // init.method takes precedence over the Request object's method
        if (init && init.method) {
          requestMethod = init.method;
        }
      } catch (error) {
        // Do not interfere with Genesys request.
      }

      const flowId = getSavedFlowId(requestUrl, requestMethod);

      return originalFetch.apply(this, arguments).then((response) => {
        // Notify only on a successful save response
        if (flowId && response && response.ok) {
          notifySaveCompleted(flowId);
        }
        return response;
      });
    };
  }

  /*
   * Watch XMLHttpRequest
   */
  if (typeof XMLHttpRequest !== "undefined") {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    // Capture method and URL at open() time so they're available in send()
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__flowlenzMethod = method;
      this.__flowlenzUrl = url;
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      const flowId = getSavedFlowId(this.__flowlenzUrl, this.__flowlenzMethod);

      if (flowId) {
        // Listen for request completion and notify on a 2xx status
        this.addEventListener(
          "loadend",
          function () {
            if (this.status >= 200 && this.status < 300) {
              notifySaveCompleted(flowId);
            }
          },
          { once: true }
        );
      }

      return originalSend.apply(this, arguments);
    };
  }
})();
