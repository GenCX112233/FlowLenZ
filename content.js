(function () {
  "use strict";

  if (document.getElementById("flowlenz-root")) {
    return;
  }

  const SAVE_RETRY_DELAYS = [
    0,
    250,
    500,
    750,
    1000,
    1500
  ];

  const root = document.createElement("div");
  root.id = "flowlenz-root";

  const logoUrl = chrome.runtime.getURL(
    "genesys-logo-flowlenz.png"
  );

  let publishedConfiguration = null;
  let savedConfiguration = null;

  let refreshInProgress = false;
  let refreshQueued = false;


  /*
   * =====================================
   * UI
   * =====================================
   */

  root.innerHTML = `
    <div class="flowlenz-panel flowlenz-hidden">

      <div class="flowlenz-header">

        <img
          class="flowlenz-logo"
          src="${logoUrl}"
          alt="Genesys"
        />

        <div class="flowlenz-title-area">

          <div class="flowlenz-title">
            FlowLenZ
          </div>

          <div class="flowlenz-subtitle">
            AI Assistant
          </div>

        </div>

      </div>


      <div class="flowlenz-content">

        <div class="flowlenz-welcome">

          <h2>
            How can I help?
          </h2>

          <p>
            Understand the flow. See the change. Know the impact
          </p>

        </div>


        <div class="flowlenz-section">

          <div class="flowlenz-section-title">
            Current Flow
          </div>

          <div
            id="flowlenz-flow-name"
            class="flowlenz-section-status"
          >
            Detecting...
          </div>

        </div>


        <div class="flowlenz-section">

          <div class="flowlenz-section-title">
            Change Report
          </div>

          <div
            id="flowlenz-published-version"
            class="flowlenz-section-status"
          >
            Published Version: Detecting...
          </div>

          <div
            id="flowlenz-saved-version"
            class="flowlenz-section-status"
            style="margin-top: 6px;"
          >
            Saved Version: Detecting...
          </div>

          <div
            id="flowlenz-config-status"
            class="flowlenz-section-status"
            style="
              margin-top: 10px;
              font-size: 12px;
            "
          >
            Configurations: Waiting...
          </div>

          <div
            id="flowlenz-refresh-status"
            class="flowlenz-section-status"
            style="
              margin-top: 5px;
              font-size: 12px;
            "
          >
            Refresh: On Open / Architect Save
          </div>

        </div>


        <div class="flowlenz-section">

          <div class="flowlenz-section-title">
            Visual Change Report
          </div>

          <div
            id="flowlenz-visual-report-status"
            class="flowlenz-section-status"
            style="font-size: 12px;"
          >
            Save the flow to enable the report.
          </div>

          <button
            id="flowlenz-visual-report-open"
            type="button"
            class="flowlenz-report-link"
            disabled
          >
            Open Visual Change Report
          </button>

        </div>


        <div class="flowlenz-section">

          <div class="flowlenz-section-title">
            Change Impact Analysis
          </div>

          <div
            id="flowlenz-analysis-summary"
            class="flowlenz-section-status"
          >
            Waiting for comparison...
          </div>

          <div
            id="flowlenz-analysis-details"
            class="flowlenz-section-status"
            style="
              margin-top: 10px;
              font-size: 13px;
              line-height: 1.7;
              overflow-wrap: anywhere;
            "
          ></div>

        </div>


        <div class="flowlenz-section">

          <div class="flowlenz-section-title">
            Lint &amp; Risk
          </div>

          <div
            id="flowlenz-risk-summary"
            class="flowlenz-section-status"
          >
            Waiting for analysis
          </div>

          <div
            id="flowlenz-risk-details"
            class="flowlenz-section-status"
            style="
              margin-top: 10px;
              font-size: 13px;
              line-height: 1.7;
              overflow-wrap: anywhere;
            "
          ></div>

        </div>


        <div class="flowlenz-section">

          <div class="flowlenz-section-title">
            Release Notes
          </div>

          <select
            id="flowlenz-release-version"
            class="flowlenz-release-select"
            disabled
          ></select>

          <div
            id="flowlenz-release-status"
            class="flowlenz-section-status"
            style="font-size: 12px;"
          >
            Waiting for published versions...
          </div>

          <button
            id="flowlenz-release-open"
            type="button"
            class="flowlenz-report-link"
            disabled
          >
            Open Release Notes
          </button>

        </div>

      </div>


      <div class="flowlenz-chat">

        <input
          id="flowlenz-chat-input"
          type="text"
          placeholder="Ask about your Architect flow..."
        />

        <button id="flowlenz-send-button">
          Send
        </button>

      </div>

    </div>
  `;


  document.body.appendChild(root);


  const panel =
    root.querySelector(".flowlenz-panel");

  const flowNameElement =
    root.querySelector("#flowlenz-flow-name");

  const publishedVersionElement =
    root.querySelector("#flowlenz-published-version");

  const savedVersionElement =
    root.querySelector("#flowlenz-saved-version");

  const configStatusElement =
    root.querySelector("#flowlenz-config-status");

  const refreshStatusElement =
    root.querySelector("#flowlenz-refresh-status");

  const analysisSummaryElement =
    root.querySelector("#flowlenz-analysis-summary");

  const analysisDetailsElement =
    root.querySelector("#flowlenz-analysis-details");

  const riskSummaryElement =
    root.querySelector("#flowlenz-risk-summary");

  const riskDetailsElement =
    root.querySelector("#flowlenz-risk-details");

  const visualReportStatusElement =
    root.querySelector("#flowlenz-visual-report-status");

  const visualReportOpenButton =
    root.querySelector("#flowlenz-visual-report-open");

  const releaseVersionSelect =
    root.querySelector("#flowlenz-release-version");

  const releaseStatusElement =
    root.querySelector("#flowlenz-release-status");

  const releaseOpenButton =
    root.querySelector("#flowlenz-release-open");

  let lastComparison = null;

  let lastReportMeta = {
    flowName: "",
    publishedVersion: "",
    savedVersion: ""
  };


  /*
   * =====================================
   * GENERAL HELPERS
   * =====================================
   */

  function sleep(ms) {

    return new Promise(
      (resolve) =>
        setTimeout(resolve, ms)
    );
  }


  function detectFlowId() {

    const uuidPattern =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

    const match =
      window.location.href.match(
        uuidPattern
      );

    return match
      ? match[0]
      : null;
  }


  function escapeHtml(value) {

    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }


  function formatCompactValue(value) {

    if (
      value === undefined ||
      value === null ||
      String(value).trim() === ""
    ) {

      return "Empty";
    }


    let text =
      String(value)
        .replace(/\s+/g, " ")
        .trim();


    if (
      text.length > 55
    ) {

      text =
        `${text.substring(0, 52)}...`;
    }


    return text;
  }


  function cleanVariableName(name) {

    if (
      !name
    ) {

      return "Variable";
    }


    return String(name)
      .replace(/^Task\./i, "")
      .replace(/^Flow\./i, "");
  }


  /*
   * =====================================
   * VERSION HANDLING
   * =====================================
   */

  function getVersionIdentifier(version) {

    if (
      !version
    ) {

      return "";
    }


    const candidates = [
      version.id,
      version.version,
      version.versionId,
      version.name
    ];


    for (
      const candidate
      of candidates
    ) {

      if (
        typeof candidate === "string" &&
        candidate.length > 0
      ) {

        return candidate;
      }


      if (
        typeof candidate === "number"
      ) {

        return String(candidate);
      }
    }


    if (
      typeof version.configurationUri ===
      "string"
    ) {

      const match =
        version.configurationUri.match(
          /\/versions\/([^/]+)\/configuration/i
        );


      if (
        match
      ) {

        return match[1];
      }
    }


    return "";
  }


  function calculateNextVersion(
    publishedVersion
  ) {

    if (
      !publishedVersion
    ) {

      return null;
    }


    const majorVersion =
      parseInt(
        publishedVersion.split(".")[0],
        10
      );


    if (
      Number.isNaN(
        majorVersion
      )
    ) {

      return null;
    }


    return `${majorVersion + 1}.0`;
  }


  function analyseVersions(data) {

    let versions =
      [];


    if (
      Array.isArray(data)
    ) {

      versions =
        data;

    } else if (
      data &&
      Array.isArray(
        data.entities
      )
    ) {

      versions =
        data.entities;
    }


    let savedVersionItem =
      null;


    let savedVersionId =
      null;


    const publishedVersions =
      [];


    for (
      const version
      of versions
    ) {

      const identifier =
        getVersionIdentifier(
          version
        );


      const configurationUri =
        version.configurationUri ||
        "";


      const combined =
        `${identifier} ${configurationUri}`;


      if (
        combined.includes(
          "saved_version_"
        )
      ) {

        savedVersionItem =
          version;


        savedVersionId =
          identifier;


        continue;
      }


      if (
        identifier.match(
          /^\d+(?:\.\d+)?$/
        )
      ) {

        publishedVersions.push({
          identifier,
          version
        });
      }
    }


    publishedVersions.sort(
      (a, b) => {

        const aParts =
          a.identifier
            .split(".")
            .map(Number);


        const bParts =
          b.identifier
            .split(".")
            .map(Number);


        const majorDifference =
          (bParts[0] || 0) -
          (aParts[0] || 0);


        if (
          majorDifference !== 0
        ) {

          return majorDifference;
        }


        return (
          (bParts[1] || 0) -
          (aParts[1] || 0)
        );
      }
    );


    const latestPublished =
      publishedVersions.length > 0
        ? publishedVersions[0]
        : null;


    return {

      publishedVersion:
        latestPublished
          ? latestPublished.identifier
          : null,

      publishedVersionItem:
        latestPublished
          ? latestPublished.version
          : null,

      publishedVersions:
        publishedVersions,

      savedVersionId:
        savedVersionId,

      savedVersionItem:
        savedVersionItem
    };
  }


  async function loadConfiguration(
    configurationUri
  ) {

    const response =
      await chrome.runtime.sendMessage({

        type:
          "GET_FLOW_CONFIGURATION",

        configurationUri:
          configurationUri
      });


    if (
      !response ||
      !response.success
    ) {

      throw new Error(
        response?.error ||
        "Unable to load configuration"
      );
    }


    return response.configuration;
  }


  async function fetchCurrentContext() {

    const flowId =
      detectFlowId();


    if (
      !flowId
    ) {

      throw new Error(
        "Could not detect flow ID from Architect URL."
      );
    }


    const detailsResponse =
      await chrome.runtime.sendMessage({

        type:
          "GET_FLOW_DETAILS",

        flowId:
          flowId
      });


    if (
      !detailsResponse ||
      !detailsResponse.success
    ) {

      throw new Error(
        detailsResponse?.error ||
        "Unable to load flow details."
      );
    }


    const versionsResponse =
      await chrome.runtime.sendMessage({

        type:
          "GET_FLOW_VERSIONS",

        flowId:
          flowId
      });


    if (
      !versionsResponse ||
      !versionsResponse.success
    ) {

      throw new Error(
        versionsResponse?.error ||
        "Unable to load flow versions."
      );
    }


    const analysed =
      analyseVersions(
        versionsResponse.versions
      );


    let publishedConfiguration =
      null;


    const publishedUri =
      analysed
        .publishedVersionItem
        ?.configurationUri;


    if (
      publishedUri
    ) {

      publishedConfiguration =
        await loadConfiguration(
          publishedUri
        );
    }


    const hasSavedVersion =
      Boolean(
        analysed.savedVersionItem
      );


    let savedConfiguration =
      null;


    if (
      hasSavedVersion
    ) {

      const savedUri =
        analysed
          .savedVersionItem
          .configurationUri;


      if (
        savedUri
      ) {

        savedConfiguration =
          await loadConfiguration(
            savedUri
          );
      }
    }


    return {

      flow:
        detailsResponse.flow,

      flowId:
        flowId,

      versions: {

        publishedVersion:
          analysed.publishedVersion,

        publishedVersions:
          analysed.publishedVersions,

        savedVersionId:
          analysed.savedVersionId
      },

      hasSavedVersion:
        hasSavedVersion,

      publishedConfiguration:
        publishedConfiguration,

      savedConfiguration:
        savedConfiguration
    };
  }


  /*
   * =====================================
   * NORMALIZATION
   * =====================================
   */

  function normalizeForComparison(
    value,
    options = {}
  ) {

    if (
      value === null ||
      value === undefined
    ) {

      return value;
    }


    if (
      Array.isArray(value)
    ) {

      return value.map(
        (item) =>
          normalizeForComparison(
            item,
            options
          )
      );
    }


    if (
      typeof value !== "object"
    ) {

      return value;
    }


    const ignoredFields =
      new Set([
        "id",
        "dateCreated",
        "dateModified",
        "createdBy",
        "modifiedBy",

        "nextAction"
      ]);


    const normalized =
      {};


    const keys =
      Object.keys(value)
        .sort();


    for (
      const key
      of keys
    ) {

      if (
        ignoredFields.has(
          key
        )
      ) {

        continue;
      }


      if (
        key === "uiMetaData"
      ) {

        continue;
      }


      normalized[key] =
        normalizeForComparison(
          value[key],
          options
        );
    }


    return normalized;
  }


  function createFingerprint(
    value,
    options = {}
  ) {

    return JSON.stringify(
      normalizeForComparison(
        value,
        options
      )
    );
  }


  function objectsEqual(
    first,
    second
  ) {

    return (
      createFingerprint(
        first
      ) ===
      createFingerprint(
        second
      )
    );
  }


  /*
   * =====================================
   * ARCHITECT OBJECT DETECTION
   * =====================================
   */

  function isArchitectAction(
    object
  ) {

    if (
      !object ||
      typeof object !== "object" ||
      Array.isArray(object)
    ) {

      return false;
    }


    const type =
      object.__type;


    if (
      typeof type !== "string"
    ) {

      return false;
    }


    return (
      type === "Action" ||
      type.endsWith("Action")
    );
  }


  function isArchitectTask(
    object
  ) {

    return (
      object &&
      typeof object === "object" &&
      !Array.isArray(object) &&
      object.__type === "Task"
    );
  }


  function getActionName(
    action
  ) {

    if (
      action?.name &&
      typeof action.name === "string"
    ) {

      return action.name;
    }


    if (
      action?.label &&
      typeof action.label === "string"
    ) {

      return action.label;
    }


    if (
      action?.__type
    ) {

      return action.__type;
    }


    return "Unnamed Action";
  }


  function getTaskName(
    task
  ) {

    if (
      task?.name &&
      typeof task.name === "string"
    ) {

      return task.name;
    }


    return "Unnamed Task";
  }


  function getFriendlyActionType(
    action
  ) {

    const type =
      action?.__type ||
      "";


    const typeNames = {

      UpdateVariableAction:
        "Update Data",

      PlayAudioAction:
        "Play Audio",

      SetAttributesAction:
        "Set Participant Data",

      TransferPureMatchAction:
        "Transfer to ACD",

      DecisionAction:
        "Decision",

      SwitchAction:
        "Switch",

      LoopAction:
        "Loop",

      DataAction:
        "Call Data Action",

      CallDataAction:
        "Call Data Action",

      SetLocaleAction:
        "Set Language",

      DialExtensionAction:
        "Dial By Extension"
    };


    return (
      typeNames[type] ||
      ""
    );
  }


  function getTrackingId(
    item
  ) {

    const trackingId =
      item?.trackingId;


    if (
      trackingId ===
        undefined ||
      trackingId === null ||
      String(
        trackingId
      ).trim() === ""
    ) {

      return "";
    }


    return String(
      trackingId
    );
  }


  function getDisplayActionName(
    item
  ) {

    const object =
      item.object ||
      item.action;


    if (
      item.kind === "task"
    ) {

      const taskName =
        item.name ||
        getTaskName(
          object
        );


      const trackingId =
        getTrackingId(
          object
        );


      return trackingId
        ? `${trackingId} ${taskName}`
        : taskName;
    }


    const name =
      item.name ||
      getActionName(
        object
      );


    const friendlyType =
      getFriendlyActionType(
        object
      );


    let displayName =
      String(name)
        .trim();


    if (
      friendlyType
    ) {

      const lowerName =
        displayName.toLowerCase();


      const lowerType =
        friendlyType.toLowerCase();


      if (
        !(
          lowerName ===
            lowerType ||
          lowerName.startsWith(
            `${lowerType} `
          ) ||
          lowerName.startsWith(
            `${lowerType}-`
          )
        )
      ) {

        displayName =
          `${friendlyType} - ${displayName}`;
      }
    }


    const trackingId =
      getTrackingId(
        object
      );


    return trackingId
      ? `${trackingId} ${displayName}`
      : displayName;
  }


  /*
   * =====================================
   * ACTION / TASK EXTRACTION
   * =====================================
   */

  function extractActions(
    configuration
  ) {

    const items =
      [];


    const taskList =
      Array.isArray(
        configuration?.flowSequenceItemList
      )
        ? configuration.flowSequenceItemList
        : [];


    const initialSequence =
      configuration?.initialSequence ||
      "";


    for (
      const task
      of taskList
    ) {

      if (
        !isArchitectTask(
          task
        )
      ) {

        continue;
      }


      if (
        String(task.id) ===
        String(initialSequence)
      ) {

        continue;
      }


      items.push({

        kind:
          "task",

        object:
          task,

        task:
          task,

        name:
          getTaskName(
            task
          ),

        type:
          "ReusableTask",

        path:
          "flowSequenceItemList"
      });
    }


    function walk(
      value,
      path
    ) {

      if (
        value === null ||
        value === undefined
      ) {

        return;
      }


      if (
        Array.isArray(value)
      ) {

        value.forEach(
          (
            item,
            index
          ) => {

            walk(
              item,
              `${path}[${index}]`
            );
          }
        );


        return;
      }


      if (
        typeof value !==
        "object"
      ) {

        return;
      }


      if (
        isArchitectAction(
          value
        )
      ) {

        items.push({

          kind:
            "action",

          object:
            value,

          action:
            value,

          name:
            getActionName(
              value
            ),

          type:
            value.__type ||
            "UnknownAction",

          path:
            path
        });
      }


      for (
        const [
          key,
          child
        ]
        of Object.entries(value)
      ) {

        walk(
          child,
          path
            ? `${path}.${key}`
            : key
        );
      }
    }


    walk(
      configuration,
      "flow"
    );


  const unique =
    [];


  const seenTasks =
    new Set();


  for (
    const item
    of items
  ) {

    if (
      item.kind !==
      "task"
    ) {

      unique.push(
        item
      );

      continue;
    }


    const taskId =
      item.object?.id;


    const key =
      taskId
        ? `TASK:${taskId}`
        : `TASKNAME:${item.name}`;


    if (
      seenTasks.has(
        key
      )
    ) {

      continue;
    }


    seenTasks.add(
      key
    );


    unique.push(
      item
    );
  }


  return unique;
}


function getActionKey(
  item
) {

  const object =
    item.object ||
    item.action;


  if (
    item.kind ===
    "task"
  ) {

    if (
      object?.id
    ) {

      return (
        `TASK-ID:${object.id}`
      );
    }


    return (
      `TASK-NAME:${item.name}`
    );
  }


  const candidates = [
    object?.id,
    object?.actionId,
    object?.key
  ];


  for (
    const candidate
    of candidates
  ) {

    if (
      typeof candidate ===
        "string" &&
      candidate.length > 0
    ) {

      return (
        `ID:${candidate}`
      );
    }
  }


  return (
    `TYPE:${item.type}` +
    `|NAME:${item.name}`
  );
}


function buildActionMap(
  items
) {

  const map =
    new Map();


  for (
    const item
    of items
  ) {

    const baseKey =
      getActionKey(
        item
      );


    let key =
      baseKey;


    let occurrence =
      1;


    while (
      map.has(key)
    ) {

      occurrence++;


      key =
        `${baseKey}|${occurrence}`;
    }


    map.set(
      key,
      item
    );
  }


  return map;
}


/*
 * =====================================
 * MEANINGFUL ACTION COMPARISON
 * =====================================
 */

function getMeaningfulObject(
  item
) {

  const object =
    item?.object ||
    item?.action ||
    {};


  const normalized =
    normalizeForComparison(
      object
    );


  if (
    normalized &&
    typeof normalized === "object"
  ) {

    delete normalized.id;

    delete normalized.trackingId;
  }


  return normalized;
}


function getMeaningfulFingerprint(
  item
) {

  return JSON.stringify(
    getMeaningfulObject(
      item
    )
  );
}


function meaningfulObjectsEqual(
  firstItem,
  secondItem
) {

  return (
    getMeaningfulFingerprint(
      firstItem
    ) ===
    getMeaningfulFingerprint(
      secondItem
    )
  );
}


/*
 * =====================================
 * CHANGE DETAILS
 * =====================================
 */

function getQueueNames(
  action
) {

  if (
    !action ||
    !Array.isArray(
      action.queues
    )
  ) {

    return [];
  }


  return action.queues
    .map(
      (queue) => {

        if (
          typeof queue?.text ===
            "string" &&
          queue.text.trim()
        ) {

          return queue.text.trim();
        }


        const configText =
          queue
            ?.config
            ?.lit
            ?.text;


        if (
          typeof configText ===
            "string" &&
          configText.trim()
        ) {

          return configText.trim();
        }


        return "";
      }
    )
    .filter(Boolean)
    .sort();
}


function getVariableName(
  entry
) {

  const directName =
    entry
      ?.variable
      ?.text;


  if (
    typeof directName ===
      "string" &&
    directName.trim()
  ) {

    return directName.trim();
  }


  const refName =
    entry
      ?.variable
      ?.config
      ?.ref
      ?.text;


  if (
    typeof refName ===
      "string" &&
    refName.trim()
  ) {

    return refName.trim();
  }


  return "";
}


function getExpressionText(
  entry
) {

  const expression =
    entry?.expression;


  if (
    !expression
  ) {

    return "";
  }


  if (
    typeof expression.text ===
      "string"
  ) {

    return expression.text.trim();
  }


  const literalText =
    expression
      ?.config
      ?.lit
      ?.text;


  if (
    literalText !==
      undefined &&
    literalText !== null
  ) {

    return String(
      literalText
    ).trim();
  }


  const refText =
    expression
      ?.config
      ?.ref
      ?.text;


  if (
    typeof refText ===
      "string"
  ) {

    return refText.trim();
  }


  return "";
}


function getConfiguredReferenceText(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return "";
  }


  if (
    typeof value === "string"
  ) {

    const trimmed =
      value.trim();


    return trimmed
      ? trimmed
      : "";
  }


  if (
    typeof value !== "object"
  ) {

    return "";
  }


  if (
    typeof value.text ===
      "string" &&
    value.text.trim()
  ) {

    return value.text.trim();
  }


  const refText =
    value
      ?.config
      ?.ref
      ?.text;


  if (
    typeof refText ===
      "string" &&
    refText.trim()
  ) {

    return refText.trim();
  }


  const litText =
    value
      ?.config
      ?.lit
      ?.text;


  if (
    litText !== undefined &&
    litText !== null
  ) {

    const literal =
      String(litText).trim();


    if (
      literal
    ) {

      return literal;
    }
  }


  if (
    typeof value.name ===
      "string" &&
    value.name.trim()
  ) {

    return value.name.trim();
  }


  return "";
}


function getUpdateDataMap(
  action
) {

  const map =
    new Map();


  if (
    !action ||
    !Array.isArray(
      action.variables
    )
  ) {

    return map;
  }


  for (
    const entry
    of action.variables
  ) {

    const variableName =
      getVariableName(
        entry
      );


    if (
      !variableName
    ) {

      continue;
    }


    map.set(
      variableName,
      {

        expression:
          getExpressionText(
            entry
          ),

        fingerprint:
          createFingerprint(
            entry.expression
          )
      }
    );
  }


  return map;
}


function getUpdateDataChanges(
  beforeAction,
  afterAction
) {

  const beforeMap =
    getUpdateDataMap(
      beforeAction
    );


  const afterMap =
    getUpdateDataMap(
      afterAction
    );


  const variableNames =
    new Set([
      ...beforeMap.keys(),
      ...afterMap.keys()
    ]);


  const changes =
    [];


  for (
    const variableName
    of variableNames
  ) {

    const before =
      beforeMap.get(
        variableName
      );


    const after =
      afterMap.get(
        variableName
      );


    if (
      !before &&
      after
    ) {

      const expression =
        formatCompactValue(
          after.expression
        );


      changes.push(
        expression === "Empty"
          ? `${cleanVariableName(variableName)} added`
          : `${cleanVariableName(variableName)} added: ${expression}`
      );


      continue;
    }


    if (
      before &&
      !after
    ) {

      changes.push(
        `${cleanVariableName(variableName)} removed`
      );


      continue;
    }


    if (
      before &&
      after &&
      before.fingerprint !==
      after.fingerprint
    ) {

      changes.push(
        `${cleanVariableName(variableName)}: ` +
        `${formatCompactValue(before.expression)}` +
        ` → ` +
        `${formatCompactValue(after.expression)}`
      );
    }
  }


  if (
    changes.length > 2
  ) {

    const remaining =
      changes.length - 2;


    return [
      changes[0],
      changes[1],
      `+${remaining} more data change${remaining > 1 ? "s" : ""}`
    ];
  }


  return changes;
}


function getConciseChanges(
  beforeItem,
  afterItem
) {

  if (
    afterItem.kind ===
    "task"
  ) {

    return [
      "Reusable task configuration changed"
    ];
  }


  const beforeAction =
    beforeItem.object ||
    beforeItem.action;


  const afterAction =
    afterItem.object ||
    afterItem.action;


  const beforeName =
    beforeAction?.name ||
    "";


  const afterName =
    afterAction?.name ||
    "";


  if (
    beforeName !==
    afterName
  ) {

    return [
      `Name: ${beforeName || "None"} → ${afterName || "None"}`
    ];
  }


  if (
    afterAction.__type ===
    "UpdateVariableAction"
  ) {

    const dataChanges =
      getUpdateDataChanges(
        beforeAction,
        afterAction
      );


    if (
      dataChanges.length > 0
    ) {

      return dataChanges;
    }


    return [
      "Update Data configuration changed"
    ];
  }


  if (
    afterAction.__type ===
    "TransferPureMatchAction"
  ) {

    const beforeQueues =
      getQueueNames(
        beforeAction
      );


    const afterQueues =
      getQueueNames(
        afterAction
      );


    if (
      JSON.stringify(
        beforeQueues
      ) !==
      JSON.stringify(
        afterQueues
      )
    ) {

      const beforeQueue =
        beforeQueues.length > 0
          ? beforeQueues.join(", ")
          : "None";


      const afterQueue =
        afterQueues.length > 0
          ? afterQueues.join(", ")
          : "None";


      return [
        `Queue: ${beforeQueue} → ${afterQueue}`
      ];
    }


    return [
      "Routing configuration changed"
    ];
  }


  if (
    afterAction.__type ===
    "PlayAudioAction"
  ) {

    return [
      "Prompt / Audio changed"
    ];
  }


  if (
    afterAction.__type ===
    "SetAttributesAction"
  ) {

    return [
      "Participant data changed"
    ];
  }


  if (
    afterAction.__type ===
    "DecisionAction"
  ) {

    return [
      "Decision logic changed"
    ];
  }


  if (
    afterAction.__type ===
    "SwitchAction"
  ) {

    return [
      "Switch logic changed"
    ];
  }


  if (
    afterAction.__type ===
    "LoopAction"
  ) {

    return [
      "Loop configuration changed"
    ];
  }


  if (
    afterAction.__type ===
      "DataAction" ||
    afterAction.__type ===
      "CallDataAction"
  ) {

    return [
      "Data Action configuration changed"
    ];
  }


  if (
    afterAction.__type ===
    "SetLocaleAction"
  ) {

    return [
      "Language changed"
    ];
  }


  if (
    afterAction.__type ===
    "DialExtensionAction"
  ) {

    return [
      "Extension routing changed"
    ];
  }


  return [
    "Configuration changed"
  ];
}


/*
 * =====================================
 * COMPARE PUBLISHED VS SAVED
 * =====================================
 */

function compareActions(
  publishedConfig,
  savedConfig
) {

  const publishedItems =
    extractActions(
      publishedConfig
    );


  const savedItems =
    extractActions(
      savedConfig
    );


  const publishedMap =
    buildActionMap(
      publishedItems
    );


  const savedMap =
    buildActionMap(
      savedItems
    );


  const added =
    [];


  const removed =
    [];


  const modified =
    [];


  for (
    const [
      key,
      savedItem
    ]
    of savedMap
  ) {

    if (
      !publishedMap.has(
        key
      )
    ) {

      added.push(
        savedItem
      );


      continue;
    }


    const publishedItem =
      publishedMap.get(
        key
      );


    if (
      !meaningfulObjectsEqual(
        publishedItem,
        savedItem
      )
    ) {

      modified.push({

        before:
          publishedItem,

        after:
          savedItem,

        details:
          getConciseChanges(
            publishedItem,
            savedItem
          )
      });
    }
  }


  for (
    const [
      key,
      publishedItem
    ]
    of publishedMap
  ) {

    if (
      !savedMap.has(
        key
      )
    ) {

      removed.push(
        publishedItem
      );
    }
  }


  return {

    added:
      added,

    removed:
      removed,

    modified:
      modified
  };
}


/*
 * =====================================
 * STEP 9
 * CHANGE IMPACT ANALYSIS
 * =====================================
 */

function getBranchPaths(
  action
) {

  if (
    !action
  ) {

    return [];
  }


  if (
    Array.isArray(
      action.paths
    )
  ) {

    return action.paths;
  }


  if (
    Array.isArray(
      action.cases
    )
  ) {

    return action.cases;
  }


  return [];
}


function getBranchingBlocks(model) {

  const blocks = new Map();

  for (const sequence of model.sequences) {

    for (const [key, action] of sequence.nodes) {

      if (!blocks.has(key) && getVisualExits(action).length >= 2) {
        blocks.set(key, { action, targets: new Map() });
      }
    }

    for (const edge of sequence.edges) {

      const block = blocks.get(edge.source);

      if (block && edge.label && !block.targets.has(edge.label)) {
        block.targets.set(edge.label, edge.target);
      }
    }
  }

  return blocks;
}


function getBranchLabels(block) {

  const labels = getVisualExits(block.action)
    .map((exit) => exit.label)
    .filter(Boolean);

  return [...new Set([...labels, ...block.targets.keys()])];
}


function analyzeBranchImpact(
  beforeConfiguration = publishedConfiguration,
  afterConfiguration = savedConfiguration
) {

  const impact = {
    newBranches: 0,
    removedBranches: 0,
    changedBranches: 0
  };

  if (!beforeConfiguration || !afterConfiguration) {
    return impact;
  }

  const before = getBranchingBlocks(buildVisualFlowModel(beforeConfiguration));
  const after = getBranchingBlocks(buildVisualFlowModel(afterConfiguration));

  for (const [key, block] of after) {

    const labels = getBranchLabels(block);
    const previous = before.get(key);

    if (!previous) {
      impact.newBranches += labels.length;
      continue;
    }

    const previousLabels = getBranchLabels(previous);

    for (const label of labels) {

      if (!previousLabels.includes(label)) {
        impact.newBranches++;
      } else if ((previous.targets.get(label) || "") !== (block.targets.get(label) || "")) {
        impact.changedBranches++;
      }
    }

    impact.removedBranches += previousLabels.filter(
      (label) => !labels.includes(label)
    ).length;
  }

  for (const [key, block] of before) {

    if (!after.has(key)) {
      impact.removedBranches += getBranchLabels(block).length;
    }
  }

  return impact;
}


function isDataActionType(
  object
) {

  return (
    object?.__type ===
      "DataAction" ||
    object?.__type ===
      "CallDataAction"
  );
}


function getPlayAudioReferenceText(
  action
) {

  if (
    !action
  ) {

    return "";
  }


  const candidates = [
    action.audio,
    action.prompt,
    action.file,
    action.tts,
    action.voice,
    action.uri,
    action.resource,
    action.media,
    action.playlist
  ];


  for (
    const candidate
    of candidates
  ) {

    const text =
      getConfiguredReferenceText(
        candidate
      );


    if (
      text
    ) {

      return text;
    }
  }


  return "";
}


function getDataActionReferenceLabel(
  action
) {

  if (
    !action
  ) {

    return "Data Action";
  }


  return (
    getConfiguredReferenceText(
      action.integration
    ) ||
    getConfiguredReferenceText(
      action.category
    ) ||
    getConfiguredReferenceText(
      action.dataAction
    ) ||
    getActionName(
      action
    )
  );
}


function analyzeDependencyImpact(
  comparison
) {

  const dependencyGroups = {

    queues:
      new Set(),

    dataActions:
      new Set(),

    promptsAudio:
      new Set(),

    reusableTasks:
      new Set()
  };


  function addResourceLine(
    group,
    line
  ) {

    dependencyGroups[group].add(
      line
    );
  }


  function addActionDependency(
    item,
    changeType,
    beforeItem
  ) {

    if (
      item.kind ===
      "task"
    ) {

      const taskName =
        getTaskName(
          item.object ||
          item.task
        );


      if (
        changeType ===
        "Added"
      ) {

        addResourceLine(
          "reusableTasks",
          `+ Reusable task: ${taskName}`
        );

      } else if (
        changeType ===
        "Removed"
      ) {

        addResourceLine(
          "reusableTasks",
          `- Reusable task: ${taskName}`
        );

      } else {

        addResourceLine(
          "reusableTasks",
          `~ Reusable task: ${taskName} (configuration changed)`
        );
      }


      return;
    }


    if (
      item.kind !==
      "action"
    ) {

      return;
    }


    const object =
      item.object;


    if (
      object?.__type ===
      "PlayAudioAction"
    ) {

      if (
        changeType ===
        "Modified"
      ) {

        const beforeAction =
          beforeItem?.object ||
          beforeItem?.action;


        const beforePrompt =
          getPlayAudioReferenceText(
            beforeAction
          );


        const afterPrompt =
          getPlayAudioReferenceText(
            object
          );


        if (
          beforePrompt !==
          afterPrompt
        ) {

          addResourceLine(
            "promptsAudio",
            `~ Prompt: ${beforePrompt || "None"} → ${afterPrompt || "None"}`
          );

        } else {

          addResourceLine(
            "promptsAudio",
            "~ Prompt / audio configuration changed"
          );
        }


        return;
      }


      const promptRef =
        getPlayAudioReferenceText(
          object
        );


      if (
        changeType ===
        "Added"
      ) {

        addResourceLine(
          "promptsAudio",
          promptRef
            ? `+ Prompt: ${promptRef}`
            : "+ Prompt / audio added"
        );

      } else {

        addResourceLine(
          "promptsAudio",
          promptRef
            ? `- Prompt: ${promptRef}`
            : "- Prompt / audio removed"
        );
      }


      return;
    }


    if (
      isDataActionType(
        object
      )
    ) {

      const label =
        getDataActionReferenceLabel(
          object
        );


      if (
        changeType ===
        "Added"
      ) {

        addResourceLine(
          "dataActions",
          `+ Data Action: ${label}`
        );

      } else if (
        changeType ===
        "Removed"
      ) {

        addResourceLine(
          "dataActions",
          `- Data Action: ${label}`
        );

      } else {

        addResourceLine(
          "dataActions",
          `~ Data Action: ${label} (configuration changed)`
        );
      }


      return;
    }


    if (
      object?.__type ===
      "TransferPureMatchAction"
    ) {

      let beforeQueues =
        [];


      let afterQueues =
        [];


      if (
        changeType ===
        "Modified"
      ) {

        const beforeAction =
          beforeItem?.object ||
          beforeItem?.action;


        beforeQueues =
          getQueueNames(
            beforeAction
          );


        afterQueues =
          getQueueNames(
            object
          );


        if (
          JSON.stringify(
            beforeQueues
          ) ===
          JSON.stringify(
            afterQueues
          )
        ) {

          return;
        }


        const beforeLabel =
          beforeQueues.length > 0
            ? beforeQueues.join(", ")
            : "None";


        const afterLabel =
          afterQueues.length > 0
            ? afterQueues.join(", ")
            : "None";


        addResourceLine(
          "queues",
          `~ Queue routing: ${beforeLabel} → ${afterLabel}`
        );


        return;
      }


      if (
        changeType ===
        "Added"
      ) {

        afterQueues =
          getQueueNames(
            object
          );


        for (
          const queue
          of afterQueues
        ) {

          addResourceLine(
            "queues",
            `+ Queue: ${queue}`
          );
        }


        return;
      }


      beforeQueues =
        getQueueNames(
          object
        );


      for (
        const queue
        of beforeQueues
      ) {

        addResourceLine(
          "queues",
          `- Queue: ${queue}`
        );
      }
    }
  }


  comparison.added.forEach(
    (item) =>
      addActionDependency(
        item,
        "Added"
      )
  );


  comparison.removed.forEach(
    (item) =>
      addActionDependency(
        item,
        "Removed"
      )
  );


  comparison.modified.forEach(
    (change) =>
      addActionDependency(
        change.after,
        "Modified",
        change.before
      )
  );


  return dependencyGroups;
}


function renderBulletLines(
  lines
) {

  return lines
    .map(
      (line) => {

        const text =
          String(
            line
          );

        const marker =
          /^[+\-~]\s/.test(
            text
          )
            ? ""
            : "• ";

        return `<div style="padding-left: 12px; text-indent: -12px;">${marker}${escapeHtml(
          text
        )}</div>`;
      }
    )
    .join("");
}


function formatBranchImpactLines(
  impact
) {

  const lines =
    [];

  if (impact.newBranches > 0) {
    lines.push(
      `${impact.newBranches} new branch${impact.newBranches > 1 ? "es" : ""}`
    );
  }

  if (impact.changedBranches > 0) {
    lines.push(
      `${impact.changedBranches} existing branch${impact.changedBranches > 1 ? "es" : ""} changed`
    );
  }

  if (impact.removedBranches > 0) {
    lines.push(
      `${impact.removedBranches} branch${impact.removedBranches > 1 ? "es" : ""} removed`
    );
  }

  return lines.length > 0
    ? lines
    : ["No branch impact detected"];
}


function renderDependencyImpactContent(
  comparison
) {

  const dependencyImpact =
    analyzeDependencyImpact(
      comparison
    );


  const dependencySections =
    [];


  function renderDependencyGroup(
    title,
    lineSet
  ) {

    if (
      !lineSet ||
      lineSet.size === 0
    ) {

      return;
    }


    const values =
      renderBulletLines(
        Array.from(
          lineSet
        ).sort()
      );


    dependencySections.push(
      `<div>` +
      `<div style="padding-left: 24px;"><strong>${escapeHtml(
        title
      )}</strong></div>` +
      `<div style="padding-left: 24px;">${values}</div>` +
      `</div>`
    );
  }


  renderDependencyGroup(
    "Queues",
    dependencyImpact.queues
  );


  renderDependencyGroup(
    "Data Actions",
    dependencyImpact.dataActions
  );


  renderDependencyGroup(
    "Prompts / Audio",
    dependencyImpact.promptsAudio
  );


  renderDependencyGroup(
    "Reusable Tasks",
    dependencyImpact.reusableTasks
  );


  if (
    dependencySections.length === 0
  ) {

    return `<div style="padding-left: 24px;">${renderBulletLines(["No dependency impact detected"])}</div>`;
  }


  return dependencySections.join(
    ""
  );
}


/*
 * Step 9C — Potential regression (delta-only test focus).
 */
function analyzePotentialRegression(
  comparison
) {

  const lines =
    new Set();


  function addLine(
    line
  ) {

    lines.add(
      line
    );
  }


  function addTestsForItem(
    item,
    changeType
  ) {

    if (
      item.kind ===
      "task"
    ) {

      const taskName =
        getTaskName(
          item.object ||
          item.task
        );


      if (
        changeType ===
        "Added"
      ) {

        addLine(
          `Test reusable task entry and exit: ${taskName}`
        );

      } else if (
        changeType ===
        "Removed"
      ) {

        addLine(
          `Test flows that previously used reusable task: ${taskName}`
        );

      } else {

        addLine(
          `Retest reusable task behavior: ${taskName}`
        );
      }


      return;
    }


    if (
      item.kind !==
      "action"
    ) {

      return;
    }


    const object =
      item.object;


    const blockLabel =
      getDisplayActionName(
        item
      );


    const actionType =
      object?.__type ||
      "";


    if (
      actionType ===
      "DecisionAction"
    ) {

      addLine(
        changeType === "Added"
          ? `Test new Decision Yes/No paths and downstream routing: ${blockLabel}`
          : changeType === "Removed"
            ? `Test journeys that used removed Decision: ${blockLabel}`
            : `Retest Decision Yes/No paths and conditions: ${blockLabel}`
      );


      return;
    }


    if (
      actionType ===
      "SwitchAction"
    ) {

      addLine(
        changeType === "Added"
          ? `Test all new Switch paths and default routing: ${blockLabel}`
          : changeType === "Removed"
            ? `Test journeys that used removed Switch: ${blockLabel}`
            : `Retest all Switch paths and case routing: ${blockLabel}`
      );


      return;
    }


    if (
      actionType ===
      "LoopAction"
    ) {

      addLine(
        changeType === "Added"
          ? `Test loop count, exit, and body actions: ${blockLabel}`
          : changeType === "Removed"
            ? `Test journeys that depended on removed Loop: ${blockLabel}`
            : `Retest loop iterations and body behavior: ${blockLabel}`
      );


      return;
    }


    if (
      actionType ===
      "TransferPureMatchAction"
    ) {

      const queues =
        getQueueNames(
          object
        )
          .join(", ") ||
        "configured queue";


      addLine(
        changeType === "Added"
          ? `Test Transfer to ACD routing to queue: ${queues}`
          : changeType === "Removed"
            ? `Test customer paths after removed Transfer (queue: ${queues})`
            : `Retest Transfer to ACD queue routing: ${queues}`
      );


      return;
    }


    if (
      actionType ===
      "PlayAudioAction"
    ) {

      const promptRef =
        getPlayAudioReferenceText(
          object
        );


      const promptPart =
        promptRef
          ? ` (${promptRef})`
          : "";


      addLine(
        changeType === "Added"
          ? `Test Play Audio playback${promptPart}`
          : changeType === "Removed"
            ? `Test journeys after removed Play Audio${promptPart}`
            : `Retest Play Audio prompt and playback${promptPart}`
      );


      return;
    }


    if (
      isDataActionType(
        object
      )
    ) {

      const label =
        getDataActionReferenceLabel(
          object
        );


      addLine(
        changeType === "Added"
          ? `Test Call Data Action success, failure, and timeout: ${label}`
          : changeType === "Removed"
            ? `Test journeys after removed Data Action: ${label}`
            : `Retest Call Data Action success, failure, and timeout: ${label}`
      );


      return;
    }


    if (
      actionType ===
      "UpdateVariableAction"
    ) {

      addLine(
        changeType === "Added"
          ? `Test Update Data variables and downstream expressions: ${blockLabel}`
          : changeType === "Removed"
            ? `Test journeys using variables from removed Update Data: ${blockLabel}`
            : `Retest Update Data values and dependent logic: ${blockLabel}`
      );


      return;
    }


    addLine(
      changeType === "Added"
        ? `Test new block behavior: ${blockLabel}`
        : changeType === "Removed"
          ? `Test journeys affected by removed block: ${blockLabel}`
          : `Retest modified block behavior: ${blockLabel}`
    );
  }


  function addTestsForModified(
    change
  ) {

    const afterItem =
      change.after;


    const object =
      afterItem.object;


    const actionType =
      object?.__type ||
      "";


    if (
      actionType ===
      "TransferPureMatchAction"
    ) {

      const beforeQueues =
        getQueueNames(
          change.before.object
        );


      const afterQueues =
        getQueueNames(
          object
        );


      if (
        JSON.stringify(
          beforeQueues
        ) !==
        JSON.stringify(
          afterQueues
        )
      ) {

        const beforeLabel =
          beforeQueues.join(", ") ||
          "None";


        const afterLabel =
          afterQueues.join(", ") ||
          "None";


        addLine(
          `Test queue routing change: ${beforeLabel} → ${afterLabel}`
        );


        return;
      }
    }


    if (
      actionType ===
      "PlayAudioAction"
    ) {

      const beforePrompt =
        getPlayAudioReferenceText(
          change.before.object
        );


      const afterPrompt =
        getPlayAudioReferenceText(
          object
        );


      if (
        beforePrompt !==
        afterPrompt
      ) {

        addLine(
          `Test prompt change: ${beforePrompt || "None"} → ${afterPrompt || "None"}`
        );


        return;
      }
    }


    addTestsForItem(
      afterItem,
      "Modified"
    );
  }


  for (
    const item
    of comparison.added
  ) {

    addTestsForItem(
      item,
      "Added"
    );
  }


  for (
    const item
    of comparison.removed
  ) {

    addTestsForItem(
      item,
      "Removed"
    );
  }


  for (
    const change
    of comparison.modified
  ) {

    addTestsForModified(
      change
    );
  }


  return lines;
}


function renderPotentialRegressionContent(
  comparison
) {

  const lines =
    analyzePotentialRegression(
      comparison
    );


  if (
    lines.size === 0
  ) {

    return `<div style="padding-left: 24px;">${renderBulletLines(["No additional regression tests recommended"])}</div>`;
  }


  return (
    `<div style="padding-left: 24px;">` +
    renderBulletLines(
      Array.from(
        lines
      ).sort()
    ) +
    `</div>`
  );
}


function renderChangeScope(
comparison
) {

const sections =
  [];


/*
 * Added
 */
if (
  comparison.added.length > 0
) {

  const values =
    comparison.added
      .map(
        (item) =>
          `+ ${escapeHtml(
            getDisplayActionName(
              item
            )
          )}`
      )
      .join("<br>");


  sections.push(
    `<div>` +
    `<div style="padding-left: 24px;"><strong>Added</strong></div>` +
    `<div style="padding-left: 24px;">${values}</div>` +
    `</div>`
  );
}


/*
 * Removed
 */
if (
  comparison.removed.length > 0
) {

  const values =
    comparison.removed
      .map(
        (item) =>
          `- ${escapeHtml(
            getDisplayActionName(
              item
            )
          )}`
      )
      .join("<br>");


  sections.push(
    `<div>` +
    `<div style="padding-left: 24px;"><strong>Removed</strong></div>` +
    `<div style="padding-left: 24px;">${values}</div>` +
    `</div>`
  );
}


/*
 * Modified
 */
if (
  comparison.modified.length > 0
) {

  const values =
    comparison.modified
      .map(
        (item) => {

          const header =
            `~ ${escapeHtml(
              getDisplayActionName(
                item.after
              )
            )}`;


          const details =
            item.details
              .map(
                (detail) =>
                  escapeHtml(
                    detail
                  )
              )
              .join("<br>");


          return (
            `<div>` +
            `<div>${header}</div>` +
            `<div style="padding-left: 24px;">${details}</div>` +
            `</div>`
          );
        }
      )
      .join("");


  sections.push(
    `<div>` +
    `<div style="padding-left: 24px;"><strong>Modified</strong></div>` +
    `<div style="padding-left: 24px;">${values}</div>` +
    `</div>`
  );
}


return sections.join("");
}


function renderChangeImpactAnalysis(
comparison
) {

if (
  !comparison
) {

  analysisSummaryElement.innerHTML =
    `<div style="margin-top: 1em;"><strong>Affected Blocks</strong></div>`;


  analysisDetailsElement.innerHTML =
    "<div>Waiting for comparison...</div>";


  return;
}


analysisSummaryElement.innerHTML =
  "";


analysisDetailsElement.innerHTML =
  buildChangeImpactHtml(
    comparison,
    publishedConfiguration,
    savedConfiguration
  );
}


function buildChangeImpactHtml(
  comparison,
  beforeConfiguration,
  afterConfiguration,
  includeRegression = true
) {

const sections =
  [];


sections.push(
  `<div style="margin-top: 1em;"><strong>Affected Blocks</strong></div>` +
  renderChangeScope(
    comparison
  )
);


const branchContent =
  renderBulletLines(
    formatBranchImpactLines(
      analyzeBranchImpact(
        beforeConfiguration,
        afterConfiguration
      )
    )
  );


sections.push(
  `<div style="margin-top: 1em;">` +
  `<div><strong>Affected Branches</strong></div>` +
  `<div style="padding-left: 24px;">${branchContent}</div>` +
  `</div>`
);


const dependencyContent =
  renderDependencyImpactContent(
    comparison
  );


sections.push(
  `<div style="margin-top: 1em;">` +
  `<div><strong>Affected dependencies</strong></div>` +
  dependencyContent +
  `</div>`
);


if (includeRegression) {

  sections.push(
    `<div style="margin-top: 1em;">` +
    `<div><strong>Potential regression</strong></div>` +
    renderPotentialRegressionContent(
      comparison
    ) +
    `</div>`
  );
}


return sections.join("");
}


/*
* =====================================
* RISK ENGINE
* =====================================
*/

function pathHasConfiguredAction(
path
) {

if (
  !path ||
  typeof path !==
    "object"
) {

  return false;
}


const candidates = [
  path.nextActionId,
  path.nextAction,
  path.startAction,
  path.actionId
];


for (
  const candidate
  of candidates
) {

  if (
    typeof candidate ===
      "string" &&
    candidate.trim()
  ) {

    return true;
  }
}


if (
  Array.isArray(
    path.actions
  ) &&
  path.actions.length > 0
) {

  return true;
}


return false;
}


function getLiteralBoolean(
expression
) {

const literal =
  expression
    ?.config
    ?.lit;


if (
  !literal ||
  literal.type !==
    "bln"
) {

  return null;
}


const rawValue =
  literal.text !==
    undefined
    ? literal.text
    : expression?.text;


const normalized =
  String(
    rawValue
  )
    .trim()
    .toLowerCase();


if (
  normalized ===
  "true"
) {

  return true;
}


if (
  normalized ===
  "false"
) {

  return false;
}


return null;
}


function createRiskIssue(
rule,
item,
message,
detailKey
) {

const action =
  item.object ||
  item.action ||
  {};


return {

  ruleId:
    rule.id,

  severity:
    rule.severity,

  actionId:
    action.id ||
    action.actionId ||
    "",

  trackingId:
    getTrackingId(
      action
    ),

  actionName:
    getDisplayActionName(
      item
    ),

  message:
    message,

  impact:
    rule.impact,

  recommendedTest:
    rule.recommendedTest,

  detailKey:
    detailKey ||
    message
};
}


function getDataActionOutput(
action,
outputName
) {

const outputs =
  action?.outputs;


if (
  outputs &&
  outputs[outputName]
) {

  return outputs[outputName];
}


const normalizedOutputName =
  String(
    outputName
  )
    .toLowerCase();


if (
  Array.isArray(
    action?.paths
  )
) {

  const matchingPath =
    action.paths.find(
      (path) =>
        String(
          path?.label ||
          ""
        )
          .trim()
          .toLowerCase() ===
        normalizedOutputName
    );


  if (
    matchingPath
  ) {

    return matchingPath;
  }
}


return null;
}


function outputHasActions(
output
) {

if (
  !output ||
  typeof output !==
    "object"
) {

  return false;
}


if (
  Array.isArray(
    output.actions
  ) &&
  output.actions.length > 0
) {

  return true;
}


if (
  pathHasConfiguredAction(
    output
  )
) {

  return true;
}


return false;
}


const RISK_RULES = [

{
  id:
    "DECISION_BRANCH_NO_PROCESSING",

  actionType:
    "DecisionAction",

  severity:
    "High",

  impact:
    "Branch may skip intended processing.",

  recommendedTest:
    "Test the affected branch.",

  validate:
    function (
      item,
      rule
    ) {

      const action =
        item.object;


      if (
        !Array.isArray(
          action?.paths
        )
      ) {

        return [];
      }


      const issues =
        [];


      const decisionPaths =
        action.paths.filter(
          (path) => {

            const label =
              String(
                path?.label ||
                ""
              )
                .trim()
                .toLowerCase();


            return (
              label === "yes" ||
              label === "no"
            );
          }
        );


      for (
        const path
        of decisionPaths
      ) {

        if (
          pathHasConfiguredAction(
            path
          )
        ) {

          continue;
        }


        const label =
          String(
            path.label ||
            "Branch"
          ).trim();


        issues.push(
          createRiskIssue(
            rule,
            item,
            `${label} branch has no action`,
            path.outputId ||
            label
          )
        );
      }


      return issues;
    }
},


{
  id:
    "DECISION_CONSTANT_CONDITION",

  actionType:
    "DecisionAction",

  severity:
    "Medium",

  impact:
    "One branch is unreachable.",

  recommendedTest:
    "Test both Yes and No paths.",

  validate:
    function (
      item,
      rule
    ) {

      const literalValue =
        getLiteralBoolean(
          item.object?.expression
        );


      if (
        literalValue ===
        null
      ) {

        return [];
      }


      const unreachableBranch =
        literalValue
          ? "No"
          : "Yes";


      const conditionText =
        literalValue
          ? "True"
          : "False";


      return [
        createRiskIssue(
          rule,
          item,
          `Condition is always ${conditionText}; ${unreachableBranch} branch cannot be reached`,
          "constant-condition"
        )
      ];
    }
},


{
  id:
    "SWITCH_PATH_NO_PROCESSING",

  actionType:
    "SwitchAction",

  severity:
    "High",

  impact:
    "Path may skip intended processing.",

  recommendedTest:
    "Test the affected Switch path.",

  validate:
    function (
      item,
      rule
    ) {

      const action =
        item.object;


      if (
        !Array.isArray(
          action?.paths
        )
      ) {

        return [];
      }


      const issues =
        [];


      for (
        const path
        of action.paths
      ) {

        if (
          pathHasConfiguredAction(
            path
          )
        ) {

          continue;
        }


        const label =
          String(
            path?.label ||
            "Switch path"
          ).trim();


        issues.push(
          createRiskIssue(
            rule,
            item,
            `${label} has no action`,
            path.outputId ||
            label
          )
        );
      }


      return issues;
    }
},


{
  id:
    "LOOP_BODY_NO_PROCESSING",

  actionType:
    "LoopAction",

  severity:
    "Medium",

  impact:
    "Loop runs without useful processing.",

  recommendedTest:
    "Verify loop actions and iterations.",

  validate:
    function (
      item,
      rule
    ) {

      const action =
        item.object;


      if (
        pathHasConfiguredAction(
          action?.path
        )
      ) {

        return [];
      }


      return [
        createRiskIssue(
          rule,
          item,
          "Loop body has no action",
          "loop-body"
        )
      ];
    }
},


{
  id:
    "DATA_ACTION_FAILURE_RECOVERY",

  actionType:
    "DataAction",

  severity:
    "Medium",

  impact:
    "Failure may have no fallback.",

  recommendedTest:
    "Test the failure path.",

  validate:
    function (
      item,
      rule
    ) {

      const failureOutput =
        getDataActionOutput(
          item.object,
          "failure"
        );


      if (
        !failureOutput ||
        outputHasActions(
          failureOutput
        )
      ) {

        return [];
      }


      return [
        createRiskIssue(
          rule,
          item,
          "Failure path has no recovery handling",
          "failure"
        )
      ];
    }
},


{
  id:
    "DATA_ACTION_TIMEOUT_RECOVERY",

  actionType:
    "DataAction",

  severity:
    "Medium",

  impact:
    "Timeout may have no fallback.",

  recommendedTest:
    "Test the timeout path.",

  validate:
    function (
      item,
      rule
    ) {

      const timeoutOutput =
        getDataActionOutput(
          item.object,
          "timeout"
        );


      if (
        !timeoutOutput ||
        outputHasActions(
          timeoutOutput
        )
      ) {

        return [];
      }


      return [
        createRiskIssue(
          rule,
          item,
          "Timeout path has no recovery handling",
          "timeout"
        )
      ];
    }
}
];


function getDeltaRisks(
  comparison
) {

  if (
    !comparison
  ) {

    return [];
  }


  const issues =
    [];


  const itemsToValidate =
    [];


  for (
    const item
    of comparison.added
  ) {

    itemsToValidate.push(
      item
    );
  }


  for (
    const change
    of comparison.modified
  ) {

    itemsToValidate.push(
      change.after
    );
  }


  for (
    const item
    of itemsToValidate
  ) {

    if (
      item.kind !==
      "action"
    ) {

      continue;
    }


    const actionType =
      item.type ||
      item.object?.__type;


    for (
      const rule
      of RISK_RULES
    ) {

      if (
        rule.actionType !==
        actionType
      ) {

        continue;
      }


      const ruleIssues =
        rule.validate(
          item,
          rule
        );


      if (
        Array.isArray(
          ruleIssues
        ) &&
        ruleIssues.length > 0
      ) {

        issues.push(
          ...ruleIssues
        );
      }
    }
  }


  return issues;
}


function renderRiskValidation(
  deltaRisks
) {

  const report =
    buildRiskReport(
      deltaRisks,
      "No risk issues detected in saved changes"
    );


  riskSummaryElement.textContent =
    report.summary;


  riskDetailsElement.innerHTML =
    report.html;
}


function buildRiskReport(
  deltaRisks,
  emptyMessage
) {

  if (
    !Array.isArray(
      deltaRisks
    ) ||
    deltaRisks.length === 0
  ) {

    return {
      summary: emptyMessage,
      html: ""
    };
  }


  const highCount =
    deltaRisks.filter(
      (issue) =>
        issue.severity ===
        "High"
    ).length;


  const mediumCount =
    deltaRisks.filter(
      (issue) =>
        issue.severity ===
        "Medium"
    ).length;


  const summary =
    `${deltaRisks.length} issue${deltaRisks.length === 1 ? "" : "s"}` +
    ` (${highCount} High, ${mediumCount} Medium)`;


  const html =
    deltaRisks
      .map(
        (issue) => {

          const header =
            `[${escapeHtml(
              issue.severity
            )}] ${escapeHtml(
              issue.actionName
            )}`;


          const message =
            escapeHtml(
              issue.message
            );


          const test =
            escapeHtml(
              issue.recommendedTest
            );


          return (
            `<div style="margin-bottom: 10px;">` +
            `<div><strong>${header}</strong></div>` +
            `<div style="padding-left: 12px;">${message}</div>` +
            `<div style="padding-left: 12px; color: #52606d;">Test: ${test}</div>` +
            `</div>`
          );
        }
      )
      .join("");


  return {
    summary,
    html
  };
}


function renderPublishedOnlyState() {

  lastComparison =
    null;

  lastReportMeta = {
    flowName:
      flowNameElement.textContent ||
      "",

    publishedVersion:
      "",

    savedVersion:
      ""
  };

  if (
    visualReportStatusElement
  ) {

    visualReportStatusElement.textContent =
      "Save the flow to enable the report.";
  }

  if (
    visualReportOpenButton
  ) {

    visualReportOpenButton.disabled =
      true;
  }

  savedVersionElement.textContent =
    "Saved Version: None";


  configStatusElement.textContent =
    publishedConfiguration
      ? "Configurations: Published Loaded | Saved Not Found"
      : "Configurations: Published unavailable | Saved Not Found";


  savedConfiguration =
    null;


  analysisSummaryElement.innerHTML =
    `<div style="margin-top: 1em;"><strong>Affected Blocks</strong></div>`;


  analysisDetailsElement.innerHTML =
    "<div>Waiting for saved version.</div>";


  riskSummaryElement.textContent =
    "Waiting for saved version";


  riskDetailsElement.innerHTML =
    "";
}


  /*
   * =====================================
   * VISUAL CHANGE REPORT (STEP 8)
   * =====================================
   */

  /*
   * Visual graph model: Architect blocks are structured. A branching block's
   * outputs start chains; when a chain ends without an explicit next, it
   * continues at the enclosing block's continuation (the join Architect draws
   * below the branches). Empty outputs go straight to that join.
   */

  const VISUAL_KNOWN_LABELS = {
    success: "Success",
    failure: "Failure",
    timeout: "Timeout",
    yes: "Yes",
    no: "No",
    default: "Default",
    next: "Next"
  };


  function getVisualRefId(value) {

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (value && typeof value === "object" && typeof value.id === "string") {
      return value.id;
    }

    return "";
  }


  function getVisualActionId(action) {

    return (
      getVisualRefId(action?.id) ||
      getVisualRefId(action?.actionId)
    );
  }


  function getVisualNodeKey(action) {

    const id = getVisualActionId(action);

    return id ? `ID:${id}` : "";
  }


  function isVisualDataAction(action) {

    return String(action?.__type || "").endsWith("DataAction");
  }


  function isVisualTerminalAction(action) {

    return /Disconnect|EndTask|EndFlow|EndWorkflow|ExitLoop|JumpTo/.test(
      String(action?.__type || "")
    );
  }


  function isVisualTerminalExit(action, label) {

    return (
      label === "Success" &&
      /Transfer/.test(String(action?.__type || ""))
    );
  }


  function collectVisualActions(value, into) {

    if (!value || typeof value !== "object") {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((child) => collectVisualActions(child, into));
      return;
    }

    if (isArchitectAction(value) && getVisualActionId(value)) {
      into.push(value);
    }

    for (const child of Object.values(value)) {
      collectVisualActions(child, into);
    }
  }


  function normalizeVisualExitLabel(action, rawLabel, outputId) {

    let label = typeof rawLabel === "string" ? rawLabel.trim() : "";

    if (!label && outputId) {

      const lower = String(outputId).toLowerCase();

      if (lower.includes("success")) {
        label = "Success";
      } else if (lower.includes("fail")) {
        label = "Failure";
      } else if (lower.includes("timeout")) {
        label = "Timeout";
      }
    }

    const known = VISUAL_KNOWN_LABELS[label.toLowerCase()];

    if (known) {
      label = known;
    }

    if (label === "Next" && isVisualDataAction(action)) {
      label = "Success";
    }

    return label;
  }


  function getVisualExits(action) {

    const exits = [];

    function addExit(container, rawLabel, fromOutputs) {

      if (!container || typeof container !== "object" || Array.isArray(container)) {
        return;
      }

      const label = normalizeVisualExitLabel(
        action,
        rawLabel ?? container.label ?? container.name,
        container.outputId
      );

      const nested = Array.isArray(container.actions)
        ? container.actions.filter(isArchitectAction)
        : [];

      const ref =
        getVisualRefId(container.nextActionId) ||
        getVisualRefId(container.nextAction) ||
        getVisualRefId(container.startAction) ||
        getVisualRefId(container.actionId);

      const isKnownExit = Object.values(VISUAL_KNOWN_LABELS).includes(label);

      // Data Action outputs also hold variable mappings (statusCode, result, ...).
      if (fromOutputs && !isKnownExit && !Array.isArray(container.actions) && !ref) {
        return;
      }

      const existing = label
        ? exits.find((exit) => exit.label === label)
        : null;

      if (existing) {

        if (!existing.ref && existing.nested.length === 0) {
          existing.ref = ref;
          existing.nested = nested;
        }

        return;
      }

      exits.push({ label, ref, nested });
    }

    for (const path of Array.isArray(action?.paths) ? action.paths : []) {
      addExit(path);
    }

    for (const path of Array.isArray(action?.cases) ? action.cases : []) {
      addExit(path);
    }

    const outputs = action?.outputs;

    if (Array.isArray(outputs)) {
      outputs.forEach((output) => addExit(output, undefined, true));
    } else if (outputs && typeof outputs === "object") {
      for (const [name, output] of Object.entries(outputs)) {
        addExit(output, output?.label || name, true);
      }
    }

    if (action?.path && typeof action.path === "object" && !Array.isArray(action.path)) {
      addExit(action.path, action.path.label || "Loop");
    }

    return exits;
  }


  function getVisualExplicitNextRef(action) {

    return (
      getVisualRefId(action?.nextActionId) ||
      getVisualRefId(action?.nextAction)
    );
  }


  function buildVisualSequenceGraph(container, actionById) {

    const actions = [];

    collectVisualActions(container, actions);

    const nodes = new Map();
    const edges = [];
    const edgeIds = new Set();
    const siblingNext = new Map();
    const visited = new Set();

    const resolve = (ref) => (ref && actionById.get(ref)) || null;

    function addEdge(from, to, label) {

      const source = getVisualNodeKey(from);
      const target = getVisualNodeKey(to);

      if (!source || !target || source === target) {
        return;
      }

      const id = `${source}|${target}|${label}`;

      if (edgeIds.has(id)) {
        return;
      }

      edgeIds.add(id);
      edges.push({ id, source, target, label });
    }

    function registerChain(list) {

      const chain = list.filter(isArchitectAction);

      for (let index = 0; index < chain.length - 1; index++) {
        siblingNext.set(chain[index], chain[index + 1]);
      }

      return chain[0] || null;
    }

    function visit(action, cont, outerCont) {

      if (!action) {
        return;
      }

      const key = getVisualNodeKey(action);

      if (!key || visited.has(key)) {
        return;
      }

      visited.add(key);
      nodes.set(key, action);

      if (cont === action) {
        cont = outerCont;
        outerCont = null;
      }

      const ownNext =
        resolve(getVisualExplicitNextRef(action)) ||
        siblingNext.get(action) ||
        null;

      const after = ownNext || cont;
      const exits = getVisualExits(action);
      const branchStarts = [];

      if (exits.length > 0) {

        for (const exit of exits) {

          if (isVisualTerminalExit(action, exit.label)) {
            continue;
          }

          const first = exit.nested.length > 0
            ? registerChain(exit.nested)
            : resolve(exit.ref);

          if (first) {
            addEdge(action, first, exit.label);
            branchStarts.push(first);
          } else if (after) {
            addEdge(action, after, exit.label);
          }
        }

        const hasSuccess = exits.some((exit) => exit.label === "Success");

        if (isVisualDataAction(action) && !hasSuccess && after) {
          addEdge(action, after, "Success");
        }

      } else if (after && !isVisualTerminalAction(action)) {

        addEdge(action, after, "");
      }

      for (const first of branchStarts) {
        visit(first, after, cont);
      }

      if (ownNext) {
        visit(ownNext, cont, outerCont);
      }
    }

    const topList = Array.isArray(container?.actionList)
      ? container.actionList
      : Array.isArray(container?.actions)
        ? container.actions
        : null;

    const usesReferences = actions.some(
      (action) =>
        getVisualExplicitNextRef(action) ||
        getVisualExits(action).some((exit) => exit.ref)
    );

    let start = resolve(
      getVisualRefId(container?.startAction) ||
      getVisualRefId(container?.startActionId)
    );

    if (topList && !usesReferences) {

      const first = registerChain(topList);

      start = start || first;
    }

    if (!start) {

      const referenced = new Set();

      for (const action of actions) {

        referenced.add(getVisualExplicitNextRef(action));

        for (const exit of getVisualExits(action)) {
          referenced.add(exit.ref);
        }
      }

      start =
        actions.find((action) => !referenced.has(getVisualActionId(action))) ||
        actions[0] ||
        null;
    }

    visit(start, null, null);

    for (const action of actions) {
      visit(action, null, null);
    }

    return { nodes, edges };
  }


  function buildVisualFlowModel(configuration) {

    const allActions = [];

    collectVisualActions(configuration, allActions);

    const actionById = new Map();

    for (const action of allActions) {

      const id = getVisualActionId(action);
      const existing = actionById.get(id);

      if (!existing || Object.keys(action).length > Object.keys(existing).length) {
        actionById.set(id, action);
      }
    }

    let containers = Array.isArray(configuration?.flowSequenceItemList)
      ? configuration.flowSequenceItemList.filter(
          (item) => item && typeof item === "object"
        )
      : [];

    if (containers.length === 0 && configuration) {
      containers = [configuration];
    }

    const sequences = containers.map((container, index) => ({
      id: getVisualRefId(container.id) || `sequence-${index}`,
      container,
      ...buildVisualSequenceGraph(container, actionById)
    }));

    return {
      sequences,
      initialSequence: String(configuration?.initialSequence || "")
    };
  }


  function toVisualReportNode(key, action, changeType) {

    const item = {
      kind: "action",
      object: action,
      action,
      name: getActionName(action),
      type: action.__type
    };

    return {
      id: key,
      label: getDisplayActionName(item),
      subtitle: action.__type || "Action",
      changeType
    };
  }


  function describeVisualSequence(sequence, initialSequence, changeTypeByKey) {

    const taskItem = {
      kind: "task",
      object: sequence.container,
      task: sequence.container,
      name: getTaskName(sequence.container)
    };

    const isInitial = sequence.id === initialSequence;

    return {
      name: isArchitectTask(sequence.container)
        ? getDisplayActionName(taskItem)
        : sequence.container?.name || "Flow",
      isInitial,
      changeType: changeTypeByKey.get(getActionKey(taskItem)) || "unchanged"
    };
  }


  function buildVisualReportPayload(
    comparison,
    meta,
    publishedConfiguration,
    savedConfiguration
  ) {

    const changeTypeByKey = new Map();

    for (const item of comparison.added) {
      changeTypeByKey.set(getActionKey(item), "added");
    }

    for (const item of comparison.removed) {
      changeTypeByKey.set(getActionKey(item), "removed");
    }

    for (const entry of comparison.modified) {
      changeTypeByKey.set(getActionKey(entry.after), "modified");
    }

    const saved = buildVisualFlowModel(savedConfiguration);
    const published = buildVisualFlowModel(publishedConfiguration);

    const publishedById = new Map(
      published.sequences.map((sequence) => [sequence.id, sequence])
    );

    const savedIds = new Set(saved.sequences.map((sequence) => sequence.id));

    const sequences = [];

    function pushSequence(sequence, initialSequence, nodes, edges) {

      const nodeList = [...nodes.values()];

      const changedCount = nodeList.filter(
        (node) => node.changeType !== "unchanged"
      ).length;

      const description = describeVisualSequence(
        sequence,
        initialSequence,
        changeTypeByKey
      );

      if (changedCount === 0 && description.changeType !== "added" && description.changeType !== "removed") {
        return;
      }

      sequences.push({
        id: sequence.id,
        ...description,
        changedCount,
        nodes: nodeList,
        edges
      });
    }

    for (const sequence of saved.sequences) {

      const nodes = new Map();

      for (const [key, action] of sequence.nodes) {
        nodes.set(
          key,
          toVisualReportNode(key, action, changeTypeByKey.get(key) || "unchanged")
        );
      }

      const edges = sequence.edges.map((edge) => ({ ...edge, status: "normal" }));

      const publishedSequence = publishedById.get(sequence.id);

      if (publishedSequence) {

        for (const [key, action] of publishedSequence.nodes) {

          if (!nodes.has(key) && changeTypeByKey.get(key) === "removed") {
            nodes.set(key, toVisualReportNode(key, action, "removed"));
          }
        }

        for (const edge of publishedSequence.edges) {

          const touchesRemoved =
            changeTypeByKey.get(edge.source) === "removed" ||
            changeTypeByKey.get(edge.target) === "removed";

          if (touchesRemoved && nodes.has(edge.source) && nodes.has(edge.target)) {
            edges.push({ ...edge, id: `removed|${edge.id}`, status: "removed" });
          }
        }
      }

      pushSequence(sequence, saved.initialSequence, nodes, edges);
    }

    for (const sequence of published.sequences) {

      if (savedIds.has(sequence.id)) {
        continue;
      }

      const nodes = new Map();

      for (const [key, action] of sequence.nodes) {
        nodes.set(key, toVisualReportNode(key, action, "removed"));
      }

      const edges = sequence.edges.map((edge) => ({ ...edge, status: "removed" }));

      pushSequence(sequence, published.initialSequence, nodes, edges);
    }

    sequences.sort((first, second) => Number(second.isInitial) - Number(first.isInitial));

    const changedBlockCount = [
      ...comparison.added,
      ...comparison.removed,
      ...comparison.modified.map((entry) => entry.after)
    ].filter((item) => item?.kind === "action").length;

    return {
      version: 2,
      generatedAt: new Date().toLocaleString(),
      flowName: meta.flowName || "",
      publishedVersion: meta.publishedVersion || "",
      savedVersion: meta.savedVersion || "",
      changedBlockCount,
      sequences
    };
  }


  function updateVisualReportControls(
    comparison,
    meta
  ) {

    lastComparison =
      comparison;

    lastReportMeta =
      meta;


    if (
      !visualReportStatusElement ||
      !visualReportOpenButton
    ) {

      return;
    }


    const changeCount =
      comparison.added.length +
      comparison.removed.length +
      comparison.modified.length;


    visualReportOpenButton.disabled =
      false;


    visualReportStatusElement.textContent =
      changeCount > 0
        ? `${changeCount} changed block(s).`
        : "No block changes — report will show an empty visual diff.";
  }


  async function openVisualChangeReport() {

    if (
      !lastComparison ||
      !savedConfiguration
    ) {

      return;
    }


    const payload =
      buildVisualReportPayload(
        lastComparison,
        lastReportMeta,
        publishedConfiguration,
        savedConfiguration
      );


    try {

      const response =
        await chrome.runtime.sendMessage(
          {
            type:
              "FLOWLENZ_OPEN_VISUAL_REPORT",

            payload
          }
        );


      if (
        !response?.success
      ) {

        throw new Error(
          response?.error ||
            "Background could not open the report."
        );
      }

    } catch (
      error
    ) {

      console.error(
        "FlowLenZ visual report error:",
        error
      );


      if (
        visualReportStatusElement
      ) {

        visualReportStatusElement.textContent =
          "Could not open report. Reload the extension and try again.";
      }
    }
  }


  if (
    visualReportOpenButton
  ) {

    visualReportOpenButton.addEventListener(
      "click",
      () => {

        openVisualChangeReport();
      }
    );
  }


  /*
   * =====================================
   * APPLY CURRENT FLOW
   * =====================================
   */

  /*
   * =====================================
   * RELEASE NOTES (STEP 9)
   * Rebuilt on demand from Genesys versions: any published version vs the
   * one before it, plus the saved draft vs latest published (pre-publish
   * preview). Opens on a separate page like the Visual Change Report.
   * =====================================
   */

  const releaseConfigurationCache =
    new Map();

  let releaseEntries =
    [];

  let releaseFlowName =
    "";


  function loadReleaseConfiguration(
    configurationUri
  ) {

    if (!releaseConfigurationCache.has(configurationUri)) {

      releaseConfigurationCache.set(
        configurationUri,
        loadConfiguration(configurationUri).catch((error) => {
          releaseConfigurationCache.delete(configurationUri);
          throw error;
        })
      );
    }

    return releaseConfigurationCache.get(
      configurationUri
    );
  }


  function describeReleaseVersion(
    version
  ) {

    const parts =
      [];

    const created =
      version?.dateCreated
        ? new Date(version.dateCreated)
        : null;

    if (created && !Number.isNaN(created.getTime())) {
      parts.push(`Published ${created.toLocaleString()}`);
    }

    if (version?.createdBy?.name) {
      parts.push(`by ${version.createdBy.name}`);
    }

    return parts.join(" ");
  }


  function buildReleaseEntries(
    context
  ) {

    const published =
      (context.versions.publishedVersions || []).filter(
        (entry) => entry.version?.configurationUri
      );

    const entries =
      [];

    [...published].reverse().forEach((entry, index, ascending) => {

      const previous =
        ascending[index - 1] ||
        null;

      entries.push({
        label: `Version ${entry.identifier}`,
        versionLabel: `Version ${entry.identifier}`,
        previousLabel: previous ? `Version ${previous.identifier}` : "",
        detail: describeReleaseVersion(entry.version),
        loadCurrent: () => loadReleaseConfiguration(entry.version.configurationUri),
        loadPrevious: previous
          ? () => loadReleaseConfiguration(previous.version.configurationUri)
          : null
      });
    });

    if (context.hasSavedVersion && context.savedConfiguration && published[0]) {

      const savedLabel =
        `Version ${calculateNextVersion(published[0].identifier) || "draft"} (Saved)`;

      entries.push({
        label: savedLabel,
        versionLabel: savedLabel,
        previousLabel: `Version ${published[0].identifier}`,
        detail: "Not yet published",
        loadCurrent: () => Promise.resolve(context.savedConfiguration),
        loadPrevious: () => loadReleaseConfiguration(published[0].version.configurationUri)
      });
    }

    if (published[0] && context.publishedConfiguration) {
      releaseConfigurationCache.set(
        published[0].version.configurationUri,
        Promise.resolve(context.publishedConfiguration)
      );
    }

    return entries;
  }


  function buildReleaseNotesBody(
    beforeConfiguration,
    afterConfiguration
  ) {

    const comparison =
      compareActions(
        beforeConfiguration,
        afterConfiguration
      );

    return {
      summary:
        `${comparison.added.length} added · ` +
        `${comparison.removed.length} removed · ` +
        `${comparison.modified.length} modified`,

      changeImpactHtml:
        buildChangeImpactHtml(
          comparison,
          beforeConfiguration,
          afterConfiguration,
          false
        )
    };
  }


  async function openReleaseNotes() {

    const entry =
      releaseEntries[Number(releaseVersionSelect.value)];

    if (!entry) {
      return;
    }

    releaseOpenButton.disabled =
      true;

    releaseStatusElement.textContent =
      "Preparing release notes...";

    try {

      const [currentConfiguration, previousConfiguration] =
        await Promise.all([
          entry.loadCurrent(),
          entry.loadPrevious
            ? entry.loadPrevious()
            : Promise.resolve(null)
        ]);

      const payload = {
        generatedAt: new Date().toLocaleString(),
        flowName: releaseFlowName,
        versionLabel: entry.versionLabel,
        previousLabel: entry.previousLabel,
        detail: entry.detail,
        firstPublish: !previousConfiguration,
        blockCount: extractActions(currentConfiguration).length,
        ...(previousConfiguration
          ? buildReleaseNotesBody(previousConfiguration, currentConfiguration)
          : {})
      };

      const response =
        await chrome.runtime.sendMessage({
          type: "FLOWLENZ_OPEN_RELEASE_NOTES",
          payload
        });

      if (!response?.success) {
        throw new Error(
          response?.error ||
            "Background could not open the release notes."
        );
      }

      releaseStatusElement.textContent =
        entry.detail ||
        entry.label;

    } catch (error) {

      console.error(
        "FlowLenZ release notes error:",
        error
      );

      releaseStatusElement.textContent =
        "Could not open release notes. Reload the extension and try again.";

    } finally {

      releaseOpenButton.disabled =
        releaseEntries.length === 0;
    }
  }


  function renderReleaseNotesPicker(
    context
  ) {

    const previousLabel =
      releaseEntries[Number(releaseVersionSelect.value)]?.label;

    releaseFlowName =
      context.flow?.name ||
      "";

    releaseEntries =
      buildReleaseEntries(
        context
      );

    releaseVersionSelect.innerHTML =
      releaseEntries
        .map(
          (entry, index) =>
            `<option value="${index}">${escapeHtml(entry.label)}</option>`
        )
        .join("");

    releaseVersionSelect.disabled =
      releaseEntries.length === 0;

    releaseOpenButton.disabled =
      releaseEntries.length === 0;

    if (releaseEntries.length === 0) {

      releaseStatusElement.textContent =
        "No published versions yet.";

      return;
    }

    const keptIndex =
      releaseEntries.findIndex(
        (entry) => entry.label === previousLabel
      );

    releaseVersionSelect.value =
      String(
        keptIndex >= 0
          ? keptIndex
          : releaseEntries.length - 1
      );

    updateReleaseStatus();
  }


  function updateReleaseStatus() {

    const entry =
      releaseEntries[Number(releaseVersionSelect.value)];

    releaseStatusElement.textContent =
      entry
        ? entry.detail || entry.label
        : "";
  }


  releaseVersionSelect.addEventListener(
    "change",
    updateReleaseStatus
  );


  releaseOpenButton.addEventListener(
    "click",
    () => {
      openReleaseNotes();
    }
  );


  function applyContext(
    context
  ) {

    if (
      context.flow &&
      context.flow.name
    ) {

      flowNameElement.textContent =
        context.flow.name;

    } else {

      flowNameElement.textContent =
        "Flow name unavailable";
    }


    publishedVersionElement.textContent =
      context.versions.publishedVersion
        ? `Published Version: ${context.versions.publishedVersion}`
        : "Published Version: Not found";


    publishedConfiguration =
      context.publishedConfiguration;


    renderReleaseNotesPicker(
      context
    );


    if (
      !context.hasSavedVersion
    ) {

      renderPublishedOnlyState();


      return;
    }


    const nextVersion =
      calculateNextVersion(
        context.versions
          .publishedVersion
      );


    savedVersionElement.textContent =
      nextVersion
        ? `Saved Version: ${nextVersion}`
        : "Saved Version: Detected";


    savedConfiguration =
      context.savedConfiguration;


    configStatusElement.textContent =
      "Configurations: Published Loaded | Saved Loaded";


    const comparison =
      compareActions(
        publishedConfiguration,
        savedConfiguration
      );


    renderChangeImpactAnalysis(
      comparison
    );


    updateVisualReportControls(
      comparison,
      {
        flowName:
          context.flow?.name ||
          "",

        publishedVersion:
          context.versions
            .publishedVersion ||
          "",

        savedVersion:
          nextVersion ||
          "Saved"
      }
    );


    const deltaRisks =
      getDeltaRisks(
        comparison
      );


    renderRiskValidation(
      deltaRisks
    );


    console.log(
      "FlowLenZ Changes:",
      comparison
    );


    console.log(
      "FlowLenZ Delta Risks:",
      deltaRisks
    );
  }


  /*
   * =====================================
   * REFRESH ON OPEN
   * =====================================
   */

  async function refreshOnOpen() {

    if (
      refreshInProgress
    ) {

      return;
    }


    refreshInProgress =
      true;


    try {

      refreshStatusElement.textContent =
        "Refresh: Loading current flow...";


      const context =
        await fetchCurrentContext();


      applyContext(
        context
      );


      refreshStatusElement.textContent =
        "Refresh: Updated on Open";

    } catch (
      error
    ) {

      console.error(
        "FlowLenZ open refresh error:",
        error
      );


      refreshStatusElement.textContent =
        "Refresh: Unable to update";

    } finally {

      refreshInProgress =
        false;
    }
  }


  /*
   * =====================================
   * REFRESH AFTER SAVE
   * =====================================
   */

  async function refreshAfterSave() {

    if (
      refreshInProgress
    ) {

      refreshQueued =
        true;


      return;
    }


    refreshInProgress =
      true;


    const previousFingerprint =
      savedConfiguration
        ? createFingerprint(
            savedConfiguration
          )
        : null;


    let latestContext =
      null;


    try {

      refreshStatusElement.textContent =
        "Refresh: Save detected...";


      for (
        const delay
        of SAVE_RETRY_DELAYS
      ) {

        if (
          delay > 0
        ) {

          refreshStatusElement.textContent =
            "Refresh: Waiting for saved configuration...";


          await sleep(
            delay
          );
        }


        latestContext =
          await fetchCurrentContext();


        if (
          !latestContext.hasSavedVersion
        ) {

          continue;
        }


        const latestFingerprint =
          createFingerprint(
            latestContext
              .savedConfiguration
          );


        if (
          previousFingerprint ===
          null
        ) {

          applyContext(
            latestContext
          );


          refreshStatusElement.textContent =
            "Refresh: Updated after Save";


          return;
        }


        if (
          latestFingerprint !==
          previousFingerprint
        ) {

          applyContext(
            latestContext
          );


          refreshStatusElement.textContent =
            "Refresh: Updated after Save";


          return;
        }
      }


      if (
        latestContext
      ) {

        applyContext(
          latestContext
        );
      }


      refreshStatusElement.textContent =
        "Refresh: Save completed";

    } catch (
      error
    ) {

      console.error(
        "FlowLenZ Save refresh error:",
        error
      );


      refreshStatusElement.textContent =
        "Refresh: Unable to update";

    } finally {

      refreshInProgress =
        false;


      if (
        refreshQueued
      ) {

        refreshQueued =
          false;


        refreshAfterSave();
      }
    }
  }


  /*
   * =====================================
   * EXTENSION EVENTS
   * =====================================
   */

  chrome.runtime.onMessage.addListener(
    (message) => {

      if (
        message &&
        message.type ===
          "TOGGLE_FLOWLENZ"
      ) {

        panel.classList.toggle(
          "flowlenz-hidden"
        );


        const isOpen =
          !panel.classList.contains(
            "flowlenz-hidden"
          );


        if (
          isOpen
        ) {

          refreshOnOpen();
        }


        return;
      }


      if (
        message &&
        message.type ===
          "ARCHITECT_SAVE_COMPLETED"
      ) {

        const currentFlowId =
          detectFlowId();


        if (
          message.flowId &&
          currentFlowId &&
          message.flowId
            .toLowerCase() !==
          currentFlowId
            .toLowerCase()
        ) {

          return;
        }


        if (
          panel.classList.contains(
            "flowlenz-hidden"
          )
        ) {

          return;
        }


        refreshAfterSave();
      }

    }
  );


  /*
   * =====================================
   * CHAT
   * =====================================
   */

  const input =
    root.querySelector(
      "#flowlenz-chat-input"
    );


  const sendButton =
    root.querySelector(
      "#flowlenz-send-button"
    );


  sendButton.addEventListener(
    "click",
    () => {

      const message =
        input.value.trim();


      if (
        !message
      ) {

        return;
      }


      console.log(
        "FlowLenZ question:",
        message
      );


      input.value =
        "";
    }
  );


  input.addEventListener(
    "keydown",
    (event) => {

      if (
        event.key ===
        "Enter"
      ) {

        sendButton.click();
      }
    }
  );

})();