- Container images for eduLIMS (`ghcr.io/vernum-projecten/edulims`) and its
  database migrations (`ghcr.io/vernum-projecten/edulims-migrate`) on
  distroless Node.js 26, for linux/amd64 and linux/arm64, with SLSA Build L3
  provenance and SBOM attestations, a Trivy gate before tagging and a weekly
  rescan of the published images.
- A production `compose.yaml` that runs eduLIMS beside FerroEHR and
  FerroBRIDGE on one PostgreSQL 18 server, with Keycloak as an optional
  profile, and a `compose.dev.yaml` with PostgreSQL and a ready Keycloak realm
  for `pnpm dev`.
