<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Provenance: OWASP Cheat Sheet Series (the sheets that apply to eduLIMS)

Written by `scripts/vendor/owasp-cheatsheets.sh`. Never hand-edit this file or a
file beside it: change the pins in the script and re-run it.

- Upstream: <https://github.com/OWASP/CheatSheetSeries>
- Ref: commit `9c87d0a0e9411de028b9d7eb853872082d6d3382` (upstream publishes no release tag for this edition)
- Fetched: 2026-11-11, from
  `https://raw.githubusercontent.com/OWASP/CheatSheetSeries/9c87d0a0e9411de028b9d7eb853872082d6d3382/<upstream path>`
- Licence: CC-BY-SA-4.0, the upstream licence file is alongside; the text is
  `LICENSES/CC-BY-SA-4.0.txt` and `REUSE.toml` annotates this tree.
- Consumer: docs/security/README.md (the sheet index), the ASVS applicability table and the Top 10 mappings, .claude/rules/auth-security.md, the security-reviewer agent and the /owasp-lookup skill.
- Check: `bash scripts/vendor/owasp-cheatsheets.sh --check` re-fetches and diffs.

## Files

| File | Upstream path | sha256 |
|---|---|---|
| `LICENSE.md` | `LICENSE.md` | `2b47ecdd5078e948395bc5980226933854228ff688f10d1dd059208be4956084` |
| `Abuse_Case_Cheat_Sheet.md` | `cheatsheets/Abuse_Case_Cheat_Sheet.md` | `e840e3b9d772ca9375358ead22deb1a860fbd6c09d3bcec36aabe64d23558365` |
| `Access_Control_Cheat_Sheet.md` | `cheatsheets/Access_Control_Cheat_Sheet.md` | `4c3f631b959cb88c4aa5b040ec7a6da259fa5a0d01c03c9ce12f5df6face0de7` |
| `Authentication_Cheat_Sheet.md` | `cheatsheets/Authentication_Cheat_Sheet.md` | `92f7483b28548679917a329c7b9be1824f33e934d9eed670aaf3e9a1e7b37e83` |
| `Authorization_Cheat_Sheet.md` | `cheatsheets/Authorization_Cheat_Sheet.md` | `fb8b6e5c60ed783025beefb5049142fd9da02d01f5c95de18a19d26479737975` |
| `Authorization_Testing_Automation_Cheat_Sheet.md` | `cheatsheets/Authorization_Testing_Automation_Cheat_Sheet.md` | `7a997a70aa9e46f2e87dde58d00d2fa284ea8a231f2dac7d3630e88999414e80` |
| `CI_CD_Security_Cheat_Sheet.md` | `cheatsheets/CI_CD_Security_Cheat_Sheet.md` | `25b927dd92a7a0ac1acb821444c3e7df4a3ad69b75edc34c855acb20f973e593` |
| `Clickjacking_Defense_Cheat_Sheet.md` | `cheatsheets/Clickjacking_Defense_Cheat_Sheet.md` | `01d29bea979845416ea4ba7b68a4ecfa03da555ede0b6b0084d4c6b9cf2e8518` |
| `Content_Security_Policy_Cheat_Sheet.md` | `cheatsheets/Content_Security_Policy_Cheat_Sheet.md` | `4d5e2f4d1c42ae58672fabb8088b2254ce5e6990432b58e110604942f14b34d0` |
| `Cookie_Theft_Mitigation_Cheat_Sheet.md` | `cheatsheets/Cookie_Theft_Mitigation_Cheat_Sheet.md` | `159b9845f76df328d3ce2b524003fec70bda3b6268fa53ad81c100e36b855782` |
| `Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.md` | `cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.md` | `dfa755756257d3b9f2a0b81679b7c493136cab13254b08dd0f98267807e36bfe` |
| `Cross_Site_Scripting_Prevention_Cheat_Sheet.md` | `cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.md` | `e4bbeced6010bb9029061910e97f01f4391cb8b89d1a0f31a390ca5a00a5e9a8` |
| `Cryptographic_Storage_Cheat_Sheet.md` | `cheatsheets/Cryptographic_Storage_Cheat_Sheet.md` | `de48a9c65d23940f5f7335b315fc444f48f17dd1170f13f9c4875ba6d5353cfd` |
| `DOM_based_XSS_Prevention_Cheat_Sheet.md` | `cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.md` | `421639d8a75fb326981a6823b1a1876da00c7ad6ce8f4f32d7ad6cb631313972` |
| `Database_Security_Cheat_Sheet.md` | `cheatsheets/Database_Security_Cheat_Sheet.md` | `b5ad6125f2f908949df3a7866daa03a9f8487e94ea84f384eb852948375f15e2` |
| `Denial_of_Service_Cheat_Sheet.md` | `cheatsheets/Denial_of_Service_Cheat_Sheet.md` | `429d4f36078a9b26e6d897c911571111bda3d0a7e9bda79dd7bc442935dc3382` |
| `Dependency_Graph_SBOM_Cheat_Sheet.md` | `cheatsheets/Dependency_Graph_SBOM_Cheat_Sheet.md` | `6a05f465580effc5cb27b8867bc0c89ab7386ff101985f601927409901210f53` |
| `Docker_Security_Cheat_Sheet.md` | `cheatsheets/Docker_Security_Cheat_Sheet.md` | `a74b6384166e5daceafd3dc14d9264237b745e1ce805972ef1b043dd63127208` |
| `Email_Validation_and_Verification_Cheat_Sheet.md` | `cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.md` | `47df700e20b6e86c1814acde0812402ae92047ea25c918831b7e84d81710d5ed` |
| `Error_Handling_Cheat_Sheet.md` | `cheatsheets/Error_Handling_Cheat_Sheet.md` | `14314923abd95f117192bd7fcae2d9c313b476229fd55f4db6caa5c82d2d9dd1` |
| `File_Upload_Cheat_Sheet.md` | `cheatsheets/File_Upload_Cheat_Sheet.md` | `65f9a85b72e016063d1dafdb5b366cd52a94f8e4bf855f3b6bec22afec10bb81` |
| `GitHub_Actions_Security_Cheat_Sheet.md` | `cheatsheets/GitHub_Actions_Security_Cheat_Sheet.md` | `6394f44a8afd6afb8666994848558dc6300f2b4e086afa606a4c2e8002109fd3` |
| `HTTP_Headers_Cheat_Sheet.md` | `cheatsheets/HTTP_Headers_Cheat_Sheet.md` | `df04323a8b10ef16cf3a248dc1431fc3d19edde6d905e70754f36ab0f3a045d6` |
| `HTTP_Strict_Transport_Security_Cheat_Sheet.md` | `cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.md` | `5475d02d74e8715c1aec0a641bf1bb0ec05b9cdd4f5754d33d147047f2d00bd5` |
| `Injection_Prevention_Cheat_Sheet.md` | `cheatsheets/Injection_Prevention_Cheat_Sheet.md` | `323ac3d1dfa19daa068fe278765eeca9218892ec609898e91ac148701de89afb` |
| `Input_Validation_Cheat_Sheet.md` | `cheatsheets/Input_Validation_Cheat_Sheet.md` | `163390e3dcf5cc965aeac5e633692682403c08067a7f2ae54bdb49372e886810` |
| `Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.md` | `cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.md` | `3b0cef632300124beb38ba4169cc163cfce44dd768885e58fb56b4285c42da7f` |
| `JSON_Web_Token_Cheat_Sheet.md` | `cheatsheets/JSON_Web_Token_Cheat_Sheet.md` | `a604ef0656402d012870a28e16f8492b2160f7bd084f378855fd55b6e2dac030` |
| `JavaScript_and_TypeScript_Security_Cheat_Sheet.md` | `cheatsheets/JavaScript_and_TypeScript_Security_Cheat_Sheet.md` | `90fd109b5b162f402b867769e2111652d5c59efa74d45d02578dc8f4257992fa` |
| `Logging_Cheat_Sheet.md` | `cheatsheets/Logging_Cheat_Sheet.md` | `55ed0b4e9b2a68dba0f5a26c817a20760632d91b315aa42bb33ecfe36cc7195d` |
| `Logging_Vocabulary_Cheat_Sheet.md` | `cheatsheets/Logging_Vocabulary_Cheat_Sheet.md` | `3cf39e97ae23146663d92365442955186f4b4866432ece534dd1a133a124011a` |
| `Mass_Assignment_Cheat_Sheet.md` | `cheatsheets/Mass_Assignment_Cheat_Sheet.md` | `f325d48b32fd86e2b5450f51ccf773b639263f3c16b6daf6634587c262e5d4ea` |
| `Multi_Tenant_Security_Cheat_Sheet.md` | `cheatsheets/Multi_Tenant_Security_Cheat_Sheet.md` | `b546aa45feefa54f42d025e9823cd15d2cc67f1eb8d4c7b555775650321c050a` |
| `NPM_Security_Cheat_Sheet.md` | `cheatsheets/NPM_Security_Cheat_Sheet.md` | `8eab2482205c5a5d3b609a0d6b41e5dc849bd6a7271e44b8151caf6e98f2e479` |
| `NodeJS_Docker_Cheat_Sheet.md` | `cheatsheets/NodeJS_Docker_Cheat_Sheet.md` | `0f6e11609574d6d45c404aa1ce6860ef5f089fff3c7c6e431e847cbd4acd1d6e` |
| `Nodejs_Security_Cheat_Sheet.md` | `cheatsheets/Nodejs_Security_Cheat_Sheet.md` | `3c0685966f5e232e9dd9b7d3706293341d183ca8109ce408dc4a182df4c0982b` |
| `OAuth2_Cheat_Sheet.md` | `cheatsheets/OAuth2_Cheat_Sheet.md` | `cd31d4f3adb876949f1b3090862e88437becd740f3e8d54fd9809b892e82a45d` |
| `Prototype_Pollution_Prevention_Cheat_Sheet.md` | `cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.md` | `468f9279555b7bf3205e7dfa79edf6e2186da27f7f2f24879fe6065fe6e42beb` |
| `Query_Parameterization_Cheat_Sheet.md` | `cheatsheets/Query_Parameterization_Cheat_Sheet.md` | `273a906037e6389dc1683e44272bba9392807c477060f7736f403d6e20ff57ec` |
| `REST_Security_Cheat_Sheet.md` | `cheatsheets/REST_Security_Cheat_Sheet.md` | `3e2959541004f37a28d47ea1f742f30f46d06a331317eb4d9371617f2ad7a704` |
| `SQL_Injection_Prevention_Cheat_Sheet.md` | `cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.md` | `6c377eef95804d03ed29c27b8002a1d714ced833dfc651e1ee69ccf4abdadd6b` |
| `Secrets_Management_Cheat_Sheet.md` | `cheatsheets/Secrets_Management_Cheat_Sheet.md` | `c7b67badc6e5990da90d1942f48b73e6e354f157de9b4eee56381cf4a906ae61` |
| `Secure_Code_Review_Cheat_Sheet.md` | `cheatsheets/Secure_Code_Review_Cheat_Sheet.md` | `214194a8b9f2158b3a9282d4e5b9331195800c3812a5ccc0e2ca25f7d8e9258a` |
| `Server_Side_Request_Forgery_Prevention_Cheat_Sheet.md` | `cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.md` | `cfd23149653bdb4390817864c818b4ac5b8460b75ddfc2805dda3fd353e81060` |
| `Session_Management_Cheat_Sheet.md` | `cheatsheets/Session_Management_Cheat_Sheet.md` | `f4350da6e2922c80dc8312ec69e86749b7bf82512cdd80d5295505472080867d` |
| `Software_Supply_Chain_Security_Cheat_Sheet.md` | `cheatsheets/Software_Supply_Chain_Security_Cheat_Sheet.md` | `c3235cb8820e1a54f6cc7ec97955fd6288f4d41db3cd3d00b31f7ef29b95ad8d` |
| `Third_Party_Javascript_Management_Cheat_Sheet.md` | `cheatsheets/Third_Party_Javascript_Management_Cheat_Sheet.md` | `2fe93a65dc1fb97535ecefb22e927ed9c5b84fcfca1b4336e8965c49a01e3715` |
| `Threat_Modeling_Cheat_Sheet.md` | `cheatsheets/Threat_Modeling_Cheat_Sheet.md` | `5102d1557d58fdc184e1cb07dbd796f063e8899318e7d83de5b6242cebf74233` |
| `Transport_Layer_Security_Cheat_Sheet.md` | `cheatsheets/Transport_Layer_Security_Cheat_Sheet.md` | `1368bb1bfb1cc25e82e114105ab622bcc27e627bcda080c2078fe6c790ee0b9c` |
| `Unvalidated_Redirects_and_Forwards_Cheat_Sheet.md` | `cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.md` | `e9cc4acd0ed7bb9af6f2e4385f707ba2dbdd6e9e77fef281e2bcee8536d8d4b1` |
| `User_Privacy_Protection_Cheat_Sheet.md` | `cheatsheets/User_Privacy_Protection_Cheat_Sheet.md` | `95ff00890c3b1f1f21cf280f3ae584f292a7fab1a750c022cb66f901e1375816` |
| `Vulnerability_Disclosure_Cheat_Sheet.md` | `cheatsheets/Vulnerability_Disclosure_Cheat_Sheet.md` | `11c58e683e1cbeae8447dcbcadf6ae7a23ac3d9f24fced746552266f9ab71a4f` |
| `Vulnerable_Dependency_Management_Cheat_Sheet.md` | `cheatsheets/Vulnerable_Dependency_Management_Cheat_Sheet.md` | `77e7a460c4072442d524394109125391317d61961db78c3cdc2dd771c006872a` |
| `Web_Cache_Security_Cheat_Sheet.md` | `cheatsheets/Web_Cache_Security_Cheat_Sheet.md` | `a88a240f071b58d4f9891a6eb44e830ad985192af55d0270ecdb3eaf165859fb` |
| `XML_External_Entity_Prevention_Cheat_Sheet.md` | `cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.md` | `9363b0048b473dba0b9c3a87bc18b12b3fc910475cf24f6fa63171d1ea9b1afb` |
