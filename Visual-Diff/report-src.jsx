import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import dagre from "dagre";

const STORAGE_KEY = "flowlenzVisualReport";
const NODE_W = 220;
const NODE_H = 76;
const FULL_VIEW_NODE_LIMIT = 30;

const NODE_STYLES = {
  added: { fill: "#d4edda", stroke: "#28a745" },
  modified: { fill: "#fff3cd", stroke: "#fd7e14" },
  removed: { fill: "#f8d7da", stroke: "#dc3545" },
  unchanged: { fill: "#f0f3f7", stroke: "#8a96a3" },
};

const CHANGE_LABELS = {
  added: "Added",
  modified: "Modified",
  removed: "Removed",
  unchanged: "Unchanged",
};

function focusSequence(sequence, mode) {
  const { nodes, edges } = sequence;

  if (mode === "full" || nodes.length <= FULL_VIEW_NODE_LIMIT) {
    return { nodes, edges: edges.map((edge) => ({ ...edge, collapsed: false })) };
  }

  const outgoing = new Map();
  const incoming = new Map();

  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    outgoing.get(edge.source).push(edge);
    incoming.get(edge.target).push(edge);
  }

  const keep = new Set(
    nodes.filter((node) => node.changeType !== "unchanged").map((node) => node.id)
  );

  for (const id of [...keep]) {
    (outgoing.get(id) || []).forEach((edge) => keep.add(edge.target));
    (incoming.get(id) || []).forEach((edge) => keep.add(edge.source));
  }

  const focused = [];
  const seen = new Set();

  const push = (source, target, label, status, collapsed) => {
    const id = `${source}|${target}|${label}|${status}`;
    if (source === target || seen.has(id)) return;
    seen.add(id);
    focused.push({ id, source, target, label, status, collapsed });
  };

  for (const edge of edges) {
    if (!keep.has(edge.source)) continue;

    if (keep.has(edge.target)) {
      push(edge.source, edge.target, edge.label, edge.status, false);
      continue;
    }

    const queue = [edge.target];
    const visited = new Set(queue);

    while (queue.length) {
      const current = queue.shift();

      for (const next of outgoing.get(current) || []) {
        if (keep.has(next.target)) {
          push(edge.source, next.target, edge.label, edge.status, true);
        } else if (!visited.has(next.target)) {
          visited.add(next.target);
          queue.push(next.target);
        }
      }
    }
  }

  return { nodes: nodes.filter((node) => keep.has(node.id)), edges: focused };
}

function layoutGraph(nodes, edges, rankdir) {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir,
    nodesep: 48,
    ranksep: 72,
    edgesep: 24,
    marginx: 32,
    marginy: 32,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_W, height: NODE_H });
  }

  const drawable = edges.filter(
    (edge) => graph.hasNode(edge.source) && graph.hasNode(edge.target)
  );

  for (const edge of drawable) {
    graph.setEdge(
      edge.source,
      edge.target,
      {
        width: edge.label ? 64 : 0,
        height: edge.label ? 18 : 0,
        labelpos: "c",
      },
      edge.id
    );
  }

  dagre.layout(graph);

  const laidOutNodes = nodes.map((node) => {
    const position = graph.node(node.id);
    return { ...node, x: position.x - NODE_W / 2, y: position.y - NODE_H / 2 };
  });

  const laidOutEdges = drawable.map((edge) => {
    const data = graph.edge({ v: edge.source, w: edge.target, name: edge.id });
    return { ...edge, points: data.points || [], labelX: data.x, labelY: data.y };
  });

  const size = graph.graph();

  return {
    nodes: laidOutNodes,
    edges: laidOutEdges,
    width: Math.max(480, size.width || 0),
    height: Math.max(200, size.height || 0),
  };
}

function wrapLabel(text, maxChars) {
  const words = String(text).split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines.slice(0, 3);
}

function edgeStroke(edge) {
  if (edge.status === "removed") return { stroke: "#dc3545", dash: "6 4" };
  if (edge.collapsed) return { stroke: "#8a96a3", dash: "3 4" };
  return { stroke: "#5c6778", dash: undefined };
}

function FlowDiagram({ nodes, edges, rankdir, markerId }) {
  const layout = useMemo(
    () => layoutGraph(nodes, edges, rankdir),
    [nodes, edges, rankdir]
  );

  return (
    <div className="report-flow-scroll">
      <svg
        className="report-flow-svg"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#5c6778" />
          </marker>
        </defs>

        {layout.edges.map((edge) => {
          if (edge.points.length < 2) return null;
          const { stroke, dash } = edgeStroke(edge);
          const d = edge.points
            .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
            .join(" ");
          const label = edge.collapsed
            ? `${edge.label ? `${edge.label} ` : ""}…`
            : edge.label;

          return (
            <g key={edge.id}>
              <path
                d={d}
                fill="none"
                stroke={stroke}
                strokeDasharray={dash}
                strokeWidth="1.5"
                markerEnd={`url(#${markerId})`}
              />
              {label && Number.isFinite(edge.labelX) ? (
                <text
                  x={edge.labelX}
                  y={edge.labelY + 4}
                  textAnchor="middle"
                  className="report-edge-label"
                >
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}

        {layout.nodes.map((node) => {
          const style = NODE_STYLES[node.changeType] || NODE_STYLES.unchanged;
          const titleLines = wrapLabel(node.label, 26);

          return (
            <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx="10"
                ry="10"
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth="2"
              />
              {titleLines.map((line, index) => (
                <text
                  key={index}
                  x={NODE_W / 2}
                  y={22 + index * 14}
                  textAnchor="middle"
                  className="report-node-title"
                >
                  {line}
                </text>
              ))}
              {node.subtitle ? (
                <text
                  x={NODE_W / 2}
                  y={NODE_H - 10}
                  textAnchor="middle"
                  className="report-node-sub"
                >
                  {String(node.subtitle).slice(0, 30)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SequenceSection({ sequence, view, index }) {
  return (
    <section className="report-sequence">
      <div className="report-sequence-header">
        <span className="report-sequence-kind">
          {sequence.isInitial ? "Starting task" : "Task"}
        </span>
        <span className="report-sequence-name">{sequence.name}</span>
        {sequence.changeType !== "unchanged" ? (
          <span className={`report-badge report-badge-${sequence.changeType}`}>
            {CHANGE_LABELS[sequence.changeType]}
          </span>
        ) : null}
        <span className="report-sequence-count">
          {sequence.changedCount} changed block(s)
        </span>
      </div>
      {view.nodes.length ? (
        <FlowDiagram
          nodes={view.nodes}
          edges={view.edges}
          rankdir={view.rankdir}
          markerId={`flowlenz-arrow-${index}`}
        />
      ) : (
        <p className="report-empty">No blocks in this task.</p>
      )}
    </section>
  );
}

function ConnectionsTable({ sections }) {
  const rows = sections.flatMap(({ sequence, view }) => {
    const labelById = new Map(view.nodes.map((node) => [node.id, node.label]));
    return view.edges.map((edge) => ({
      key: `${sequence.id}-${edge.id}`,
      task: sequence.name,
      from: labelById.get(edge.source) || edge.source,
      to: labelById.get(edge.target) || edge.target,
      path: `${edge.label || "—"}${edge.collapsed ? " (via hidden blocks)" : ""}${
        edge.status === "removed" ? " (removed)" : ""
      }`,
    }));
  });

  if (!rows.length) {
    return null;
  }

  let lastTask = null;

  return (
    <div className="report-connections">
      <h2>Connections (Saved Flow Wiring)</h2>
      <p className="report-connections-note">
        Wiring is derived from saved version with an explicit merge pass on
        branch blocks.
      </p>
      <div className="report-connections-scroll">
        <table className="report-connections-table">
          <thead>
            <tr>
              <th>From</th>
              <th>Path</th>
              <th>To</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((row) => {
              const cells = [];
              if (row.task !== lastTask) {
                lastTask = row.task;
                cells.push(
                  <tr key={`${row.key}-group`} className="report-connections-group">
                    <td colSpan={3}>{row.task}</td>
                  </tr>
                );
              }
              cells.push(
                <tr key={row.key}>
                  <td>{row.from}</td>
                  <td>{row.path}</td>
                  <td>{row.to}</td>
                </tr>
              );
              return cells;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportApp() {
  const [payload, setPayload] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState("focus");
  const [rankdir, setRankdir] = useState("TB");

  useEffect(() => {
    chrome.storage.session.get(STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        setLoadError(chrome.runtime.lastError.message);
        return;
      }

      const data = result[STORAGE_KEY];

      if (!data) {
        setLoadError(
          "No report data. Open FlowLenZ in Architect and use “Open Visual Change Report”."
        );
        return;
      }

      if (!Array.isArray(data.sequences)) {
        setLoadError(
          "This report was generated by an older FlowLenZ version. Reload the extension and open the report again."
        );
        return;
      }

      setPayload(data);
    });
  }, []);

  const sections = useMemo(
    () =>
      (payload?.sequences || []).map((sequence) => ({
        sequence,
        view: { ...focusSequence(sequence, mode), rankdir },
      })),
    [payload, mode, rankdir]
  );

  const onDownloadPdf = useCallback(() => {
    window.print();
  }, []);

  if (loadError || !payload) {
    return (
      <div className="report-shell">
        <div className="report-header">
          <h1>FlowLenZ — Visual Change Report</h1>
          {loadError ? (
            <p className="report-empty">{loadError}</p>
          ) : (
            <p className="report-meta">Loading…</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="report-shell">
      <div className="report-header">
        <h1>FlowLenZ — Visual Change Report</h1>
        <div className="report-meta">
          <div>
            <strong>{payload.flowName || "Flow"}</strong>
          </div>
          <div>
            Published: {payload.publishedVersion || "—"} · Saved:{" "}
            {payload.savedVersion || "—"}
          </div>
          {payload.generatedAt ? <div>Generated: {payload.generatedAt}</div> : null}
          <div>Changed blocks: {payload.changedBlockCount}</div>
        </div>
        <div className="report-toolbar">
          <button type="button" className="primary" onClick={onDownloadPdf}>
            Download PDF
          </button>
          <label className="report-control">
            View
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="focus">Changes + neighbors</option>
              <option value="full">Full task</option>
            </select>
          </label>
          <label className="report-control">
            Direction
            <select value={rankdir} onChange={(event) => setRankdir(event.target.value)}>
              <option value="TB">Top → Bottom (Architect)</option>
              <option value="LR">Left → Right</option>
            </select>
          </label>
          <div className="report-legend">
            <span className="legend-item">
              <span className="legend-swatch legend-added" /> Added
            </span>
            <span className="legend-item">
              <span className="legend-swatch legend-modified" /> Modified
            </span>
            <span className="legend-item">
              <span className="legend-swatch legend-removed" /> Removed
            </span>
            <span className="legend-item">
              <span className="legend-swatch legend-unchanged" /> Unchanged
            </span>
            <span className="legend-item">
              <span className="legend-line legend-line-removed" /> Removed wiring
            </span>
            <span className="legend-item">
              <span className="legend-line legend-line-collapsed" /> Via hidden blocks
            </span>
          </div>
        </div>
      </div>
      <div className="report-graph-wrap">
        {sections.length ? (
          sections.map(({ sequence, view }, index) => (
            <SequenceSection
              key={sequence.id}
              sequence={sequence}
              view={view}
              index={index}
            />
          ))
        ) : (
          <p className="report-empty">
            No changed blocks to display (published and saved match).
          </p>
        )}
      </div>
      <ConnectionsTable sections={sections} />
    </div>
  );
}

const root = createRoot(document.getElementById("report-root"));
root.render(<ReportApp />);
