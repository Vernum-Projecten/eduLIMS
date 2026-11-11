// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Drives a real SSO sign-in against the development Keycloak without a browser: eduLIMS runs
// in-process (`auth.handler`), Keycloak over HTTP, with one cookie jar per side. Test support
// for tests/integration only.

/** A minimal cookie jar: name=value pairs from `Set-Cookie`, sent back as one `Cookie`. */
export class CookieJar {
  readonly #cookies = new Map<string, string>();

  /** Stores the cookies a response sets; an expired or empty one is dropped. */
  store(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const [pair = ""] = line.split(";");
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === "" || /max-age=0/i.test(line)) this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
  }

  /** The `Cookie` header value. */
  header(): string {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  has(prefix: string): boolean {
    return [...this.#cookies.keys()].some((name) => name.includes(prefix));
  }
}

function decodeEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x3D;", "=")
    .replaceAll("&#61;", "=")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

/** Returns the action of the first form in an HTML page. */
export function formAction(html: string): string | null {
  const match = /<form[^>]*\baction="([^"]+)"/i.exec(html);
  return match?.[1] ? decodeEntities(match[1]) : null;
}

/** Returns the hidden inputs of an HTML form as name and value pairs. */
export function hiddenInputs(html: string): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const match of html.matchAll(/<input[^>]*>/gi)) {
    const tag = match[0];
    const name = /\bname="([^"]+)"/i.exec(tag)?.[1];
    const value = /\bvalue="([^"]*)"/i.exec(tag)?.[1];
    if (name && value !== undefined && /type="hidden"/i.test(tag)) {
      inputs[name] = decodeEntities(value);
    }
  }
  return inputs;
}

/**
 * Signs `username` (password = username, the realm's public dev accounts) in at Keycloak,
 * starting at the authorization or SAML request URL. Returns Keycloak's last response: a
 * redirect to eduLIMS (OIDC) or the auto-submitting SAML response page.
 */
export async function keycloakLogin(startUrl: string, username: string): Promise<Response> {
  const jar = new CookieJar();
  const page = await fetch(startUrl, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  jar.store(page);
  const html = await page.text();
  const action = formAction(html);
  if (!action) throw new Error(`no Keycloak login form (status ${page.status})`);
  const response = await fetch(action, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() },
    body: new URLSearchParams({ username, password: username, credentialId: "" }),
    signal: AbortSignal.timeout(10_000),
  });
  return response;
}

/** Whether the development Keycloak answers at `realm`. */
export async function keycloakReachable(realm: string): Promise<boolean> {
  try {
    const response = await fetch(`${realm}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
