import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
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
  workspacePath: string;
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
}

interface SelfModApplyBody {
  proposalId?: string;
  approvalCode?: string;
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

function normalizeBaseUrl(url: string): string {
  return (url || "").trim().replace(/\/+$/, "");
}

function defaultConfig(): AppConfig {
  return {
    version: 1,
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
      workspacePath: "",
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
      wordpressSites: Array.isArray(parsed.wordpressSites) ? parsed.wordpressSites : [],
      connectorToolPath: typeof parsed.connectorToolPath === "string" ? parsed.connectorToolPath : defaults.connectorToolPath,
      mcpRules: typeof parsed.mcpRules === "string" && parsed.mcpRules.trim() ? parsed.mcpRules : defaults.mcpRules,
    };

    if (merged.activeSiteId && !merged.wordpressSites.some((site) => site.id === merged.activeSiteId)) {
      merged.activeSiteId = merged.wordpressSites[0]?.id || null;
    }
    return merged;
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
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
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
  return `You are the MCP Agentic Editor, an AI assistant for a news website.

STRICT RULES TO FOLLOW (MCP RULES):
${rules}

Your goals:
1. Review articles for quality, tone, and adherence to these MCP rules.
2. Suggest SEO improvements.
3. Help manage WordPress issues.
4. Assist with automations.
5. Analyze images, audio, and video content provided for news value and SEO (ALT text, captions).

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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0");

  app.use(express.json({ limit: "20mb" }));

  app.get("/api/health", (_req, res) => {
    const config = readConfig();
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      configuredSites: config.wordpressSites.length,
      hasVpsBridge: Boolean(config.vps.baseUrl),
      hasHostingerConfig: Boolean(config.hostinger.baseUrl),
      selectedModel: config.ai.model,
      selfModificationEnabled: config.selfModification.enabled,
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
      const targetFile = String(body.targetFile || "").trim();
      const instruction = String(body.instruction || "").trim();
      if (!targetFile) {
        return res.status(400).json({ ok: false, message: "Target file is required." });
      }
      if (!instruction) {
        return res.status(400).json({ ok: false, message: "Instruction is required." });
      }

      const workspacePath = resolveWorkspacePath(config, body.workspacePath);
      const targetAbsolutePath = path.resolve(workspacePath, targetFile);
      if (!isInsideWorkspace(workspacePath, targetAbsolutePath)) {
        return res.status(400).json({ ok: false, message: "Target file must be inside workspace path." });
      }
      if (!fs.existsSync(targetAbsolutePath) || !fs.statSync(targetAbsolutePath).isFile()) {
        return res.status(400).json({ ok: false, message: `Target file not found: ${targetFile}` });
      }

      const originalContent = fs.readFileSync(targetAbsolutePath, "utf-8");
      if (originalContent.length > 200_000) {
        return res.status(400).json({
          ok: false,
          message: "Target file is too large for safe in-app modification. Split changes into smaller files.",
        });
      }

      const apiKey = getGeminiApiKey(config);
      if (!apiKey) {
        return res.status(400).json({
          ok: false,
          message: "Gemini API key is missing. Add it in Settings > AI Model Routing or .env.",
        });
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
        return res.status(500).json({
          ok: false,
          message: "Model did not return valid updatedContent JSON.",
          raw: result.text?.slice(0, 600) || "",
        });
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
        const oldest = [...selfModProposals.values()]
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
        if (oldest) selfModProposals.delete(oldest.id);
      }

      return res.json({
        ok: true,
        proposalId: proposal.id,
        targetFile: proposal.targetRelativePath,
        summary: proposal.summary,
        diffPreview: proposal.diffPreview,
        approvalCode: proposal.approvalCode,
        expiresAt: proposal.expiresAt,
        modelUsed: result.modelUsed,
        warning: result.warning,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, message: String(error) });
    }
  });

  app.post("/api/self-mod/apply", (req, res) => {
    try {
      const body = (req.body || {}) as SelfModApplyBody;
      const proposalId = String(body.proposalId || "").trim();
      const approvalCode = String(body.approvalCode || "").trim();
      if (!proposalId || !approvalCode) {
        return res.status(400).json({ ok: false, message: "proposalId and approvalCode are required." });
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
      if (approvalCode !== proposal.approvalCode) {
        return res.status(403).json({ ok: false, message: "Approval code mismatch." });
      }
      if (!fs.existsSync(proposal.targetAbsolutePath) || !fs.statSync(proposal.targetAbsolutePath).isFile()) {
        return res.status(400).json({ ok: false, message: "Target file no longer exists." });
      }
      const currentContent = fs.readFileSync(proposal.targetAbsolutePath, "utf-8");
      if (sha256(currentContent) !== proposal.originalHash) {
        return res.status(409).json({
          ok: false,
          message: "Target file changed since proposal generation. Generate a fresh proposal first.",
        });
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
            instruction: proposal.instruction,
            summary: proposal.summary,
            approvalCode: proposal.approvalCode,
          },
          null,
          2,
        ),
        "utf-8",
      );

      fs.writeFileSync(proposal.targetAbsolutePath, proposal.updatedContent, "utf-8");
      proposal.status = "applied";
      proposal.backupPath = backupPath;

      return res.json({
        ok: true,
        message: `Applied changes to ${proposal.targetRelativePath}. Backup created.`,
        targetFile: proposal.targetRelativePath,
        backupPath,
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
      });
    } catch (error) {
      console.error("Gemini API Error:", error);
      return res.status(500).json({
        error: "Failed to generate response.",
        text: "I'm sorry, I encountered an error while processing your request.",
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
