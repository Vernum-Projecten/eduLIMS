- Charts now have one accessible foundation built on TanStack Charts: every
  chart has a name and a description for screen readers, a **View as table**
  button that shows the same values as a table, a legend that tells series
  apart by shape as well as colour, colours that keep enough contrast in the
  light and the dark theme, and numbers in the language you chose. The
  unused `recharts` library is gone. A development-only example page at
  `/dev/charts` shows a scatter plot with fictional data; production
  deployments do not serve it.
