// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Starlight's search button shows "Search" and the shortcut keys, but its aria-label is
// "Search" alone, so the visible text is not part of the name (WCAG 2.5.3, Label in Name).
// The button takes its name from its visible word instead, and the keys, already exposed
// through aria-keyshortcuts, are hidden from assistive technology.
for (const button of document.querySelectorAll("site-search button[data-open-modal]")) {
  const word = button.querySelector(":scope > span[aria-hidden]");
  const keys = button.querySelector(":scope > kbd");
  if (!word || !keys) continue;
  word.removeAttribute("aria-hidden");
  keys.setAttribute("aria-hidden", "true");
  button.removeAttribute("aria-label");
}
