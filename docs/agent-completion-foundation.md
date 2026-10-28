# Opt-in artifact completion foundation

This change adds a delivery guard for new, explicitly contracted agent runs. Existing workflow version 1 runs and requests without a completion contract keep their existing completion rule. No existing run is migrated or assigned a contract, and no new recipe or publishing capability is activated.

An example run input includes:

```json
{
  "completionContract": {
    "version": 1,
    "requiredArtifacts": [
      { "kind": "report", "minCount": 1, "language": "hy" }
    ]
  }
}
```

Kinds use the existing evidence, draft, report and WordPress artifact vocabulary. `minCount` counts distinct retained output resources, not headlines, paragraphs or other content items. Requirements are bounded to 16 selectors and 100 total outputs. Language tags are normalized to lowercase. Duplicate selectors and overlapping language-free/language-specific requirements for the same kind are rejected rather than assigned ambiguous meaning.

The server validates a new contract before opening a database transaction. The contract is retained in the run, bound to request-id reuse and immutable through run mutations. Action approval digests include the contract only when present, preserving existing contractless action digests. Operator redirection cannot remove or weaken delivery requirements; a changed goal that needs different outputs requires a new run.

Tools now retain sanitized artifact references on their successful step receipts as well as in the aggregate output list. Contracted completion requires matching references in both places. Failed, uncertain or unproven receipts do not qualify; duplicate artifact IDs, aliases or revisions of one output do not inflate counts. The runtime rechecks these requirements inside the final completion mutation. Existing success/no-unresolved-action checks remain in force. A model proposal to finish without its promised outputs fails with `AGENT_COMPLETION_INVALID`; it never records a successful completion.

Retained contracts with an unsupported version stay readable and pause before a model or tool call. The runtime does not reinterpret, upgrade or execute them. New inputs accept only version 1. Durable storage remains the existing JSON record format, with no schema migration or dependency change.

## Limits and next acceptance gates

This foundation verifies retained delivery receipts. It does **not** verify artifact contents, factual accuracy, editorial review, continued existence at a remote destination, publication rights or recipe readiness. A report reference alone does not prove the promised headline package exists or is valid. Old receipts are not backfilled with inferred artifact provenance.

Before activating a named recipe, implement and test its versioned output-content schema, bounded packaging/retention tool and compatible review/export reader. The server must derive that recipe's contract and enforce its activation profile, grants and budgets; clients and model text must not be able to omit or weaken it. Prepared-action implementation binding is included in this increment and described in [AGENT_IMPLEMENTATION_BINDING.md](AGENT_IMPLEMENTATION_BINDING.md). Operation reconciliation and restore authority remain separate audited foundation work.

Verification lives in `tests/agent-completion.test.ts` and the completion-contract case within `tests/agent-store.test.ts`. The PostgreSQL case runs only against an explicitly supplied isolated `AZAT_AGENT_TEST_DATABASE_URL`; fixture tests use no private data or provider connections.
