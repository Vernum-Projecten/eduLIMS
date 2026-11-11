- The language buttons in the header are now one language menu, and a
  signed-in user's choice is saved to their account and applied at every next
  sign-in, on any device. Upgrade step: run `pnpm db:migrate`, which adds the
  nullable `user.locale` column.
