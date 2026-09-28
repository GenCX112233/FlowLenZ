(function () {
    "use strict";
  
    if (window.__FLOWLENZ_SAVE_HOOK_INSTALLED__) {
      return;
    }
  
    window.__FLOWLENZ_SAVE_HOOK_INSTALLED__ = true;
  
    function getSavedFlowId(url, method) {
      if (
        typeof method !== "string" ||
        method.toUpperCase() !== "POST"
      ) {
        return null;
      }
  
      try {
        const parsedUrl =
          new URL(url, window.location.origin);
  
        const match =
          parsedUrl.pathname.match(
            /\/api\/v2\/flows\/([0-9a-f-]{36})\/versions\/?$/i
          );
  
        return match
          ? match[1]
          : null;
  
      } catch (error) {
        return null;
      }
    }
  
  
    function notifySaveCompleted(flowId) {
      window.postMessage(
        {
          source: "FLOWLENZ_SAVE_HOOK",
          type: "ARCHITECT_SAVE_COMPLETED",
          flowId: flowId
        },
        "*"
      );
    }
  
  
    /*
     * Watch fetch()
     */
    if (typeof window.fetch === "function") {
  
      const originalFetch =
        window.fetch;
  
      window.fetch =
        function (input, init) {
  
          let requestUrl = "";
          let requestMethod = "GET";
  
          try {
  
            if (
              typeof input === "string"
            ) {
  
              requestUrl =
                input;
  
            } else if (
              input &&
              typeof input.url === "string"
            ) {
  
              requestUrl =
                input.url;
  
              if (input.method) {
                requestMethod =
                  input.method;
              }
            }
  
            if (
              init &&
              init.method
            ) {
  
              requestMethod =
                init.method;
            }
  
          } catch (error) {
            // Do not interfere with Genesys request.
          }
  
  
          const flowId =
            getSavedFlowId(
              requestUrl,
              requestMethod
            );
  
  
          return originalFetch
            .apply(this, arguments)
            .then(
              (response) => {
  
                if (
                  flowId &&
                  response &&
                  response.ok
                ) {
  
                  notifySaveCompleted(
                    flowId
                  );
                }
  
                return response;
              }
            );
        };
    }
  
  
    /*
     * Watch XMLHttpRequest
     */
    if (
      typeof XMLHttpRequest !==
      "undefined"
    ) {
  
      const originalOpen =
        XMLHttpRequest.prototype.open;
  
      const originalSend =
        XMLHttpRequest.prototype.send;
  
  
      XMLHttpRequest.prototype.open =
        function (
          method,
          url
        ) {
  
          this.__flowlenzMethod =
            method;
  
          this.__flowlenzUrl =
            url;
  
          return originalOpen
            .apply(
              this,
              arguments
            );
        };
  
  
      XMLHttpRequest.prototype.send =
        function () {
  
          const flowId =
            getSavedFlowId(
              this.__flowlenzUrl,
              this.__flowlenzMethod
            );
  
  
          if (flowId) {
  
            this.addEventListener(
              "loadend",
              function () {
  
                if (
                  this.status >= 200 &&
                  this.status < 300
                ) {
  
                  notifySaveCompleted(
                    flowId
                  );
                }
  
              },
              {
                once: true
              }
            );
          }
  
  
          return originalSend
            .apply(
              this,
              arguments
            );
        };
    }
  
  })();