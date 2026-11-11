- Long lists can now be virtualised: only the rows in view are rendered, so a
  list of 10,000 rows scrolls smoothly and stays usable with the keyboard
  (arrow keys, Home, End, Page Up and Page Down) and a screen reader, which
  still hears each row's position in the whole list. Developers get the
  TanStack Devtools panel (Router, Query and Form) in `pnpm dev`; production
  builds contain none of it.
