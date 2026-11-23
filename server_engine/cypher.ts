import { DemoDocument, DocumentGraphEntity, DocumentGraphRelationship } from "./types";

interface NodePattern {
  varName: string;
  labels: string[];
  props: Record<string, string | number>;
}

interface RelPattern {
  varName: string;
  relTypes: string[];
  direction: "right" | "left" | "both";
}

function parsePropsBlock(raw?: string): Record<string, string | number> {
  const props: Record<string, string | number> = {};
  if (!raw) return props;
  const rx = /([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?))/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(raw)) !== null) {
    const key = m[1];
    if (m[2] !== undefined) props[key] = m[2];
    else if (m[3] !== undefined) props[key] = m[3];
    else if (m[4] !== undefined) props[key] = Number(m[4]);
  }
  return props;
}

function parseNodePattern(raw: string): NodePattern {
  const inner = (raw || "").trim().replace(/^\(|\)$/g, "").trim();
  let props: Record<string, string | number> = {};
  const braceIdx = inner.indexOf("{");
  let head = inner;
  if (braceIdx !== -1) {
    const closeIdx = inner.lastIndexOf("}");
    const propStr = inner.slice(braceIdx + 1, closeIdx > braceIdx ? closeIdx : inner.length);
    props = parsePropsBlock(propStr);
    head = inner.slice(0, braceIdx).trim();
  }
  const parts = head.split(":").map((s) => s.trim()).filter(Boolean);
  const varName = parts[0] && !head.startsWith(":") ? parts[0] : "n";
  const labels = head.startsWith(":") ? parts : parts.slice(1);
  return { varName, labels, props };
}

function parseRelPattern(rawRel: string, leftArrow: string, rightArrow: string): RelPattern {
  const inner = (rawRel || "").trim().replace(/^\[|\]$/g, "").trim();
  const cleanHead = inner.split("{")[0].trim();
  const colonIdx = cleanHead.indexOf(":");
  let varName = "r";
  let relTypes: string[] = [];
  if (colonIdx !== -1) {
    varName = cleanHead.slice(0, colonIdx).trim() || "r";
    relTypes = cleanHead
      .slice(colonIdx + 1)
      .split("|")
      .map((s) => s.replace(/^:/, "").trim().toUpperCase())
      .filter(Boolean);
  } else if (cleanHead) {
    varName = cleanHead;
  }
  const direction: "right" | "left" | "both" =
    rightArrow === "->" && leftArrow === "-"
      ? "right"
      : leftArrow === "<-" && rightArrow === "-"
        ? "left"
        : "both";
  return { varName, relTypes, direction };
}

function resolveNodeForEndpoint(
  endpointName: string,
  nodes: DocumentGraphEntity[]
): DocumentGraphEntity | undefined {
  const low = (endpointName || "").toLowerCase();
  return (
    nodes.find((n) => (n.name || "").toLowerCase() === low || n.id.toLowerCase() === low) ||
    undefined
  );
}

function nodeMatchesPattern(
  node: DocumentGraphEntity | undefined,
  fallbackName: string,
  pattern: NodePattern,
  docId: number
): boolean {
  if (pattern.labels.length > 0) {
    if (!node) return false;
    const nodeLblLow = (node.label || "").toLowerCase();
    const labelMatched = pattern.labels.some((lbl) => lbl.toLowerCase() === nodeLblLow);
    if (!labelMatched) return false;
  }
  for (const [k, expected] of Object.entries(pattern.props)) {
    if (k === "document_id") {
      if (Number(expected) !== docId) return false;
      continue;
    }
    const actual =
      k === "name"
        ? node?.name || fallbackName
        : k === "label"
          ? node?.label
          : k === "id"
            ? node?.id
            : k === "source_page"
              ? node?.source_page
              : node?.properties?.[k];
    if (actual === undefined || String(actual).toLowerCase() !== String(expected).toLowerCase()) {
      return false;
    }
  }
  return true;
}

function getFieldVal(
  token: string,
  ctx: {
    srcVar: string;
    tgtVar: string;
    relVar: string;
    srcNode?: DocumentGraphEntity;
    tgtNode?: DocumentGraphEntity;
    srcName: string;
    tgtName: string;
    edge?: DocumentGraphRelationship;
    docId: number;
  }
): string | number | undefined {
  const clean = token.trim();
  const typeMatch = clean.match(/^type\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)$/i);
  if (typeMatch) {
    return ctx.edge?.relation;
  }
  const propMatch = clean.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (!propMatch) return undefined;
  const [, v, prop] = propMatch;
  const node = v === ctx.srcVar ? ctx.srcNode : v === ctx.tgtVar ? ctx.tgtNode : undefined;
  const nameFallback = v === ctx.srcVar ? ctx.srcName : v === ctx.tgtVar ? ctx.tgtName : undefined;
  if (v === ctx.relVar && ctx.edge) {
    if (prop === "type" || prop === "relation") return ctx.edge.relation;
    if (prop === "document_id") return ctx.docId;
    if (prop === "source_page") return ctx.edge.source_page;
    return undefined;
  }
  if (prop === "name") return node?.name || nameFallback;
  if (prop === "label") return node?.label;
  if (prop === "id") return node?.id;
  if (prop === "document_id") return ctx.docId;
  if (prop === "source_page") return node?.source_page ?? ctx.edge?.source_page;
  return node?.properties?.[prop];
}

function evalSingleCondition(
  cond: string,
  ctx: Parameters<typeof getFieldVal>[1]
): boolean {
  const c = cond.trim();
  if (!c) return true;

  // CONTAINS / STARTS WITH / ENDS WITH
  const strOpM = c.match(/^(.+?)\s+(CONTAINS|STARTS\s+WITH|ENDS\s+WITH)\s+['"]([^'"]*)['"]$/i);
  if (strOpM) {
    const val = String(getFieldVal(strOpM[1], ctx) ?? "").toLowerCase();
    const target = strOpM[3].toLowerCase();
    const op = strOpM[2].toUpperCase().replace(/\s+/g, " ");
    if (op === "CONTAINS") return val.includes(target);
    if (op === "STARTS WITH") return val.startsWith(target);
    if (op === "ENDS WITH") return val.endsWith(target);
  }

  // = / <> / !=
  const cmpM = c.match(/^(.+?)\s*(=|<>|!=)\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?))$/);
  if (cmpM) {
    const actual = getFieldVal(cmpM[1], ctx);
    const expected = cmpM[3] ?? cmpM[4] ?? cmpM[5];
    const eq = String(actual ?? "").toLowerCase() === String(expected ?? "").toLowerCase();
    return cmpM[2] === "=" ? eq : !eq;
  }

  // Node label predicate in WHERE e.g. "n:Carrier"
  const lblM = c.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (lblM) {
    const node = lblM[1] === ctx.srcVar ? ctx.srcNode : lblM[1] === ctx.tgtVar ? ctx.tgtNode : undefined;
    return (node?.label || "").toLowerCase() === lblM[2].toLowerCase();
  }

  return true;
}

function evaluateWhereClause(whereRaw: string | undefined, ctx: Parameters<typeof getFieldVal>[1]): boolean {
  if (!whereRaw || !whereRaw.trim()) return true;
  // Support OR groups split around top-level OR, each containing AND predicates
  const orGroups = whereRaw.split(/\s+OR\s+/i);
  return orGroups.some((grp) => {
    const andParts = grp.split(/\s+AND\s+/i);
    return andParts.every((p) => evalSingleCondition(p, ctx));
  });
}

export function executeReadOnlyCypherQuery(
  cypher: string,
  doc: DemoDocument
): Array<Record<string, any>> {
  const cleanCypher = (cypher || "").replace(/\s+/g, " ").trim().replace(/;$/, "");
  const limitMatch = cleanCypher.match(/\bLIMIT\s+(\d+)\b/i);
  const limit = limitMatch ? Math.max(1, Math.min(500, Number(limitMatch[1]))) : 100;

  const whereMatch = cleanCypher.match(/\bWHERE\s+(.+?)(?=\s+RETURN\b|\s+ORDER\b|\s+LIMIT\b|$)/i);
  const whereClause = whereMatch?.[1]?.trim();

  const matchBodyM = cleanCypher.match(/\bMATCH\s+(.+?)(?=\s+WHERE\b|\s+RETURN\b|\s+LIMIT\b|$)/i);
  const matchBody = matchBodyM?.[1]?.trim() || "(n)-[r]->(m)";

  const nodes = (doc.graph_nodes || []).filter((n) => n.document_id === doc.id);
  const edges = (doc.graph_edges || []).filter((e) => e.document_id === doc.id);

  // Check relationship pattern: (a)-[r]-(b) or (a)<-[r]-(b) or (a)-[r]->(b)
  const relMatch = matchBody.match(
    /^(\([^)]*\))\s*(<-|-)\s*(\[[^\]]*\])?\s*(->|-)\s*(\([^)]*\))$/
  );

  if (relMatch) {
    const leftNodePat = parseNodePattern(relMatch[1]);
    const relPat = parseRelPattern(relMatch[3] || "[r]", relMatch[2], relMatch[4]);
    const rightNodePat = parseNodePattern(relMatch[5]);

    const rows: Array<Record<string, any>> = [];
    for (const edge of edges) {
      if (
        relPat.relTypes.length > 0 &&
        !relPat.relTypes.includes(edge.relation.toUpperCase())
      ) {
        continue;
      }

      const origSrcNode = resolveNodeForEndpoint(edge.source, nodes);
      const origTgtNode = resolveNodeForEndpoint(edge.target, nodes);

      const candidateOrientations: Array<{
        srcName: string;
        tgtName: string;
        srcNode?: DocumentGraphEntity;
        tgtNode?: DocumentGraphEntity;
      }> = [];

      if (relPat.direction === "right") {
        candidateOrientations.push({
          srcName: edge.source,
          tgtName: edge.target,
          srcNode: origSrcNode,
          tgtNode: origTgtNode
        });
      } else if (relPat.direction === "left") {
        candidateOrientations.push({
          srcName: edge.target,
          tgtName: edge.source,
          srcNode: origTgtNode,
          tgtNode: origSrcNode
        });
      } else {
        candidateOrientations.push({
          srcName: edge.source,
          tgtName: edge.target,
          srcNode: origSrcNode,
          tgtNode: origTgtNode
        });
        if (edge.source !== edge.target) {
          candidateOrientations.push({
            srcName: edge.target,
            tgtName: edge.source,
            srcNode: origTgtNode,
            tgtNode: origSrcNode
          });
        }
      }

      for (const orient of candidateOrientations) {
        if (
          !nodeMatchesPattern(orient.srcNode, orient.srcName, leftNodePat, doc.id) ||
          !nodeMatchesPattern(orient.tgtNode, orient.tgtName, rightNodePat, doc.id)
        ) {
          continue;
        }

        const passedWhere = evaluateWhereClause(whereClause, {
          srcVar: leftNodePat.varName,
          tgtVar: rightNodePat.varName,
          relVar: relPat.varName,
          srcNode: orient.srcNode,
          tgtNode: orient.tgtNode,
          srcName: orient.srcName,
          tgtName: orient.tgtName,
          edge,
          docId: doc.id
        });
        if (!passedWhere) continue;

        rows.push({
          Source: edge.source,
          Source_Label: origSrcNode?.label || "Entity",
          Relation: edge.relation,
          Target: edge.target,
          Target_Label: origTgtNode?.label || "Entity",
          Document_ID: edge.document_id,
          Source_Page: edge.source_page,
          Source_Chunk_ID: edge.source_chunk_id
        });
        break; // Avoid duplicate row for same edge when undirected matches both orientations
      }

      if (rows.length >= limit) break;
    }
    return rows;
  }

  // Single-node pattern: MATCH (n[:Label] [{props}]) ... RETURN ...
  const singleNodeMatch = matchBody.match(/^(\([^)]*\))$/);
  if (singleNodeMatch) {
    const nodePat = parseNodePattern(singleNodeMatch[1]);
    const rows: Array<Record<string, any>> = [];
    for (const node of nodes) {
      const displayName = node.name || node.id;
      if (!nodeMatchesPattern(node, displayName, nodePat, doc.id)) continue;
      const passedWhere = evaluateWhereClause(whereClause, {
        srcVar: nodePat.varName,
        tgtVar: "__none__",
        relVar: "__none__",
        srcNode: node,
        srcName: displayName,
        tgtName: "",
        docId: doc.id
      });
      if (!passedWhere) continue;
      rows.push({
        Node: displayName,
        Label: node.label,
        Document_ID: node.document_id,
        Source_Page: node.source_page,
        Source_Chunk_ID: node.source_chunk_id,
        ...(node.properties ? { Properties: node.properties } : {})
      });
      if (rows.length >= limit) break;
    }
    return rows;
  }

  // Fallback bounded edge output when complex multi-hop query provided
  return edges.slice(0, limit).map((e) => ({
    Source: e.source,
    Relation: e.relation,
    Target: e.target,
    Document_ID: e.document_id,
    Source_Page: e.source_page,
    Source_Chunk_ID: e.source_chunk_id
  }));
}
