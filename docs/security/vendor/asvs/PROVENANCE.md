<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Provenance: OWASP Application Security Verification Standard 5.0.0

Written by `scripts/vendor/owasp-asvs.sh`. Never hand-edit this file or a
file beside it: change the pins in the script and re-run it.

- Upstream: <https://github.com/OWASP/ASVS>
- Ref: tag `v5.0.0_release` (commit `5cf9b032440be53ce345ab3c130fda46ba1ce7a2`)
- Fetched: 2026-11-11, from
  `https://raw.githubusercontent.com/OWASP/ASVS/5cf9b032440be53ce345ab3c130fda46ba1ce7a2/<upstream path>`
- Licence: CC-BY-SA-4.0, the upstream licence file is alongside; the text is
  `LICENSES/CC-BY-SA-4.0.txt` and `REUSE.toml` annotates this tree.
- Consumer: docs/security/asvs-5.0-applicability.md (its table is generated from docs_en/*.flat.json by scripts/security/asvs-table.ts), the security-reviewer agent and the /owasp-lookup skill.
- Check: `bash scripts/vendor/owasp-asvs.sh --check` re-fetches and diffs.

## Files

| File | Upstream path | sha256 |
|---|---|---|
| `LICENSE.md` | `LICENSE.md` | `28a9529c7d0bb4dc51f4bf5c116a3d16ef247a052f7591466768ddf563fd1cf5` |
| `en/0x00-Header.yaml` | `5.0/en/0x00-Header.yaml` | `b8950cf9f2f248e78c52ab3b7e29d7dd531d1db4f876218e88e83d4b8b405ca2` |
| `en/0x01-Frontispiece.md` | `5.0/en/0x01-Frontispiece.md` | `5ae28d95996f7d8c793f8a6dc55f2683ea3da97ca05e966ae4c584b47e75f41e` |
| `en/0x02-Preface.md` | `5.0/en/0x02-Preface.md` | `fe6ac41f02478b23adbc2ec03bb9f2f8a9aafef5e6fcf7518892240869811dde` |
| `en/0x03-What-is-the-ASVS.md` | `5.0/en/0x03-What-is-the-ASVS.md` | `324bda52f0e6ebd4e1332a4e960be22dfb0890ec03cc7b460ce7c67776b36325` |
| `en/0x04-Assessment_and_Certification.md` | `5.0/en/0x04-Assessment_and_Certification.md` | `a425fd085d43a46c94398e559d57c800a5bfadb0c41e22bff38f59d4714c5aac` |
| `en/0x05-For-Users-Of-4.0.md` | `5.0/en/0x05-For-Users-Of-4.0.md` | `caaa6b7046b409aba5522e1aca948d2b80aa09fc08add66f046eeeb8b8f5fb79` |
| `en/0x10-V1-Encoding-and-Sanitization.md` | `5.0/en/0x10-V1-Encoding-and-Sanitization.md` | `8c0e36a42c3cbf711e2579eb68e1fea8090f52301cac7c400d7c392207b24ee7` |
| `en/0x11-V2-Validation-and-Business-Logic.md` | `5.0/en/0x11-V2-Validation-and-Business-Logic.md` | `70ad0f68df22ddd825c2837e74999fa026851e75a3128372307685e2bb526969` |
| `en/0x12-V3-Web-Frontend-Security.md` | `5.0/en/0x12-V3-Web-Frontend-Security.md` | `02de197d5aa55592cfa524e66d4aa15bd3e8955e23e76438ac413c94172488fc` |
| `en/0x13-V4-API-and-Web-Service.md` | `5.0/en/0x13-V4-API-and-Web-Service.md` | `efcadbf5ad78fb977c96d3d30e9a1d02aaafd4d787112a529ac82788a990406b` |
| `en/0x14-V5-File-Handling.md` | `5.0/en/0x14-V5-File-Handling.md` | `079a51123e5156a5ffc6329f266d49752cb60f6b780899484c3f1cfde3734ebb` |
| `en/0x15-V6-Authentication.md` | `5.0/en/0x15-V6-Authentication.md` | `e1e0aaa15e48f7941560176d28eeb11ad3b9b4f9d323437c0e950b3a16cd2b23` |
| `en/0x16-V7-Session-Management.md` | `5.0/en/0x16-V7-Session-Management.md` | `4aec329f2642ae750fbe1abac5da7e8a7bcfec6fc331bb0a46916970f9c88236` |
| `en/0x17-V8-Authorization.md` | `5.0/en/0x17-V8-Authorization.md` | `60c188b1703cab2086841d8f1b4adc0ededf66ed38c676a11bb92347646b5330` |
| `en/0x18-V9-Self-contained-Tokens.md` | `5.0/en/0x18-V9-Self-contained-Tokens.md` | `5f14e09fb67892e805ad386959eb3a8bafca03271dbb502ccf7323e82b3f812c` |
| `en/0x19-V10-OAuth-and-OIDC.md` | `5.0/en/0x19-V10-OAuth-and-OIDC.md` | `2da443986ba40987bd0908bbd7da2372ab0d777701cc590f4eb0fdad6ae804ed` |
| `en/0x20-V11-Cryptography.md` | `5.0/en/0x20-V11-Cryptography.md` | `a64f3f2dc6f53565dfba66e40fd336b50eab6cdb530c2791f62db8b58202bacf` |
| `en/0x21-V12-Secure-Communication.md` | `5.0/en/0x21-V12-Secure-Communication.md` | `62f7737e74172d3d2177bd838c1bc44461d0a70c37cfd09d9e4669252b480775` |
| `en/0x22-V13-Configuration.md` | `5.0/en/0x22-V13-Configuration.md` | `f66ef1306eba07e04fcd0f23b52d082747f1b4fba0a19934167fb35507afba6d` |
| `en/0x23-V14-Data-Protection.md` | `5.0/en/0x23-V14-Data-Protection.md` | `a9ba33b7c77379fed0f27fd019945e10fa143c63b8c4e4783b7cf587c9f56039` |
| `en/0x24-V15-Secure-Coding-and-Architecture.md` | `5.0/en/0x24-V15-Secure-Coding-and-Architecture.md` | `4c068e82b157159e9ab7099daecb40af4c2642ad791751f791a26785dead6b22` |
| `en/0x25-V16-Security-Logging-and-Error-Handling.md` | `5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md` | `23b0c0d4a54cc62a53e8669cbd15bb97f323249e9d837d3055f95873b2ef1652` |
| `en/0x26-V17-WebRTC.md` | `5.0/en/0x26-V17-WebRTC.md` | `29a55aed304efc92f6bf827aeee3323671d0521ddab823f8e6265018ce0ff2c0` |
| `en/0x90-Appendix-A_Glossary.md` | `5.0/en/0x90-Appendix-A_Glossary.md` | `47fcc73dceb0eac6e9c2ec0d9494708040729cd0db2b92a63815de3113ded324` |
| `en/0x91-Appendix-B_References.md` | `5.0/en/0x91-Appendix-B_References.md` | `426a9ce64b9aed6b38dc6ee075dc4c01ff43d032a92b72ae3cd833037e7190ec` |
| `en/0x92-Appendix-C_Cryptography.md` | `5.0/en/0x92-Appendix-C_Cryptography.md` | `3e01f78cb945011059e7e86b3e6ce11478c95d0ea9d559fec60143a519c403f6` |
| `en/0x93-Appendix-D_Recommendations.md` | `5.0/en/0x93-Appendix-D_Recommendations.md` | `7d3f24508fef17db099d5e937308c045845b6b9a89916c643f6328878ad02e6f` |
| `en/0x94-Appendix-E_Contributors.md` | `5.0/en/0x94-Appendix-E_Contributors.md` | `f8944945e558a436dbdc3cdca4de05efd6d900307e6b7e5cf4dd5e2bb1345f09` |
| `docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.json` | `5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.json` | `bcdbec214d70abcfad9284a31d4f9e5134305831d628aad3aa85d7e26626cb35` |
| `docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.flat.json` | `5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.flat.json` | `8201b20eec2908c3380ac600c91c8ba746346fbb808859366abb232027532311` |
| `docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv` | `5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv` | `98c8fe911b9edb403af8ee05d3ce8201ecac2659e313b053890a62847cdcf680` |
