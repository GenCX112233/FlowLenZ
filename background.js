const CLIENT_ID =
  "31e1986a-b2ff-4b79-a657-d182e223e976";

const LOGIN_URL =
  "https://login.mypurecloud.com";

const API_URL =
  "https://api.mypurecloud.com";

const SCOPE =
  "architect:readonly";


function base64UrlEncode(buffer) {
  const bytes =
    new Uint8Array(buffer);

  let binary = "";

  for (const byte of bytes) {
    binary +=
      String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}


function generateRandomString() {
  const bytes =
    new Uint8Array(64);

  crypto.getRandomValues(bytes);

  return base64UrlEncode(bytes);
}


async function createCodeChallenge(
  verifier
) {
  const data =
    new TextEncoder()
      .encode(verifier);

  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );

  return base64UrlEncode(digest);
}


async function authenticateGenesys() {
  const redirectUri =
    chrome.identity.getRedirectURL();

  const verifier =
    generateRandomString();

  const challenge =
    await createCodeChallenge(
      verifier
    );

  const state =
    generateRandomString();

  const authUrl =
    `${LOGIN_URL}/oauth/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SCOPE)}` +
    `&code_challenge=${encodeURIComponent(challenge)}` +
    `&code_challenge_method=S256` +
    `&state=${encodeURIComponent(state)}`;

  const redirectResponse =
    await chrome.identity
      .launchWebAuthFlow({
        url: authUrl,
        interactive: true
      });

  if (!redirectResponse) {
    throw new Error(
      "Genesys login did not complete."
    );
  }

  const callbackUrl =
    new URL(redirectResponse);

  const returnedState =
    callbackUrl.searchParams.get(
      "state"
    );

  const code =
    callbackUrl.searchParams.get(
      "code"
    );

  const oauthError =
    callbackUrl.searchParams.get(
      "error"
    );

  if (oauthError) {
    throw new Error(
      `Genesys OAuth error: ${oauthError}`
    );
  }

  if (returnedState !== state) {
    throw new Error(
      "OAuth state validation failed."
    );
  }

  if (!code) {
    throw new Error(
      "Authorization code not received."
    );
  }

  const tokenBody =
    new URLSearchParams({
      grant_type:
        "authorization_code",

      client_id:
        CLIENT_ID,

      code:
        code,

      redirect_uri:
        redirectUri,

      code_verifier:
        verifier
    });

  const tokenResponse =
    await fetch(
      `${LOGIN_URL}/oauth/token`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          tokenBody.toString()
      }
    );

  if (!tokenResponse.ok) {
    const errorText =
      await tokenResponse.text();

    throw new Error(
      `Token request failed: ${tokenResponse.status} ${errorText}`
    );
  }

  const tokenData =
    await tokenResponse.json();

  const expiresAt =
    Date.now() +
    (
      (tokenData.expires_in || 3600) *
      1000
    );

  await chrome.storage.local.set({
    genesysAccessToken:
      tokenData.access_token,

    genesysExpiresAt:
      expiresAt
  });

  return tokenData.access_token;
}


async function getAccessToken() {
  const stored =
    await chrome.storage.local.get([
      "genesysAccessToken",
      "genesysExpiresAt"
    ]);

  if (
    stored.genesysAccessToken &&
    stored.genesysExpiresAt &&
    stored.genesysExpiresAt >
      Date.now() + 60000
  ) {
    return stored.genesysAccessToken;
  }

  return authenticateGenesys();
}


async function genesysGet(path) {
  const accessToken =
    await getAccessToken();

  const url =
    path.startsWith("http")
      ? path
      : `${API_URL}${path}`;

  const response =
    await fetch(
      url,
      {
        method: "GET",

        cache: "no-store",

        headers: {
          "Authorization":
            `Bearer ${accessToken}`,

          "Accept":
            "application/json"
        }
      }
    );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Genesys API failed: ${response.status} ${text}`
    );
  }

  return response.json();
}


async function getFlowDetails(
  flowId
) {
  return genesysGet(
    `/api/v2/flows/${flowId}`
  );
}


async function getFlowVersions(
  flowId
) {
  return genesysGet(
    `/api/v2/flows/${flowId}/versions`
  );
}


async function getFlowConfiguration(
  configurationUri
) {
  return genesysGet(
    configurationUri
  );
}


chrome.action.onClicked.addListener(
  async (tab) => {

    if (!tab.id) {
      return;
    }

    try {
      await chrome.tabs.sendMessage(
        tab.id,
        {
          type:
            "TOGGLE_FLOWLENZ"
        },
        {
          frameId: 0
        }
      );

    } catch (error) {
      console.error(
        "FlowLenZ toggle failed:",
        error
      );
    }
  }
);


chrome.runtime.onMessage.addListener(
  (
    message,
    sender,
    sendResponse
  ) => {

    if (
      message.type ===
      "FLOWLENZ_ARCHITECT_SAVE_COMPLETED"
    ) {

      const tabId =
        sender.tab?.id;

      if (tabId) {
        chrome.tabs
          .sendMessage(
            tabId,
            {
              type:
                "ARCHITECT_SAVE_COMPLETED",

              flowId:
                message.flowId
            },
            {
              frameId: 0
            }
          )
          .catch(
            (error) => {
              console.log(
                "FlowLenZ UI not available:",
                error
              );
            }
          );
      }

      return;
    }


    if (
      message.type ===
      "GET_FLOW_DETAILS"
    ) {

      getFlowDetails(
        message.flowId
      )
        .then(
          (flow) => {
            sendResponse({
              success: true,
              flow: flow
            });
          }
        )
        .catch(
          (error) => {
            sendResponse({
              success: false,
              error: error.message
            });
          }
        );

      return true;
    }


    if (
      message.type ===
      "GET_FLOW_VERSIONS"
    ) {

      getFlowVersions(
        message.flowId
      )
        .then(
          (versions) => {
            sendResponse({
              success: true,
              versions: versions
            });
          }
        )
        .catch(
          (error) => {
            sendResponse({
              success: false,
              error: error.message
            });
          }
        );

      return true;
    }


    if (
      message.type ===
      "GET_FLOW_CONFIGURATION"
    ) {

      getFlowConfiguration(
        message.configurationUri
      )
        .then(
          (configuration) => {
            sendResponse({
              success: true,
              configuration:
                configuration
            });
          }
        )
        .catch(
          (error) => {
            sendResponse({
              success: false,
              error: error.message
            });
          }
        );

      return true;
    }


    const reportPages = {
      FLOWLENZ_OPEN_VISUAL_REPORT: {
        url: "Visual-Diff/report.html",
        storageKey: "flowlenzVisualReport"
      },
      FLOWLENZ_OPEN_RELEASE_NOTES: {
        url: "Release-Notes/release-notes.html",
        storageKey: "flowlenzReleaseNotes"
      }
    };


    const reportPage =
      reportPages[message.type];


    if (
      reportPage
    ) {

      const reportUrl =
        chrome.runtime.getURL(
          reportPage.url
        );


      chrome.storage.session
        .set({
          [reportPage.storageKey]:
            message.payload
        })
        .then(
          () =>
            chrome.tabs.create(
              {
                url:
                  reportUrl,

                active:
                  true
              }
            )
        )
        .then(
          () => {
            sendResponse({
              success: true
            });
          }
        )
        .catch(
          (error) => {
            sendResponse({
              success: false,
              error: error.message
            });
          }
        );

      return true;
    }

  }
);