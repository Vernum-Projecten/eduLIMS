- eduLIMS now connects to PostgreSQL over TLS and verifies the server certificate in production, and refuses to start when `DATABASE_URL` lacks `sslmode=verify-full` (#40).
  Upgrade step: create `config/postgres-tls/ca.crt`, `server.crt` and `server.key` before you start the new `compose.yaml` (docs/deployment.md, "Database TLS"). A `DATABASE_URL` you set yourself needs `?sslmode=verify-full`.
