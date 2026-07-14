# List Query Contract

`ARC-03` defines the common list-query baseline for product and Admin resources.

The executable source is `config/list-query-contract.json`; `npm run test:list-query-contract` verifies list route existence, cursor pagination declarations, bounded sort/filter metadata, and export-route existence where export is supported.

Rules:

- Cursor pagination is the default for mutable product lists and Admin operational lists.
- `limit` must be bounded by the owning parser or repository. The platform default maximum is `100`.
- Filters and sorts are allowlists. Unknown filters, unknown sort keys, or unbounded full-table scans should fail validation or fall back to the documented default.
- Export is opt-in. Export routes must be explicit, permission-protected, and audited when they expose Admin or operational evidence.
- List contracts describe query shape; they do not bypass resource authorization or field redaction.

