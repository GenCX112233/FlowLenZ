(function () {
    "use strict";
  
    window.addEventListener(
      "message",
      (event) => {
  
        if (
          event.source !== window
        ) {
          return;
        }
  
        const message =
          event.data;
  
        if (
          !message ||
          message.source !==
            "FLOWLENZ_SAVE_HOOK" ||
          message.type !==
            "ARCHITECT_SAVE_COMPLETED"
        ) {
          return;
        }
  
        chrome.runtime
          .sendMessage({
            type:
              "FLOWLENZ_ARCHITECT_SAVE_COMPLETED",
  
            flowId:
              message.flowId
          })
          .catch(
            (error) => {
  
              console.error(
                "FlowLenZ save bridge error:",
                error
              );
            }
          );
      }
    );
  
  })();