- A user can be a teacher and an administrator at the same time and switches
  between the Teacher portal and the Admin portal with the portal switcher at
  the top of the sidebar, or with Alt+1 and Alt+2 (Option on a Mac). eduLIMS
  opens the portal last picked at the next sign-in, and the user menu lists
  every role. Each role keeps only its own access. Every role an identity
  provider sends counts, whether assigned directly or through a group; a
  student role combined with teacher or administrator refuses the sign-in
  with a message to contact the administrator. Upgrade step: run
  `pnpm db:migrate`, which adds the nullable `user.last_portal` column and a
  check that `user.role` holds an allowed role set.
