/* ═══════════════════════════════════════════════════════════════
   Aurora — CascadeChainMini: a compact inline dependency chain
   visualisation for the incident card and dock popup.

   Shows the "killer chain": root cause → intermediate systems → affected
   endpoints, with animated flow indicators during active incidents.
   Uses station_config.json's dependency graph as the source of truth.
   ═══════════════════════════════════════════════════════════════ */
import { Box, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { buildingName, downstream } from './actions';
import { dependencyEdges } from '../data/stationConfig';

const SEVERITY_COLOUR = { critical: 'error', warning: 'warning', normal: 'default' };

/** Given sources and affected, reconstruct the shortest cascade paths through
 *  the dependency graph so we can draw the chain. */
function buildChainPaths(stationId, sources, affected) {
  const edges = dependencyEdges(stationId);
  const adj = {};
  edges.forEach((e) => {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  });
  const paths = [];
  const others = affected.filter((b) => !sources.includes(b));
  sources.forEach((src) => {
    // BFS from source to each affected node
    const visited = new Set([src]);
    const parent = { [src]: null };
    const queue = [src];
    while (queue.length) {
      const node = queue.shift();
      (adj[node] || []).forEach((next) => {
        if (!visited.has(next)) {
          visited.add(next);
          parent[next] = node;
          queue.push(next);
        }
      });
    }
    others.forEach((target) => {
      if (parent[target] === undefined) return;
      const path = [];
      let cur = target;
      while (cur !== null) {
        path.unshift(cur);
        cur = parent[cur];
      }
      if (path.length >= 2) paths.push(path);
    });
  });
  return paths;
}

/** A compact cascade chain: [Generator] → [Power Grid] → [Heating] → [Living Quarters] */
export default function CascadeChainMini({ stationId, sources = [], affected = [], severity = 'warning', resolved = false }) {
  if (!sources.length && !affected.length) return null;
  const paths = buildChainPaths(stationId, sources, affected);
  // Deduplicate: show the longest unique paths
  const unique = [];
  const seen = new Set();
  paths.sort((a, b) => b.length - a.length).forEach((p) => {
    const key = p.join('>');
    if (!seen.has(key)) { seen.add(key); unique.push(p); }
  });
  // If no graph paths found, just show sources → affected
  const chains = unique.length > 0 ? unique.slice(0, 3) : (sources.length && affected.length
    ? [sources.concat(affected.filter((b) => !sources.includes(b)))]
    : []);
  if (!chains.length) return null;
  const flowColor = severity === 'critical' ? 'error.main' : 'warning.main';
  return (
    <Box data-testid="cascade-chain-mini" sx={{ mt: 1 }}>
      {chains.map((chain, ci) => (
        <Stack key={ci} direction="row" sx={{
          gap: 0.5, flexWrap: 'wrap', alignItems: 'center', mb: chains.length > 1 ? 1 : 0,
        }}>
          {chain.map((nodeId, ni) => {
            const isSource = sources.includes(nodeId);
            const name = buildingName(stationId, nodeId);
            return (
              <Stack key={nodeId} direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                {ni > 0 && (
                  <Box
                    component="span"
                    aria-hidden="true"
                    sx={{
                      display: 'inline-flex', alignItems: 'center', color: resolved ? 'text.secondary' : flowColor,
                      fontSize: 14, fontWeight: 700,
                      ...(resolved ? {} : {
                        animation: 'aurora-flow-pulse 1.6s ease-in-out infinite',
                        animationDelay: `${ni * 0.2}s`,
                      }),
                    }}
                  >
                    →
                  </Box>
                )}
                <Tooltip title={`${name}${isSource ? ' (root cause)' : ' (affected)'}`} arrow placement="top">
                  <Chip
                    size="small"
                    variant={isSource ? 'filled' : 'outlined'}
                    color={isSource ? SEVERITY_COLOUR[severity] || 'error' : 'default'}
                    label={name}
                    sx={{
                      fontSize: 12, fontWeight: isSource ? 700 : 500, cursor: 'default',
                      ...(resolved ? { opacity: 0.6 } : {}),
                      ...(isSource && !resolved ? {
                        '--aurora-ring': (t) => `${t.vars.palette[SEVERITY_COLOUR[severity]]?.main || t.vars.palette.error.main}40`,
                        boxShadow: '0 0 0 2px var(--aurora-ring)',
                        animation: 'aurora-ring-pulse 2s ease-in-out infinite',
                      } : {}),
                    }}
                  />
                </Tooltip>
              </Stack>
            );
          })}
        </Stack>
      ))}
    </Box>
  );
}
