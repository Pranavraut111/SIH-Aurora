/* Aurora — layout helpers for the dependency map. */

/** Column (depth) per node: longest path from a node with no inputs. */
export function layoutDepths(ids, edges) {
  const depth = Object.fromEntries(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass += 1) {
    let changed = false;
    edges.forEach(({ source, target }) => {
      if (depth[source] != null && depth[target] != null && depth[target] < depth[source] + 1) {
        depth[target] = depth[source] + 1;
        changed = true;
      }
    });
    if (!changed) break;
  }
  return depth;
}
