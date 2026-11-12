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
- **The MLLP port:** the Afinion 2 reaches FerroBRIDGE from the lab
  network, outside the host. FerroBRIDGE 0.0.24, the pinned image, serves
  its HL7 v2 face as MLLP over TLS only and requires a client certificate
  that chains to `[hl7v2.tls] client_ca_file`; each `[[hl7v2.senders]]`
  entry names the `certificate_subject` its certificate carries, and the
  bridge refuses to start without the `[hl7v2.tls]` files, without a
  sender, or with a sender that names no `certificate_subject` (FerroBRIDGE
  book, "The HL7 v2 face"; CHANGELOG 0.0.23). The Afinion 2 cannot do TLS:
  the network and connectivity settings of the Afinion 2 User Manual,
  1117346 Rev. A, 2023/02, chapter "Configuration", Tables 1 and 2, have no
  TLS, encryption or certificate setting, and the chapter "Connectivity"
  asks only that the analyser "communicates with the external information
  system over a secure network" (being vendored under
  `docs/vendor/afinion/`, #209). The Afinion 2 route therefore waits on the FerroBRIDGE release
  that adds plain MLLP for devices, bound to their network addresses
  (FerroHEALTH/FerroBRIDGE#1918; decided on #131); until then the face
  stays off. Once it ships, the Afinion 2 sends on that plain lane, bound to
  the analyser's fixed address, together with the bind address
  (`FERROBRIDGE_MLLP_BIND_HOST` on the lab-facing address) and a host
  firewall that admits only the analysers' fixed addresses
  (`docs/deployment.md`, "The MLLP port"). A TLS-terminating sidecar per
  analyser was the technical alternative and is not chosen. **Accepted
  residual risk** on that lane: a device that takes over an analyser's
  address passes all three controls, and a host on the path can read or
  alter a result (Top 10:2025 A01 and A08; ASVS V12.3.1 and V13.2.1 are not
  met on this segment). Revisit when Abbott documents TLS for the Afinion 2.
- **Revisit** this record when any service runs on a second host or the
  backend network spans machines; at that point option 1 applies.

## Links

- ASVS 5.0 V12.3: `docs/security/vendor/asvs/en/0x21-V12-Secure-Communication.md`
- ASVS 5.0 V13.2: `docs/security/vendor/asvs/en/0x22-V13-Configuration.md`
- Docker, "Packet filtering and firewalls":
  <https://docs.docker.com/engine/network/packet-filtering-firewalls/>
- FerroHEALTH/FerroBRIDGE#1918, plain MLLP from devices that cannot do TLS:
  <https://github.com/FerroHEALTH/FerroBRIDGE/issues/1918>
- node-postgres SSL: <https://node-postgres.com/features/ssl>
- PostgreSQL 18, "Secure TCP/IP Connections with SSL":
  <https://www.postgresql.org/docs/18/ssl-tcp.html>
