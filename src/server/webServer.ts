/**
 * `agenthud web` — a local browser UI over the same data the TUI reads.
 *
 * Design decisions:
 * - `node:http` only, and a single self-contained HTML file served
 *   verbatim. No bundler, no framework, no CDN: the page has to work
 *   offline, on the machine that runs it, with `npx agenthud web`.
 * - LOOPBACK ONLY. The server refuses to bind anything but 127.0.0.1 /
 *   ::1 and rejects a `Host` header that isn't `127.0.0.1:<port>` /
 *   `localhost:<port>` — that second check is the DNS-rebinding guard,
 *   without which a web page could point a hostname at 127.0.0.1 and
 *   read the user's transcripts.
 * - Every request needs the per-run token (header `X-Agenthud-Token`,
 *   or `?token=` on the very first navigation). The token is random per
 *   process and is printed as part of the URL, so another local app (or
 *   a stray browser tab) can't drive the API.
 * - The API is deliberately small and read-mostly: the tree and one
 *   session's activities are the TUI's two panes; report/summary reuse
 *   the existing `generateReport` / `runSummary` code paths so the
 *   browser and the CLI cannot drift apart.
 * - Activity requests are validated against the CURRENTLY discovered
 *   session files. `?path=` is a client-supplied string, so trusting it
 *   would turn this into an arbitrary-file reader over HTTP.
 *
 * Gotchas:
 * - `runSummary` is a long, chatty operation (30-90s, progress on
 *   stderr). The server calls it with `quiet: true` and reads the
 *   result back from the cache file, so a summary request never sprays
 *   markdown into the server's own stdout.
 * - Discovery runs per request. That is the same cadence the TUI uses
 *   (2s poll) and the providers memoize by mtime, so a warm tree is
 *   tens of milliseconds; the first request after start is the slow one.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_INCLUDE_TYPES } from "../config/globalConfig.js";
import { generateReport } from "../data/reportGenerator.js";
import { projectRefsFromTree, resolveScopes } from "../data/scope.js";
import { parseSessionHistory } from "../data/sessionHistory.js";
import { discoverSessions } from "../data/sessions.js";
import {
  listSummaries,
  stripExistingHeaderBlock,
} from "../data/summariesIndex.js";
import {
  dailySummaryPath,
  rangeSummaryPath,
  runRangeSummary,
  runSummary,
} from "../data/summaryRunner.js";
import { resolveStyleReference } from "../data/summaryStyle.js";
import type {
  ActivityEntry,
  GlobalConfig,
  SessionNode,
  SessionTree,
} from "../types/index.js";
import { agenthudHome } from "../utils/agenthudHome.js";
import { openInDefaultApp } from "../utils/openInDefaultApp.js";

// --- payload shapes (what the browser consumes) ----------------------------

export interface SessionPayload {
  id: string;
  short: string;
  /** Absolute session log path. The UI sends it back on /api/activity;
   * the server still validates it against current discovery, so a
   * tampered value is a 404 rather than a file read. */
  filePath: string;
  provider: string | null;
  status: string;
  live: string | null;
  model: string | null;
  ctxPercent: number | null;
  version: string | null;
  title: string | null;
  lastModifiedMs: number;
  hidden: boolean;
  subAgents?: SessionPayload[];
}

export interface ProjectPayload {
  name: string;
  path: string;
  hotness: string;
  hidden: boolean;
  sessions: SessionPayload[];
}

export interface TreePayload {
  generatedAt: number;
  totalCount: number;
  hidden: { total: number; active: number };
  /** Set when the server was started with a scope (`agenthud web --cwd`),
   * so the UI can preselect it in its project selector. */
  initialScopes?: string[];
  projects: ProjectPayload[];
}

export interface ActivityPayload {
  sessionId: string;
  filePath: string;
  count: number;
  activities: Array<{
    t: number;
    time: string;
    type: string;
    icon: string;
    label: string;
    detail: string;
    body?: string;
    bodyKind?: string;
    numbered?: boolean;
    count?: number;
  }>;
}

/** `session-9760ce18-…` → `9760`: the same compact id the TUI shows. */
export function shortSessionId(id: string): string {
  return id.replace(/^session-/, "").slice(0, 4);
}

export function sessionPayload(node: SessionNode): SessionPayload {
  return {
    id: node.id,
    short: shortSessionId(node.id),
    filePath: node.filePath,
    provider: node.provider ?? null,
    status: node.status,
    live: node.liveState,
    model: node.modelName,
    ctxPercent: node.contextUsage?.percent ?? null,
    version: node.version ?? null,
    title: node.firstUserPrompt,
    lastModifiedMs: node.lastModifiedMs,
    hidden: node.hidden === true,
    ...(node.agentId === undefined
      ? { subAgents: node.subAgents.map(sessionPayload) }
      : {}),
  };
}

export function buildTreePayload(
  tree: SessionTree,
  now = Date.now(),
  initialScopes?: string[],
): TreePayload {
  const project = (p: SessionTree["projects"][number]): ProjectPayload => ({
    name: p.name,
    path: p.projectPath,
    hotness: p.hotness,
    hidden: p.hidden === true,
    sessions: p.sessions.map(sessionPayload),
  });
  return {
    generatedAt: now,
    totalCount: tree.totalCount,
    hidden: { total: tree.hiddenStats.total, active: tree.hiddenStats.active },
    ...(initialScopes?.length ? { initialScopes } : {}),
    projects: [...tree.projects, ...tree.coldProjects].map(project),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function hhmmss(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function buildActivityPayload(
  sessionId: string,
  filePath: string,
  activities: ActivityEntry[],
): ActivityPayload {
  return {
    sessionId,
    filePath,
    count: activities.length,
    activities: activities.map((a) => ({
      t: a.timestamp.getTime(),
      time: hhmmss(a.timestamp),
      type: a.type,
      icon: a.icon,
      label: a.label,
      detail: a.detail,
      ...(a.detailBody ? { body: a.detailBody } : {}),
      ...(a.detailKind ? { bodyKind: a.detailKind } : {}),
      ...(a.detailNumbered ? { numbered: true } : {}),
      ...(a.count && a.count > 1 ? { count: a.count } : {}),
    })),
  };
}

/** Flatten a tree to `id → filePath`, for validating activity requests. */
export function indexSessionFiles(tree: SessionTree): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (nodes: SessionNode[]) => {
    for (const n of nodes) {
      map.set(n.id, n.filePath);
      walk(n.subAgents);
    }
  };
  for (const p of [...tree.projects, ...tree.coldProjects]) walk(p.sessions);
  return map;
}

/** The summary file body, minus the auto-managed backlink block and the
 * engine provenance comment, with the title line kept so the browser
 * shows which day/scope it is. */
export function summaryBodyForFile(content: string): string {
  const title = content.match(/^# .+$/m)?.[0] ?? "";
  const body = stripExistingHeaderBlock(content)
    .replace(/^\s*<!--\s*agenthud-engine:[^>]*-->\s*$/gm, "")
    .trim();
  return title ? `${title}\n\n${body}` : body;
}

// --- server ----------------------------------------------------------------

export interface WebServerOptions {
  config: GlobalConfig;
  port?: number; // default 7787; 0 = ephemeral
  host?: string; // default 127.0.0.1 (loopback only)
  openBrowser?: boolean;
  /** Initial scope, so `agenthud web --cwd` opens on that project. */
  scopeToProjects?: string[];
}

export interface WebServerHandle {
  url: string;
  port: number;
  token: string;
  close: () => Promise<void>;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const MAX_BODY_BYTES = 64 * 1024;

function uiHtmlPath(): string {
  // Dev: src/server/web-ui.html next to this module. Bundled: dist/web-ui.html
  // (tsup's onSuccess copies it), which is also `dirname` of the bundle.
  return join(dirname(fileURLToPath(import.meta.url)), "web-ui.html");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  contentType: string,
): void {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function parseDate(value: string | null): Date {
  if (value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (
        d.getFullYear() === Number(m[1]) &&
        d.getMonth() === Number(m[2]) - 1 &&
        d.getDate() === Number(m[3])
      ) {
        return d;
      }
    }
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Hard cap on a requested range: beyond this the payload (and, for a
 * summary, the number of engine calls) stops being a reasonable ask. */
const MAX_RANGE_DAYS = 62;

/** Inclusive day list for a `from`/`to` pair, or an error message. */
function enumerateDays(
  fromRaw: string | null,
  toRaw: string | null,
): { ok: true; days: Date[] } | { ok: false; error: string } {
  if (!fromRaw || !toRaw) {
    return { ok: false, error: "from 和 to 必须同时给出（格式 YYYY-MM-DD）" };
  }
  const from = parseDate(fromRaw);
  const to = parseDate(toRaw);
  if (isoDate(from) !== fromRaw || isoDate(to) !== toRaw) {
    return { ok: false, error: "日期格式必须是 YYYY-MM-DD" };
  }
  if (from.getTime() > to.getTime()) {
    return { ok: false, error: "起始日期不能晚于结束日期" };
  }
  const days: Date[] = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
    if (days.length > MAX_RANGE_DAYS) {
      return { ok: false, error: `范围超过 ${MAX_RANGE_DAYS} 天，请缩小范围` };
    }
  }
  return { ok: true, days };
}

/** One markdown document for a multi-day range: each day's report body
 * under a `## <date>` heading (the per-day H1 would otherwise repeat). */
export function joinDailyReports(
  days: Array<{ date: string; content: string }>,
): string {
  if (days.length === 0) return "（无活动）";
  if (days.length === 1) return days[0].content;
  const header = `# AgentHUD Report: ${days[0].date} → ${days[days.length - 1].date}`;
  const parts = days.map((d) => {
    const body = d.content.replace(/^# AgentHUD Report: .*\n+/, "").trim();
    return `## ${d.date}\n\n${body || "（无活动）"}`;
  });
  return `${header}\n\n${parts.join("\n\n")}`;
}

export async function startWebServer(
  opts: WebServerOptions,
): Promise<WebServerHandle> {
  const host = opts.host ?? "127.0.0.1";
  if (!LOOPBACK.has(host)) {
    throw new Error(
      `refusing to bind ${host}: the web UI is loopback-only (127.0.0.1)`,
    );
  }
  const token = randomBytes(16).toString("hex");
  const config = opts.config;

  const discover = () => discoverSessions(config);

  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: message });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);

    // DNS-rebinding guard: a page served from evil.example can be made to
    // resolve to 127.0.0.1, but it cannot fake this Host header.
    const hostHeader = (req.headers.host ?? "").toLowerCase();
    const portNow = (server.address() as { port: number } | null)?.port;
    const allowedHosts = new Set([
      `127.0.0.1:${portNow}`,
      `localhost:${portNow}`,
      `[::1]:${portNow}`,
    ]);
    if (!allowedHosts.has(hostHeader)) {
      sendJson(res, 403, { ok: false, error: "unexpected Host header" });
      return;
    }

    if (
      req.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/index.html")
    ) {
      const htmlPath = uiHtmlPath();
      if (!existsSync(htmlPath)) {
        sendText(
          res,
          500,
          "agenthud: web-ui.html is missing from the install.\n",
          "text/plain; charset=utf-8",
        );
        return;
      }
      sendText(
        res,
        200,
        readFileSync(htmlPath, "utf-8"),
        "text/html; charset=utf-8",
      );
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { ok: false, error: "not found" });
      return;
    }

    const provided =
      req.headers["x-agenthud-token"]?.toString() ??
      url.searchParams.get("token") ??
      "";
    if (provided !== token) {
      sendJson(res, 401, { ok: false, error: "invalid or missing token" });
      return;
    }

    // --- read-only endpoints ------------------------------------------------
    if (req.method === "GET" && url.pathname === "/api/tree") {
      sendJson(
        res,
        200,
        buildTreePayload(discover(), Date.now(), opts.scopeToProjects),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/activity") {
      const id = url.searchParams.get("id") ?? "";
      const requestedPath = url.searchParams.get("path");
      const tree = discover();
      const files = indexSessionFiles(tree);
      const actual = files.get(id);
      // The server owns the path (it comes from discovery). A client that
      // sends `path` at all must send the one we discovered — anything
      // else is a tampered request, not a file-read primitive.
      if (!actual || (requestedPath !== null && requestedPath !== actual)) {
        sendJson(res, 404, {
          ok: false,
          error: "unknown session (it may have been removed)",
        });
        return;
      }
      const activities = parseSessionHistory(actual);
      sendJson(res, 200, buildActivityPayload(id, actual, activities));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/report") {
      // `?scope=` ABSENT → the server's initial whitelist
      // (`agenthud web --cwd`); present-but-empty (`?scope=`) → every
      // project. Conflating the two would make the picker unable to widen
      // back out.
      const scopeParams = url.searchParams.getAll("scope");
      const resolvedParams = scopeParams
        .flatMap((s) => s.split(","))
        .map((s) => s.trim())
        .filter(Boolean);
      const scopeList =
        scopeParams.length === 0
          ? (opts.scopeToProjects ?? [])
          : resolvedParams;
      const format =
        url.searchParams.get("format") === "json" ? "json" : "markdown";
      const tree = scopeList.length
        ? discoverSessions(config, { scopeToProjects: scopeList })
        : discover();
      const flat = [
        ...tree.projects.flatMap((p) => p.sessions),
        ...tree.coldProjects.flatMap((p) => p.sessions),
      ];
      const reportFor = (d: Date) =>
        generateReport(flat, {
          date: d,
          include: config.summary.include ?? config.report.include,
          format,
          detailLimit: config.summary.detailLimit ?? config.report.detailLimit,
          withGit: config.summary.withGit ?? config.report.withGit,
        });

      // Range request (`from` + `to`) → one document, one section per day.
      const fromRaw = url.searchParams.get("from");
      const toRaw = url.searchParams.get("to");
      if (fromRaw !== null || toRaw !== null) {
        const range = enumerateDays(fromRaw, toRaw);
        if (!range.ok) {
          sendJson(res, 400, { ok: false, error: range.error });
          return;
        }
        const days = range.days.map((d) => ({
          date: isoDate(d),
          content: reportFor(d),
        }));
        sendJson(res, 200, {
          from: days[0].date,
          to: days[days.length - 1].date,
          scopes: scopeList,
          format,
          days: days.map((d) => d.date),
          content: joinDailyReports(days),
        });
        return;
      }

      const date = parseDate(url.searchParams.get("date"));
      const content = reportFor(date);
      sendJson(res, 200, {
        date: url.searchParams.get("date") ?? "",
        scopes: scopeList,
        format,
        content,
      });
      return;
    }

    // Which style reference the next summary run would use. Read-only and
    // cheap: the UI shows it beside the toggle, so "my style file is
    // actually being picked up" is verifiable without generating anything.
    if (req.method === "GET" && url.pathname === "/api/style") {
      const style = resolveStyleReference({
        path:
          typeof config.summary.style === "string"
            ? config.summary.style
            : undefined,
        disabled: config.summary.style === false,
      });
      sendJson(res, 200, {
        path: style.path,
        chars: style.text ? style.text.length : 0,
        truncated: style.truncated,
        error: style.error ?? "",
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/summaries") {
      const dir = join(agenthudHome(), "summaries");
      const entries = listSummaries(dir).map((e) => ({
        filename: e.filename,
        kind: e.kind,
        scope: e.scope ?? "",
        label:
          e.kind === "daily"
            ? `${e.date.getFullYear()}-${pad2(e.date.getMonth() + 1)}-${pad2(e.date.getDate())}`
            : `${e.from.toISOString().slice(0, 10)} → ${e.to.toISOString().slice(0, 10)}`,
        date:
          e.kind === "daily"
            ? `${e.date.getFullYear()}-${pad2(e.date.getMonth() + 1)}-${pad2(e.date.getDate())}`
            : `${e.from.getFullYear()}-${pad2(e.from.getMonth() + 1)}-${pad2(e.from.getDate())}`,
      }));
      sendJson(res, 200, { entries });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/summary") {
      const name = url.searchParams.get("name") ?? "";
      const dir = join(agenthudHome(), "summaries");
      // Only names the index recognises — no path traversal, ever.
      const known = listSummaries(dir).some((e) => e.filename === name);
      if (!known) {
        sendJson(res, 404, { ok: false, error: "unknown summary file" });
        return;
      }
      const content = readFileSync(join(dir, name), "utf-8");
      sendJson(res, 200, {
        ok: true,
        filename: name,
        markdown: summaryBodyForFile(content),
      });
      return;
    }

    // --- the one mutating endpoint -----------------------------------------
    if (req.method === "POST" && url.pathname === "/api/summary") {
      let body: {
        date?: string;
        /** Range mode: inclusive `from`/`to` (YYYY-MM-DD). */
        from?: string;
        to?: string;
        /** Whitelist of project paths (the workspace picker). */
        scopes?: string[];
        engine?: string;
        model?: string;
        force?: boolean;
        /** Style reference: `false` = drop it (the UI checkbox), a string
         * = an explicit file. Omitted = config / the default file. */
        style?: boolean | string;
      };
      try {
        body = JSON.parse(await readBody(req)) as typeof body;
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid JSON body" });
        return;
      }

      const wanted = Array.isArray(body.scopes)
        ? body.scopes.filter((s) => typeof s === "string" && s.trim())
        : [];
      // Validate the whitelist against what actually exists, and use the
      // canonical paths (not the client's strings) from here on.
      let scopeList: string[] = [];
      if (wanted.length > 0) {
        const resolved = resolveScopes(
          wanted.map((value) => ({ kind: "ref" as const, value })),
          projectRefsFromTree(discover()),
        );
        if (!resolved.ok) {
          sendJson(res, 400, { ok: false, error: resolved.error });
          return;
        }
        scopeList = resolved.projectPaths;
      }
      const scopeArg = scopeList.length ? scopeList : undefined;

      // Style reference from the UI: a boolean toggle (false = off) or an
      // explicit path. `undefined` leaves the config/default in charge.
      const styleOpts: { stylePath?: string; noStyle?: boolean } =
        body.style === false
          ? { noStyle: true }
          : typeof body.style === "string" && body.style.trim()
            ? { stylePath: body.style.trim() }
            : {};

      // ---- range mode: per-day dailies + one synthesis ----------------
      if (body.from !== undefined || body.to !== undefined) {
        const range = enumerateDays(body.from ?? null, body.to ?? null);
        if (!range.ok) {
          sendJson(res, 400, { ok: false, error: range.error });
          return;
        }
        const from = range.days[0];
        const to = range.days[range.days.length - 1];
        const cachePath = rangeSummaryPath(from, to, scopeArg);
        const mtimeBefore = existsSync(cachePath)
          ? statSync(cachePath).mtimeMs
          : 0;
        const code = await runRangeSummary({
          from,
          to,
          today: new Date(),
          force: body.force === true,
          // The user pressed the button — no second prompt behind a
          // browser call that has nothing to answer it.
          assumeYes: true,
          engine: config.summary.engine,
          engineFlag:
            body.engine && body.engine !== "auto" ? body.engine : undefined,
          model: body.model || config.summary.model,
          include: config.summary.include ??
            config.report.include ?? [...DEFAULT_INCLUDE_TYPES],
          detailLimit:
            config.summary.detailLimit ?? config.report.detailLimit ?? 120,
          withGit: config.summary.withGit ?? config.report.withGit ?? false,
          scopeToProjects: scopeArg,
          open: false,
          openIndex: false,
          quiet: true,
          ...styleOpts,
        });
        if (code !== 0) {
          sendJson(res, 502, {
            ok: false,
            error: "区间摘要生成失败，请查看服务端日志",
          });
          return;
        }
        if (!existsSync(cachePath)) {
          sendJson(res, 200, {
            ok: true,
            cachePath: "",
            markdown: "",
            fromCache: false,
            empty: true,
            days: range.days.length,
          });
          return;
        }
        const content = readFileSync(cachePath, "utf-8");
        sendJson(res, 200, {
          ok: true,
          range: true,
          cachePath,
          markdown: summaryBodyForFile(content),
          fromCache: statSync(cachePath).mtimeMs === mtimeBefore,
          days: range.days.length,
          usage: null,
        });
        return;
      }

      const date = parseDate(body.date ?? null);
      // Cache provenance: a past day with an unchanged cache file means
      // the runner served the cached text instead of calling the engine.
      const cachePath = dailySummaryPath(date, scopeArg);
      const mtimeBefore = existsSync(cachePath)
        ? statSync(cachePath).mtimeMs
        : 0;

      const code = await runSummary({
        date,
        today: new Date(),
        force: body.force === true,
        engine: config.summary.engine,
        engineFlag:
          body.engine && body.engine !== "auto" ? body.engine : undefined,
        model: body.model || config.summary.model,
        include: config.summary.include ??
          config.report.include ?? [...DEFAULT_INCLUDE_TYPES],
        detailLimit:
          config.summary.detailLimit ?? config.report.detailLimit ?? 120,
        withGit: config.summary.withGit ?? config.report.withGit ?? false,
        scopeToProjects: scopeList.length ? scopeList : undefined,
        open: false,
        openIndex: false,
        quiet: true,
        ...styleOpts,
      });
      if (code !== 0) {
        sendJson(res, 502, {
          ok: false,
          error: "summary generation failed — check the server log",
        });
        return;
      }
      if (!existsSync(cachePath)) {
        sendJson(res, 200, {
          ok: true,
          cachePath: "",
          markdown: "",
          fromCache: false,
          empty: true,
        });
        return;
      }
      const content = readFileSync(cachePath, "utf-8");
      const mtimeAfter = statSync(cachePath).mtimeMs;
      sendJson(res, 200, {
        ok: true,
        cachePath,
        markdown: summaryBodyForFile(content),
        fromCache: mtimeBefore !== 0 && mtimeAfter === mtimeBefore,
        usage: null,
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: "not found" });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 7787, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port =
    typeof address === "object" && address ? address.port : (opts.port ?? 7787);
  const url = `http://127.0.0.1:${port}/?token=${token}`;

  // The summaries dir must exist before the first "list" call.
  try {
    mkdirSync(join(agenthudHome(), "summaries"), { recursive: true });
  } catch {
    // best-effort; the endpoints degrade to an empty list
  }

  if (opts.openBrowser) {
    void openInDefaultApp(url);
  }

  return {
    url,
    port,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
