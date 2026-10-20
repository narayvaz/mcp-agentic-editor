type Config = Record<string, any>;
const secretSections: Record<string, string[]> = { ai: ['apiKey'], vps: ['apiToken'], hostinger: ['apiToken'], google: ['serviceAccountJson'] };

export function redactSettings<T extends Config>(config: T): T & { secretStatus: Record<string, boolean> } {
  const clean = JSON.parse(JSON.stringify(config));
  const secretStatus: Record<string, boolean> = {};
  for (const [section, fields] of Object.entries(secretSections)) {
    for (const field of fields) {
      secretStatus[`${section}.${field}`] = Boolean(clean[section]?.[field]);
      if (clean[section]) clean[section][field] = '';
    }
  }
  for (const site of clean.wordpressSites || []) {
    for (const field of ['username', 'appPassword']) {
      secretStatus[`wordpress.${site.id}.${field}`] = Boolean(site[field]);
      site[field] = '';
    }
  }
  delete clean.clearSecrets;
  clean.secretStatus = secretStatus;
  return clean;
}

/** Empty form fields retain saved secrets; explicit clearing is separately named. */
export function mergeSettingsSecrets<T extends Config>(base: T, incoming: Config): Config {
  const merged: Config = { ...incoming };
  const clear = new Set(Array.isArray(incoming.clearSecrets) ? incoming.clearSecrets.filter((x: unknown) => typeof x === 'string') : []);
  const known = new Set<string>();
  for (const [section, fields] of Object.entries(secretSections)) {
    merged[section] = { ...base[section], ...(incoming[section] || {}) };
    for (const field of fields) {
      const key = `${section}.${field}`; known.add(key);
      const value = incoming[section]?.[field];
      if (value !== undefined && typeof value !== 'string') throw new Error(`Invalid ${key}.`);
      merged[section][field] = clear.has(key) ? '' : (value?.trim() || base[section]?.[field] || '');
    }
  }
  if (incoming.wordpressSites !== undefined && !Array.isArray(incoming.wordpressSites)) throw new Error('Sites must be a list.');
  const ids = new Set<string>();
  merged.wordpressSites = (incoming.wordpressSites || base.wordpressSites || []).map((site: Config) => {
    if (!site || typeof site.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(site.id) || ids.has(site.id)) throw new Error('Each site needs a unique valid ID.');
    ids.add(site.id);
    const previous = (base.wordpressSites || []).find((x: Config) => x.id === site.id);
    const next = { ...site };
    for (const field of ['username', 'appPassword']) {
      const key = `wordpress.${site.id}.${field}`; known.add(key);
      if (site[field] !== undefined && typeof site[field] !== 'string') throw new Error(`Invalid ${field}.`);
      next[field] = clear.has(key) ? '' : (site[field]?.trim() || previous?.[field] || '');
    }
    return next;
  });
  for (const key of clear) if (!known.has(key)) throw new Error('Unknown credential field.');
  delete merged.secretStatus;
  delete merged.clearSecrets;
  if (merged.selfModification) merged.selfModification = { ...merged.selfModification, autoApplyEnabled: false };
  return merged;
}

export function publicSites(config: Config) {
  return { activeSiteId: config.activeSiteId, sites: (config.wordpressSites || []).map((site: Config) => ({ id: site.id, name: site.name, baseUrl: site.baseUrl, configured: Boolean(site.username && site.appPassword) })) };
}
