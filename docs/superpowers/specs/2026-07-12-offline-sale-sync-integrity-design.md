# Offline Sale Sync Integrity Design

## Problem

An offline sale can be shown as synchronized in Sellary Cashier even though no
matching sale exists on the server. The failure sequence is:

1. A customer or another sale dependency fails to synchronize.
2. The backend returns a failed sale result but still stores its idempotency
   record with `sale_id = null`.
3. A later retry finds that record and returns `duplicate` with no server sale.
4. The cashier treats every `duplicate` result as success and marks the local
   sale synchronized.

This creates a false-success state and removes the sale from the retry queue.

## Design

### Backend invariant

`SyncService` will store an idempotency response only after a sale has been
successfully persisted and the result contains a real `sale_id`. Failed
business results remain retryable and do not reserve their idempotency key.

Cached legacy responses without a valid `sale_id` will not be reported as a
successful duplicate. The backend will reprocess the sale so already affected
cashier installations can recover after the server is upgraded.

### Cashier invariant

The sync engine will mark a sale synchronized only when the server returns:

- `status = synced` with a non-null `sale_id`; or
- `status = duplicate` with a non-null `sale_id`.

A success-like result without a server ID is a permanent attention state, not
a successful synchronization. The local sale remains visible for an explicit
retry after the backend is upgraded.

### Queue dependency handling

Customer synchronization remains first. If any customer receives a permanent
business failure, sales that depend on that customer must not be falsely
reported as successful. Backend retry recovery is the primary guarantee; the
cashier validation is defense in depth for malformed or legacy responses.

## Error handling

- Transport failures continue to use the existing exponential backoff.
- Normal business failures continue to be shown as requiring attention.
- A missing `sale_id` in a `synced` or `duplicate` response is recorded as a
  permanent synchronization error with a clear diagnostic message.
- Successfully persisted sales preserve existing idempotent replay behavior.

## Tests

Backend regression tests will prove that:

1. A failed sale does not create an idempotency record.
2. Retrying the same payload after fixing its dependency creates exactly one
   server sale and returns its ID.
3. A legacy cached response with `sale_id = null` is reprocessed rather than
   returned as a successful duplicate.

Cashier regression tests will prove that a `synced` or `duplicate` result with
no `sale_id` is not passed to `markSaleSynced` and remains an attention item.

## Release

Run focused and full backend/cashier tests, compile/build both affected
packages, bump the cashier patch version, and produce the Windows Tauri release
artifacts using the repository's existing release configuration. Deployment of
the backend hotfix must precede distribution of the cashier installer.
