const action = 'change|modify|update|improve|fix|redesign|restyle|replace|add|remove|implement|refactor|rewrite';
const selfTarget = /\b(?:yourself|your(?:\s+own)?\s+(?:app|application|ui|ux|interface|features?|icons?|colou?rs?|code|source\s+code|tabs?|components?|dashboard|sidebar|editor)|this\s+(?:app|application|assistant|interface)|azat\s+studio|(?:the|this)\s+(?:sidebar|tab|dashboard|window|placeholder|react\s+component|codebase))\b/i;
const request = new RegExp(`^(?:(?:please|kindly|now|directly|actually|immediately)\\s+)*(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?|i\\s+(?:want|need|would\\s+like)\\s+(?:you\\s+to|to)\\s+|i\\s+am\\s+asking\\s+you\\s+to\\s+|i'd\\s+like\\s+(?:you\\s+to|to)\\s+|you\\s+(?:need\\s+to|should|must)\\s+|let(?:'s|\\s+us)\\s+)?(${action})\\b\\s*(.*)$`, 'i');
const confirmation = /^(?:(?:please|now)\s+)*(?:do\s+(?:it|this|that)|go\s+ahead|proceed|apply\s+(?:it|this|that)|make\s+the\s+change|(?:initiate|start)\s+self[-\s]+mod(?:ification)?)\b/i;
const confirmDescription = /^(?:(?:please|now)\s+)*(?:go\s+ahead(?:\s+and)?|proceed(?:\s+(?:with|to))?|do\s+(?:it|this|that)\s+and)\s+(?:an?\s+)?(?:describ(?:e|ing)|description|explain(?:ing)?|explanation|tell(?:ing)?|outlin(?:e|ing)|summari[sz](?:e|ing)|list(?:ing)?|discuss(?:ing)?|review(?:ing)?|analy[sz](?:e|ing))\b/i;
const editorialObject = /^(?:(?:this|that|the|my|our|a|an)\s+)?(?:article(?!\s+(?:review|reviewer|editor))|paragraph|draft|translation|headline|script|text|story|report|caption|question|answer)\b/i;

/** Route explicit app-change requests to Development. This is not an execution permission check. */
export function isAutonomousSelfModIntent(prompt: string): boolean {
  const normalized = (prompt ?? '').normalize('NFKC').replace(/[’‘]/g, "'").trim();
  if (!normalized) return false;
  // A historical mention is context, not an imperative. Check each requested clause.
  const clauses = normalized.split(/[.!?;,\n]+|\b(?:and\s+then|then|also)\s+(?=(?:please\s+)?(?:change|modify|update|improve|fix|redesign|restyle|replace|add|remove|implement|refactor|rewrite)\b)/i);
  let appContext = false;
  let previousClause = '';
  for (const raw of clauses) {
    const clause = raw.trim();
    if (!clause) continue;
    const hasTarget = selfTarget.test(clause);
    if (confirmation.test(clause) && !confirmDescription.test(clause) && (hasTarget || appContext || /\bself[-\s]+mod(?:ification)?\b/i.test(clause))) return true;
    const intent = clause.match(request);
    if (intent) {
      const tail = intent[2].trim();
      // An article about the app is still editorial material, not the app itself.
      const target = tail.split(/\b(?:about|describing|discussing|mentioning)\b/i)[0];
      const genericCapability = /^(?:can|could)\s+you\b/i.test(clause)
        && /^(?:change|modify|improve|update)$/i.test(intent[1])
        && /^(?:yourself|your(?:\s+own)?\s+(?:ui|ux|interface|features?|code)|this\s+app|azat\s+studio)(?:\s+(?:at\s+all|in\s+general|when\s+asked))?$/i.test(tail);
      const scopedToApp = /^(?:in|for|within)\s+(?:this\s+(?:app|application|interface)|azat\s+studio|your(?:\s+own)?\s+(?:app|application|ui|interface))$/i.test(previousClause);
      if (!genericCapability && !editorialObject.test(tail)
        && (selfTarget.test(target) || scopedToApp || (appContext && /^(?:it|this|that|them|these|those)\b/i.test(tail)))) return true;
    }
    appContext ||= hasTarget;
    previousClause = clause;
  }
  return false;
}
