---
title: Handleiding voor beheerders
description: Inloggen in het Beheerportaal, gebruikers een rol geven, en wat je er straks mee kunt.
sidebar:
  label: Beheerder
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

In het Beheerportaal beheer je de gebruikers van eduLIMS en houd je de
koppelingen met de labapparatuur in de gaten. Deze handleiding is voor de
functioneel beheerder. Het installeren en draaien van de server staat onder
[Operations](/operations/install/) (in het Engels).

:::caution[In ontwikkeling]
eduLIMS is nog in ontwikkeling. Deze handleiding beschrijft wat nu werkt en
noemt de taken die gepland zijn. Elke geplande taak verwijst naar een
conceptrequirement, die nog kan veranderen.
:::

## Inloggen

1. Open eduLIMS in je browser en kies **Inloggen**.
2. Kies de inlogknop van je onderwijsinstelling en log in met je account van
   de instelling.

eduLIMS opent het Beheerportaal als je account de rol beheerder heeft.

## Je weg vinden

De zijbalk links toont de onderdelen van het Beheerportaal; de huidige pagina is
gemarkeerd. De knop linksboven (of **Ctrl+B**, **Cmd+B** op een Mac) klapt de
zijbalk in tot pictogrammen en weer uit, en eduLIMS onthoudt die keuze; op een
telefoon opent de knop de zijbalk als paneel. Boven de pagina laat het
kruimelpad zien waar je bent. Onderaan de zijbalk staat je naam: kies die voor
je account en rol, het thema (licht, donker of de instelling van je systeem)
en **Uitloggen**. Onderdelen die nog niet klaar zijn, tonen **Binnenkort
beschikbaar**.

## De taal wijzigen

eduLIMS is er in het Nederlands en het Engels. Kies bovenaan de pagina de
taalknop (daarop staat de huidige taal, bijvoorbeeld **Nederlands**) en kies
**Nederlands** of **English**. De pagina laadt opnieuw in die taal. Ben je
ingelogd, dan bewaart eduLIMS je keuze bij je account. Die geldt dan ook de
volgende keer dat je inlogt, op elk apparaat.

## Een gebruiker een rol geven

eduLIMS kent drie rollen: student, docent en beheerder (in de configuratie
`student`, `teacher` en `admin`). Een gebruiker zonder rol kan eduLIMS niet
gebruiken en krijgt een melding dat hij contact moet opnemen met een
beheerder.

Op dit moment komt de rol uit de identity provider. Bij elke keer inloggen
leest eduLIMS de rollen uit het ID-token en zet ze om naar een rol in
eduLIMS:

- **Microsoft Entra ID:** wijs de app-rol `edulims-student`,
  `edulims-teacher` of `edulims-admin` van de app-registratie van eduLIMS toe
  aan de gebruiker, of aan een groep waarin de gebruiker zit.
- **Keycloak:** geef de gebruiker de realmrol `edulims-student`,
  `edulims-teacher` of `edulims-admin`.

De wijziging werkt vanaf de volgende keer dat de gebruiker inlogt. De namen
van de rollen zijn instelbaar ([Identity providers](/operations/identity-providers/)).

:::note
Of rollen worden beheerd in de identity provider, in eduLIMS, of in de
provider met een uitzondering in het Beheerportaal, is nog een open vraag
voor de producteigenaar ([ADR 0010](/development/decisions/0010-vendor-neutral-oidc-entra-and-keycloak/)).
Rollen bewerken in het Beheerportaal wacht op dat antwoord.
:::

## Geplande taken

| Taak                                                                               | Requirement                      |
| ---------------------------------------------------------------------------------- | -------------------------------- |
| Gebruikers aanmaken en een rol toekennen                                           | [B1](/development/requirements/) |
| Klassen aanmaken en studenten koppelen, met de hand of met een CSV-import          | [B2](/development/requirements/) |
| De analyseapparaten registreren en zien of FerroBRIDGE en FerroEHR bereikbaar zijn | [B3](/development/requirements/) |
| Het logboek van uploads, HL7-berichten en fouten bekijken                          | [B4](/development/requirements/) |

De requirements zijn in het Engels.
