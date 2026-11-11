- The interface is English by default and available in Dutch. A language
  switcher in the header stores the choice in the `EDULIMS_LOCALE` cookie;
  without one, eduLIMS follows the browser's `Accept-Language`. Dates and
  numbers follow the chosen language, with times in Europe/Amsterdam.
- The roles are now `student`, `teacher` and `admin`, with the portals at
  `/student`, `/teacher` and `/admin`. Upgrade step: rename the identity
  provider roles to `edulims-teacher` and `edulims-admin` (the default
  `OIDC_ROLE_MAP` is
  `edulims-student:student,edulims-teacher:teacher,edulims-admin:admin`), or
  set `OIDC_ROLE_MAP` to your existing role names.
- The Microsoft button reads "Sign in with Microsoft". The Keycloak button
  reads "Sign in with Keycloak" in the chosen language unless `KEYCLOAK_LABEL`
  is set, which now has no default.
