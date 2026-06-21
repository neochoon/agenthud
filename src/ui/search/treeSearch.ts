/**
 * Hierarchical narrow-finder helpers for the Session Tree search surface.
 *
 * Design decisions:
 * - A project-name match keeps ALL of its sessions (not just matching ones),
 *   mirroring how a user thinks of "search within project beta".
 * - Sub-agent matches bubble up to keep the ancestor chain visible so the
 *   user can see which project/session the match belongs to.
 * - `treeSearchHits` returns only session/sub-agent ids (not project sentinels)
 *   because ↑/↓ should land on selectable rows that open activity in the viewer.
 */

import type {
  ProjectNode,
  SessionNode,
  SessionTree,
} from "../../types/index.js";
import { hasMatch } from "./matcher.js";

function sessionText(s: SessionNode): string {
  return `${s.firstUserPrompt ?? ""} ${s.id} ${s.agentId ?? ""}`;
}

function filterSession(s: SessionNode, q: string): SessionNode | null {
  const subs = s.subAgents
    .map((sa) => filterSession(sa, q))
    .filter(Boolean) as SessionNode[];
  if (hasMatch(sessionText(s), q) || subs.length > 0)
    return { ...s, subAgents: subs };
  return null;
}

function filterProject(p: ProjectNode, q: string): ProjectNode | null {
  if (hasMatch(p.name, q)) return p; // project-name hit keeps all sessions
  const sessions = p.sessions
    .map((s) => filterSession(s, q))
    .filter(Boolean) as SessionNode[];
  return sessions.length > 0 ? { ...p, sessions } : null;
}

/** Hierarchically narrow the tree to nodes that match `query` (smart-case),
 * keeping ancestors of any match. Empty query returns the tree unchanged. */
export function filterTreeBySearch(
  tree: SessionTree,
  query: string,
): SessionTree {
  if (!query) return tree;
  const narrow = (projects: ProjectNode[]) =>
    projects
      .map((p) => filterProject(p, query))
      .filter(Boolean) as ProjectNode[];
  return {
    ...tree,
    projects: narrow(tree.projects),
    coldProjects: narrow(tree.coldProjects),
  };
}

/** Ids of matching session/sub-agent nodes in display order (for ↑/↓ selection). */
export function treeSearchHits(tree: SessionTree, query: string): string[] {
  if (!query) return [];
  const out: string[] = [];
  const walk = (s: SessionNode) => {
    if (hasMatch(sessionText(s), query)) out.push(s.id);
    s.subAgents.forEach(walk);
  };
  for (const grp of [tree.projects, tree.coldProjects]) {
    for (const p of grp) p.sessions.forEach(walk);
  }
  return out;
}
