- eduLIMS keeps an activity log (B4): every sign-in, failed or refused
  sign-in, sign-out, ended session, role change, block, unblock, created and
  deleted user is recorded with ids and codes only, never a name, an e-mail
  address or an IP address. `pnpm db:prune` deletes events older than 12
  months and sessions that expired more than 30 days ago; run it daily
  (`docs/deployment.md`, "Retention"). `pnpm db:seed` also fills a fictional
  demo set of 70 people with accounts, sessions, blocks and four weeks of
  activity. Upgrade step: the `edulims-migrate` service applies the new
  `0005_audit_event` migration on the next `docker compose up`.
