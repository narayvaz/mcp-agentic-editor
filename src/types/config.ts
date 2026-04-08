export interface WordPressSiteConfig {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  appPassword: string;
}

export interface VpsConfig {
  baseUrl: string;
  apiToken: string;
  automationsPath: string;
  seoStatsPath: string;
  wpStatusPath: string;
}

export interface GoogleConfig {
  ga4PropertyId: string;
  gscSiteUrl: string;
  serviceAccountJson: string;
}

export interface HostingerConfig {
  baseUrl: string;
  username: string;
  apiToken: string;
}

export interface AiConfig {
  model: string;
  fallbackModel: string;
  apiKey: string;
}

export interface SelfModificationConfig {
  enabled: boolean;
  workspacePath: string;
}

export interface AppConfig {
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

export interface SeoStatsResponse {
  clicks: number;
  impressions: number;
  avgPosition: number;
  ctr: number;
  history: Array<{ date: string; clicks: number; impressions: number }>;
  source?: string;
  note?: string;
}

export interface WordPressStatusResponse {
  status: string;
  source?: string;
  siteUrl?: string | null;
  issues: Array<{
    id: string | number;
    type: string;
    message: string;
    severity: "low" | "medium" | "high";
  }>;
}
