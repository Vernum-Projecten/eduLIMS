<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0013. Transport security inside the Compose stack

- Status: Proposed
- Date: 2026-11-11
- Deciders: maintainer (decision on #40, made on the owner's delegation)

## Context and problem statement

In production eduLIMS reaches PostgreSQL, FerroEHR and FerroBRIDGE over the
Compose `backend` network, and every one of those connections was plain.
The traffic carries personal data (names, e-mail addresses, grades) and the
measurements. ASVS 5.0 Level 2 asks for TLS on service-to-service
connections (V12.3.1), with a verified certificate (V12.3.2, V12.3.3) and a
trusted internal CA (V12.3.4).

Which internal connections get TLS, and what risk does the rest carry?

## Decision drivers

- The database holds every piece of personal data eduLIMS has; a connection
  to it is the most valuable one to protect.
- One Linux host runs the whole stack (ADR 0008): no internal traffic crosses
  a physical network today.
- FerroEHR and FerroBRIDGE are separate projects with their own TLS
  configuration; eduLIMS cannot verify a setting it does not own.
- Every extra certificate is one more expiry an operator has to renew.

## Considered options

1. **TLS everywhere:** PostgreSQL, FerroEHR and FerroBRIDGE behind verified
   TLS with an internal CA.
2. **TLS to PostgreSQL only;** FerroEHR and FerroBRIDGE stay plain on the
   internal network as an accepted residual risk.
3. **Nothing:** rely on the internal Docker network for all three.

## Decision

Option 2.

- **PostgreSQL:** a production `DATABASE_URL` must say
  `sslmode=verify-full`, which makes node-postgres require TLS and check
  both the certificate chain and the host name. `sslrootcert=<file>` names
  the CA; without it the system CAs apply (a managed PostgreSQL with a public
  CA). `src/server/env.ts` refuses any other `sslmode` when
  `NODE_ENV=production`, the migrate image checks the same, and there is no
  opt-out. `compose.yaml` starts PostgreSQL with `ssl=on` and the operator's
  certificate from `config/postgres-tls/`, and gives eduLIMS the CA
  (`docs/deployment.md`, "Database TLS").
- **FerroEHR and FerroBRIDGE:** eduLIMS keeps reaching them over `http` on
  the internal `backend` network.

## Consequences

- An eavesdropper or a spoofed host between eduLIMS and the database sees
  nothing and gets no connection; a missing or expired certificate stops
  eduLIMS from starting, which fails closed.
- The operator creates and renews one CA and one server certificate.
- **Accepted residual risk:** a process with access to the host's container
  network (a compromised container on `backend`, or root on the host) can
  read or alter the eduLIMS to FerroEHR and FerroBRIDGE traffic. On one host
  that attacker can already read the database volume and the `.env` file, so
  TLS on these two links would add little. The same holds for FerroEHR's and
  Keycloak's own connections to PostgreSQL, which their configuration
  governs.
- **Accepted residual risk, the MLLP port:** the Afinion 2 reaches
  FerroBRIDGE from the lab network, outside the host, over plain MLLP. No
  Afinion 2 document the repository cites describes TLS (the HL7
  Connectivity Protocol v4.0 describes plain MLLP framing; the manual asks
  only for a secure network; #186), and MLLP has no authentication. Anyone
  who reaches the port can send a result under any sample ID, and anyone on
  the path can read or alter one (Top 10:2025 A01 and A08; ASVS V12.3.1 and
  V13.2.1 are not met on this segment). The controls are the bind address
  (`FERROBRIDGE_MLLP_BIND_HOST` on the lab-facing address) and a host
  firewall that admits only the analysers' fixed addresses
  (`docs/deployment.md`, "The MLLP port"). What stays open is a device that
  takes over an analyser's address, or a host on the path. Revisit when Abbott documents TLS for the
  Afinion 2, or when a TLS-terminating device sits next to the analyser.
- **Revisit** this record when any service runs on a second host or the
  backend network spans machines; at that point option 1 applies.

## Links

- ASVS 5.0 V12.3: `docs/security/vendor/asvs/en/0x21-V12-Secure-Communication.md`
- ASVS 5.0 V13.2: `docs/security/vendor/asvs/en/0x22-V13-Configuration.md`
- Docker, "Packet filtering and firewalls":
  <https://docs.docker.com/engine/network/packet-filtering-firewalls/>
- node-postgres SSL: <https://node-postgres.com/features/ssl>
- PostgreSQL 18, "Secure TCP/IP Connections with SSL":
  <https://www.postgresql.org/docs/18/ssl-tcp.html>
