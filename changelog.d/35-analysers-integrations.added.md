- The admin portal's **Analysers and integrations** screen (B3): the status
  of FerroEHR and FerroBRIDGE, each with its state as an icon and text, the
  last check, the last success, the response time and the reason of a
  failure, checked every minute inside the app container and on demand with
  **Check now**, so an unreachable service shows as **Unavailable** within
  5 minutes, and one that refuses eduLIMS's credentials as
  **Refused (authentication)**; and the analyser register, a searchable, filtered and sorted
  list of every analyser with its model, serial number, location, route to
  FerroEHR and status, where administrators add, edit and retire analysers,
  each change recorded in the activity log. The check targets come only from
  `FERROEHR_BASE_URL` and `FERROBRIDGE_BASE_URL`. Upgrade step: the
  `edulims-migrate` service applies the new `0009_analyser` and
  `0010_integration_check` migrations on the next `docker compose up`.
