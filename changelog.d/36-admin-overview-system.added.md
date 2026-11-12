- The admin portal's overview shows the number of users per role, the active
  sessions and the blocked users (each linking to that filter of **Users and
  roles**), the state of FerroEHR and FerroBRIDGE, and the 10 latest
  activity-log events. **System** now also shows, read-only, every enabled
  identity provider with its callback URL, role claim and role map, and the
  eduLIMS version, commit, build time and SLSA provenance reference of a
  release image; it never shows a secret. The release image sets these build
  values itself, so operators set nothing.
