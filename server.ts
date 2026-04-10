import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import { GoogleGenAI } from "@google/genai";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envCandidates = [
  path.join(__dirname, ".env"),
  path.join(__dirname, "../.env"),
  path.join(process.cwd(), ".env"),
];
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const DEFAULT_RULES = `# MCP News Website - Core Rules & Standards

## 1. Journalistic Integrity
- All headlines must be objective and factual. No clickbait.
- Sources must be cited if provided in the draft.
- Tone should be professional, neutral, and authoritative.

## 2. SEO Standards
- Primary keyword must appear in the first 100 words.
- Meta descriptions must be between 140-160 characters.
- Use H2 and H3 tags for readability.
- Images must have descriptive ALT text.

## 3. WordPress Configuration Rules
- LiteSpeed Cache: Object Cache must be enabled for performance.
- Query Monitor: No database queries should take longer than 0.5s.
- Plugins: Only essential plugins should be active.

## 4. Automation Rules
- Never publish a post automatically; always save as "Draft" or "Pending Review".
- Always run a "Health Check" before and after any configuration change.`;

interface AgentPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface AgentRequestBody {
  prompt?: string;
  context?: string;
  parts?: AgentPart[];
  research?: {
    web?: boolean;
    scholar?: boolean;
    notebook?: boolean;
    articleMode?: boolean;
  };
}

interface WordPressSiteConfig {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  appPassword: string;
}

interface VpsConfig {
  baseUrl: string;
  apiToken: string;
  automationsPath: string;
  seoStatsPath: string;
  wpStatusPath: string;
}

interface GoogleConfig {
  ga4PropertyId: string;
  gscSiteUrl: string;
  serviceAccountJson: string;
}

interface HostingerConfig {
  baseUrl: string;
  username: string;
  apiToken: string;
}

interface AiConfig {
  model: string;
  fallbackModel: string;
  apiKey: string;
}

interface SelfModificationConfig {
  enabled: boolean;
  autoApplyEnabled: boolean;
  workspacePath: string;
}

interface ResearchConfig {
  webBrowsingEnabled: boolean;
  scholarEnabled: boolean;
  notebookWorkspacePath: string;
  maxWebSources: number;
  maxNotebookSnippets: number;
}

interface AppConfig {
  version: number;
  activeSiteId: string | null;
  wordpressSites: WordPressSiteConfig[];
  vps: VpsConfig;
  google: GoogleConfig;
  hostinger: HostingerConfig;
  ai: AiConfig;
  selfModification: SelfModificationConfig;
  research: ResearchConfig;
  connectorToolPath: string;
  notebookLmEnabled: boolean;
  mcpRules: string;
}

interface ContentReviewBody {
  siteId?: string;
  postId?: number;
  content?: string;
  title?: string;
}

interface SelfModProposeBody {
  workspacePath?: string;
  targetFile?: string;
  instruction?: string;
  autoApply?: boolean;
}

interface SelfModApplyBody {
  proposalId?: string;
  approvalCode?: string;
  autoApply?: boolean;
}

interface SelfModProposal {
  id: string;
  createdAt: string;
  expiresAt: string;
  workspacePath: string;
  targetAbsolutePath: string;
  targetRelativePath: string;
  instruction: string;
  summary: string;
  diffPreview: string;
  originalHash: string;
  updatedHash: string;
  originalContent: string;
  updatedContent: string;
  approvalCode: string;
  status: "pending" | "applied" | "expired";
  backupPath?: string;
}

const selfModProposals = new Map<string, SelfModProposal>();
const KEYCHAIN_SERVICE = "Azat Studio";
const KEYCHAIN_REF_PREFIX = "keychain://";

interface WebSource {
  title: string;
  url: string;
  snippet: string;
}

function normalizeBaseUrl(url: string): string {
  return (url || "").trim().replace(/\/+$/, "");
}

function defaultConfig(): AppConfig {
  return {
    version: 2,
    activeSiteId: null,
    wordpressSites: [],
    vps: {
      baseUrl: "",
      apiToken: "",
      automationsPath: "/api/automations",
      seoStatsPath: "/api/seo-stats",
      wpStatusPath: "/api/wp-status",
    },
    google: {
      ga4PropertyId: "",
      gscSiteUrl: "",
      serviceAccountJson: "",
    },
    hostinger: {
      baseUrl: "",
      username: "",
      apiToken: "",
    },
    ai: {
      model: "gemini-3-flash-preview",
      fallbackModel: "gemini-3-flash-preview",
      apiKey: "",
    },
    selfModification: {
      enabled: false,
      autoApplyEnabled: false,
      workspacePath: "",
    },
    research: {
      webBrowsingEnabled: true,
      scholarEnabled: true,
      notebookWorkspacePath: "",
      maxWebSources: 5,
      maxNotebookSnippets: 6,
    },
    connectorToolPath: "",
    notebookLmEnabled: false,
    mcpRules: DEFAULT_RULES,
  };
}

function getConfigFilePath(): string {
  const configDir = path.join(os.homedir(), ".mcp-agentic-editor");
  fs.mkdirSync(configDir, { recursive: true });
  return path.join(configDir, "config.json");
}

function isKeychainSupported(): boolean {
  return process.platform === "darwin";
}

function toKeychainRef(account: string): string {
  return `${KEYCHAIN_REF_PREFIX}${account}`;
}

function keychainAccountFromValue(value: string): string {
  return value.startsWith(KEYCHAIN_REF_PREFIX) ? value.slice(KEYCHAIN_REF_PREFIX.length) : "";
}

function readKeychainSecret(account: string): string {
  if (!isKeychainSupported()) return "";
  try {
    return String(
      execFileSync("security", ["find-generic-password", "-a", account, "-s", KEYCHAIN_SERVICE, "-w"], {
        encoding: "utf-8",
      }),
    ).trim();
  } catch {
    return "";
  }
}

function writeKeychainSecret(account: string, value: string): boolean {
  if (!isKeychainSupported()) return false;
  try {
    execFileSync("security", ["add-generic-password", "-a", account, "-s", KEYCHAIN_SERVICE, "-w", value, "-U"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function resolveSecretValue(account: string, value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  const accountFromRef = keychainAccountFromValue(trimmed);
  if (accountFromRef) {
    return readKeychainSecret(accountFromRef) || "";
  }
  return trimmed;
}

function storeSecretValue(account: string, value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  if (!isKeychainSupported()) return trimmed;
  const ok = writeKeychainSecret(account, trimmed);
  return ok ? toKeychainRef(account) : trimmed;
}

function hydrateConfigSecrets(config: AppConfig): AppConfig {
  const hydrated: AppConfig = JSON.parse(JSON.stringify(config));

  hydrated.ai.apiKey = resolveSecretValue("ai.apiKey", hydrated.ai.apiKey);
  hydrated.vps.apiToken = resolveSecretValue("vps.apiToken", hydrated.vps.apiToken);
  hydrated.hostinger.apiToken = resolveSecretValue("hostinger.apiToken", hydrated.hostinger.apiToken);
  hydrated.google.serviceAccountJson = resolveSecretValue("google.serviceAccountJson", hydrated.google.serviceAccountJson);

  hydrated.wordpressSites = hydrated.wordpressSites.map((site) => ({
    ...site,
    username: resolveSecretValue(`wordpress.${site.id}.username`, site.username),
    appPassword: resolveSecretValue(`wordpress.${site.id}.appPassword`, site.appPassword),
  }));

  return hydrated;
}

function persistConfigSecrets(config: AppConfig): AppConfig {
  const stored: AppConfig = JSON.parse(JSON.stringify(config));

  stored.ai.apiKey = storeSecretValue("ai.apiKey", stored.ai.apiKey);
  stored.vps.apiToken = storeSecretValue("vps.apiToken", stored.vps.apiToken);
  stored.hostinger.apiToken = storeSecretValue("hostinger.apiToken", stored.hostinger.apiToken);
  stored.google.serviceAccountJson = storeSecretValue("google.serviceAccountJson", stored.google.serviceAccountJson);

  stored.wordpressSites = stored.wordpressSites.map((site) => ({
    ...site,
    username: storeSecretValue(`wordpress.${site.id}.username`, site.username),
    appPassword: storeSecretValue(`wordpress.${site.id}.appPassword`, site.appPassword),
  }));

  return stored;
}

function readConfig(): AppConfig {
  const configPath = getConfigFilePath();
  if (!fs.existsSync(configPath)) {
    const initial = defaultConfig();
    fs.writeFileSync(configPath, JSON.stringify(initial, null, 2), "utf-8");
    return initial;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const defaults = defaultConfig();
    const merged: AppConfig = {
      ...defaults,
      ...parsed,
      vps: { ...defaults.vps, ...(parsed.vps || {}) },
      google: { ...defaults.google, ...(parsed.google || {}) },
      hostinger: { ...defaults.hostinger, ...(parsed.hostinger || {}) },
      ai: { ...defaults.ai, ...(parsed.ai || {}) },
      selfModification: { ...defaults.selfModification, ...(parsed.selfModification || {}) },
      research: { ...defaults.research, ...(parsed.research || {}) },
      wordpressSites: Array.isArray(parsed.wordpressSites) ? parsed.wordpressSites : [],
      connectorToolPath: typeof parsed.connectorToolPath === "string" ? parsed.connectorToolPath : defaults.connectorToolPath,
      mcpRules: typeof parsed.mcpRules === "string" && parsed.mcpRules.trim() ? parsed.mcpRules : defaults.mcpRules,
    };

    if (merged.activeSiteId && !merged.wordpressSites.some((site) => site.id === merged.activeSiteId)) {
      merged.activeSiteId = merged.wordpressSites[0]?.id || null;
    }
    return hydrateConfigSecrets(merged);
  } catch (error) {
    console.error("Failed to read config file, using defaults:", error);
    return defaultConfig();
  }
}

function sanitizeConfigInput(input: Partial<AppConfig>): AppConfig {
  const base = readConfig();
  const merged: AppConfig = {
    ...base,
    ...input,
    vps: {
      ...base.vps,
      ...(input.vps || {}),
    },
    google: {
      ...base.google,
      ...(input.google || {}),
    },
    hostinger: {
      ...base.hostinger,
      ...(input.hostinger || {}),
    },
    ai: {
      ...base.ai,
      ...(input.ai || {}),
    },
    selfModification: {
      ...base.selfModification,
      ...(input.selfModification || {}),
    },
    research: {
      ...base.research,
      ...(input.research || {}),
    },
    wordpressSites: Array.isArray(input.wordpressSites)
      ? input.wordpressSites
          .map((site, index) => ({
            id: (site.id || `site-${Date.now()}-${index}`).trim(),
            name: (site.name || `Site ${index + 1}`).trim(),
            baseUrl: normalizeBaseUrl(site.baseUrl || ""),
            username: (site.username || "").trim(),
            appPassword: (site.appPassword || "").trim(),
          }))
          .filter((site) => Boolean(site.baseUrl))
      : base.wordpressSites,
    activeSiteId: typeof input.activeSiteId === "string" || input.activeSiteId === null ? input.activeSiteId : base.activeSiteId,
    connectorToolPath: typeof input.connectorToolPath === "string" ? input.connectorToolPath : base.connectorToolPath,
    notebookLmEnabled: typeof input.notebookLmEnabled === "boolean" ? input.notebookLmEnabled : base.notebookLmEnabled,
    mcpRules: typeof input.mcpRules === "string" ? input.mcpRules : base.mcpRules,
  };

  merged.vps.baseUrl = normalizeBaseUrl(merged.vps.baseUrl);
  merged.hostinger.baseUrl = normalizeBaseUrl(merged.hostinger.baseUrl);
  merged.ai.model = (merged.ai.model || base.ai.model || "gemini-3-flash-preview").trim();
  merged.ai.fallbackModel = (merged.ai.fallbackModel || base.ai.fallbackModel || "gemini-3-flash-preview").trim();
  merged.ai.apiKey = (merged.ai.apiKey || base.ai.apiKey || "").trim();
  merged.selfModification.workspacePath = (merged.selfModification.workspacePath || base.selfModification.workspacePath || "").trim();
  merged.selfModification.enabled = Boolean(merged.selfModification.enabled);
  merged.selfModification.autoApplyEnabled = Boolean(merged.selfModification.autoApplyEnabled);
  merged.research.notebookWorkspacePath = (merged.research.notebookWorkspacePath || "").trim();
  merged.research.webBrowsingEnabled = Boolean(merged.research.webBrowsingEnabled);
  merged.research.scholarEnabled = Boolean(merged.research.scholarEnabled);
  merged.research.maxWebSources = Math.max(2, Math.min(10, Number(merged.research.maxWebSources || 5)));
  merged.research.maxNotebookSnippets = Math.max(2, Math.min(16, Number(merged.research.maxNotebookSnippets || 6)));
  merged.connectorToolPath = merged.connectorToolPath.trim();

  if (merged.activeSiteId && !merged.wordpressSites.some((site) => site.id === merged.activeSiteId)) {
    merged.activeSiteId = merged.wordpressSites[0]?.id || null;
  }
  if (!merged.activeSiteId && merged.wordpressSites.length > 0) {
    merged.activeSiteId = merged.wordpressSites[0].id;
  }

  return merged;
}

function writeConfig(config: AppConfig): void {
  const configPath = getConfigFilePath();
  const toStore = persistConfigSecrets(config);
  fs.writeFileSync(configPath, JSON.stringify(toStore, null, 2), "utf-8");
}

function getGeminiApiKey(config: AppConfig): string {
  const fromSettings = (config.ai?.apiKey || "").trim();
  const fromEnv = (process.env.GEMINI_API_KEY || "").trim();
  return fromSettings || fromEnv;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function isInsideWorkspace(workspacePath: string, targetPath: string): boolean {
  const base = path.resolve(workspacePath);
  const target = path.resolve(targetPath);
  return target === base || target.startsWith(`${base}${path.sep}`);
}

function resolveWorkspacePath(config: AppConfig, rawWorkspacePath?: string): string {
  const configured = (rawWorkspacePath || config.selfModification.workspacePath || "").trim();
  if (!configured) {
    throw new Error("Workspace path is required. Set it in Settings > Self-Modification.");
  }
  const resolved = path.resolve(configured);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Workspace path is invalid: ${resolved}`);
  }
  return resolved;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const tryParse = (candidate: string) => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(text);
  if (direct) return direct;

  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const fenced = tryParse(fencedMatch[1].trim());
    if (fenced) return fenced;
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return tryParse(text.slice(firstBrace, lastBrace + 1).trim());
  }

  return null;
}

function buildDiffPreview(originalContent: string, updatedContent: string, maxChanges = 140): string {
  const before = originalContent.split("\n");
  const after = updatedContent.split("\n");
  const limit = Math.max(before.length, after.length);
  const rows: string[] = [];
  let changes = 0;

  for (let i = 0; i < limit; i++) {
    const left = before[i];
    const right = after[i];
    if (left === right) continue;
    if (typeof left === "string") rows.push(`- ${i + 1}: ${left}`);
    if (typeof right === "string") rows.push(`+ ${i + 1}: ${right}`);
    changes++;
    if (changes >= maxChanges) {
      rows.push("... diff preview truncated ...");
      break;
    }
  }

  return rows.length ? rows.join("\n") : "No textual changes detected.";
}

function getBackupRoot(): string {
  const root = path.join(os.homedir(), ".mcp-agentic-editor", "backups");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

let relaunchScheduled = false;

function scheduleElectronRelaunch(delayMs = 1800): boolean {
  if (!process.versions.electron || relaunchScheduled) return false;
  relaunchScheduled = true;
  setTimeout(async () => {
    try {
      const electronModule = (await import("electron")) as any;
      const appRef = electronModule?.app || electronModule?.default?.app;
      if (appRef && typeof appRef.relaunch === "function" && typeof appRef.exit === "function") {
        appRef.relaunch();
        appRef.exit(0);
        return;
      }
    } catch (error) {
      console.error("Failed to relaunch electron app:", error);
    }
    relaunchScheduled = false;
  }, Math.max(500, delayMs));
  return true;
}

function isAutonomousSelfModIntent(prompt: string): boolean {
  const text = (prompt || "").toLowerCase();
  if (!text.trim()) return false;

  const explicitExecute = /(do it|go ahead|proceed|apply it|make the change|initiate self-mod|initiate self modification|start self-mod|start self modification)/i.test(
    text,
  );
  const hasSelfTarget = /(yourself|itself|your app|app itself|azat studio|agent|this app|own ui|own features|self-mod|your (icon|icons|ui|feature|features|color|colors|code))/i.test(
    text,
  );
  if (explicitExecute && hasSelfTarget) return true;

  const looksLikeCapabilityQuestion = /^\s*(can|could|are you|do you)\b/i.test(text) && text.includes("?");
  const asksCapabilityOnly =
    (/(can you|could you|are you able|are you capable|ability)/i.test(text) || looksLikeCapabilityQuestion) &&
    !/(do it|do this|proceed|go ahead|apply|initiate|start now|make it now)/i.test(text);
  if (asksCapabilityOnly) return false;

  const hasActionVerb = /(change|modify|update|improve|fix|redesign|restyle|replace|add|remove|implement)/i.test(text);
  return hasActionVerb && hasSelfTarget;
}

function listWorkspaceCodeFiles(workspacePath: string, maxFiles = 260): string[] {
  const allowedExt = new Set([".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".css", ".json", ".md", ".html"]);
  const skipDirs = new Set([".git", "node_modules", "dist", "dist-electron", "dist-server", "release", ".next", ".cache"]);
  const out: string[] = [];
  const root = path.resolve(workspacePath);

  const walk = (dir: string) => {
    if (out.length >= maxFiles) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!allowedExt.has(ext)) continue;
      out.push(path.relative(root, fullPath));
    }
  };

  walk(root);
  return out.sort();
}

async function selectTargetFileForSelfMod(
  ai: GoogleGenAI,
  config: AppConfig,
  prompt: string,
  workspacePath: string,
): Promise<string> {
  const explicitPathMatch = prompt.match(/([A-Za-z0-9_./-]+\.(?:tsx?|jsx?|cjs|mjs|css|json|md|html))/);
  if (explicitPathMatch?.[1]) {
    const candidate = explicitPathMatch[1].trim();
    const abs = path.resolve(workspacePath, candidate);
    if (isInsideWorkspace(workspacePath, abs) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return candidate;
    }
  }

  const files = listWorkspaceCodeFiles(workspacePath, 220);
  const preferenceMap: Array<{ pattern: RegExp; candidates: string[] }> = [
    { pattern: /(icon|avatar|emoji|profile|top right|right corner)/i, candidates: ["src/App.tsx", "src/components/Sidebar.tsx"] },
    { pattern: /(theme|color|colors|palette|typography|font|liquid)/i, candidates: ["src/index.css", "src/App.tsx"] },
    { pattern: /(chat|agent chat|conversation|thread)/i, candidates: ["src/components/AgentChat.tsx"] },
    { pattern: /(settings|toggle|checkbox|option)/i, candidates: ["src/components/Settings.tsx"] },
    { pattern: /(sidebar|menu|navigation|tab)/i, candidates: ["src/components/Sidebar.tsx"] },
    { pattern: /(dashboard|stats|chart)/i, candidates: ["src/components/Dashboard.tsx"] },
    { pattern: /(automation|workflow)/i, candidates: ["src/components/Automations.tsx", "server.ts"] },
    { pattern: /(updater|update|restart|electron)/i, candidates: ["electron/main.ts", "server.ts"] },
    { pattern: /(rules|policy|mcp)/i, candidates: ["src/components/RulesManager.tsx", "server.ts"] },
  ];

  for (const group of preferenceMap) {
    if (!group.pattern.test(prompt)) continue;
    for (const candidate of group.candidates) {
      if (files.includes(candidate)) return candidate;
    }
  }

  const fileListText = files.slice(0, 180).join("\n");
  const selectorPrompt = [
    "Pick exactly one target file path from the list that should be modified for the user's request.",
    "Return only JSON like: {\"targetFile\":\"path/from/list\"}",
    "Never invent a path. Use one from the list only.",
    "",
    `User request: ${prompt}`,
    "",
    "Candidate files:",
    fileListText,
  ].join("\n");

  const selection = await generateWithModelFallback(
    ai,
    (config.ai.model || "gemini-3-flash-preview").trim(),
    (config.ai.fallbackModel || "gemini-3-flash-preview").trim(),
    [{ parts: [{ text: selectorPrompt }] }],
    0.1,
  );
  const parsed = extractJsonObject(selection.text || "");
  const fromModel = typeof parsed?.targetFile === "string" ? parsed.targetFile.trim() : "";
  if (fromModel && files.includes(fromModel)) return fromModel;

  if (files.includes("src/App.tsx")) return "src/App.tsx";
  if (files.includes("server.ts")) return "server.ts";
  if (files.length) return files[0];
  throw new Error("No editable files found in workspace.");
}

async function generateSelfModProposal(
  config: AppConfig,
  body: SelfModProposeBody,
): Promise<{ proposal: SelfModProposal; modelUsed: string; warning?: string }> {
  const targetFile = String(body.targetFile || "").trim();
  const instruction = String(body.instruction || "").trim();
  if (!targetFile) {
    throw new Error("Target file is required.");
  }
  if (!instruction) {
    throw new Error("Instruction is required.");
  }

  const workspacePath = resolveWorkspacePath(config, body.workspacePath);
  const targetAbsolutePath = path.resolve(workspacePath, targetFile);
  if (!isInsideWorkspace(workspacePath, targetAbsolutePath)) {
    throw new Error("Target file must be inside workspace path.");
  }
  if (!fs.existsSync(targetAbsolutePath) || !fs.statSync(targetAbsolutePath).isFile()) {
    throw new Error(`Target file not found: ${targetFile}`);
  }

  const originalContent = fs.readFileSync(targetAbsolutePath, "utf-8");
  if (originalContent.length > 200_000) {
    throw new Error("Target file is too large for safe in-app modification. Split changes into smaller files.");
  }

  const apiKey = getGeminiApiKey(config);
  if (!apiKey) {
    throw new Error("Gemini API key is missing. Add it in Settings > AI Model Routing or .env.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const targetRelativePath = path.relative(workspacePath, targetAbsolutePath) || path.basename(targetAbsolutePath);
  const selfModPrompt = [
    "You are editing one code file for a strict approval workflow.",
    "Return ONLY valid JSON with this shape:",
    '{"summary":"short summary","updatedContent":"full updated file text"}',
    "Rules:",
    "- Preserve file language/syntax.",
    "- Apply only requested change.",
    "- Do not add markdown fences.",
    "",
    `Target file: ${targetRelativePath}`,
    `User instruction: ${instruction}`,
    "",
    "Current file content:",
    originalContent,
  ].join("\n");

  const result = await generateWithModelFallback(
    ai,
    (config.ai.model || "gemini-3-flash-preview").trim(),
    (config.ai.fallbackModel || "gemini-3-flash-preview").trim(),
    [
      {
        parts: [
          { text: buildSystemPrompt("Generate a safe single-file code edit JSON response.", config.mcpRules || DEFAULT_RULES) },
          { text: selfModPrompt },
        ],
      },
    ],
    0.2,
  );

  const parsed = extractJsonObject(result.text || "");
  const updatedContent = typeof parsed?.updatedContent === "string" ? parsed.updatedContent : "";
  const summary =
    typeof parsed?.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : `Apply requested change to ${targetRelativePath}`;

  if (!updatedContent) {
    throw new Error("Model did not return valid updatedContent JSON.");
  }

  const proposalId = `sm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const approvalCode = `APPLY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const proposal: SelfModProposal = {
    id: proposalId,
    createdAt: new Date().toISOString(),
    expiresAt,
    workspacePath,
    targetAbsolutePath,
    targetRelativePath,
    instruction,
    summary,
    diffPreview: buildDiffPreview(originalContent, updatedContent),
    originalHash: sha256(originalContent),
    updatedHash: sha256(updatedContent),
    originalContent,
    updatedContent,
    approvalCode,
    status: "pending",
  };
  selfModProposals.set(proposalId, proposal);

  if (selfModProposals.size > 100) {
    const oldest = [...selfModProposals.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
    if (oldest) selfModProposals.delete(oldest.id);
  }

  return {
    proposal,
    modelUsed: result.modelUsed,
    warning: result.warning,
  };
}

async function runAutonomousSelfModification(config: AppConfig, prompt: string): Promise<{
  ok: boolean;
  text: string;
  targetFile?: string;
  backupPath?: string;
}> {
  if (!config.selfModification.enabled) {
    return {
      ok: false,
      text: "Self-modification is disabled. Enable it in Settings first.",
    };
  }
  if (!config.selfModification.autoApplyEnabled) {
    return {
      ok: false,
      text: "Auto-apply self-modification is disabled. Enable it in Settings > Self-Modification.",
    };
  }

  const workspacePath = resolveWorkspacePath(config, config.selfModification.workspacePath);
  const apiKey = getGeminiApiKey(config);
  if (!apiKey) {
    return {
      ok: false,
      text: "Gemini API key is missing. Add it in Settings > AI Model Routing or .env.",
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  const targetFile = await selectTargetFileForSelfMod(ai, config, prompt, workspacePath);
  const { proposal, modelUsed, warning } = await generateSelfModProposal(config, {
    workspacePath,
    targetFile,
    instruction: prompt,
    autoApply: true,
  });

  const applied = applySelfModProposal(proposal, "auto");
  const restartScheduled = scheduleElectronRelaunch(1800);
  const messageLines = [
    `Self-modification applied automatically.`,
    `Target file: ${applied.targetFile}`,
    `Backup: ${applied.backupPath}`,
    `Model used: ${modelUsed}`,
    warning ? `Warning: ${warning}` : "",
    restartScheduled ? "App restart scheduled now to load changes." : "Restart not scheduled automatically in this runtime.",
  ].filter(Boolean);

  return {
    ok: true,
    text: messageLines.join("\n"),
    targetFile: applied.targetFile,
    backupPath: applied.backupPath,
  };
}

function applySelfModProposal(proposal: SelfModProposal, mode: "manual" | "auto"): { targetFile: string; backupPath: string } {
  if (proposal.status !== "pending") {
    throw new Error(`Proposal is already ${proposal.status}.`);
  }
  if (!fs.existsSync(proposal.targetAbsolutePath) || !fs.statSync(proposal.targetAbsolutePath).isFile()) {
    throw new Error("Target file no longer exists.");
  }

  const currentContent = fs.readFileSync(proposal.targetAbsolutePath, "utf-8");
  if (sha256(currentContent) !== proposal.originalHash) {
    throw new Error("Target file changed since proposal generation. Generate a fresh proposal first.");
  }

  const backupDir = path.join(getBackupRoot(), proposal.id);
  const backupPath = path.join(backupDir, proposal.targetRelativePath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, currentContent, "utf-8");
  fs.writeFileSync(
    path.join(backupDir, "metadata.json"),
    JSON.stringify(
      {
        createdAt: proposal.createdAt,
        appliedAt: new Date().toISOString(),
        targetFile: proposal.targetRelativePath,
        targetAbsolutePath: proposal.targetAbsolutePath,
        workspacePath: proposal.workspacePath,
        instruction: proposal.instruction,
        summary: proposal.summary,
        approvalCode: proposal.approvalCode,
        applyMode: mode,
      },
      null,
      2,
    ),
    "utf-8",
  );

  fs.writeFileSync(proposal.targetAbsolutePath, proposal.updatedContent, "utf-8");
  proposal.status = "applied";
  proposal.backupPath = backupPath;

  return {
    targetFile: proposal.targetRelativePath,
    backupPath,
  };
}

function getSiteFromConfig(config: AppConfig, siteId?: string): WordPressSiteConfig {
  const resolvedId = siteId || config.activeSiteId;
  const site = resolvedId ? config.wordpressSites.find((candidate) => candidate.id === resolvedId) : config.wordpressSites[0];
  if (!site) {
    throw new Error("No WordPress site configured. Add one in Settings first.");
  }
  return site;
}

function getWordPressAuthHeaders(site: WordPressSiteConfig): HeadersInit {
  if (!site.username || !site.appPassword) {
    return {};
  }
  const token = Buffer.from(`${site.username}:${site.appPassword}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

async function fetchWordPressPosts(site: WordPressSiteConfig, perPage: number, page: number, search: string) {
  const params = new URLSearchParams({
    per_page: String(Math.max(1, Math.min(perPage, 100))),
    page: String(Math.max(1, page)),
    _embed: "1",
    orderby: "date",
    order: "desc",
  });
  if (search.trim()) {
    params.set("search", search.trim());
  }

  const response = await fetch(`${site.baseUrl}/wp-json/wp/v2/posts?${params.toString()}`, {
    headers: {
      "Content-Type": "application/json",
      ...getWordPressAuthHeaders(site),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WordPress posts request failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const posts = (await response.json()) as any[];
  return posts.map((post) => ({
    id: post.id,
    date: post.date,
    status: post.status,
    title: post?.title?.rendered || "Untitled",
    excerpt: post?.excerpt?.rendered || "",
    content: post?.content?.rendered || "",
    link: post.link,
  }));
}

async function fetchWordPressPost(site: WordPressSiteConfig, postId: number) {
  const response = await fetch(`${site.baseUrl}/wp-json/wp/v2/posts/${postId}?_embed=1`, {
    headers: {
      "Content-Type": "application/json",
      ...getWordPressAuthHeaders(site),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WordPress post request failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const post = await response.json();
  return {
    id: post.id,
    date: post.date,
    status: post.status,
    title: post?.title?.rendered || "Untitled",
    excerpt: post?.excerpt?.rendered || "",
    content: post?.content?.rendered || "",
    link: post.link,
  };
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function buildSystemPrompt(context: string | undefined, rules: string): string {
  return `You are Azat Studio Agent, an AI assistant for research, editorial workflows, and automation.

STRICT RULES TO FOLLOW (MCP RULES):
${rules}

Your goals:
1. Review articles for quality, tone, and adherence to these MCP rules.
2. Suggest SEO improvements.
3. Help manage WordPress issues.
4. Assist with automations.
5. Analyze images, audio, and video content provided for news value and SEO (ALT text, captions).
6. When research sources are provided, ground factual claims in those sources and cite URLs inline.
7. If asked to change this app's code/features/colors and auto-apply is enabled, execute self-modification workflow with backup + restart; otherwise explain what setting is missing.

Context: ${context || "No additional context provided."}`;
}

const AVAILABLE_MODELS = [
  {
    id: "gemma-4-26b-a4b-it",
    label: "Gemma 4 26B A4B IT",
    releaseDate: "2026-04-02",
    note: "Mixture-of-Experts efficiency model.",
  },
  {
    id: "gemma-4-31b-it",
    label: "Gemma 4 31B IT",
    releaseDate: "2026-04-02",
    note: "Flagship dense quality model.",
  },
  {
    id: "gemini-3-flash-preview",
    label: "Gemini 3 Flash Preview",
    releaseDate: "2026-01-01",
    note: "Fallback compatibility model.",
  },
] as const;

async function generateWithModelFallback(
  ai: GoogleGenAI,
  requestedModel: string,
  fallbackModel: string,
  contents: Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>,
  temperature: number,
): Promise<{ text: string; modelUsed: string; fallback: boolean; warning?: string }> {
  try {
    const response = await ai.models.generateContent({
      model: requestedModel,
      contents,
      config: { temperature },
    });
    return {
      text: response.text || "No response from model.",
      modelUsed: requestedModel,
      fallback: false,
    };
  } catch (primaryError) {
    if (!fallbackModel || fallbackModel === requestedModel) {
      throw primaryError;
    }
    const response = await ai.models.generateContent({
      model: fallbackModel,
      contents,
      config: { temperature },
    });
    return {
      text: response.text || "No response from model.",
      modelUsed: fallbackModel,
      fallback: true,
      warning: `Model ${requestedModel} failed and fallback model ${fallbackModel} was used.`,
    };
  }
}

async function fetchFromVps(config: AppConfig, relativePath: string): Promise<any> {
  if (!config.vps.baseUrl) {
    throw new Error("VPS base URL is not configured.");
  }
  const targetUrl = new URL(relativePath, `${normalizeBaseUrl(config.vps.baseUrl)}/`).toString();
  const response = await fetch(targetUrl, {
    headers: {
      "Content-Type": "application/json",
      ...(config.vps.apiToken ? { Authorization: `Bearer ${config.vps.apiToken}` } : {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`VPS request failed (${response.status}): ${body.slice(0, 200)}`);
  }
  return response.json();
}

function walkJsonFiles(dirPath: string, maxDepth = 3, currentDepth = 0): string[] {
  if (currentDepth > maxDepth) return [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsonFiles(fullPath, maxDepth, currentDepth + 1));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files;
}

function flattenObject(input: unknown, prefix = ""): Record<string, string> {
  const output: Record<string, string> = {};
  if (!input || typeof input !== "object") return output;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(output, flattenObject(value, nextPrefix));
      continue;
    }
    if (typeof value === "string") {
      output[nextPrefix.toLowerCase()] = value.trim();
    }
  }
  return output;
}

function pickByKey(flatMap: Record<string, string>, candidates: string[]): string {
  for (const candidate of candidates) {
    const direct = flatMap[candidate.toLowerCase()];
    if (direct) return direct;
    const fuzzyEntry = Object.entries(flatMap).find(([key]) => key.includes(candidate.toLowerCase()));
    if (fuzzyEntry?.[1]) return fuzzyEntry[1];
  }
  return "";
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function compactPlainText(input: string, maxLength = 700): string {
  const clean = stripHtml(decodeHtmlEntities(input || "")).replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}...` : clean;
}

async function fetchTextSafe(url: string, timeoutMs = 14000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AzatStudioBot/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function toJinaReadUrl(targetUrl: string): string {
  return `https://r.jina.ai/http://${targetUrl.replace(/^https?:\/\//i, "")}`;
}

function parseDuckDuckGoHtmlResults(html: string, limit: number): WebSource[] {
  const blocks = html.match(/<div class="result__body">[\s\S]*?<\/div>\s*<\/div>/g) || [];
  const results: WebSource[] = [];

  for (const block of blocks) {
    if (results.length >= limit) break;
    const linkMatch = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"/i);
    const titleMatch = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const rawUrl = linkMatch?.[1] || "";
    if (!rawUrl.startsWith("http")) continue;

    const title = compactPlainText(titleMatch?.[1] || rawUrl, 160);
    const snippet = compactPlainText(snippetMatch?.[1] || "", 260);
    results.push({ title, url: rawUrl, snippet });
  }

  if (results.length) return results;

  const linkRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = linkRegex.exec(html)) && results.length < limit) {
    const url = match[1];
    const title = compactPlainText(match[2], 160);
    if (!title || /duckduckgo/i.test(url)) continue;
    if (results.some((entry) => entry.url === url)) continue;
    results.push({ title, url, snippet: "" });
  }
  return results;
}

async function getWebSources(query: string, maxSources: number): Promise<WebSource[]> {
  const limit = Math.max(2, Math.min(10, maxSources));
  const encodedQuery = encodeURIComponent(query.trim());
  const html = await fetchTextSafe(`https://duckduckgo.com/html/?q=${encodedQuery}`, 12000);
  const parsed = parseDuckDuckGoHtmlResults(html, limit);
  const candidates = parsed.slice(0, limit);

  const enriched = await Promise.all(
    candidates.map(async (source) => {
      if (source.snippet.length > 60) return source;
      try {
        const raw = await fetchTextSafe(toJinaReadUrl(source.url), 10000);
        return {
          ...source,
          snippet: compactPlainText(raw, 260),
        };
      } catch {
        return source;
      }
    }),
  );

  return enriched.filter((source) => source.url && source.title);
}

function openAlexAbstractToText(index: Record<string, number[]> | undefined): string {
  if (!index || typeof index !== "object") return "";
  let maxPosition = -1;
  for (const positions of Object.values(index)) {
    for (const position of positions || []) {
      if (position > maxPosition) maxPosition = position;
    }
  }
  if (maxPosition < 0) return "";

  const words = new Array<string>(maxPosition + 1).fill("");
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions || []) {
      if (position >= 0 && position < words.length) {
        words[position] = word;
      }
    }
  }
  return words.join(" ").replace(/\s+/g, " ").trim();
}

async function getScholarSources(query: string, maxSources: number): Promise<WebSource[]> {
  const limit = Math.max(2, Math.min(8, maxSources));
  const endpoint = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}`;
  const text = await fetchTextSafe(endpoint, 12000);
  const payload = JSON.parse(text) as { results?: any[] };
  const results = Array.isArray(payload.results) ? payload.results : [];

  return results.slice(0, limit).map((item) => {
    const title = compactPlainText(item?.title || "Untitled scholarly source", 180);
    const abstractText = compactPlainText(openAlexAbstractToText(item?.abstract_inverted_index), 280);
    const sourceName = compactPlainText(item?.primary_location?.source?.display_name || "OpenAlex source", 80);
    const published = item?.publication_date ? `Published: ${item.publication_date}. ` : "";
    const snippet = `${published}${sourceName}. ${abstractText || "Abstract unavailable from source metadata."}`.trim();
    const doiUrl = typeof item?.doi === "string" && item.doi ? item.doi : "";
    const fallbackUrl = item?.primary_location?.landing_page_url || item?.ids?.openalex || "";
    return {
      title,
      url: doiUrl || fallbackUrl || "https://api.openalex.org",
      snippet,
    };
  });
}

function walkResearchFiles(rootPath: string, maxDepth = 5, currentDepth = 0): string[] {
  if (currentDepth > maxDepth) return [];
  const allowedExtensions = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".html", ".htm", ".pdf"]);
  const ignoredDirs = new Set([".git", "node_modules", "dist", "dist-server", "dist-electron", "release"]);

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      files.push(...walkResearchFiles(fullPath, maxDepth, currentDepth + 1));
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (allowedExtensions.has(ext)) files.push(fullPath);
  }
  return files;
}

function readResearchFileText(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === ".pdf") {
      return String(execFileSync("pdftotext", ["-layout", filePath, "-"], { encoding: "utf-8", maxBuffer: 24 * 1024 * 1024 }));
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    if (ext === ".json") {
      try {
        return JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        return raw;
      }
    }
    return raw;
  } catch {
    return "";
  }
}

function scoreTextByQuery(text: string, query: string): { score: number; snippet: string } {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (!normalizedText) return { score: 0, snippet: "" };
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length >= 3);
  if (!words.length) return { score: 0, snippet: compactPlainText(normalizedText, 280) };

  const lower = normalizedText.toLowerCase();
  let score = 0;
  let firstHit = -1;
  for (const word of words) {
    const idx = lower.indexOf(word);
    if (idx >= 0) {
      score += 1;
      if (firstHit < 0 || idx < firstHit) firstHit = idx;
    }
  }
  if (score === 0) return { score: 0, snippet: "" };

  const from = Math.max(0, firstHit - 180);
  const to = Math.min(normalizedText.length, from + 520);
  const snippet = compactPlainText(normalizedText.slice(from, to), 320);
  return { score, snippet };
}

function getNotebookSources(query: string, workspacePath: string, maxSnippets: number): WebSource[] {
  if (!workspacePath) return [];
  const root = path.resolve(workspacePath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];

  const files = walkResearchFiles(root, 5).slice(0, 120);
  const scored = files
    .map((filePath) => {
      const text = readResearchFileText(filePath);
      const { score, snippet } = scoreTextByQuery(text, query);
      return { filePath, score, snippet };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(2, Math.min(16, maxSnippets)));

  return scored.map((entry) => ({
    title: path.basename(entry.filePath),
    url: `file://${entry.filePath}`,
    snippet: entry.snippet,
  }));
}

function formatSourcesAsPromptBlock(label: string, sources: WebSource[]): string {
  if (!sources.length) return "";
  const rows = sources
    .map((source, idx) => `${idx + 1}. ${source.title}\nURL: ${source.url}\nSnippet: ${source.snippet}`)
    .join("\n\n");
  return `\n${label}:\n${rows}\n`;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0");

  app.use(express.json({ limit: "20mb" }));

  app.get("/api/health", (_req, res) => {
    const config = readConfig();
    res.json({
      status: "ok",
      appName: "Azat Studio",
      timestamp: new Date().toISOString(),
      configuredSites: config.wordpressSites.length,
      hasVpsBridge: Boolean(config.vps.baseUrl),
      hasHostingerConfig: Boolean(config.hostinger.baseUrl),
      selectedModel: config.ai.model,
      selfModificationEnabled: config.selfModification.enabled,
      selfModificationAutoApplyEnabled: config.selfModification.autoApplyEnabled,
      webBrowsingEnabled: config.research.webBrowsingEnabled,
      scholarEnabled: config.research.scholarEnabled,
      keychainSupported: isKeychainSupported(),
      notebookLmEnabled: config.notebookLmEnabled,
    });
  });

  app.get("/api/models", (_req, res) => {
    const config = readConfig();
    res.json({
      selectedModel: config.ai.model,
      fallbackModel: config.ai.fallbackModel,
      models: AVAILABLE_MODELS,
    });
  });

  app.get("/api/mcp/status", (_req, res) => {
    const config = readConfig();
    res.json({
      app: "Azat Studio",
      mcpRuntime: "elastic-v1",
      connectors: [
        {
          id: "wordpress",
          enabled: config.wordpressSites.length > 0,
          fallback: "vps-bridge",
        },
        {
          id: "vps-bridge",
          enabled: Boolean(config.vps.baseUrl),
          fallback: "wordpress-direct",
        },
        {
          id: "hostinger",
          enabled: Boolean(config.hostinger.baseUrl),
          fallback: "none",
        },
        {
          id: "web-research",
          enabled: config.research.webBrowsingEnabled,
          fallback: "scholar-only",
        },
        {
          id: "scholar-research",
          enabled: config.research.scholarEnabled,
          fallback: "web-only",
        },
        {
          id: "notebook-bridge",
          enabled: Boolean(config.research.notebookWorkspacePath),
          fallback: "attachments-in-chat",
        },
      ],
      policy: {
        retriesPerConnector: 2,
        timeoutMs: 14000,
        sourceCap: config.research.maxWebSources,
      },
    });
  });

  app.get("/api/settings", (_req, res) => {
    res.json(readConfig());
  });

  app.put("/api/settings", (req, res) => {
    const incoming = (req.body || {}) as Partial<AppConfig>;
    const sanitized = sanitizeConfigInput(incoming);
    writeConfig(sanitized);
    res.json(sanitized);
  });

  app.post("/api/self-mod/propose", async (req, res) => {
    try {
      const config = readConfig();
      if (!config.selfModification.enabled) {
        return res.status(400).json({
          ok: false,
          message: "Self-modification is disabled. Enable it in Settings first.",
        });
      }

      const body = (req.body || {}) as SelfModProposeBody;
      const { proposal, modelUsed, warning } = await generateSelfModProposal(config, body);

      const autoApplyRequested = Boolean(body.autoApply) && config.selfModification.autoApplyEnabled;
      if (autoApplyRequested) {
        const applied = applySelfModProposal(proposal, "auto");
        const restartScheduled = scheduleElectronRelaunch(1800);
        return res.json({
          ok: true,
          proposalId: proposal.id,
          targetFile: proposal.targetRelativePath,
          summary: proposal.summary,
          diffPreview: proposal.diffPreview,
          approvalCode: proposal.approvalCode,
          expiresAt: proposal.expiresAt,
          autoApplied: true,
          backupPath: applied.backupPath,
          modelUsed,
          warning,
          restartScheduled,
          message: `Auto-applied to ${applied.targetFile}. Backup created.${restartScheduled ? " App restart scheduled." : ""}`,
        });
      }

      return res.json({
        ok: true,
        proposalId: proposal.id,
        targetFile: proposal.targetRelativePath,
        summary: proposal.summary,
        diffPreview: proposal.diffPreview,
        approvalCode: proposal.approvalCode,
        expiresAt: proposal.expiresAt,
        modelUsed,
        warning,
      });
    } catch (error) {
      const message = String(error || "");
      const status = /required|invalid|not found|inside workspace|missing|too large/i.test(message) ? 400 : 500;
      return res.status(status).json({ ok: false, message });
    }
  });

  app.post("/api/self-mod/apply", (req, res) => {
    try {
      const config = readConfig();
      const body = (req.body || {}) as SelfModApplyBody;
      const proposalId = String(body.proposalId || "").trim();
      const approvalCode = String(body.approvalCode || "").trim();
      if (!proposalId) {
        return res.status(400).json({ ok: false, message: "proposalId is required." });
      }

      const proposal = selfModProposals.get(proposalId);
      if (!proposal) {
        return res.status(404).json({ ok: false, message: "Proposal not found." });
      }
      if (proposal.status !== "pending") {
        return res.status(409).json({ ok: false, message: `Proposal is already ${proposal.status}.` });
      }
      if (new Date(proposal.expiresAt).getTime() < Date.now()) {
        proposal.status = "expired";
        return res.status(410).json({ ok: false, message: "Proposal expired. Generate a new proposal." });
      }
      const allowAutoApply = config.selfModification.autoApplyEnabled && Boolean(body.autoApply);
      if (!approvalCode && !allowAutoApply) {
        return res.status(400).json({ ok: false, message: "approvalCode is required unless auto-apply mode is enabled." });
      }
      if (approvalCode && approvalCode !== proposal.approvalCode) {
        return res.status(403).json({ ok: false, message: "Approval code mismatch." });
      }

      const applied = applySelfModProposal(proposal, allowAutoApply ? "auto" : "manual");
      const restartScheduled = allowAutoApply ? scheduleElectronRelaunch(1800) : false;

      return res.json({
        ok: true,
        message: `Applied changes to ${applied.targetFile}. Backup created.${restartScheduled ? " App restart scheduled." : ""}`,
        targetFile: applied.targetFile,
        backupPath: applied.backupPath,
        applyMode: allowAutoApply ? "auto" : "manual",
        restartScheduled,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, message: String(error) });
    }
  });

  app.post("/api/connector/import", (req, res) => {
    try {
      const config = readConfig();
      const requestedPath = typeof req.body?.path === "string" ? req.body.path.trim() : "";
      const connectorPath = requestedPath || config.connectorToolPath;
      if (!connectorPath) {
        return res.status(400).json({ ok: false, message: "connectorToolPath is not set." });
      }
      if (!fs.existsSync(connectorPath)) {
        return res.status(400).json({ ok: false, message: `Path not found: ${connectorPath}` });
      }

      const candidateFiles = fs.statSync(connectorPath).isDirectory()
        ? walkJsonFiles(connectorPath, 4)
        : connectorPath.toLowerCase().endsWith(".json")
          ? [connectorPath]
          : [];
      if (!candidateFiles.length) {
        return res.status(400).json({ ok: false, message: "No JSON files found in connector path." });
      }

      const mergedFlat: Record<string, string> = {};
      for (const filePath of candidateFiles) {
        try {
          const raw = fs.readFileSync(filePath, "utf-8");
          const parsed = JSON.parse(raw);
          Object.assign(mergedFlat, flattenObject(parsed));
        } catch {
          // Ignore non-JSON or unreadable files
        }
      }

      const guessedWpUrl = pickByKey(mergedFlat, ["wordpress.baseurl", "wp.baseurl", "wp_url", "wordpress_url", "site_url"]);
      const guessedWpUser = pickByKey(mergedFlat, ["wordpress.username", "wp.username", "wp_user", "username"]);
      const guessedWpPassword = pickByKey(mergedFlat, ["wordpress.apppassword", "app_password", "application_password", "wp_app_password"]);
      const guessedVpsUrl = pickByKey(mergedFlat, ["vps.baseurl", "bridge.baseurl", "webhook.baseurl", "vps_url", "bridge_url"]);
      const guessedVpsToken = pickByKey(mergedFlat, ["vps.apitoken", "bridge.apitoken", "api_token", "bearer_token"]);
      const guessedHostingerUrl = pickByKey(mergedFlat, ["hostinger.baseurl", "hostinger_url", "hostinger.api_url"]);
      const guessedHostingerToken = pickByKey(mergedFlat, ["hostinger.apitoken", "hostinger.token", "hostinger_api_token"]);
      const guessedHostingerUser = pickByKey(mergedFlat, ["hostinger.username", "hostinger.user", "hostinger_login"]);

      const nextConfig = sanitizeConfigInput({
        ...config,
        connectorToolPath: connectorPath,
        wordpressSites: config.wordpressSites.length
          ? config.wordpressSites
          : guessedWpUrl
            ? [
                {
                  id: `site-${Date.now()}`,
                  name: "Imported WordPress Site",
                  baseUrl: guessedWpUrl,
                  username: guessedWpUser,
                  appPassword: guessedWpPassword,
                },
              ]
            : config.wordpressSites,
        vps: {
          ...config.vps,
          baseUrl: guessedVpsUrl || config.vps.baseUrl,
          apiToken: guessedVpsToken || config.vps.apiToken,
        },
        hostinger: {
          ...config.hostinger,
          baseUrl: guessedHostingerUrl || config.hostinger.baseUrl,
          apiToken: guessedHostingerToken || config.hostinger.apiToken,
          username: guessedHostingerUser || config.hostinger.username,
        },
      });

      writeConfig(nextConfig);
      return res.json({
        ok: true,
        message: `Imported connector hints from ${candidateFiles.length} JSON file(s).`,
        imported: {
          wordpressBaseUrl: guessedWpUrl || null,
          vpsBaseUrl: guessedVpsUrl || null,
          hostingerBaseUrl: guessedHostingerUrl || null,
        },
      });
    } catch (error) {
      return res.status(500).json({ ok: false, message: String(error) });
    }
  });

  app.get("/api/rules", (_req, res) => {
    const config = readConfig();
    res.json({ rules: config.mcpRules || DEFAULT_RULES });
  });

  app.put("/api/rules", (req, res) => {
    const config = readConfig();
    const rules = typeof req.body?.rules === "string" ? req.body.rules : config.mcpRules;
    const updated = sanitizeConfigInput({ ...config, mcpRules: rules });
    writeConfig(updated);
    res.json({ rules: updated.mcpRules });
  });

  app.post("/api/connection/test", async (req, res) => {
    try {
      const type = String(req.body?.type || "");
      const config = readConfig();

      if (type === "wordpress") {
        const site = getSiteFromConfig(config, req.body?.siteId);
        await fetchWordPressPosts(site, 1, 1, "");
        return res.json({ ok: true, message: `Connected to ${site.baseUrl}` });
      }

      if (type === "vps") {
        if (!config.vps.baseUrl) {
          return res.status(400).json({ ok: false, message: "VPS base URL is not set." });
        }
        await fetchFromVps(config, config.vps.wpStatusPath || "/api/wp-status");
        return res.json({ ok: true, message: "VPS bridge endpoint is reachable." });
      }

      if (type === "google") {
        return res.status(400).json({
          ok: false,
          message: "Google GA4/GSC direct auth is not implemented yet in this build. Use VPS bridge endpoints for now.",
        });
      }

      if (type === "hostinger") {
        if (!config.hostinger.baseUrl) {
          return res.status(400).json({ ok: false, message: "Hostinger base URL is not set." });
        }
        const response = await fetch(config.hostinger.baseUrl, {
          method: "GET",
          headers: {
            ...(config.hostinger.apiToken ? { Authorization: `Bearer ${config.hostinger.apiToken}` } : {}),
          },
        });
        return res.json({
          ok: response.ok,
          message: response.ok
            ? "Hostinger endpoint is reachable."
            : `Hostinger endpoint responded with status ${response.status}.`,
        });
      }

      if (type === "ai") {
        const apiKey = getGeminiApiKey(config);
        if (!apiKey) {
          return res.status(400).json({
            ok: false,
            message: "Gemini API key is missing. Add it in Settings > AI Model Routing or in .env (GEMINI_API_KEY).",
          });
        }

        const ai = new GoogleGenAI({ apiKey });
        const selectedModel = (config.ai.model || "gemini-3-flash-preview").trim();
        const fallbackModel = (config.ai.fallbackModel || "gemini-3-flash-preview").trim();
        const result = await generateWithModelFallback(
          ai,
          selectedModel,
          fallbackModel,
          [{ parts: [{ text: "Respond with exactly: AI model connection test OK." }] }],
          0.1,
        );
        return res.json({
          ok: true,
          message: result.warning
            ? `${result.warning} Test response: ${result.text}`
            : `Model ${result.modelUsed} test OK: ${result.text}`,
        });
      }

      return res.status(400).json({ ok: false, message: "Unknown connection test type." });
    } catch (error) {
      return res.status(500).json({ ok: false, message: String(error) });
    }
  });

  app.get("/api/wp/sites", (_req, res) => {
    const config = readConfig();
    res.json({
      activeSiteId: config.activeSiteId,
      sites: config.wordpressSites,
    });
  });

  app.get("/api/wp/posts", async (req, res) => {
    try {
      const config = readConfig();
      const site = getSiteFromConfig(config, typeof req.query.siteId === "string" ? req.query.siteId : undefined);
      const perPage = Number(req.query.perPage || 20);
      const page = Number(req.query.page || 1);
      const search = typeof req.query.search === "string" ? req.query.search : "";
      const posts = await fetchWordPressPosts(site, perPage, page, search);
      return res.json({ siteId: site.id, posts });
    } catch (error) {
      return res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/wp/post/:postId", async (req, res) => {
    try {
      const config = readConfig();
      const site = getSiteFromConfig(config, typeof req.query.siteId === "string" ? req.query.siteId : undefined);
      const postId = Number(req.params.postId);
      if (!Number.isFinite(postId)) {
        return res.status(400).json({ error: "Invalid post id." });
      }
      const post = await fetchWordPressPost(site, postId);
      return res.json({ siteId: site.id, post });
    } catch (error) {
      return res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/content/review", async (req, res) => {
    try {
      const body = (req.body || {}) as ContentReviewBody;
      const config = readConfig();

      let reviewContent = (body.content || "").trim();
      let title = (body.title || "").trim();

      if (!reviewContent && body.postId) {
        const site = getSiteFromConfig(config, body.siteId);
        const post = await fetchWordPressPost(site, body.postId);
        reviewContent = stripHtml(post.content || "");
        title = stripHtml(post.title || title);
      }

      if (!reviewContent) {
        return res.status(400).json({ error: "No content provided for review." });
      }

      const apiKey = getGeminiApiKey(config);
      if (!apiKey) {
        return res.status(400).json({
          error: "Gemini is not configured yet. Add API key in Settings > AI Model Routing or in .env and restart.",
        });
      }

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Review this article and provide:
1. Journalistic integrity check
2. SEO issues and fixes
3. Readability + structure improvements
4. Suggested better headline variants
5. A publish-readiness score (0-100)

Title: ${title || "Untitled"}

Article:
${reviewContent}`;
      const requestedModel = (config.ai.model || "gemini-3-flash-preview").trim();
      const fallbackModel = (config.ai.fallbackModel || "gemini-3-flash-preview").trim();
      const result = await generateWithModelFallback(
        ai,
        requestedModel,
        fallbackModel,
        [
          {
            parts: [
              { text: buildSystemPrompt("Content review request from editor", config.mcpRules || DEFAULT_RULES) },
              { text: prompt },
            ],
          },
        ],
        0.6,
      );

      return res.json({
        review: result.text || "No review generated.",
        modelUsed: result.modelUsed,
        warning: result.warning,
      });
    } catch (error) {
      return res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/seo-stats", async (_req, res) => {
    const config = readConfig();

    if (config.vps.baseUrl) {
      try {
        const vpsStats = await fetchFromVps(config, config.vps.seoStatsPath || "/api/seo-stats");
        return res.json({ ...vpsStats, source: "vps" });
      } catch (error) {
        console.error("VPS seo-stats fetch failed:", error);
      }
    }

    try {
      const site = getSiteFromConfig(config);
      const posts = await fetchWordPressPosts(site, 100, 1, "");
      const history = Array.from({ length: 7 }, (_, offset) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - offset));
        const isoDay = date.toISOString().slice(0, 10);
        const publishedCount = posts.filter((post) => post.date?.slice(0, 10) === isoDay).length;
        return {
          date: date.toLocaleDateString(),
          clicks: publishedCount,
          impressions: 0,
        };
      });

      return res.json({
        clicks: 0,
        impressions: 0,
        avgPosition: 0,
        ctr: 0,
        history,
        source: "wordpress-publishing-fallback",
        note: "Real SEO metrics require GA4/GSC or a VPS SEO endpoint. This fallback only shows publishing activity.",
      });
    } catch {
      return res.json({
        clicks: 0,
        impressions: 0,
        avgPosition: 0,
        ctr: 0,
        history: [],
        source: "not-configured",
        note: "Configure at least one WordPress site or a VPS SEO endpoint in Settings.",
      });
    }
  });

  app.get("/api/wp-status", async (_req, res) => {
    const config = readConfig();

    if (config.vps.baseUrl) {
      try {
        const vpsStatus = await fetchFromVps(config, config.vps.wpStatusPath || "/api/wp-status");
        return res.json({ ...vpsStatus, source: "vps" });
      } catch (error) {
        console.error("VPS wp-status fetch failed:", error);
      }
    }

    try {
      const site = getSiteFromConfig(config);
      await fetch(`${site.baseUrl}/wp-json`);
      return res.json({
        status: "ok",
        source: "wordpress",
        siteUrl: site.baseUrl,
        issues: [
          {
            id: "setup-info",
            type: "integration",
            message: "WordPress connection is reachable. Add VPS status endpoint for deeper health diagnostics.",
            severity: "low",
          },
        ],
      });
    } catch {
      return res.json({
        status: "warning",
        source: "fallback",
        siteUrl: null,
        issues: [
          {
            id: "missing-site",
            type: "integration",
            message: "No reachable WordPress site configured. Update Settings to enable live checks.",
            severity: "high",
          },
        ],
      });
    }
  });

  app.get("/api/automations", async (_req, res) => {
    const config = readConfig();
    if (!config.vps.baseUrl) {
      return res.json({
        items: [],
        source: "not-configured",
        note: "Set VPS base URL and automations path in Settings to load your real automations.",
      });
    }

    try {
      const payload = await fetchFromVps(config, config.vps.automationsPath || "/api/automations");
      const items = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : [];
      return res.json({
        items,
        source: "vps",
      });
    } catch (error) {
      return res.status(500).json({
        items: [],
        source: "vps-error",
        error: String(error),
      });
    }
  });

  app.post("/api/research/web", async (req, res) => {
    try {
      const query = String(req.body?.query || "").trim();
      if (!query) {
        return res.status(400).json({ ok: false, message: "query is required." });
      }
      const config = readConfig();
      if (!config.research.webBrowsingEnabled) {
        return res.status(400).json({ ok: false, message: "Web browsing is disabled in settings." });
      }
      const sources = await getWebSources(query, config.research.maxWebSources);
      return res.json({
        ok: true,
        query,
        sources,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, message: String(error) });
    }
  });

  app.post("/api/research/scholar", async (req, res) => {
    try {
      const query = String(req.body?.query || "").trim();
      if (!query) {
        return res.status(400).json({ ok: false, message: "query is required." });
      }
      const config = readConfig();
      if (!config.research.scholarEnabled) {
        return res.status(400).json({ ok: false, message: "Scholar research is disabled in settings." });
      }
      const sources = await getScholarSources(query, Math.max(3, config.research.maxWebSources));
      return res.json({
        ok: true,
        query,
        sources,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, message: String(error) });
    }
  });

  app.post("/api/research/notebook", (req, res) => {
    try {
      const query = String(req.body?.query || "").trim();
      if (!query) {
        return res.status(400).json({ ok: false, message: "query is required." });
      }
      const config = readConfig();
      const rootPath = String(req.body?.workspacePath || config.research.notebookWorkspacePath || "").trim();
      if (!rootPath) {
        return res.status(400).json({
          ok: false,
          message: "Notebook workspace path is not configured. Set it in Settings > Research.",
        });
      }
      const sources = getNotebookSources(query, rootPath, config.research.maxNotebookSnippets);
      return res.json({
        ok: true,
        query,
        workspacePath: rootPath,
        sources,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, message: String(error) });
    }
  });

  app.post("/api/research/deep-dive", async (req, res) => {
    try {
      const query = String(req.body?.query || "").trim();
      if (!query) {
        return res.status(400).json({ ok: false, message: "query is required." });
      }

      const config = readConfig();
      const includeWeb = req.body?.includeWeb !== false && config.research.webBrowsingEnabled;
      const includeScholar = req.body?.includeScholar !== false && config.research.scholarEnabled;
      const includeNotebook = Boolean(req.body?.includeNotebook);
      const articleMode = Boolean(req.body?.articleMode);
      const notebookPath = String(req.body?.workspacePath || config.research.notebookWorkspacePath || "").trim();

      const webSources = includeWeb ? await getWebSources(query, config.research.maxWebSources) : [];
      const scholarSources = includeScholar ? await getScholarSources(query, Math.max(3, config.research.maxWebSources)) : [];
      const notebookSources = includeNotebook ? getNotebookSources(query, notebookPath, config.research.maxNotebookSnippets) : [];

      const allSources = [...scholarSources, ...webSources, ...notebookSources].slice(0, 14);
      if (!allSources.length) {
        return res.status(400).json({
          ok: false,
          message: "No sources found. Enable research providers in Settings and try a more specific query.",
        });
      }

      const apiKey = getGeminiApiKey(config);
      if (!apiKey) {
        return res.json({
          ok: true,
          query,
          sources: allSources,
          summary:
            "Research sources found. Add Gemini API key to generate deep explanation and optional article output.",
        });
      }

      const ai = new GoogleGenAI({ apiKey });
      const synthesisPrompt = [
        articleMode
          ? "Create a deep-dive public-facing article in plain language."
          : "Create a concise research brief with practical interpretation.",
        "Explain what the research means, confidence caveats, and practical real-life use cases for ordinary people.",
        "Keep claims aligned with provided sources only.",
        formatSourcesAsPromptBlock("SOURCE MATERIAL", allSources),
        `User topic: ${query}`,
      ].join("\n\n");

      const result = await generateWithModelFallback(
        ai,
        (config.ai.model || "gemini-3-flash-preview").trim(),
        (config.ai.fallbackModel || "gemini-3-flash-preview").trim(),
        [{ parts: [{ text: synthesisPrompt }] }],
        0.55,
      );

      return res.json({
        ok: true,
        query,
        articleMode,
        sources: allSources,
        output: result.text || "No output generated.",
        modelUsed: result.modelUsed,
        warning: result.warning,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, message: String(error) });
    }
  });

  app.post("/api/agent", async (req, res) => {
    try {
      const { prompt, context, parts = [] } = (req.body || {}) as AgentRequestBody;
      if (!prompt || !prompt.trim()) {
        return res.status(400).json({ error: "Missing prompt." });
      }

      const config = readConfig();
      const apiKey = getGeminiApiKey(config);
      if (!apiKey) {
        return res.json({
          text: "Gemini is not configured yet. Add API key in Settings > AI Model Routing or in .env, then restart the app.",
        });
      }

      if (isAutonomousSelfModIntent(prompt)) {
        const selfModResult = await runAutonomousSelfModification(config, prompt);
        return res.json({
          text: selfModResult.text,
          selfModification: {
            attempted: true,
            ok: selfModResult.ok,
            targetFile: selfModResult.targetFile,
            backupPath: selfModResult.backupPath,
          },
        });
      }

      const safeParts: AgentPart[] = Array.isArray(parts)
        ? parts
            .filter((part) => part && (typeof part.text === "string" || part.inlineData))
            .map((part) => ({
              text: typeof part.text === "string" ? part.text : undefined,
              inlineData: part.inlineData
                ? {
                    mimeType: part.inlineData.mimeType,
                    data: part.inlineData.data,
                  }
                : undefined,
            }))
        : [];

      const researchFlags = req.body?.research || {};
      const autoResearch = /\b(latest|today|current|verify|fact|source|research|study|paper|scholar)\b/i.test(prompt);
      const wantsWebResearch = Boolean(
        config.research.webBrowsingEnabled && (researchFlags.web === true || (autoResearch && researchFlags.web !== false)),
      );
      const wantsScholarResearch = Boolean(
        config.research.scholarEnabled &&
          (researchFlags.scholar === true ||
            /\b(scholar|scientific|journal|study|paper|evidence)\b/i.test(prompt)),
      );
      const wantsNotebookResearch = Boolean(researchFlags.notebook && config.research.notebookWorkspacePath);
      const articleMode = Boolean(researchFlags.articleMode);

      let webSources: WebSource[] = [];
      let scholarSources: WebSource[] = [];
      let notebookSources: WebSource[] = [];

      if (wantsWebResearch) {
        try {
          webSources = await getWebSources(prompt, config.research.maxWebSources);
        } catch (error) {
          console.error("Web research failed:", error);
        }
      }
      if (wantsScholarResearch) {
        try {
          scholarSources = await getScholarSources(prompt, Math.max(3, config.research.maxWebSources));
        } catch (error) {
          console.error("Scholar research failed:", error);
        }
      }
      if (wantsNotebookResearch) {
        try {
          notebookSources = getNotebookSources(prompt, config.research.notebookWorkspacePath, config.research.maxNotebookSnippets);
        } catch (error) {
          console.error("Notebook research failed:", error);
        }
      }

      const sources = [...scholarSources, ...webSources, ...notebookSources].slice(0, 16);
      const researchPromptBlock = [
        sources.length
          ? "Use the research sources below. Cite source URLs inline when making factual claims."
          : "No external research sources were loaded for this message.",
        articleMode ? "User requested article-style output if suitable." : "User did not request article output by default.",
        formatSourcesAsPromptBlock("RESEARCH SOURCES", sources),
      ]
        .join("\n")
        .trim();

      const ai = new GoogleGenAI({ apiKey });
      const requestedModel = (config.ai.model || "gemini-3-flash-preview").trim();
      const fallbackModel = (config.ai.fallbackModel || "gemini-3-flash-preview").trim();
      const result = await generateWithModelFallback(
        ai,
        requestedModel,
        fallbackModel,
        [
          {
            parts: [
              { text: buildSystemPrompt(context, config.mcpRules || DEFAULT_RULES) },
              { text: researchPromptBlock },
              ...safeParts,
              { text: `User request: ${prompt}` },
            ],
          },
        ],
        0.7,
      );

      return res.json({
        text: result.text || "No response from model.",
        modelUsed: result.modelUsed,
        warning: result.warning,
        research: {
          webCount: webSources.length,
          scholarCount: scholarSources.length,
          notebookCount: notebookSources.length,
          totalSources: sources.length,
        },
      });
    } catch (error) {
      console.error("Gemini API Error:", error);
      const detail = String(error || "").slice(0, 300);
      return res.status(500).json({
        error: "Failed to generate response.",
        text: `I encountered an error while processing your request: ${detail || "unknown error"}.`,
      });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distCandidates = [
      path.join(__dirname, "dist"),
      path.join(__dirname, "../dist"),
      path.join(process.cwd(), "dist"),
    ];
    const distPath = distCandidates.find((candidate) => fs.existsSync(candidate)) || distCandidates[0];
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(PORT, HOST, () => {
      console.log(`Server running on http://${HOST}:${PORT}`);
      resolve();
    });
    server.on("error", (error) => reject(error));
  });
}

startServer().catch((error) => {
  console.error("Server startup failed:", error);
  process.exit(1);
});
