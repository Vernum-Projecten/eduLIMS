// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The server entry: every request (page, server function, server route) resolves its locale
// from the locale cookie, else Accept-Language, else English, and renders inside that locale.
import handler from "@tanstack/react-start/server-entry";
import { paraglideMiddleware } from "@/i18n/server";
import { defineLocaleCookieServerStrategy } from "@/lib/i18n/locale-cookie";
import { isSecureOrigin } from "@/server/cookie-security";

defineLocaleCookieServerStrategy(() => isSecureOrigin());

export default {
  fetch(request: Request): Promise<Response> {
    return paraglideMiddleware(request, () => handler.fetch(request));
  },
};
