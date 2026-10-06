const STORAGE_KEY = "flowlenzReleaseNotes";

const metaElement = document.getElementById("rn-meta");
const contentElement = document.getElementById("rn-content");
const downloadButton = document.getElementById("rn-download");

function addLine(parent, text, strong) {
  const line = document.createElement("div");
  if (strong) {
    const bold = document.createElement("strong");
    bold.textContent = text;
    line.appendChild(bold);
  } else {
    line.textContent = text;
  }
  parent.appendChild(line);
}

// Section bodies are HTML built (and escaped) by the FlowLenZ panel renderers.
function addSection(title, summary, html) {
  const section = document.createElement("section");
  section.className = "rn-section";

  const heading = document.createElement("h2");
  heading.textContent = title;
  section.appendChild(heading);

  if (summary) {
    const summaryElement = document.createElement("div");
    summaryElement.className = "rn-section-summary";
    summaryElement.textContent = summary;
    section.appendChild(summaryElement);
  }

  if (html) {
    const body = document.createElement("div");
    body.className = "rn-section-body";
    body.innerHTML = html;
    section.appendChild(body);
  }

  contentElement.appendChild(section);
}

function render(data) {
  metaElement.textContent = "";

  addLine(metaElement, data.flowName || "Flow", true);
  addLine(
    metaElement,
    data.firstPublish
      ? `${data.versionLabel} (first publish)`
      : `${data.versionLabel} · compared with ${data.previousLabel}`
  );

  if (data.detail) {
    addLine(metaElement, data.detail);
  }

  if (data.publishedBy) {
    addLine(metaElement, `Published by: ${data.publishedBy}`);
  }

  if (data.generatedAt) {
    addLine(metaElement, `Generated: ${data.generatedAt}`);
  }

  downloadButton.hidden = false;

  if (data.firstPublish) {
    addSection("Summary", `First published version · ${data.blockCount} blocks`, "");
    return;
  }

  addSection("Summary", data.summary, "");
  if (data.customerImpact) {
    addSection("Customer Journey Impact", data.customerImpact, "");
  }
  addSection("Change Impact Analysis", "", data.changeImpactHtml);
  if (data.riskSummary) {
    addSection("Lint & Risk", data.riskSummary, data.riskHtml);
  }
}

downloadButton.addEventListener("click", () => window.print());

chrome.storage.session.get(STORAGE_KEY, (result) => {
  if (chrome.runtime.lastError) {
    metaElement.textContent = chrome.runtime.lastError.message;
    return;
  }

  const data = result[STORAGE_KEY];

  if (!data) {
    metaElement.textContent =
      "No release notes data. Open FlowLenZ in Architect and use “Open Release Notes”.";
    return;
  }

  render(data);
});
