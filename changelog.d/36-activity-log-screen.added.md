- The Admin portal has a full activity log at **Activity log**: every
  sign-in, refused sign-in, ended session, role change and block, newest
  first, 25 to a page. Filter it by the user who acted, the user it is
  about, the action, the outcome and a period of days; the filters, the sort
  and the page are part of the address, so a view can be shared. Names are
  looked up for the screen only; the log still holds ids and codes. A user's
  details link to their events. Upgrade step: the `edulims-migrate` service
  applies the new `0011_audit_event_indexes` migration on the next
  `docker compose up`.
