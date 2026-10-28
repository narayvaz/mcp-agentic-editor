# Prepared action implementation binding

The installed service now requires an identified application build before it can initialize agent execution. The Electron launcher already verifies packaged artifacts. At backend registration, Studio captures the manifest's source and backend hashes once and derives an executor identity. Missing or malformed identity disables agent tasks; it does not resolve credentials or grant authority.

New prepared steps retain version 1 bindings to this identity and to a canonical hash of their tool name, effect and input schema. Approval digests include that binding. The registry snapshots metadata and function references at construction; later changes to the caller's tool object cannot replace a prepared implementation. PostgreSQL refuses mutation or removal of a retained binding.

A different executable implementation or schema cannot execute an old prepared action. Startup recovery also checks waiting approvals and paused checkpoints, rejects their pending authority and pauses the task without changing its retained arguments or stamping a new binding onto it. Approval independently checks compatibility, covering requests made before recovery. A task can be redirected after review, superseding the old prepared action, or replaced with a new task. Historical completed receipts remain readable.

The dependency-injected runtime retains a contractless mode for legacy fixture tests. The installed service explicitly requires the verified identity. Unidentified development servers must not claim agent execution readiness.

This does not replace scope authorization, selected-destination/revision checks, exact approval or fencing. It does not establish cross-run idempotency, invalidate approvals after an old database restore, or reconcile uncertain remote effects. Those are separate B02/B09 acceptance requirements. Same-run replay detection continues to compare the action independently of the implementation hash, so a build change does not authorize repeating a successful write.

Tests cover same-build restart, changed implementation/schema/effect, legacy unbound actions, waiting approvals, approve-time refusal, immutable storage, unidentified-service refusal and readable historical results. No provider or real publishing action is involved.
