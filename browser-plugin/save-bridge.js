(function () {
  "use strict";

  // Listen for messages posted to the window (from save-hook.js running in page context)
  window.addEventListener("message", (event) => {
    // Ignore messages from other frames/windows
    if (event.source !== window) {
      return;
    }

    const message = event.data;

    // Only handle save completion events from the FlowLenZ save hook
    if (!message || message.source !== "FLOWLENZ_SAVE_HOOK" || message.type !== "ARCHITECT_SAVE_COMPLETED") {
      return;
    }

    // Forward the save event to the extension background/service worker via chrome.runtime
    chrome.runtime
      .sendMessage({ type: "FLOWLENZ_ARCHITECT_SAVE_COMPLETED", flowId: message.flowId })
      .catch((error) => {
        console.error("FlowLenZ save bridge error:", error);
      });
  });
})();
