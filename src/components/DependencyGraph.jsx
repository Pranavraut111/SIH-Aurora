/* ═══════════════════════════════════════════════════════════════
   Aurora — Dependency Graph Visualization
   Interactive node diagram showing building dependencies
   and cascading failure analysis
   ═══════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LuLayers, LuShieldCheck, LuTriangleAlert, LuZap } from 'react-icons/lu';
import './DependencyGraph.css';
import { buildingList, dependencyEdges } from '../data/stationConfig';

// ── Graph Layout (positions only; names, abbreviations and edges come from station_config.json) ──
const NODE_POSITIONS = {
  storage:         { x: 170, y: 60 },
  generator:       { x: 400, y: 60 },
  heating:         { x: 200, y: 180 },
  heatingB:        { x: 560, y: 180 },
  waterTank:       { x: 380, y: 200 },
  commsMast:       { x: 700, y: 120 },
  livingQuarters:  { x: 300, y: 330 },
  lab:             { x: 580, y: 330 },
};

function graphFor(stationId) {
  const nodes = Object.fromEntries(buildingList(stationId).map((b) => [b.id, {
    ...(NODE_POSITIONS[b.id] || { x: 60, y: 380 }),
    label: b.name, abbr: b.abbr, module: b.module,
  }]));
  const edges = dependencyEdges(stationId).map((e) => ({ source: e.source, target: e.target, label: e.relation }));
  return { nodes, edges };
}

const ALERT_COLORS = {
  normal:   'var(--status-success)',
  warning:  'var(--status-warning)',
  critical: 'var(--status-critical)',
};

export default function DependencyGraph({
  alerts = {},
  onNodeClick,
  dependencyAlerts = [],
  aiHealth = 'healthy',
  stationId = 'maitri',
}) {
  const { nodes: GRAPH_NODES, edges: GRAPH_EDGES } = graphFor(stationId);
  const svgRef = useRef(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 420 });

  // Find edges affected by cascades
  const cascadeEdges = new Set();
  dependencyAlerts.forEach(d => {
    const key = `${d.sourceBuilding}-${d.affectedBuilding}`;
    cascadeEdges.add(key);
  });

  // Determine which nodes are at risk from cascades
  const atRiskNodes = new Set(dependencyAlerts.map(d => d.affectedBuilding));

  return (
    <motion.div
      className="dep-graph glass-panel"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {/* Header */}
      <div className="dep-graph-header">
        <div className="dep-graph-title-row">
          <LuLayers size={16} strokeWidth={1.5} className="dep-graph-icon" />
          <h3 className="dep-graph-title font-display">Dependency Graph</h3>
          <span className={`dep-health-badge badge badge-${aiHealth === 'healthy' ? 'success' : aiHealth === 'degraded' ? 'warning' : 'critical'}`}>
            {aiHealth === 'healthy' ? <><LuShieldCheck size={12} /> Healthy</> : aiHealth === 'degraded' ? <><LuTriangleAlert size={12} /> Degraded</> : <><LuTriangleAlert size={12} /> Critical</>}
          </span>
        </div>
        <p className="dep-graph-subtitle text-caption">
          Aurora anomaly monitoring · Cascade failure analysis
        </p>
      </div>

      {/* SVG Graph */}
      <div className="dep-graph-canvas">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          className="dep-svg"
        >
          {/* Defs for markers and filters */}
          <defs>
            <marker id="arrowNormal" viewBox="0 0 10 7" refX="10" refY="3.5"
              markerWidth="8" markerHeight="6" orient="auto-start-reverse">
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--text-muted)" opacity="0.4" />
            </marker>
            <marker id="arrowCascade" viewBox="0 0 10 7" refX="10" refY="3.5"
              markerWidth="8" markerHeight="6" orient="auto-start-reverse">
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--status-warning)" opacity="0.8" />
            </marker>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Edges */}
          {GRAPH_EDGES.map((edge, i) => {
            const src = GRAPH_NODES[edge.source];
            const tgt = GRAPH_NODES[edge.target];
            if (!src || !tgt) return null;

            const edgeKey = `${edge.source}-${edge.target}`;
            const isCascade = cascadeEdges.has(edgeKey);
            const isHovered = hoveredNode === edge.source || hoveredNode === edge.target;

            // Calculate offset for arrow (don't overlap node circle)
            const dx = tgt.x - src.x;
            const dy = tgt.y - src.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const nx = dx / len;
            const ny = dy / len;
            const r = 28;

            return (
              <g key={i}>
                <line
                  x1={src.x + nx * r}
                  y1={src.y + ny * r}
                  x2={tgt.x - nx * r}
                  y2={tgt.y - ny * r}
                  className={`dep-edge ${isCascade ? 'cascade' : ''} ${isHovered ? 'hovered' : ''}`}
                  markerEnd={isCascade ? 'url(#arrowCascade)' : 'url(#arrowNormal)'}
                />
                {isCascade && (
                  <line
                    x1={src.x + nx * r}
                    y1={src.y + ny * r}
                    x2={tgt.x - nx * r}
                    y2={tgt.y - ny * r}
                    className="dep-edge-pulse"
                  />
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {Object.entries(GRAPH_NODES).map(([id, node]) => {
            const alertLevel = alerts[id] || 'normal';
            const isAtRisk = atRiskNodes.has(id);
            const isHovered = hoveredNode === id;
            const color = ALERT_COLORS[alertLevel] || ALERT_COLORS.normal;

            return (
              <g
                key={id}
                className={`dep-node ${alertLevel} ${isAtRisk ? 'at-risk' : ''}`}
                onMouseEnter={() => setHoveredNode(id)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => onNodeClick?.(id)}
                style={{ cursor: 'pointer' }}
              >
                {/* Glow circle for alerts */}
                {alertLevel !== 'normal' && (
                  <circle
                    cx={node.x} cy={node.y} r={34}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    opacity="0.3"
                    filter="url(#glow)"
                  />
                )}

                {/* At-risk pulse ring */}
                {isAtRisk && alertLevel === 'normal' && (
                  <circle
                    cx={node.x} cy={node.y} r={30}
                    fill="none"
                    stroke="var(--status-warning)"
                    strokeWidth="1.5"
                    opacity="0.4"
                    className="risk-pulse"
                  />
                )}

                {/* Main circle */}
                <circle
                  cx={node.x} cy={node.y}
                  r={isHovered ? 28 : 24}
                  className="dep-node-circle"
                  fill={alertLevel !== 'normal' ? color : 'var(--bg-surface-raised)'}
                  fillOpacity={alertLevel !== 'normal' ? 0.15 : 0.8}
                  stroke={color}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                />

                {/* Icon */}
                <text
                  x={node.x} y={node.y + 1}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="11"
                  fontWeight="700"
                  fontFamily="var(--font-mono)"
                  letterSpacing="0.04em"
                  className="dep-node-icon"
                >
                  {node.abbr}
                </text>

                {/* Label */}
                <text
                  x={node.x} y={node.y + 40}
                  textAnchor="middle"
                  className="dep-node-label"
                  fill={isHovered ? 'var(--text-primary)' : 'var(--text-secondary)'}
                  fontSize="10"
                  fontWeight={isHovered ? '600' : '400'}
                >
                  {node.label}
                </text>

                {/* Alert badge */}
                {alertLevel !== 'normal' && (
                  <g>
                    <circle
                      cx={node.x + 18} cy={node.y - 18} r={8}
                      fill={color}
                    />
                    <text
                      x={node.x + 18} y={node.y - 17}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="8"
                      fill="white"
                      fontWeight="bold"
                    >
                      {alertLevel === 'critical' ? '!' : '!'}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Cascade alerts list */}
      <AnimatePresence>
        {dependencyAlerts.length > 0 && (
          <motion.div
            className="dep-cascade-list"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <h4 className="dep-cascade-title"><LuZap size={14} strokeWidth={1.5} /> Cascade Risks</h4>
            {dependencyAlerts.map((alert, i) => (
              <div key={i} className={`dep-cascade-item ${alert.severity}`}>
                <span className="dep-cascade-chain">
                  {alert.sourceName} → {alert.affectedName}
                </span>
                <span className={`badge badge-${alert.severity}`}>
                  {alert.severity}
                </span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
