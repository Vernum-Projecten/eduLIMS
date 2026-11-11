- Classes in the teacher portal (B2, D3): a teacher creates a class with its
  academic year, invites students and co-teachers by typing, pasting or
  reading a CSV list after a preview, and shares a translated invitation
  text; eduLIMS sends no email. A person joins every class that invited their
  verified address when they sign in. Teachers manage lab groups in group
  sets (by hand, by splitting the class or by copying a set), archive a class
  at the end of the year and copy it to the next. Students see their classes
  and pending invitations on their overview, and administrators see every
  class without grades or results. Upgrade step: the `edulims-migrate`
  service applies the new `0012_classes` migration on the next
  `docker compose up`, and `pnpm db:prune` also deletes class invitations 90
  days after they ended.
