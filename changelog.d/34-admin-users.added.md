- The admin portal's **Users and roles** screen (B1): a server-side paged,
  sorted and filtered table of every account (search on name and e-mail
  address; filters on role, sign-in method and status, kept in the address),
  and a details panel per user with the profile, the roles and where they
  come from, linked accounts, active sessions with **End session** and
  **End all sessions**, block and unblock with a reason and an optional last
  day, and the user's recent activity. Roles are owned in a hybrid way: a
  role the identity provider sends decides at every sign-in; without one, the
  roles an administrator set in eduLIMS apply, and only those can be edited
  here. A blocked user is refused at every sign-in, SSO included. The login
  page says which method this browser signed in with last time. Upgrade
  step: the `edulims-migrate` service applies the new `0007_user_role_source`
  migration on the next `docker compose up`.
