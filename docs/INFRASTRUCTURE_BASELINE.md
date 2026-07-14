# Infrastructure Baseline

The minimum runtime baseline is PostgreSQL, Redis when Redis-backed rate limiting is selected, object storage when S3 storage is selected, and a Secret Manager provider in production.

Development and test may use explicit mock storage and in-memory rate limits. Production fails closed for missing PostgreSQL, mock storage, mock Provider runtime, and inline secret-only operation.

Provider enablement remains outside this baseline.
