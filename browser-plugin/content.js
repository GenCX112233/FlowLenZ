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

  const logoUrl = chrome.runtime.getURL("genesys-logo-flowlenz.png");
  const brandLogoUrl = chrome.runtime.getURL("FlowLenZ-logo-light.png");

  let publishedConfiguration = null;
  let savedConfiguration = null;

  let refreshInProgress = false;
  let refreshQueued = false;


  /*
   * =====================================
   * UI
   * =====================================
   */

  let panel, flowNameElement, publishedVersionElement, savedVersionElement,
    configStatusElement, refreshStatusElement, analysisSummaryElement,
    analysisDetailsElement, riskSummaryElement, riskDetailsElement,
    visualReportStatusElement, visualReportOpenButton, validationElement,
    releaseVersionSelect, releaseStatusElement, releaseOpenButton,
    customerImpactElement, customerImpactRegenerateButton;

  let lastCustomerImpactFacts = null;

  let lastComparison = null;
  let lastReportMeta = { flowName: "", publishedVersion: "", savedVersion: "" };

  let lastDeltaRisks = null;


  /*
   * =====================================
   * GENERAL HELPERS
   * =====================================
   */

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }


  function detectFlowId() {
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = window.location.href.match(uuidPattern);
    return match ? match[0] : null;
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
    if (value === undefined || value === null || String(value).trim() === "") {
      return "Empty";
    }

    let text = String(value).replace(/\s+/g, " ").trim();

    if (text.length > 55) {
      text = `${text.substring(0, 52)}...`;
    }

    return text;
  }


  function cleanVariableName(name) {
    if (!name) {
      return "Variable";
    }
    return String(name).replace(/^Task\./i, "").replace(/^Flow\./i, "");
  }


  /*
   * =====================================
   * VERSION HANDLING
   * =====================================
   */

  function getVersionIdentifier(version) {
    if (!version) return "";

    const candidates = [version.id, version.version, version.versionId, version.name];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.length > 0) return candidate;
      if (typeof candidate === "number") return String(candidate);
    }

    if (typeof version.configurationUri === "string") {
      const match = version.configurationUri.match(/\/versions\/([^/]+)\/configuration/i);
      if (match) return match[1];
    }

    return "";
  }


  function calculateNextVersion(publishedVersion) {

    if (!publishedVersion) {
      return null;
    }

    const majorVersion = parseInt(publishedVersion.split(".")[0], 10);

    if (Number.isNaN(majorVersion)) {
      return null;
    }


    return `${majorVersion + 1}.0`;
  }


  function analyseVersions(data) {
    let versions = [];

    if (Array.isArray(data)) {
      versions = data;
    } else if (data && Array.isArray(data.entities)) {
      versions = data.entities;
    }

    let savedVersionItem = null;
    let savedVersionId = null;
    const publishedVersions = [];


  for (const version of versions) {

      const identifier = getVersionIdentifier(version);
      const configurationUri = version.configurationUri || "";
      const combined = `${identifier} ${configurationUri}`;

      if (combined.includes("saved_version_")) {
        savedVersionItem = version;
        savedVersionId = identifier;
        continue;
      }

      if (identifier.match(/^\d+(?:\.\d+)?$/)) {
        publishedVersions.push({ identifier, version });
      }
    }


    publishedVersions.sort((a, b) => {
      const aParts = a.identifier.split(".").map(Number);
      const bParts = b.identifier.split(".").map(Number);
      const majorDifference = (bParts[0] || 0) - (aParts[0] || 0);
      if (majorDifference !== 0) {
        return majorDifference;
      }
      return (bParts[1] || 0) - (aParts[1] || 0);
    });

    const latestPublished = publishedVersions.length > 0 ? publishedVersions[0] : null;

    return {
      publishedVersion: latestPublished ? latestPublished.identifier : null,
      publishedVersionItem: latestPublished ? latestPublished.version : null,
      publishedVersions,
      savedVersionId,
      savedVersionItem
    };
  }


  async function loadConfiguration(configurationUri) {
    const response = await chrome.runtime.sendMessage({
      type: "GET_FLOW_CONFIGURATION",
      configurationUri
    });

    if (!response || !response.success) {
      throw new Error(response?.error || "Unable to load configuration");
    }

    return response.configuration;
  }


  async function fetchCurrentContext() {
    const flowId = detectFlowId();

    if (!flowId) {
      throw new Error("Could not detect flow ID from Architect URL.");
    }


    const detailsResponse = await chrome.runtime.sendMessage({ type: "GET_FLOW_DETAILS", flowId });

    if (!detailsResponse || !detailsResponse.success) {
      throw new Error(detailsResponse?.error || "Unable to load flow details.");
    }


    const versionsResponse = await chrome.runtime.sendMessage({ type: "GET_FLOW_VERSIONS", flowId });

    if (!versionsResponse || !versionsResponse.success) {
      throw new Error(versionsResponse?.error || "Unable to load flow versions.");
    }


    const analysed = analyseVersions(versionsResponse.versions);

    let publishedConfiguration = null;
    const publishedUri = analysed.publishedVersionItem?.configurationUri;

    if (publishedUri) {
      publishedConfiguration = await loadConfiguration(publishedUri);
    }

    const hasSavedVersion = Boolean(analysed.savedVersionItem);
    let savedConfiguration = null;

    if (hasSavedVersion) {
      const savedUri = analysed.savedVersionItem.configurationUri;
      if (savedUri) {
        savedConfiguration = await loadConfiguration(savedUri);
      }
    }

    return {
      flow: detailsResponse.flow,
      flowId,
      versions: {
        publishedVersion: analysed.publishedVersion,
        publishedVersions: analysed.publishedVersions,
        savedVersionId: analysed.savedVersionId
      },
      hasSavedVersion,
      publishedConfiguration,
      savedConfiguration
    };
  }


  /*
   * =====================================
   * NORMALIZATION
   * =====================================
   */

  function normalizeForComparison(value, options = {}) {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => normalizeForComparison(item, options));
    }

    if (typeof value !== "object") {
      return value;
    }

    const ignoredFields = new Set(["id", "dateCreated", "dateModified", "createdBy", "modifiedBy", "nextAction"]);
    const normalized = {};
    const keys = Object.keys(value).sort();

    for (const key of keys) {
      if (ignoredFields.has(key)) {
        continue;
      }
      if (key === "uiMetaData") {
        continue;
      }
      normalized[key] = normalizeForComparison(value[key], options);
    }

    return normalized;
  }


  function createFingerprint(value, options = {}) {
    return JSON.stringify(normalizeForComparison(value, options));
  }


  function objectsEqual(first, second) {
    return createFingerprint(first) === createFingerprint(second);
  }


  /*
   * =====================================
   * ARCHITECT OBJECT DETECTION
   * =====================================
   */

  function isArchitectAction(object) {
    if (!object || typeof object !== "object" || Array.isArray(object)) {
      return false;
    }
    const type = object.__type;
    if (typeof type !== "string") {
      return false;
    }
    return type === "Action" || type.endsWith("Action");
  }


  function isArchitectTask(object) {
    return object && typeof object === "object" && !Array.isArray(object) && object.__type === "Task";
  }


  function getActionName(action) {
    if (action?.name && typeof action.name === "string") {
      return action.name;
    }
    if (action?.label && typeof action.label === "string") {
      return action.label;
    }
    if (action?.__type) {
      return action.__type;
    }
    return "Unnamed Action";
  }


  function getTaskName(task) {
    if (task?.name && typeof task.name === "string") {
      return task.name;
    }
    return "Unnamed Task";
  }


  function getFriendlyActionType(action) {
    const type = action?.__type || "";
    const typeNames = {
      UpdateVariableAction: "Update Data",
      PlayAudioAction: "Play Audio",
      SetAttributesAction: "Set Participant Data",
      TransferPureMatchAction: "Transfer to ACD",
      DecisionAction: "Decision",
      SwitchAction: "Switch",
      LoopAction: "Loop",
      DataAction: "Call Data Action",
      CallDataAction: "Call Data Action",
      SetLocaleAction: "Set Language",
      DialExtensionAction: "Dial By Extension"
    };
    return typeNames[type] || "";
  }


  function getTrackingId(item) {
    const trackingId = item?.trackingId;
    if (trackingId === undefined || trackingId === null || String(trackingId).trim() === "") {
      return "";
    }
    return String(trackingId);
  }


  function getDisplayActionName(item) {
    const object = item.object || item.action;

    if (item.kind === "task") {
      const taskName = item.name || getTaskName(object);
      const trackingId = getTrackingId(object);
      return trackingId ? `${trackingId} ${taskName}` : taskName;
    }

    const name = item.name || getActionName(object);
    const friendlyType = getFriendlyActionType(object);
    let displayName = String(name).trim();

    if (friendlyType) {
      const lowerName = displayName.toLowerCase();
      const lowerType = friendlyType.toLowerCase();
      if (!(lowerName === lowerType || lowerName.startsWith(`${lowerType} `) || lowerName.startsWith(`${lowerType}-`))) {
        displayName = `${friendlyType} - ${displayName}`;
      }
    }

    const trackingId = getTrackingId(object);
    return trackingId ? `${trackingId} ${displayName}` : displayName;
  }


  /*
   * =====================================
   * ACTION / TASK EXTRACTION
   * =====================================
   */

  function extractActions(configuration) {
    const items = [];
    const taskList = Array.isArray(configuration?.flowSequenceItemList) ? configuration.flowSequenceItemList : [];
    const initialSequence = configuration?.initialSequence || "";

    for (const task of taskList) {
      if (!isArchitectTask(task)) {
        continue;
      }
      if (String(task.id) === String(initialSequence)) {
        continue;
      }
      items.push({
        kind: "task",
        object: task,
        task,
        name: getTaskName(task),
        type: "ReusableTask",
        path: "flowSequenceItemList"
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


    walk(configuration, "flow");

    const unique = [];
    const seenTasks = new Set();

    for (const item of items) {
      if (item.kind !== "task") {
        unique.push(item);
        continue;
      }
      const taskId = item.object?.id;
      const key = taskId ? `TASK:${taskId}` : `TASKNAME:${item.name}`;
      if (seenTasks.has(key)) {
        continue;
      }
      seenTasks.add(key);
      unique.push(item);
    }

    return unique;
  }


function getActionKey(item) {
  const object = item.object || item.action;

  if (item.kind === "task") {
    return object?.id ? `TASK-ID:${object.id}` : `TASK-NAME:${item.name}`;
  }

  const candidates = [object?.id, object?.actionId, object?.key];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return `ID:${candidate}`;
    }
  }

  return `TYPE:${item.type}|NAME:${item.name}`;
}


function buildActionMap(items) {
  const map = new Map();

  for (const item of items) {
    const baseKey = getActionKey(item);
    let key = baseKey;
    let occurrence = 1;

    while (map.has(key)) {
      occurrence++;
      key = `${baseKey}|${occurrence}`;
    }

    map.set(key, item);
  }

  return map;
}


/*
 * =====================================
 * MEANINGFUL ACTION COMPARISON
 * =====================================
 */

function getMeaningfulObject(item) {
  const object = item?.object || item?.action || {};
  const normalized = normalizeForComparison(object);

  if (normalized && typeof normalized === "object") {
    delete normalized.id;
    delete normalized.trackingId;
  }

  return normalized;
}


function collectMeaningfulDifferences(
  before,
  after,
  path,
  out
) {

  if (out.length >= 20) {
    return out;
  }

  const bothObjects =
    before && after &&
    typeof before === "object" &&
    typeof after === "object";

  if (!bothObjects) {

    if (JSON.stringify(before) !== JSON.stringify(after)) {
      out.push({
        path: path || "(root)",
        before: JSON.stringify(before)?.slice(0, 200),
        after: JSON.stringify(after)?.slice(0, 200)
      });
    }

    return out;
  }

  const keys =
    new Set([
      ...Object.keys(before),
      ...Object.keys(after)
    ]);

  for (const key of keys) {
    collectMeaningfulDifferences(
      before[key],
      after[key],
      Array.isArray(before) ? `${path}[${key}]` : (path ? `${path}.${key}` : key),
      out
    );
  }

  return out;
}


function logModifiedDifferences(comparison) {
  for (const entry of comparison.modified) {
    console.log(
      `FlowLenZ diff: ${getDisplayActionName(entry.after)}`,
      collectMeaningfulDifferences(getMeaningfulObject(entry.before), getMeaningfulObject(entry.after), "", [])
    );
  }
}


function getMeaningfulFingerprint(item) {
  return JSON.stringify(getMeaningfulObject(item));
}


function meaningfulObjectsEqual(firstItem, secondItem) {
  return getMeaningfulFingerprint(firstItem) === getMeaningfulFingerprint(secondItem);
}


/*
 * =====================================
 * CHANGE DETAILS
 * =====================================
 */

function getQueueNames(action) {
  if (!action || !Array.isArray(action.queues)) {
    return [];
  }

  return action.queues
    .map((queue) => {
      if (typeof queue?.text === "string" && queue.text.trim()) {
        return queue.text.trim();
      }
      const configText = queue?.config?.lit?.text;
      if (typeof configText === "string" && configText.trim()) {
        return configText.trim();
      }
      return "";
    })
    .filter(Boolean)
    .sort();
}


function getVariableName(entry) {
  const directName = entry?.variable?.text;
  if (typeof directName === "string" && directName.trim()) {
    return directName.trim();
  }
  const refName = entry?.variable?.config?.ref?.text;
  if (typeof refName === "string" && refName.trim()) {
    return refName.trim();
  }
  return "";
}


function getExpressionText(entry) {
  const expression = entry?.expression;
  if (!expression) {
    return "";
  }
  if (typeof expression.text === "string") {
    return expression.text.trim();
  }
  const literalText = expression?.config?.lit?.text;
  if (literalText !== undefined && literalText !== null) {
    return String(literalText).trim();
  }
  const refText = expression?.config?.ref?.text;
  if (typeof refText === "string") {
    return refText.trim();
  }
  return "";
}


function getConfiguredReferenceText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : "";
  }
  if (typeof value !== "object") {
    return "";
  }
  if (typeof value.text === "string" && value.text.trim()) {
    return value.text.trim();
  }
  const refText = value?.config?.ref?.text;
  if (typeof refText === "string" && refText.trim()) {
    return refText.trim();
  }
  const litText = value?.config?.lit?.text;
  if (litText !== undefined && litText !== null) {
    const literal = String(litText).trim();
    if (literal) {
      return literal;
    }
  }
  if (typeof value.name === "string" && value.name.trim()) {
    return value.name.trim();
  }
  return "";
}


function getUpdateDataMap(action) {
  const map = new Map();

  if (!action || !Array.isArray(action.variables)) {
    return map;
  }

  for (const entry of action.variables) {
    const variableName = getVariableName(entry);
    if (!variableName) {
      continue;
    }
    map.set(variableName, {
      expression: getExpressionText(entry),
      fingerprint: createFingerprint(entry.expression)
    });
  }

  return map;
}


function getUpdateDataChanges(beforeAction, afterAction) {
  const beforeMap = getUpdateDataMap(beforeAction);
  const afterMap = getUpdateDataMap(afterAction);
  const variableNames = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes = [];

  for (const variableName of variableNames) {
    const before = beforeMap.get(variableName);
    const after = afterMap.get(variableName);

    if (!before && after) {
      const expression = formatCompactValue(after.expression);
      changes.push(
        expression === "Empty"
          ? `${cleanVariableName(variableName)} added`
          : `${cleanVariableName(variableName)} added: ${expression}`
      );
      continue;
    }

    if (before && !after) {
      changes.push(`${cleanVariableName(variableName)} removed`);
      continue;
    }

    if (before && after && before.fingerprint !== after.fingerprint) {
      changes.push(
        `${cleanVariableName(variableName)}: ` +
        `${formatCompactValue(before.expression)}` +
        ` → ` +
        `${formatCompactValue(after.expression)}`
      );
    }
  }

  if (changes.length > 2) {
    const remaining = changes.length - 2;
    return [changes[0], changes[1], `+${remaining} more data change${remaining > 1 ? "s" : ""}` ];
  }

  return changes;
}


function getConciseChanges(beforeItem, afterItem) {
  if (afterItem.kind === "task") {
    return ["Reusable task configuration changed"];
  }

  const beforeAction = beforeItem.object || beforeItem.action;
  const afterAction = afterItem.object || afterItem.action;
  const beforeName = beforeAction?.name || "";
  const afterName = afterAction?.name || "";

  if (beforeName !== afterName) {
    return [`Name: ${beforeName || "None"} → ${afterName || "None"}`];
  }

  if (afterAction.__type === "UpdateVariableAction") {
    const dataChanges = getUpdateDataChanges(beforeAction, afterAction);
    if (dataChanges.length > 0) {
      return dataChanges;
    }
    return ["Update Data configuration changed"];
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


  if (afterAction.__type === "SetAttributesAction") {
    return ["Participant data changed"];
  }

  if (afterAction.__type === "DecisionAction") {
    return ["Decision logic changed"];
  }

  if (afterAction.__type === "SwitchAction") {
    return ["Switch logic changed"];
  }

  if (afterAction.__type === "LoopAction") {
    return ["Loop configuration changed"];
  }

  if (afterAction.__type === "DataAction" || afterAction.__type === "CallDataAction") {
    return ["Data Action configuration changed"];
  }

  if (afterAction.__type === "SetLocaleAction") {
    return ["Language changed"];
  }

  if (afterAction.__type === "DialExtensionAction") {
    return ["Extension routing changed"];
  }

  return ["Configuration changed"];
}


/*
 * =====================================
 * COMPARE PUBLISHED VS SAVED
 * =====================================
 */

function compareActions(publishedConfig, savedConfig) {
  const publishedItems = extractActions(publishedConfig);
  const savedItems = extractActions(savedConfig);
  const publishedMap = buildActionMap(publishedItems);
  const savedMap = buildActionMap(savedItems);
  const added = [];
  const removed = [];
  const modified = [];

  for (const [key, savedItem] of savedMap) {
    if (!publishedMap.has(key)) {
      added.push(savedItem);
      continue;
    }
    const publishedItem = publishedMap.get(key);
    if (!meaningfulObjectsEqual(publishedItem, savedItem)) {
      modified.push({
        before: publishedItem,
        after: savedItem,
        details: getConciseChanges(publishedItem, savedItem)
      });
    }
  }

  for (const [key, publishedItem] of publishedMap) {
    if (!savedMap.has(key)) {
      removed.push(publishedItem);
    }
  }

  return { added, removed, modified };
}


/*
 * =====================================
 * STEP 9
 * CHANGE IMPACT ANALYSIS
 * =====================================
 */

function getBranchPaths(action) {
  if (!action) {
    return [];
  }
  if (Array.isArray(action.paths)) {
    return action.paths;
  }
  if (Array.isArray(action.cases)) {
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
    changedBranches: 0,
    addedBlocks: 0,
    newOnAddedBlocks: 0,
    newOnExisting: [],
    rerouted: [],
    removedBlocks: 0,
    removedWithBlocks: 0,
    removedOnExisting: []
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
      impact.newOnAddedBlocks += labels.length;
      impact.addedBlocks++;
      continue;
    }

    const previousLabels = getBranchLabels(previous);
    const name = getBranchBlockName(block.action);
    const added = [];
    const rerouted = [];

    for (const label of labels) {

      if (!previousLabels.includes(label)) {
        added.push(label);
      } else if ((previous.targets.get(label) || "") !== (block.targets.get(label) || "")) {
        rerouted.push(label);
      }
    }

    const removed = previousLabels.filter(
      (label) => !labels.includes(label)
    );

    impact.newBranches += added.length;
    impact.changedBranches += rerouted.length;
    impact.removedBranches += removed.length;

    if (added.length) impact.newOnExisting.push({ name, labels: added });
    if (rerouted.length) impact.rerouted.push({ name, labels: rerouted });
    if (removed.length) impact.removedOnExisting.push({ name, labels: removed });
  }

  for (const [key, block] of before) {

    if (!after.has(key)) {
      const count = getBranchLabels(block).length;
      impact.removedBranches += count;
      impact.removedWithBlocks += count;
      impact.removedBlocks++;
    }
  }

  return impact;
}


function getBranchBlockName(action) {

  return getDisplayActionName({
    kind: "action",
    object: action,
    action,
    name: getActionName(action),
    type: action.__type
  });
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


const REFERENCE_SKIP_KEYS =
  new Set([
    "paths",
    "cases",
    "actions",
    "outputs",
    "nextAction",
    "nextActionId",
    "uiMetaData",
    "__type",
    "id"
  ]);


/*
 * Every named reference inside one block (not its branches):
 * [{ path: "dataAction.config.ref", text: "Get Account" }, ...]
 */
function collectActionReferences(
  action
) {

  const refs = [];
  const seen = new Set();

  const push = (path, text) => {
    const value = typeof text === "string" ? text.trim() : "";
    const key = `${path}|${value}`;
    if (!value || seen.has(key)) return;
    seen.add(key);
    refs.push({ path, text: value });
  };

  const visit = (value, path, depth) => {

    if (!value || typeof value !== "object" || depth > 6 || refs.length > 80) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`, depth + 1));
      return;
    }

    if (depth > 0 && isArchitectAction(value)) {
      return;
    }

    if (depth > 0) {
      push(path, value.text);
      push(`${path}.lit`, value.config?.lit?.text);
      push(`${path}.ref`, value.config?.ref?.text);

      if (value.id && typeof value.name === "string") {
        push(`${path}.name`, value.name);
      }
    }

    for (const [key, child] of Object.entries(value)) {

      if (REFERENCE_SKIP_KEYS.has(key)) {
        continue;
      }

      const childPath = path ? `${path}.${key}` : key;

      if (typeof child === "string" && depth > 0 && /name$/i.test(key)) {
        push(childPath, child);
      } else if (typeof child === "string" && depth === 0 && /name$/i.test(key) && key !== "name") {
        push(childPath, child);
      } else {
        visit(child, childPath, depth + 1);
      }
    }
  };

  visit(action, "", 0);

  return refs;
}


function findReferenceTexts(refs, include, exclude) {
  return [
    ...new Set(
      refs
        .filter((ref) => include.test(ref.path) && !(exclude && exclude.test(ref.path)))
        .map((ref) => ref.text)
    )
  ];
}


function cleanPromptText(text) {
  const names = [...String(text).matchAll(/Prompt\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);

  for (const match of String(text).matchAll(/ToAudioTTS\(\s*"([^"]*)"/gi)) {
    names.push(`TTS "${match[1].slice(0, 50)}${match[1].length > 50 ? "…" : ""}"`);
  }

  if (names.length > 0) {
    return names;
  }

  // Audio options such as ', false, true' are playback flags, not prompt names.
  const cleaned = String(text).replace(/,\s*(true|false)\b/gi, "").trim();

  if (!cleaned || /^(true|false|-?\d+(\.\d+)?)$/i.test(cleaned)) {
    return [];
  }

  return [cleaned.length > 60 ? `${cleaned.slice(0, 60)}…` : cleaned];
}


function getPlayAudioReferences(action) {
  if (!action) {
    return [];
  }
  const texts = findReferenceTexts(
    collectActionReferences(action),
    /prompt|audio|tts|media|file|playlist/i
  );
  return [...new Set(texts.flatMap(cleanPromptText))].sort();
}


function getPlayAudioReferenceText(action) {
  return getPlayAudioReferences(action).join(", ");
}


function getDataActionReferenceLabel(action) {
  if (!action) {
    return "Data Action";
  }
  const refs = collectActionReferences(action);
  const name = findReferenceTexts(refs, /dataAction|actionName|actionRef|(^|\.)action(\.|$)/i, /integration|category|input/i)[0] || "";
  if (name) {
    return name;
  }
  return (
    getConfiguredReferenceText(action.integration) ||
    getConfiguredReferenceText(action.category) ||
    findReferenceTexts(refs, /integration|category/i)[0] ||
    getActionName(action)
  );
}


function getFlowDependencyKind(action, path) {
  const type = String(action?.__type || "");
  if (/inQueue/i.test(path)) return "In-queue flow";
  if (/Bot/i.test(type) || /bot/i.test(path)) return "Bot flow";
  if (/CommonModule/i.test(type) || /module/i.test(path)) return "Common module";
  if (/Secure/i.test(type)) return "Secure flow";
  return "Flow";
}


/*
 * Flows this block calls or hands off to (bot flows, common modules,
 * transfer-to-flow, in-queue flows), as "Kind: Name" labels.
 */
function getFlowReferences(action) {
  if (!action) {
    return [];
  }
  const refs = collectActionReferences(action).filter(
    (ref) => /flow|bot|module/i.test(ref.path) && !/variable|input/i.test(ref.path)
  );
  return [...new Set(refs.map((ref) => `${getFlowDependencyKind(action, ref.path)}: ${ref.text}`))].sort();
}


const VARIABLE_TOKEN =
  /\b(?:Task|Flow|State)\.[A-Za-z_][A-Za-z0-9_]*/g;


/*
 * Variables a block touches: `written` = in assignment/output positions,
 * `all` = anywhere in the block (excluding its branches).
 */
function getBlockVariableUse(action) {
  const written = new Set();
  const all = new Set();

  const visit = (value, path, depth) => {
    if (value === null || value === undefined || depth > 8) {
      return;
    }
    if (typeof value === "string") {
      for (const match of value.matchAll(VARIABLE_TOKEN)) {
        all.add(match[0]);
        if (/variable|output|result|assign/i.test(path)) {
          written.add(match[0]);
        }
      }
      return;
    }
    if (typeof value !== "object") {
      return;
    }
    if (depth > 0 && isArchitectAction(value)) {
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (!["paths", "cases", "actions", "nextAction", "nextActionId", "uiMetaData"].includes(key)) {
        visit(child, path ? `${path}.${key}` : key, depth + 1);
      }
    }
  };

  visit(action, "", 0);
  return { written, all };
}


/*
 * Blocks that call another flow (bot flow, common module, ...) whose inputs
 * read a variable set by a changed block — the called flow receives different
 * data even though the calling block itself was not edited.
 */
function addFlowInputDependencies(comparison, afterConfiguration, addResourceLine, setBlockName) {
  if (!afterConfiguration) {
    return;
  }

  const changedVariables = new Map();

  const recordWrites = (item) => {

    const object = item?.object || item?.action;

    if (!object || item.kind !== "action") {
      return;
    }

    for (const variable of getBlockVariableUse(object).written) {
      if (!changedVariables.has(variable)) {
        changedVariables.set(variable, getBranchBlockName(object));
      }
    }
  };

  comparison.added.forEach(recordWrites);
  comparison.removed.forEach(recordWrites);
  comparison.modified.forEach((change) => {
    recordWrites(change.before);
    recordWrites(change.after);
  });

  if (changedVariables.size === 0) {
    return;
  }

  for (const item of extractActions(afterConfiguration)) {

    if (item.kind !== "action") {
      continue;
    }

    const flows = getFlowReferences(item.object);

    if (flows.length === 0) {
      continue;
    }

    const used = getBlockVariableUse(item.object).all;

    const blockName = getBranchBlockName(item.object);

    const inputs = [...changedVariables.entries()].filter(
      ([variable, changedBy]) => used.has(variable) && changedBy !== blockName
    );

    if (inputs.length === 0) {
      continue;
    }

    setBlockName(blockName);

    for (const flow of flows) {
      for (const [variable, changedBy] of inputs) {
        addResourceLine(
          "flows",
          `~ ${flow} (input ${variable} changed${changedBy ? ` in ${changedBy}` : ""})`
        );
      }
    }
  }

  setBlockName("");
}


function analyzeDependencyImpact(comparison, afterConfiguration = savedConfiguration) {
  const dependencyGroups = {
    queues: new Set(),

    dataActions: new Set(),
    promptsAudio: new Set(),
    flows: new Set(),
    reusableTasks: new Set()
  };

  let currentBlockName = "";

  // "+ Queue: X" → "+ 18 Transfer to ACD — Queue: X" (block name as in Affected Blocks).
  function addResourceLine(group, line) {
    dependencyGroups[group].add(
      currentBlockName && /^[+\-~] /.test(line)
        ? `${line.slice(0, 2)}${currentBlockName} — ${line.slice(2)}`
        : line
    );
  }


  /*
   * Added / removed blocks list every reference; modified blocks list only
   * references that appeared or disappeared (or "configuration changed" when
   * the same references remain and reportUnchanged is set).
   */
  function addListDependencies(
    group,
    prefix,
    beforeList,
    afterList,
    changeType,
    reportUnchanged
  ) {

    if (changeType === "Added") {
      afterList.forEach((name) => addResourceLine(group, `+ ${prefix}${name}`));
      return;
    }

    if (changeType === "Removed") {
      afterList.forEach((name) => addResourceLine(group, `- ${prefix}${name}`));
      return;
    }

    const added = afterList.filter((name) => !beforeList.includes(name));
    const removed = beforeList.filter((name) => !afterList.includes(name));

    added.forEach((name) => addResourceLine(group, `+ ${prefix}${name}`));
    removed.forEach((name) => addResourceLine(group, `- ${prefix}${name}`));

    if (!added.length && !removed.length && reportUnchanged) {
      addResourceLine(
        group,
        afterList.length
          ? `~ ${prefix}${afterList.join(", ")} (configuration changed)`
          : `~ ${prefix || "Configuration"} changed`
      );
    }
  }


  function logDependencyReferences(object) {
    console.log(
      `FlowLenZ dependency refs: ${getBranchBlockName(object)}`,
      collectActionReferences(object)
    );
  }


  function addActionDependency(item, changeType, beforeItem) {
    currentBlockName = getDisplayActionName(item);

    if (item.kind === "task") {
      const taskName = getTaskName(item.object || item.task);
      if (changeType === "Added") {
        addResourceLine("reusableTasks", `+ Reusable task: ${taskName}`);
      } else if (changeType === "Removed") {
        addResourceLine("reusableTasks", `- Reusable task: ${taskName}`);
      } else {
        addResourceLine("reusableTasks", `~ Reusable task: ${taskName} (configuration changed)`);
      }
      return;
    }

    if (item.kind !== "action") {
      return;
    }

    const object = item.object;
    const beforeObject = beforeItem?.object || beforeItem?.action;

    addListDependencies("flows", "", getFlowReferences(beforeObject), getFlowReferences(object), changeType, false);

    if (object?.__type === "PlayAudioAction") {
      addListDependencies("promptsAudio", "Prompt: ", getPlayAudioReferences(beforeObject), getPlayAudioReferences(object), changeType, true);
      logDependencyReferences(object);
      return;
    }

    if (isDataActionType(object)) {
      const label = getDataActionReferenceLabel(object);
      if (changeType === "Added") {
        addResourceLine("dataActions", `+ Data Action: ${label}`);
      } else if (changeType === "Removed") {
        addResourceLine("dataActions", `- Data Action: ${label}`);
      } else {
        const beforeLabel = getDataActionReferenceLabel(beforeObject);
        addResourceLine(
          "dataActions",
          beforeLabel !== label
            ? `~ Data Action: ${beforeLabel} → ${label}`
            : `~ Data Action: ${label} (configuration changed)`
        );
      }
      logDependencyReferences(object);
      return;
    }

    if (object?.__type === "TransferPureMatchAction") {
      let beforeQueues = [];
      let afterQueues = [];

      if (changeType === "Modified") {
        const beforeAction = beforeItem?.object || beforeItem?.action;


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


        const beforeLabel = beforeQueues.length > 0 ? beforeQueues.join(", ") : "None";
        const afterLabel = afterQueues.length > 0 ? afterQueues.join(", ") : "None";
        addResourceLine("queues", `~ Queue routing: ${beforeLabel} → ${afterLabel}`);
        return;
      }

      if (changeType === "Added") {
        afterQueues = getQueueNames(object);
        for (const queue of afterQueues) {
          addResourceLine("queues", `+ Queue: ${queue}`);
        }
        return;
      }

      beforeQueues = getQueueNames(object);
      for (const queue of beforeQueues) {
        addResourceLine("queues", `- Queue: ${queue}`);
      }
    }
  }


  comparison.added.forEach((item) => addActionDependency(item, "Added"));
  comparison.removed.forEach((item) => addActionDependency(item, "Removed"));
  comparison.modified.forEach((change) => addActionDependency(change.after, "Modified", change.before));

  addFlowInputDependencies(comparison, afterConfiguration, addResourceLine, (blockName) => {
    currentBlockName = blockName;
  });

  return dependencyGroups;
}


function renderBulletLines(lines) {
  return lines
    .map((line) => {
      const text = String(line);
      const marker = /^[+\-~]\s/.test(text) ? "" : "• ";
      return `<div style="padding-left: 12px; text-indent: -12px;">${marker}${escapeHtml(text)}</div>`;
    })
    .join("");
}


function formatBranchImpactLines(impact) {
  const plural = (count, word) =>
    `${count} ${word}${count === 1 ? "" : word.endsWith("ch") ? "es" : "s"}`;

  const describeBlocks = (entries) => {
    const shown = entries.slice(0, 3).map((entry) => `${entry.labels.join(", ")} on ${entry.name}`);
    if (entries.length > 3) shown.push(`+${entries.length - 3} more`);
    return shown.join("; ");
  };

  const lines = [];

  if (impact.newBranches > 0) {

    const parts = [];

    if (impact.newOnAddedBlocks > 0) {
      const count = impact.newOnAddedBlocks === impact.newBranches ? "" : `${impact.newOnAddedBlocks} `;
      parts.push(`${count}from ${plural(impact.addedBlocks, "added block")}`);
    }

    if (impact.newOnExisting?.length) {
      parts.push(describeBlocks(impact.newOnExisting));
    }

    lines.push(
      `${plural(impact.newBranches, "new branch")}` +
      (parts.length ? ` — ${parts.join("; ")}` : "")
    );
  }

  if (impact.changedBranches > 0) {
    lines.push(
      `${plural(impact.changedBranches, "existing branch")} rerouted` +
      (impact.rerouted?.length ? ` — ${describeBlocks(impact.rerouted)}` : "")
    );
  }

  if (impact.removedBranches > 0) {

    const parts = [];

    if (impact.removedWithBlocks > 0) {
      const count = impact.removedWithBlocks === impact.removedBranches ? "" : `${impact.removedWithBlocks} `;
      parts.push(`${count}with ${plural(impact.removedBlocks, "removed block")}`);
    }

    if (impact.removedOnExisting?.length) {
      parts.push(describeBlocks(impact.removedOnExisting));
    }

    lines.push(
      `${plural(impact.removedBranches, "branch")} removed` +
      (parts.length ? ` — ${parts.join("; ")}` : "")
    );
  }

  return lines.length > 0
    ? lines
    : ["No branch impact detected"];
}


function renderDependencyImpactContent(comparison, afterConfiguration = savedConfiguration) {
  const dependencyImpact = analyzeDependencyImpact(comparison, afterConfiguration);


  const dependencySections =
    [];


  function renderDependencyGroup(
    title,
    lineSet
  ) {

    if (!lineSet || lineSet.size === 0) {
      return;
    }

    const values = renderBulletLines(Array.from(lineSet).sort());

    dependencySections.push(
      `<div>` +
      `<div style="padding-left: 24px;"><strong>${escapeHtml(title)}</strong></div>` +
      `<div style="padding-left: 24px;">${values}</div>` +
      `</div>`
    );
  }

  renderDependencyGroup("Queues", dependencyImpact.queues);
  renderDependencyGroup("Data Actions", dependencyImpact.dataActions);
  renderDependencyGroup("Prompts / Audio", dependencyImpact.promptsAudio);
  renderDependencyGroup("Flows", dependencyImpact.flows);
  renderDependencyGroup("Reusable Tasks", dependencyImpact.reusableTasks);

  if (dependencySections.length === 0) {
    return `<div style="padding-left: 24px;">${renderBulletLines(["No dependency impact detected"])}</div>`;
  }

  return dependencySections.join("");
}


/*
 * Step 9C — Potential regression (delta-only test focus).
 */
function analyzePotentialRegression(comparison) {
  const lines = new Set();

  function addLine(line) {
    lines.add(line);
  }

  function addTestsForItem(item, changeType) {
    if (item.kind === "task") {
      const taskName = getTaskName(item.object || item.task);
      if (changeType === "Added") {
        addLine(`Test reusable task entry and exit: ${taskName}`);
      } else if (changeType === "Removed") {
        addLine(`Test flows that previously used reusable task: ${taskName}`);
      } else {
        addLine(`Retest reusable task behavior: ${taskName}`);
      }
      return;
    }

    if (item.kind !== "action") {
      return;
    }

    const object = item.object;
    const blockLabel = getDisplayActionName(item);
    const actionType = object?.__type || "";

    if (actionType === "DecisionAction") {
      addLine(
        changeType === "Added"
          ? `Test new Decision Yes/No paths and downstream routing: ${blockLabel}`
          : changeType === "Removed"
            ? `Test journeys that used removed Decision: ${blockLabel}`
            : `Retest Decision Yes/No paths and conditions: ${blockLabel}`
      );
      return;
    }

    if (actionType === "SwitchAction") {
      addLine(
        changeType === "Added"
          ? `Test all new Switch paths and default routing: ${blockLabel}`
          : changeType === "Removed"
            ? `Test journeys that used removed Switch: ${blockLabel}`
            : `Retest all Switch paths and case routing: ${blockLabel}`
      );
      return;
    }

    if (actionType === "LoopAction") {
      addLine(
        changeType === "Added"
          ? `Test loop count, exit, and body actions: ${blockLabel}`
          : changeType === "Removed"
            ? `Test journeys that depended on removed Loop: ${blockLabel}`
            : `Retest loop iterations and body behavior: ${blockLabel}`
      );
      return;
    }

    if (actionType === "TransferPureMatchAction") {
      const queues = getQueueNames(object).join(", ") || "configured queue";
      addLine(
        changeType === "Added"
          ? `Test Transfer to ACD routing to queue: ${queues}`
          : changeType === "Removed"
            ? `Test customer paths after removed Transfer (queue: ${queues})`
            : `Retest Transfer to ACD queue routing: ${queues}`
      );
      return;
    }

    if (actionType === "PlayAudioAction") {
      const promptRef = getPlayAudioReferenceText(object);
      const promptPart = promptRef ? ` (${promptRef})` : "";
      addLine(
        changeType === "Added"
          ? `Test Play Audio playback${promptPart}`
          : changeType === "Removed"
            ? `Test journeys after removed Play Audio${promptPart}`
            : `Retest Play Audio prompt and playback${promptPart}`
      );
      return;
    }

    if (isDataActionType(object)) {
      const label = getDataActionReferenceLabel(object);
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


    addTestsForItem(afterItem, "Modified");
  }

  for (const item of comparison.added) {
    addTestsForItem(item, "Added");
  }

  for (const item of comparison.removed) {
    addTestsForItem(item, "Removed");
  }

  for (const change of comparison.modified) {
    addTestsForModified(change);
  }

  return lines;
}


function renderPotentialRegressionContent(comparison) {
  const lines = analyzePotentialRegression(comparison);

  if (lines.size === 0) {
    return `<div style="padding-left: 24px;">${renderBulletLines(["No additional regression tests recommended"])}</div>`;
  }

  return `<div style="padding-left: 24px;">` + renderBulletLines(Array.from(lines).sort()) + `</div>`;
}


// Text-safe shades of the Visual Change Report legend colours.
const CHANGE_COLORS = {
  added: "#1e7e34",
  modified: "#e8590c",
  removed: "#c82333"
};

const SEVERITY_COLORS = {
  High: "#c82333",
  Medium: "#e8590c",
  Low: "#1e7e34"
};


function colorText(html, color) {
  return color ? `<span style="color: ${color};">${html}</span>` : html;
}


function renderChangeScope(comparison) {
  const sections = [];

  /*
   * Added
   */
  if (comparison.added.length > 0) {
    const values = comparison.added
      .map((item) => `${colorText("+", CHANGE_COLORS.added)} ${escapeHtml(getDisplayActionName(item))}`)
      .join("<br>");
    sections.push(
      `<div>` +
      `<div style="padding-left: 24px;"><strong style="color: ${CHANGE_COLORS.added};">Added</strong></div>` +
      `<div style="padding-left: 24px;">${values}</div>` +
      `</div>`
    );
  }

  /*
   * Removed
   */
  if (comparison.removed.length > 0) {
    const values = comparison.removed
      .map((item) => `${colorText("-", CHANGE_COLORS.removed)} ${escapeHtml(getDisplayActionName(item))}`)
      .join("<br>");
    sections.push(
      `<div>` +
      `<div style="padding-left: 24px;"><strong style="color: ${CHANGE_COLORS.removed};">Removed</strong></div>` +
      `<div style="padding-left: 24px;">${values}</div>` +
      `</div>`
    );
  }

  /*
   * Modified
   */
  if (comparison.modified.length > 0) {
    const values = comparison.modified
      .map((item) => {
        const header = `${colorText("~", CHANGE_COLORS.modified)} ${escapeHtml(getDisplayActionName(item.after))}`;
        const details = item.details.map((detail) => escapeHtml(detail)).join("<br>");
        return (
          `<div>` +
          `<div>${header}</div>` +
          `<div style="padding-left: 24px;">${details}</div>` +
          `</div>`
        );
      })
      .join("");
    sections.push(
      `<div>` +
      `<div style="padding-left: 24px;"><strong style="color: ${CHANGE_COLORS.modified};">Modified</strong></div>` +
      `<div style="padding-left: 24px;">${values}</div>` +
      `</div>`
    );
  }

  if (sections.length === 0) {
    return `<div style="padding-left: 24px;">${renderBulletLines(["No blocks are impacted"])}</div>`;
  }

  return sections.join("");
}


function renderChangeImpactAnalysis(comparison) {
  if (!comparison) {
    analysisSummaryElement.innerHTML = `<div style="margin-top: 1em;"><strong>Affected Blocks</strong></div>`;
    analysisDetailsElement.innerHTML = "<div>Waiting for comparison...</div>";
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
    comparison,
    afterConfiguration
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

function pathHasConfiguredAction(path) {
  if (!path || typeof path !== "object") {
    return false;
  }

  const candidates = [path.nextActionId, path.nextAction, path.startAction, path.actionId];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return true;
    }
  }

  if (Array.isArray(path.actions) && path.actions.length > 0) {
    return true;
  }

  return false;
}


function getLiteralBoolean(expression) {
  const literal = expression?.config?.lit;

  if (!literal || literal.type !== "bln") {
    return null;
  }

  const rawValue = literal.text !== undefined ? literal.text : expression?.text;
  const normalized = String(rawValue).trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return null;
}


function createRiskIssue(rule, item, message, detailKey) {
  const action = item.object || item.action || {};

  return {
    ruleId: rule.id,
    severity: rule.severity,
    actionId: action.id || action.actionId || "",
    trackingId: getTrackingId(action),
    actionName: getDisplayActionName(item),
    message,
    impact: rule.impact,
    recommendedTest: rule.recommendedTest,
    detailKey: detailKey || message
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


  if (Array.isArray(action?.paths)) {
    const matchingPath = action.paths.find(
      (path) => String(path?.label || "").trim().toLowerCase() === normalizedOutputName
    );
    if (matchingPath) {
      return matchingPath;
    }
  }

  return null;
}


function outputHasActions(output) {
  if (!output || typeof output !== "object") {
    return false;
  }
  if (Array.isArray(output.actions) && output.actions.length > 0) {
    return true;
  }
  if (pathHasConfiguredAction(output)) {
    return true;
  }
  return false;
}


const RISK_RULES = [

{
  id: "DECISION_BRANCH_NO_PROCESSING",
  actionType: "DecisionAction",
  severity: "High",
  impact: "Branch may skip intended processing.",
  recommendedTest: "Test the affected branch.",
  validate: function (item, rule) {
    const action = item.object;
    if (!Array.isArray(action?.paths)) {
      return [];
    }
    const issues = [];
    const decisionPaths = action.paths.filter((path) => {
      const label = String(path?.label || "").trim().toLowerCase();
      return label === "yes" || label === "no";
    });
    for (const path of decisionPaths) {
      if (pathHasConfiguredAction(path)) {
        continue;
      }
      const label = String(path.label || "Branch").trim();
      issues.push(createRiskIssue(rule, item, `"${label} branch" → Has no action`, path.outputId || label));
    }
    return issues;
  }
},


{
  id: "DECISION_CONSTANT_CONDITION",
  actionType: "DecisionAction",
  severity: "Medium",
  impact: "One branch is unreachable.",
  recommendedTest: "Test both Yes and No paths.",
  validate: function (item, rule) {
    const literalValue = getLiteralBoolean(item.object?.expression);
    if (literalValue === null) {
      return [];
    }
    const unreachableBranch = literalValue ? "No" : "Yes";
    const conditionText = literalValue ? "True" : "False";
    return [
      createRiskIssue(rule, item, `"${unreachableBranch} branch" → Can never be reached (condition is always ${conditionText})`, "constant-condition")
    ];
  }
},


{
  id: "SWITCH_PATH_NO_PROCESSING",
  actionType: "SwitchAction",
  severity: "High",
  impact: "Path may skip intended processing.",
  recommendedTest: "Test the affected Switch path.",
  validate: function (item, rule) {
    const action = item.object;
    if (!Array.isArray(action?.paths)) {
      return [];
    }
    const issues = [];
    for (const path of action.paths) {
      if (pathHasConfiguredAction(path)) {
        continue;
      }
      const label = String(path?.label || "Switch path").trim();
      issues.push(createRiskIssue(rule, item, `"${label}" → Has no action`, path.outputId || label));
    }
    return issues;
  }
},


{
  id: "LOOP_BODY_NO_PROCESSING",
  actionType: "LoopAction",
  severity: "Medium",
  impact: "Loop runs without useful processing.",
  recommendedTest: "Verify loop actions and iterations.",
  validate: function (item, rule) {
    const action = item.object;
    if (pathHasConfiguredAction(action?.path)) {
      return [];
    }
    return [createRiskIssue(rule, item, `"Loop body" → Has no action`, "loop-body")];
  }
},


{
  id: "DATA_ACTION_FAILURE_RECOVERY",
  actionType: "DataAction",
  severity: "Medium",
  impact: "Failure may have no fallback.",
  recommendedTest: "Test the failure path.",
  validate: function (item, rule) {
    const failureOutput = getDataActionOutput(item.object, "failure");
    if (!failureOutput || outputHasActions(failureOutput)) {
      return [];
    }
    return [createRiskIssue(rule, item, `"Failure path" → Has no recovery handling`, "failure")];
  }
},


{
  id: "DATA_ACTION_TIMEOUT_RECOVERY",
  actionType: "DataAction",
  severity: "Medium",
  impact: "Timeout may have no fallback.",
  recommendedTest: "Test the timeout path.",
  validate: function (item, rule) {
    const timeoutOutput = getDataActionOutput(item.object, "timeout");
    if (!timeoutOutput || outputHasActions(timeoutOutput)) {
      return [];
    }
    return [createRiskIssue(rule, item, `"Timeout path" → Has no recovery handling`, "timeout")];
  }
}
];


function getDeltaRisks(comparison) {
  if (!comparison) {
    return [];
  }

  const issues = [];
  const itemsToValidate = [];

  for (const item of comparison.added) {
    itemsToValidate.push(item);
  }

  for (const change of comparison.modified) {
    itemsToValidate.push(change.after);
  }

  return runRiskRules(itemsToValidate);
}


  function getAllRisks(configuration) {
    if (!configuration) return [];
    return runRiskRules(extractActions(configuration));
  }


function runRiskRules(items) {
  const issues = [];
  for (const item of items) {
    if (item.kind !== "action") continue;
    const actionType = item.type || item.object?.__type;
    for (const rule of RISK_RULES) {
      if (rule.actionType !== actionType) continue;
      const ruleIssues = rule.validate(item, rule);
      if (Array.isArray(ruleIssues) && ruleIssues.length > 0) {
        issues.push(...ruleIssues);
      }
    }
  }
  return issues;
}


function renderRiskValidation(deltaRisks) {
  const report = buildRiskReport(deltaRisks, "No risk issues detected in saved changes");
  riskSummaryElement.textContent = report.summary;
  riskDetailsElement.innerHTML = report.html;
}


function formatRiskMessage(message) {
  const match = /^("[^"]+")\s*→\s*(.*)$/.exec(String(message));
  return match
    ? `<strong>${escapeHtml(match[1])}</strong> → ${escapeHtml(match[2])}`
    : escapeHtml(message);
}


function buildRiskReport(deltaRisks, emptyMessage) {
  if (!Array.isArray(deltaRisks) || deltaRisks.length === 0) {
    return { summary: emptyMessage, html: "" };
  }

  const highCount = deltaRisks.filter((issue) => issue.severity === "High").length;
  const mediumCount = deltaRisks.filter((issue) => issue.severity === "Medium").length;
  const summary = `${deltaRisks.length} issue${deltaRisks.length === 1 ? "" : "s"} (${highCount} High, ${mediumCount} Medium)`;

  const html = deltaRisks
    .map((issue) => {
      const header = `${colorText(`[${escapeHtml(issue.severity)}]`, SEVERITY_COLORS[issue.severity])} ${escapeHtml(issue.actionName)}`;
      const message = formatRiskMessage(issue.message);
      const test = escapeHtml(issue.recommendedTest);
      return (
        `<div style="margin-bottom: 10px;">` +
        `<div><strong>${header}</strong></div>` +
        `<div style="padding-left: 12px;">${message}</div>` +
        `<div style="padding-left: 12px; color: #52606d;">Test: ${test}</div>` +
        `</div>`
      );
    })
    .join("");

  return { summary, html };
}


  /*
   * =====================================
   * CUSTOMER IMPACT (STEP 10)
   * =====================================
   */

  function getTransferTarget(action) {
    if (!action) return "";
    // Transfer to ACD: only use literal queue names — never fall through to
    // collectActionReferences which picks up Failure output variables (errorType, etc.)
    if (action.__type === "TransferPureMatchAction") {
      const queues = getQueueNames(action);
      return queues.length ? queues.join(", ") : "";
    }
    // Other Transfer types (Transfer to User, etc.): look for user/agent name
    const refs = collectActionReferences(action);
    return findReferenceTexts(refs, /user|agent|name/i, /queue|flow|data|error/i)[0] || "";
  }


  function buildBranchWiringLines(comparison, beforeConfiguration, afterConfiguration) {
    if (!beforeConfiguration || !afterConfiguration) return [];

    // Build key sets for added/removed blocks from the comparison
    const addedActionKeys = new Set(
      comparison.added.filter((i) => i.kind === "action").map(getActionKey)
    );

    // Build key→action map and full edge list from the saved flow model
    const savedModel = buildVisualFlowModel(afterConfiguration);
    const keyToAction = new Map();
    const allEdges = [];
    for (const seq of savedModel.sequences) {
      for (const [key, action] of seq.nodes) keyToAction.set(key, action);
      for (const edge of seq.edges) allEdges.push(edge);
    }

    // Build key→action map from published model for before-state lookup
    const publishedModel = buildVisualFlowModel(beforeConfiguration);
    const publishedKeyToAction = new Map();
    const publishedEdges = [];
    for (const seq of publishedModel.sequences) {
      for (const [key, action] of seq.nodes) publishedKeyToAction.set(key, action);
      for (const edge of seq.edges) publishedEdges.push(edge);
    }

    function nodeLabel(key) {
      const action = keyToAction.get(key);
      if (!action) return "";
      const name = getDisplayActionName({ kind: "action", object: action, action, name: getActionName(action), type: action.__type });
      const target = getTransferTarget(action);
      return target ? `${name} (${target})` : name;
    }

    function sourceName(key) {
      const action = keyToAction.get(key) || publishedKeyToAction.get(key);
      if (!action) return key;
      return getDisplayActionName({ kind: "action", object: action, action, name: getActionName(action), type: action.__type });
    }

    const lines = [];
    const seen = new Set();

    // Find edges where source is an added block or target is an added block
    // that changed from the published wiring
    const publishedEdgeIds = new Set(publishedEdges.map((e) => `${e.source}|${e.target}|${e.label}`));

    function followFromKey(key) {
      if (seen.has(key)) return;
      seen.add(key);
      const outgoing = allEdges.filter((e) => e.source === key);
      for (const edge of outgoing) {
        const edgeId = `${edge.source}|${edge.target}|${edge.label}`;
        const targetLabel = nodeLabel(edge.target);
        const srcName = sourceName(edge.source);
        const label = edge.label ? `${edge.label} on ${srcName}` : srcName;
        if (!publishedEdgeIds.has(edgeId)) {
          lines.push(targetLabel
            ? `  ${label} -> ${targetLabel}`
            : `  ${label} -> (end of path)`);
        }
        // Follow chain if target is also an added block
        if (addedActionKeys.has(edge.target)) {
          followFromKey(edge.target);
        }
      }
    }

    // Entry points: edges from existing blocks that now point to an added block
    for (const edge of allEdges) {
      if (!addedActionKeys.has(edge.source) && addedActionKeys.has(edge.target)) {
        const edgeId = `${edge.source}|${edge.target}|${edge.label}`;
        if (!publishedEdgeIds.has(edgeId)) {
          const targetLabel = nodeLabel(edge.target);
          const srcName = sourceName(edge.source);
          const label = edge.label ? `${edge.label} on ${srcName}` : srcName;
          lines.push(targetLabel
            ? `  ${label} -> now leads to ${targetLabel}`
            : `  ${label} -> (new path)`);
          followFromKey(edge.target);
        }
      }
    }

    return lines;
  }


  function collectCustomerImpactData(comparison, beforeConfiguration, afterConfiguration) {
    // Added blocks — include named target where applicable
    const added = comparison.added.filter((i) => i.kind === "action").map((i) => {
      const name = getDisplayActionName(i);
      const target = getTransferTarget(i.object);
      return target ? `${name} (→ ${target})` : name;
    });
    const removed = comparison.removed.filter((i) => i.kind === "action").map(getDisplayActionName);
    const modified = comparison.modified.filter((i) => i.after?.kind === "action").map((i) => {
      const detail = i.details?.[0] || "configuration changed";
      return `${getDisplayActionName(i.after)} (${detail})`;
    });

    const deps = analyzeDependencyImpact(comparison, afterConfiguration);
    const wiringLines = buildBranchWiringLines(comparison, beforeConfiguration, afterConfiguration);

    return { added, removed, modified, deps, wiringLines };
  }


  function buildCustomerImpactFacts(
    comparison,
    flowName,
    publishedVersion,
    savedVersion,
    beforeConfiguration = publishedConfiguration,
    afterConfiguration = savedConfiguration
  ) {
    const { added, removed, modified, deps, wiringLines } =
      collectCustomerImpactData(comparison, beforeConfiguration, afterConfiguration);
    const lines = [];

    lines.push(`Flow: ${flowName}  Published: ${publishedVersion || "none"} → Saved: ${savedVersion || "draft"}`);
    lines.push("");

    lines.push(`Changed blocks (${added.length + removed.length + modified.length}):`);
    if (added.length) lines.push(`  Added: ${added.join(", ")}`);
    if (removed.length) lines.push(`  Removed: ${removed.join(", ")}`);
    if (modified.length) lines.push(`  Modified: ${modified.join(", ")}`);

    if (deps.queues.size) lines.push(`Affected queues: ${[...deps.queues].join(", ")}`);
    if (deps.dataActions.size) lines.push(`Affected data actions: ${[...deps.dataActions].join(", ")}`);
    if (deps.promptsAudio.size) lines.push(`Affected prompts/audio: ${[...deps.promptsAudio].join(", ")}`);
    if (deps.flows.size) lines.push(`Affected flows: ${[...deps.flows].join(", ")}`);

    // Branch wiring — show exact from→to connections
    if (wiringLines.length) {
      lines.push("Branch wiring (how paths connect):");
      wiringLines.forEach((l) => lines.push(l));
    }

    return lines.join("\n");
  }


  // "+ 18 Transfer to ACD - Queue: Sales" -> "Sales"
  function cleanDependencyName(value) {
    return String(value)
      .replace(/^[+\-~]\s*/, "")
      .split(" - ")
      .pop()
      .replace(/^[A-Za-z /]+:\s*/, "")
      .trim();
  }


  function joinNames(names, limit = 4, clean = false) {
    const list = [...new Set([...names].map((name) => (clean ? cleanDependencyName(name) : name)))].filter(Boolean);
    if (list.length <= limit) return list.join(", ");
    return `${list.slice(0, limit).join(", ")} and ${list.length - limit} more`;
  }


  function buildFallbackCustomerImpact(
    comparison,
    beforeConfiguration = publishedConfiguration,
    afterConfiguration = savedConfiguration
  ) {
    const { added, removed, modified, deps, wiringLines } =
      collectCustomerImpactData(comparison, beforeConfiguration, afterConfiguration);
    const sentences = [];

    if (added.length) {
      sentences.push(`Callers will now pass through ${added.length} new block${added.length === 1 ? "" : "s"}: ${joinNames(added)}.`);
    }
    if (removed.length) {
      sentences.push(`${joinNames(removed)} ${removed.length === 1 ? "is" : "are"} no longer part of the caller journey.`);
    }
    if (modified.length) {
      sentences.push(`Caller experience changes at ${joinNames(modified)}.`);
    }

    const touched = [];
    if (deps.queues.size) touched.push(`queues ${joinNames(deps.queues, 4, true)}`);
    if (deps.flows.size) touched.push(`flows ${joinNames(deps.flows, 4, true)}`);
    if (deps.promptsAudio.size) touched.push(`prompts ${joinNames(deps.promptsAudio, 4, true)}`);
    if (deps.dataActions.size) touched.push(`data actions ${joinNames(deps.dataActions, 4, true)}`);
    if (touched.length) {
      sentences.push(`This affects ${touched.join("; ")}.`);
    }

    if (wiringLines.length) {
      sentences.push(`New path: ${wiringLines[0].trim()}.`);
    }

    return sentences.length ? sentences.slice(0, 3).join(" ") : "No caller-facing change detected.";
  }


  const FALLBACK_NOTE = "(Rule-based summary — AI service unavailable.)";


  async function fetchCustomerImpact(facts) {
    const response = await chrome.runtime.sendMessage({ type: "GET_CUSTOMER_IMPACT", facts });
    if (!response?.success) throw new Error(response?.error || "AI service unavailable");
    return response.narrative;
  }


  async function renderCustomerImpact(comparison, flowName, publishedVersion, savedVersion) {
    if (!customerImpactElement) return;

    const totalChanges = comparison.added.length + comparison.removed.length + comparison.modified.length;
    if (totalChanges === 0) {
      customerImpactElement.textContent = "No changes to analyse.";
      if (customerImpactRegenerateButton) customerImpactRegenerateButton.disabled = true;
      return;
    }

    customerImpactElement.textContent = "Analysing customer impact...";
    if (customerImpactRegenerateButton) customerImpactRegenerateButton.disabled = true;

    const facts = buildCustomerImpactFacts(comparison, flowName, publishedVersion, savedVersion);
    lastCustomerImpactFacts = facts;

    try {
      customerImpactElement.textContent = await fetchCustomerImpact(facts);
    } catch (error) {
      console.warn("FlowLenZ customer impact: AI unavailable, using fallback.", error);
      customerImpactElement.textContent = `${buildFallbackCustomerImpact(comparison)}\n${FALLBACK_NOTE}`;
    } finally {
      if (customerImpactRegenerateButton) customerImpactRegenerateButton.disabled = false;
    }
  }


  /*
   * =====================================
   * FLOW Q&A (STEP 11)
   * =====================================
   */

  let chatHistory = [];
  let chatFlowContext = null;


  function extractExpressionText(expr) {
    if (!expr) return "";
    if (typeof expr === "string") return expr.trim();
    // Architect expression objects: { lit: { text: "..." } } or { ref: { text: "..." } } or { text: "..." }
    const text = expr.text || expr.lit?.text || expr.ref?.text || expr.config?.lit?.text || expr.config?.ref?.text || "";
    return String(text).trim();
  }


  // Resources — use dedicated helpers that already filter noise
  function collectFlowResources(model) {
    const queues = new Set(), prompts = new Set(), dataActions = new Set(), subFlows = new Set();
    let blockCount = 0;

    for (const seq of model.sequences) {
      for (const action of seq.nodes.values()) {
        blockCount += 1;
        for (const q of getQueueNames(action)) queues.add(q);
        for (const p of getPlayAudioReferences(action)) prompts.add(p);
        const type = String(action?.__type || "");
        if (type.includes("DataAction") || type.includes("IntegrationAction")) {
          const label = getDataActionReferenceLabel(action);
          if (label) dataActions.add(label);
        }
        const refs = collectActionReferences(action);
        for (const ref of refs) {
          if (/callflow|subflow|transferflow/i.test(ref.path) && ref.text) subFlows.add(ref.text);
        }
      }
    }

    return { queues, prompts, dataActions, subFlows, blockCount };
  }


  // Keyword answers from flow data when the AI service is unavailable.
  function buildFallbackChatAnswer(question) {
    const configuration = savedConfiguration || publishedConfiguration;
    if (!configuration) {
      return "Open a flow in Architect, then ask again.";
    }

    const q = question.toLowerCase();
    const list = (set) => (set.size ? [...set].map((item) => `- ${item}`).join("\n") : "- (none)");
    const model = buildVisualFlowModel(configuration);
    const resources = collectFlowResources(model);
    const parts = [];

    if (/explain|overview|describe|summar|about|what does|walk|understand|how does/.test(q)) {
      parts.push(buildFallbackFlowOverview(model, resources));
    }

    if (/chang|differ|modif|added|removed|delta|new/.test(q)) {
      parts.push(
        lastComparison
          ? `**Changes vs published:** ${lastComparison.added.length} added, ${lastComparison.removed.length} removed, ${lastComparison.modified.length} modified.`
          : "**Changes vs published:** none detected."
      );
    }
    if (/impact|customer|caller|journey|experience/.test(q) && lastComparison) {
      parts.push(`**Customer impact:** ${buildFallbackCustomerImpact(lastComparison)}`);
    }
    if (/queue|acd|agent|transfer/.test(q)) {
      parts.push(`**Queues:**\n${list(resources.queues)}`);
    }
    if (/prompt|audio|play|message/.test(q)) {
      parts.push(`**Prompts / audio:**\n${list(resources.prompts)}`);
    }
    if (/data ?action|api|integration|lookup/.test(q)) {
      parts.push(`**Data actions:**\n${list(resources.dataActions)}`);
    }
    if (/risk|lint|issue|error|valid|problem|warn/.test(q)) {
      const risks = getDeltaRisks(lastComparison);
      parts.push(
        risks.length
          ? `**Lint & Risk (changed blocks):**\n${risks.map((r) => `- ${r.actionName} — ${r.message}`).join("\n")}`
          : "**Lint & Risk:** no issues in changed blocks."
      );
      if (Array.isArray(lastValidationRows) && lastValidationRows.length) {
        parts.push(`**Architect validation:**\n${lastValidationRows.map((r) => `- ${r.blockName} — ${r.message}`).join("\n")}`);
      }
    }
    if (/block|step|how many|count|size/.test(q)) {
      parts.push(`**Blocks:** ${resources.blockCount} in the saved version.`);
    }
    // "flow" appears in most questions, so only answer called flows when nothing else matched.
    if (/sub-?flow|bot|called flow|flow/.test(q) && !parts.length) {
      parts.push(`**Called flows:**\n${list(resources.subFlows)}`);
    }

    if (!parts.length) {
      parts.push(buildFallbackFlowOverview(model, resources));
      parts.push(
        "I can also answer offline about: changes, customer impact, queues, prompts, data actions, called flows, risks/validation and block count."
      );
    }

    return parts.join("\n\n");
  }


  function buildFallbackFlowOverview(model, resources) {
    const blockLabel = (action) =>
      action
        ? getDisplayActionName({ kind: "action", object: action, action, name: getActionName(action), type: action.__type })
        : "";
    const lines = [`**Flow overview:** ${resources.blockCount} blocks.`];

    for (const seq of model.sequences) {
      const isMain = model.sequences.length === 1 || seq.id === model.initialSequence;
      lines.push(`**${isMain ? "Main path" : `Task: ${seq.container?.name || "Task"}`}:**`);
      for (const edge of seq.edges) {
        const exit = edge.label && edge.label.toLowerCase() !== "next" ? ` [${edge.label}]` : "";
        lines.push(`- ${blockLabel(seq.nodes.get(edge.source)) || edge.source}${exit} → ${blockLabel(seq.nodes.get(edge.target)) || edge.target}`);
      }
      if (!seq.edges.length) {
        for (const action of seq.nodes.values()) lines.push(`- ${blockLabel(action)}`);
      }
    }

    if (resources.queues.size) lines.push(`**Queues:** ${[...resources.queues].join(", ")}`);
    if (resources.dataActions.size) lines.push(`**Data actions:** ${[...resources.dataActions].join(", ")}`);
    if (resources.subFlows.size) lines.push(`**Called flows:** ${[...resources.subFlows].join(", ")}`);

    return lines.join("\n");
  }


  function buildFlowContext(configuration, publishedConfiguration, flowName, versionLabel = "") {
    if (!configuration) return null;

    const model = buildVisualFlowModel(configuration);
    const publishedModel = publishedConfiguration ? buildVisualFlowModel(publishedConfiguration) : null;
    const publishedKeys = new Set();
    if (publishedModel) {
      for (const seq of publishedModel.sequences) {
        for (const key of seq.nodes.keys()) publishedKeys.add(key);
      }
    }

    const lines = [`Flow: ${flowName || "(unknown)"}`];
    if (versionLabel) lines.push(`Version: ${versionLabel}`);

    for (const seq of model.sequences) {
      const taskName = seq.container?.name || "Main Flow";
      const isMain = model.sequences.length === 1 || seq.id === model.initialSequence;
      lines.push("");
      lines.push(isMain ? "Blocks:" : `Task: ${taskName} — Blocks:`);

      for (const [key, action] of seq.nodes) {
        const item = { kind: "action", object: action, action, name: getActionName(action), type: action.__type };
        let label = getDisplayActionName(item);
        const type = String(action?.__type || "");
        if (type.includes("DataAction") || type.includes("IntegrationAction")) {
          const daName = getDataActionReferenceLabel(action);
          if (daName && daName !== label) label += ` — ${daName}`;
        }
        if (type === "DecisionAction" && action.expression) {
          const expr = extractExpressionText(action.expression);
          if (expr) label += ` — Condition: ${expr}`;
        }
        if (type === "SwitchAction" && Array.isArray(action.paths)) {
          const cases = action.paths.map((p) => String(p.label || "").trim()).filter(Boolean);
          if (cases.length) label += ` — Cases: ${cases.join(", ")}`;
        }
        const changed = publishedModel && !publishedKeys.has(key) ? " (added)" : "";
        lines.push(`  ${label}${changed}`);
      }

      lines.push("");
      lines.push(isMain ? "Wiring:" : `Task: ${taskName} — Wiring:`);

      const grouped = new Map();
      for (const edge of seq.edges) {
        if (!grouped.has(edge.source)) grouped.set(edge.source, []);
        grouped.get(edge.source).push(edge);
      }

      for (const [sourceKey, edges] of grouped) {
        const fromAction = seq.nodes.get(sourceKey);
        const fromItem = { kind: "action", object: fromAction, action: fromAction, name: getActionName(fromAction), type: fromAction?.__type };
        const fromLabel = fromAction ? getDisplayActionName(fromItem) : sourceKey;
        for (const edge of edges) {
          const toAction = seq.nodes.get(edge.target);
          const toItem = { kind: "action", object: toAction, action: toAction, name: getActionName(toAction), type: toAction?.__type };
          const toLabel = toAction ? getDisplayActionName(toItem) : edge.target;
          const exitPart = edge.label && edge.label.toLowerCase() !== "next" ? ` [${edge.label}]` : "";
          lines.push(`  ${fromLabel}${exitPart} -> ${toLabel}`);
        }
      }
    }

    const { queues, prompts, dataActions, subFlows } = collectFlowResources(model);

    lines.push("");
    lines.push("Resources:");
    lines.push(`  Queues: ${queues.size ? [...queues].join(", ") : "(none)"}`);
    lines.push(`  Prompts/Audio: ${prompts.size ? [...prompts].join(", ") : "(none)"}`);
    lines.push(`  Data Actions: ${dataActions.size ? [...dataActions].join(", ") : "(none)"}`);
    lines.push(`  Sub-flows: ${subFlows.size ? [...subFlows].join(", ") : "(none)"}`);

    const allRisks = getAllRisks(configuration);
    if (allRisks.length > 0) {
      lines.push("");
      lines.push("Lint & Risk issues:");
      for (const issue of allRisks) {
        lines.push(`  [${issue.severity}] ${issue.actionName} — ${issue.message} (${issue.impact})`);
      }
    }

    if (Array.isArray(lastValidationRows) && lastValidationRows.length > 0) {
      lines.push("");
      lines.push("Genesys Architect Validation Errors:");
      for (const row of lastValidationRows) {
        lines.push(`  ${row.blockName} — ${row.message}`);
      }
    }

    return lines.join("\n");
  }


  function parseMarkdown(text) {
    const lines = text.split("\n");
    let html = "";
    let inList = false;

    for (const raw of lines) {
      const line = raw.trimEnd();

      if (/^[-*] /.test(line)) {
        if (!inList) { html += "<ul>"; inList = true; }
        html += `<li>${inlineMd(line.slice(2))}</li>`;
      } else {
        if (inList) { html += "</ul>"; inList = false; }
        if (line === "") {
          html += "<br>";
        } else {
          html += `<p>${inlineMd(line)}</p>`;
        }
      }
    }

    if (inList) html += "</ul>";
    return html;
  }


  function inlineMd(text) {
    return text
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }


  function renderChatMessage(role, text, isLoading = false) {
    const messagesEl = root.querySelector("#flowlenz-chat-messages");
    if (!messagesEl) return null;
    const bubble = document.createElement("div");
    bubble.className = `flowlenz-chat-bubble ${role}${isLoading ? " loading" : ""}`;
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }


  async function sendChatQuestion(question) {
    renderChatMessage("user", question);
    const loadingBubble = renderChatMessage("ai", "Thinking...", true);

    const context = chatFlowContext || "No flow context available yet. Open a flow in Architect first.";

    let response = null;
    try {
      response = await chrome.runtime.sendMessage({
        type: "FLOW_QA",
        context,
        history: chatHistory,
        question
      });
    } catch (error) {
      response = null;
    }

    const answer = response?.success
      ? response.answer
      : `${buildFallbackChatAnswer(question)}\n\n${FALLBACK_NOTE}`;

    if (loadingBubble) loadingBubble.remove();

    const messagesEl = root.querySelector("#flowlenz-chat-messages");
    const bubble = document.createElement("div");
    bubble.className = "flowlenz-chat-bubble ai";
    bubble.innerHTML = parseMarkdown(answer);
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (response?.success) {
      chatHistory.push({ role: "user", content: question });
      chatHistory.push({ role: "assistant", content: answer });
      if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    }
  }


function renderPublishedOnlyState() {
  lastComparison = null;
  validationElement.innerHTML = "";
  lastReportMeta = {
    flowName: flowNameElement.textContent || "",
    publishedVersion: "",
    savedVersion: ""
  };

  if (customerImpactElement) {
    customerImpactElement.textContent = "Save the flow to analyse customer journey impact.";
    if (customerImpactRegenerateButton) customerImpactRegenerateButton.disabled = true;
  }

  if (visualReportStatusElement) {
    visualReportStatusElement.textContent = "Save the flow to enable the report.";
  }

  if (visualReportOpenButton) {
    visualReportOpenButton.disabled = true;
  }

  savedVersionElement.textContent = "Saved Version: None";
  configStatusElement.textContent = publishedConfiguration
    ? "Configurations: Published Loaded | Saved Not Found"
    : "Configurations: Published unavailable | Saved Not Found";
  savedConfiguration = null;
  analysisSummaryElement.innerHTML = `<div style="margin-top: 1em;"><strong>Affected Blocks</strong></div>`;
  analysisDetailsElement.innerHTML = "<div>Waiting for saved version.</div>";
  riskSummaryElement.textContent = "Waiting for saved version";
  riskDetailsElement.innerHTML = "";
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


  /*
   * =====================================
   * APPLY CURRENT FLOW
   * =====================================
   */

  /*
   * =====================================
   * FLOW VALIDATION (Genesys Architect Validate list)
   * Read from the Architect page after the user clicks Validate — the one
   * exception to "APIs only", approved 2026-09-29. Located by its footer
   * text rather than Architect's internal class names.
   * =====================================
   */

  const VALIDATION_FOOTER_TEXT =
    "Press validate again to refresh list";

  let lastValidationRows =
    null;


  // SVG icons have no innerText; treat them as empty.
  function getVisibleLines(
    element
  ) {

    if (!(element instanceof HTMLElement)) {
      return [];
    }

    return element.innerText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function findValidationFooters() {

    const snapshot =
      document.evaluate(
        `//*[contains(normalize-space(.), '${VALIDATION_FOOTER_TEXT}') and not(*[contains(normalize-space(.), '${VALIDATION_FOOTER_TEXT}')])]`,
        document.body,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );

    const footers = [];

    for (let index = 0; index < snapshot.snapshotLength; index++) {

      const node = snapshot.snapshotItem(index);

      if (!root.contains(node)) {
        footers.push(node);
      }
    }

    return footers;
  }


  function isRendered(
    element
  ) {

    return (
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden"
    );
  }


  /*
   * Text pieces inside an element, read from the DOM (not rendering), so the
   * Validate list can be read while Architect keeps it hidden (it only shows
   * on CSS hover, which scripts cannot trigger).
   */
  function getTextChunks(
    element
  ) {

    const chunks = [];

    const walker =
      document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.parentElement?.closest("svg, style, script")
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT
      });

    while (walker.nextNode()) {

      const text =
        walker.currentNode.textContent.replace(/\s+/g, " ").trim();

      if (text) {
        chunks.push(text);
      }
    }

    return chunks;
  }


  /*
   * Prefer a copy of the list that is on screen, otherwise the most recent
   * hidden copy; never climb as far as the toolbar (which would read the
   * "Validate 4" button as a row).
   */
  function findValidationPanel() {

    const validateButton =
      findArchitectValidateButton();

    const footers =
      findValidationFooters();

    const ordered = [
      ...footers.filter(isRendered),
      ...footers.filter((footer) => !isRendered(footer)).reverse()
    ];

    for (const footer of ordered) {

      let panel = footer.parentElement;

      while (panel && panel !== document.body) {

        if (validateButton && panel.contains(validateButton)) {
          break;
        }

        if (getTextChunks(panel).length >= 3) {
          return panel;
        }

        panel = panel.parentElement;
      }
    }

    return null;
  }


  // Rows are the deepest elements whose text is exactly "block name / message".
  function parseValidationRows(
    panel
  ) {

    const rows = [];
    const seen = new Set();

    const validateButton =
      findArchitectValidateButton();

    for (const element of panel.querySelectorAll("*")) {

      if (validateButton && (element.contains(validateButton) || validateButton.contains(element))) {
        continue;
      }

      const lines =
        getTextChunks(element);

      if (
        lines.length !== 2 ||
        lines.includes(VALIDATION_FOOTER_TEXT) ||
        /^\d+$/.test(lines[1])
      ) {
        continue;
      }

      const deeper =
        [...element.children].some(
          (child) => getTextChunks(child).length === 2
        );

      const key = lines.join("|");

      if (deeper || seen.has(key)) {
        continue;
      }

      seen.add(key);

      rows.push({
        blockName: lines[0],
        message: lines[1]
      });
    }

    return rows;
  }


  function captureValidationResults() {

    if (!validationElement) {
      return;
    }

    const panel =
      findValidationPanel();

    if (!panel) {
      return;
    }

    const rows =
      parseValidationRows(panel);

    // A hidden or half-rendered list parses as empty; never let that wipe real results.
    if (rows.length === 0 && lastValidationRows?.length) {
      return;
    }

    const signature =
      JSON.stringify(rows);

    if (signature === JSON.stringify(lastValidationRows)) {
      return;
    }

    lastValidationRows = rows;

    console.log(
      "FlowLenZ validation: rows read",
      rows
    );

    renderValidationSection();
  }


  function formatValidationMessage(
    message
  ) {

    return escapeHtml(message).replace(
      /&#039;([^&]+?)&#039;|'([^']+?)'/g,
      (match, escaped, plain) => `<strong>"${escaped || plain}"</strong>`
    );
  }


  function renderValidationSection() {

    const heading =
      `<div style="margin-top: 6px;"><strong>Flow Validation Errors</strong></div>`;

    if (!lastComparison) {
      validationElement.innerHTML = "";
      return;
    }

    if (!lastValidationRows) {
      validationElement.innerHTML =
        heading +
        `<div style="padding-left: 12px;">${renderBulletLines(["Click Validate in Architect to include Genesys validation results"])}</div>`;
      return;
    }

    const changedBlocks =
      [
        ...lastComparison.added,
        ...lastComparison.modified.map((entry) => entry.after)
      ].filter((item) => item?.kind === "action");

    const matches =
      [];

    for (const row of lastValidationRows) {

      const rowName =
        row.blockName.toLowerCase();

      for (const item of changedBlocks) {

        const object = item.object || item.action;
        const name = String(getActionName(object) || "").toLowerCase();
        const displayName = getDisplayActionName(item);

        if (name === rowName || displayName.toLowerCase().endsWith(rowName)) {
          matches.push({ ...row, displayName });
        }
      }
    }

    const body =
      matches.length === 0
        ? renderBulletLines(["No validation errors for changed blocks"])
        : matches
            .map(
              (match) =>
                `<div style="margin-bottom: 10px;">` +
                `<div><strong>${escapeHtml(match.displayName)}</strong></div>` +
                `<div style="padding-left: 12px;">${formatValidationMessage(match.message)}</div>` +
                `</div>`
            )
            .join("");

    validationElement.innerHTML =
      heading +
      `<div style="padding-left: 12px;">${body}</div>`;
  }


  // Architect uses Genesys (gux-*) custom elements as well as plain buttons.
  function findArchitectValidateButton() {

    const selector =
      "button, [role='button'], gux-button, gux-button-slot, gux-action-button, a";

    for (const element of document.querySelectorAll(selector)) {

      if (root.contains(element)) {
        continue;
      }

      const lines = getVisibleLines(element);

      if (lines.length > 0 && /^Validate\b/i.test(lines[0])) {
        return element;
      }
    }

    const label =
      document.evaluate(
        "//*[normalize-space(text())='Validate']",
        document.body,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;

    if (label && !root.contains(label)) {
      return label.closest(selector) || label;
    }

    return null;
  }


  let validationCaptureTimer = null;

  new MutationObserver(() => {
    clearTimeout(validationCaptureTimer);
    validationCaptureTimer = setTimeout(captureValidationResults, 300);
  }).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["style", "class", "hidden", "aria-hidden"]
  });


  /*
   * =====================================
   * RELEASE NOTES (STEP 9)
   * Rebuilt on demand from Genesys versions: any published version vs the
   * one before it, plus the saved draft vs latest published (pre-publish
   * preview). Opens on a separate page like the Visual Change Report.
   * =====================================
   */

  const releaseConfigurationCache = new Map();
  let releaseEntries = [];
  let releaseFlowName = "";


  function loadReleaseConfiguration(configurationUri) {
    if (!releaseConfigurationCache.has(configurationUri)) {
      releaseConfigurationCache.set(
        configurationUri,
        loadConfiguration(configurationUri).catch((error) => {
          releaseConfigurationCache.delete(configurationUri);
          throw error;
        })
      );
    }
    return releaseConfigurationCache.get(configurationUri);
  }


  function describeReleaseVersion(version) {
    const parts = [];
    const created = version?.dateCreated ? new Date(version.dateCreated) : null;
    if (created && !Number.isNaN(created.getTime())) {
      parts.push(`Published ${created.toLocaleString()}`);
    }
    return parts.join(" ");
  }


  const releaseUserNameCache = new Map();


  // Version data may carry only the publisher's user id; look the name up once.
  async function resolveReleasePublisher(version) {
    const user = version?.createdBy;
    if (user?.name) {
      return user.name;
    }
    if (!user?.id) {
      console.log("FlowLenZ release: version has no createdBy user", version);
      return "";
    }

    if (!releaseUserNameCache.has(user.id)) {

      releaseUserNameCache.set(
        user.id,
        chrome.runtime
          .sendMessage({ type: "GET_USER_NAME", userId: user.id })
          .then((response) => {
            if (!response?.success) {
              console.log("FlowLenZ release: user name lookup failed", response?.error);
            }
            return response?.success ? response.name || "" : "";
          })
          .catch((error) => {
            console.log("FlowLenZ release: user name lookup failed", error);
            return "";
          })
      );
    }

    return releaseUserNameCache.get(user.id);
  }


  function buildReleaseEntries(context) {
    const published = (context.versions.publishedVersions || []).filter(
      (entry) => entry.version?.configurationUri
    );
    const entries = [];

    [...published].reverse().forEach((entry, index, ascending) => {
      const previous = ascending[index - 1] || null;
      entries.push({
        label: `Version ${entry.identifier}`,
        versionLabel: `Version ${entry.identifier}`,
        previousLabel: previous ? `Version ${previous.identifier}` : "",
        detail: describeReleaseVersion(entry.version),
        version: entry.version,
        loadCurrent: () => loadReleaseConfiguration(entry.version.configurationUri),
        loadPrevious: previous ? () => loadReleaseConfiguration(previous.version.configurationUri) : null
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

    return entries.reverse();
  }


  function buildReleaseNotesBody(beforeConfiguration, afterConfiguration) {
    const comparison = compareActions(beforeConfiguration, afterConfiguration);
    const riskReport = buildRiskReport(getDeltaRisks(comparison), "No risk issues detected in changed blocks");
    return {
      riskSummary: riskReport.summary,
      riskHtml: riskReport.html,
      summary:
        `${comparison.added.length} added · ` +
        `${comparison.removed.length} removed · ` +
        `${comparison.modified.length} modified`,
      changeImpactHtml: buildChangeImpactHtml(comparison, beforeConfiguration, afterConfiguration, false)
    };
  }


  async function openReleaseNotes() {
    const entry = releaseEntries[Number(releaseVersionSelect.value)];
    if (!entry) {
      return;
    }
    releaseOpenButton.disabled = true;
    releaseStatusElement.textContent = "Preparing release notes...";

    try {

      const [currentConfiguration, previousConfiguration] =
        await Promise.all([
          entry.loadCurrent(),
          entry.loadPrevious
            ? entry.loadPrevious()
            : Promise.resolve(null)
        ]);

      const publishedBy = entry.version ? (await resolveReleasePublisher(entry.version)) || "Unknown" : "";

      let customerImpact = "";
      if (!entry.firstPublish && previousConfiguration) {
        const rnComparison = compareActions(previousConfiguration, currentConfiguration);
        const facts = buildCustomerImpactFacts(
          rnComparison,
          releaseFlowName,
          entry.previousLabel,
          entry.versionLabel,
          previousConfiguration,
          currentConfiguration
        );
        try {
          customerImpact = await fetchCustomerImpact(facts);
        } catch (_) {
          customerImpact =
            `${buildFallbackCustomerImpact(rnComparison, previousConfiguration, currentConfiguration)}\n${FALLBACK_NOTE}`;
        }
      }

      const payload = {
        generatedAt: new Date().toLocaleString(),
        flowName: releaseFlowName,
        versionLabel: entry.versionLabel,
        previousLabel: entry.previousLabel,
        detail: entry.detail,
        publishedBy,
        firstPublish: !previousConfiguration,
        blockCount: extractActions(currentConfiguration).length,
        customerImpact,
        ...(previousConfiguration ? buildReleaseNotesBody(previousConfiguration, currentConfiguration) : {})
      };

      const response = await chrome.runtime.sendMessage({ type: "FLOWLENZ_OPEN_RELEASE_NOTES", payload });

      if (!response?.success) {
        throw new Error(response?.error || "Background could not open the release notes.");
      }

      updateReleaseStatus();

    } catch (error) {
      console.error("FlowLenZ release notes error:", error);
      releaseStatusElement.textContent = "Could not open release notes. Reload the extension and try again.";
    } finally {
      releaseOpenButton.disabled = releaseEntries.length === 0;
    }
  }


  function renderReleaseNotesPicker(context) {
    const previousLabel = releaseEntries[Number(releaseVersionSelect.value)]?.label;
    releaseFlowName = context.flow?.name || "";
    releaseEntries = buildReleaseEntries(context);
    releaseVersionSelect.innerHTML = releaseEntries
        .map((entry, index) =>
            `<option value="${index}">${escapeHtml(entry.label)}</option>`
        )
        .join("");

    releaseVersionSelect.disabled = releaseEntries.length === 0;
    releaseOpenButton.disabled = releaseEntries.length === 0;

    if (releaseEntries.length === 0) {
      releaseStatusElement.textContent = "No published versions yet.";
      return;
    }

    const keptIndex = releaseEntries.findIndex((entry) => entry.label === previousLabel);
    releaseVersionSelect.value = String(keptIndex >= 0 ? keptIndex : 0);
    updateReleaseStatus();
  }


  async function updateReleaseStatus() {
    const entry = releaseEntries[Number(releaseVersionSelect.value)];
    releaseStatusElement.textContent = entry ? entry.detail || entry.label : "";

    if (!entry?.version) {
      return;
    }

    const publisher = await resolveReleasePublisher(entry.version);

    if (releaseEntries[Number(releaseVersionSelect.value)] !== entry) {
      return;
    }

    releaseStatusElement.textContent = `${entry.detail || entry.label}\nPublished by: ${publisher || "Unknown"}`;
  }


  function applyContext(context) {
    if (context.flow && context.flow.name) {
      flowNameElement.textContent = context.flow.name;
    } else {
      flowNameElement.textContent = "Flow name unavailable";
    }

    publishedVersionElement.textContent = context.versions.publishedVersion
      ? `Published Version: ${context.versions.publishedVersion}`
      : "Published Version: Not found";

    publishedConfiguration = context.publishedConfiguration;
    renderReleaseNotesPicker(context);

    if (!context.hasSavedVersion) {
      renderPublishedOnlyState();
      chatFlowContext = buildFlowContext(
        publishedConfiguration,
        null,
        context.flow?.name || "",
        `Published ${context.versions.publishedVersion || ""} (no saved changes)`.trim()
      );
      return;
    }

    const nextVersion = calculateNextVersion(context.versions.publishedVersion);
    savedVersionElement.textContent = nextVersion ? `Saved Version: ${nextVersion}` : "Saved Version: Detected";
    savedConfiguration = context.savedConfiguration;
    configStatusElement.textContent = "Configurations: Published Loaded | Saved Loaded";

    const comparison = compareActions(publishedConfiguration, savedConfiguration);
    renderChangeImpactAnalysis(comparison);
    updateVisualReportControls(comparison, {
      flowName: context.flow?.name || "",
      publishedVersion: context.versions.publishedVersion || "",
      savedVersion: nextVersion || "Saved"
    });

    const deltaRisks = getDeltaRisks(comparison);
    lastDeltaRisks = deltaRisks;
    renderRiskValidation(deltaRisks);
    renderValidationSection();
    renderCustomerImpact(comparison, context.flow?.name || "", context.versions.publishedVersion || "", nextVersion || "Saved");
    chatFlowContext = buildFlowContext(
      context.savedConfiguration,
      context.publishedConfiguration,
      context.flow?.name || "",
      `Saved ${nextVersion || ""} (compared with published ${context.versions.publishedVersion || "none"})`
    );
    console.log("FlowLenZ Changes:", comparison);
    logModifiedDifferences(comparison);
    console.log("FlowLenZ Delta Risks:", deltaRisks);
  }


  /*
   * =====================================
   * REFRESH ON OPEN
   * =====================================
   */

  async function refreshOnOpen() {
    if (refreshInProgress) {
      return;
    }

    refreshInProgress = true;

    try {
      refreshStatusElement.textContent = "Refresh: Loading current flow...";
      const context = await fetchCurrentContext();
      applyContext(context);
      refreshStatusElement.textContent = "Refresh: Updated on Open";
    } catch (error) {
      console.error("FlowLenZ open refresh error:", error);
      refreshStatusElement.textContent = "Refresh: Unable to update";
    } finally {
      refreshInProgress = false;
    }
  }


  /*
   * =====================================
   * REFRESH AFTER SAVE
   * =====================================
   */

  async function refreshAfterSave() {
    if (refreshInProgress) {
      refreshQueued = true;
      return;
    }

    refreshInProgress = true;
    const previousFingerprint = savedConfiguration ? createFingerprint(savedConfiguration) : null;
    let latestContext = null;

    try {

      refreshStatusElement.textContent = "Refresh: Save detected...";

      for (const delay of SAVE_RETRY_DELAYS) {
        if (delay > 0) {
          refreshStatusElement.textContent = "Refresh: Waiting for saved configuration...";
          await sleep(delay);
        }

        latestContext = await fetchCurrentContext();

        if (!latestContext.hasSavedVersion) {
          continue;
        }

        const latestFingerprint = createFingerprint(latestContext.savedConfiguration);

        if (previousFingerprint === null) {
          applyContext(latestContext);
          refreshStatusElement.textContent = "Refresh: Updated after Save";
          return;
        }

        if (latestFingerprint !== previousFingerprint) {
          applyContext(latestContext);
          refreshStatusElement.textContent = "Refresh: Updated after Save";
          return;
        }
      }

      if (latestContext) {
        applyContext(latestContext);
      }

      refreshStatusElement.textContent = "Refresh: Save completed";

    } catch (error) {
      console.error("FlowLenZ Save refresh error:", error);
      refreshStatusElement.textContent = "Refresh: Unable to update";

    } finally {
      refreshInProgress = false;
      if (refreshQueued) {
        refreshQueued = false;
        refreshAfterSave();
      }
    }
  }


  /*
   * =====================================
   * EXTENSION EVENTS
   * =====================================
   */

  chrome.runtime.onMessage.addListener((message) => {
    panelReady.then(() => handleExtensionMessage(message));
  });


  function handleExtensionMessage(message) {
    if (message && message.type === "TOGGLE_FLOWLENZ") {
      panel.classList.toggle("flowlenz-hidden");
      const isOpen = !panel.classList.contains("flowlenz-hidden");
      if (isOpen) {
        refreshOnOpen();
      }
      return;
    }

    if (message && message.type === "ARCHITECT_SAVE_COMPLETED") {
      const currentFlowId = detectFlowId();
      if (message.flowId && currentFlowId && message.flowId.toLowerCase() !== currentFlowId.toLowerCase()) {
        return;
      }

      // Open the panel on Save, scrolled to the top, so the analysis starts from the beginning.
      panel.classList.remove("flowlenz-hidden");
      setChatFullScreen(false);
      root.querySelector(".flowlenz-content")?.scrollTo({ top: 0 });
      refreshAfterSave();
      setTimeout(captureValidationResults, 2500);
    }
  }


  /*
   * =====================================
   * UI
   * =====================================
   */

  const CHEVRON_UP = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M7.646 4.646a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8 5.707 5.354 8.354a.5.5 0 1 1-.708-.708l3-3z"/></svg>`;
  const CHEVRON_DOWN = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M7.646 11.354a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8 10.293 5.354 7.646a.5.5 0 0 0-.708.708l3 3z"/></svg>`;


  // Chat has two states: minimised (input only, sections visible) and full (fills panel below header).
  function setChatFullScreen(full) {
    if (!panel) return;
    panel.classList.toggle("flowlenz-chat-full", full);
    root.querySelector(".flowlenz-chat")?.classList.toggle("flowlenz-chat-minimised", !full);
    if (full) {
      const messagesEl = root.querySelector("#flowlenz-chat-messages");
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    const chatToggle = root.querySelector("#flowlenz-chat-toggle");
    if (chatToggle) {
      chatToggle.innerHTML = full ? CHEVRON_DOWN : CHEVRON_UP;
      chatToggle.title = full ? "Minimise chat" : "Expand chat";
    }
  }


  async function initPanel() {
    const html = await fetch(chrome.runtime.getURL("panel.html")).then((r) => r.text());
    root.innerHTML = html
      .replace("__LOGO_URL__", logoUrl)
      .replace("__BRAND_LOGO_URL__", brandLogoUrl);

    document.body.appendChild(root);

    panel = root.querySelector(".flowlenz-panel");
    flowNameElement = root.querySelector("#flowlenz-flow-name");
    publishedVersionElement = root.querySelector("#flowlenz-published-version");
    savedVersionElement = root.querySelector("#flowlenz-saved-version");
    configStatusElement = root.querySelector("#flowlenz-config-status");
    refreshStatusElement = root.querySelector("#flowlenz-refresh-status");
    analysisSummaryElement = root.querySelector("#flowlenz-analysis-summary");
    analysisDetailsElement = root.querySelector("#flowlenz-analysis-details");
    riskSummaryElement = root.querySelector("#flowlenz-risk-summary");
    riskDetailsElement = root.querySelector("#flowlenz-risk-details");
    visualReportStatusElement = root.querySelector("#flowlenz-visual-report-status");
    visualReportOpenButton = root.querySelector("#flowlenz-visual-report-open");
    validationElement = root.querySelector("#flowlenz-validation");
    releaseVersionSelect = root.querySelector("#flowlenz-release-version");
    releaseStatusElement = root.querySelector("#flowlenz-release-status");
    releaseOpenButton = root.querySelector("#flowlenz-release-open");
    customerImpactElement = root.querySelector("#flowlenz-customer-impact");
    customerImpactRegenerateButton = root.querySelector("#flowlenz-customer-impact-regenerate");

    customerImpactRegenerateButton?.addEventListener("click", () => {
      if (lastComparison && lastCustomerImpactFacts) {
        renderCustomerImpact(
          lastComparison,
          lastReportMeta.flowName,
          lastReportMeta.publishedVersion,
          lastReportMeta.savedVersion
        );
      }
    });

    visualReportOpenButton.addEventListener("click", () => { openVisualChangeReport(); });
    releaseVersionSelect.addEventListener("change", updateReleaseStatus);
    releaseOpenButton.addEventListener("click", () => { openReleaseNotes(); });

    const input = root.querySelector("#flowlenz-chat-input");
    const sendButton = root.querySelector("#flowlenz-send-button");
    const chatToggle = root.querySelector("#flowlenz-chat-toggle");

    setChatFullScreen(false);

    chatToggle.addEventListener("click", () => {
      const full = panel.classList.contains("flowlenz-chat-full");
      setChatFullScreen(!full);
      if (!full) input.focus();
    });
    root.querySelector(".flowlenz-chat-label").addEventListener("click", () => {
      setChatFullScreen(true);
      input.focus();
    });
    input.addEventListener("focus", () => setChatFullScreen(true));
    root.querySelector("#flowlenz-clear-button").addEventListener("click", () => {
      root.querySelector("#flowlenz-chat-messages").innerHTML = "";
      chatHistory = [];
      input.value = "";
      input.style.height = "";
      input.focus();
    });
    sendButton.addEventListener("click", () => {
      const message = input.value.trim();
      if (!message) return;
      setChatFullScreen(true);
      input.value = "";
      input.style.height = "";
      sendChatQuestion(message);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendButton.click();
      }
    });

    input.addEventListener("input", () => {
      input.style.height = "";
      const maxHeight = parseFloat(getComputedStyle(input).maxHeight);
      input.style.height = Math.min(input.scrollHeight, maxHeight) + "px";
    });
  }

  const panelReady = initPanel().catch((error) => {
    console.error("FlowLenZ panel failed to load:", error);
  });

})();