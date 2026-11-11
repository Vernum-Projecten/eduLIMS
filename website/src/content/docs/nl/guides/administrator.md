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

## Als je meer dan één rol hebt

Een account kan tegelijk docent en beheerder zijn. Bovenaan de zijbalk staat
dan het portaal waarin je werkt, bijvoorbeeld **Docentportaal**. Kies het om
de lijst met je portalen te openen en kies het andere, of druk op **Alt+1** of
**Alt+2** (**Option+1** of **Option+2** op een Mac). eduLIMS onthoudt het
portaal dat je kiest en opent het de volgende keer dat je inlogt. Elk portaal
toont alleen wat die rol mag zien: als beheerder zie je geen cijfers of
resultaten. Het gebruikersmenu onderaan de zijbalk toont al je rollen.

## Sneltoetsen

Druk buiten een tekstveld op **?** om alle sneltoetsen te zien, met de
toetsen voor jouw computer; je opent de lijst ook met **Sneltoetsen** in het
gebruikersmenu onderaan de zijbalk. Met meer dan één portaal wissel je met
**Alt+1** en **Alt+2** (**Option+1** en **Option+2** op een Mac). Op een
pagina met een zoekveld ga je met **/** of **Ctrl+K** (**⌘K** op een Mac)
naar dat veld. Sneltoetsen werken nooit terwijl je in een veld typt of
terwijl een menu of venster open is. Zitten **?** en **/** in de weg,
bijvoorbeeld bij spraakbediening, zet dan in die lijst **Sneltoetsen met één
toets** uit.

## De taal wijzigen

eduLIMS is er in het Nederlands en het Engels. Kies bovenaan de pagina de
taalknop (daarop staat de huidige taal, bijvoorbeeld **Nederlands**) en kies
**Nederlands** of **English**. De pagina laadt opnieuw in die taal. Ben je
ingelogd, dan bewaart eduLIMS je keuze bij je account. Die geldt dan ook de
volgende keer dat je inlogt, op elk apparaat.

## Gebruikers en rollen

**Gebruikers en rollen** toont elk account van eduLIMS, 25 per pagina. Elke
rij toont de naam en het e-mailadres, de rollen en waar ze vandaan komen
(Microsoft Entra ID, Keycloak of eduLIMS), de aanmeldmethoden, de status
(**Actief**, **Geblokkeerd** of **Nooit aangemeld**), de laatste aanmelding
en het aantal actieve sessies. Het scherm toont geen cijfers, resultaten of
inleveringen.

- **Zoek** op een deel van een naam of e-mailadres: de lijst volgt terwijl
  je typt.
- **Filter** met **Rol**, **Aanmeldmethode** en **Status**. Elk filter opent
  een lijst met zijn waarden en het aantal gebruikers per waarde; kies een of
  meer waarden (een gebruiker past bij elk van die waarden) en combineer de
  filters. De gekozen waarden staan op de knop. **Wissen** wist de
  zoekopdracht en elk filter. De zoekopdracht en de filters staan in het
  adres, dus je kunt een gefilterde weergave als bladwijzer bewaren of delen.
- **Sorteer** met het menu van de kolomkop **Naam** of **Laatst
  aangemeld** (**Oplopend** of **Aflopend**). **Kolom verbergen** in een
  kolommenu, of **Weergave**, verbergt en toont kolommen; deze browser
  onthoudt de keuze.
- **Rijen per pagina** toont 10, 25, 50 of 100 gebruikers; de knoppen ernaast
  gaan naar de eerste, vorige, volgende en laatste pagina.
- **Het rijmenu** (de knop aan het eind van elke rij) opent de gegevens,
  beëindigt alle sessies van de gebruiker, of blokkeert of deblokkeert die.
- **Selecteer rijen** met hun selectievakje, of elke rij van de pagina met
  het vakje in de kop, om ze in één keer te behandelen: **Sessies
  beëindigen** meldt de gekozen gebruikers overal af, **Blokkeren** blokkeert
  ze met één reden en een optionele laatste dag. Je eigen account kun je niet
  selecteren.

Kies een naam om de gegevens van die gebruiker naast de lijst te openen. De
gegevens hebben een eigen adres, dus je kunt een link naar één gebruiker
delen. Ze tonen:

- **Profiel:** wanneer het account is aangemaakt, de laatste aanmelding en
  de methode daarvan, en de opgeslagen taal en het opgeslagen portaal.
- **Rollen:** de rollen van de gebruiker en waar ze vandaan komen (zie
  hieronder).
- **Blokkade:** de gebruiker blokkeren of deblokkeren.
- **Actieve sessies:** de browsers en apparaten waarop de gebruiker is
  aangemeld. **Sessie beëindigen** meldt de gebruiker af op één apparaat,
  **Alle sessies beëindigen** op elk apparaat. Op je eigen account kun je de
  sessie die je gebruikt niet beëindigen (meld je af); **Alle andere sessies
  beëindigen** laat die open.
- **Gekoppelde accounts:** de accounts bij de identity provider die aan de
  gebruiker zijn gekoppeld.
- **Recente activiteit:** de laatste tien gebeurtenissen uit het
  activiteitenlogboek over of door deze gebruiker.

Elke actie vraagt eerst om een bevestiging, meldt of hij gelukt is en komt
in het activiteitenlogboek.

### Een gebruiker blokkeren

Kies **Gebruiker blokkeren**, schrijf de reden op en kies, als de blokkade
vanzelf moet aflopen, de laatste dag. Een geblokkeerde gebruiker wordt
meteen afgemeld, en elke aanmelding wordt geweigerd, ook via Microsoft Entra
ID en Keycloak, tot de laatste dag voorbij is of je **Deblokkeren** kiest.
Alleen beheerders zien de reden. Je kunt je eigen account niet blokkeren.

## Een gebruiker een rol geven

eduLIMS kent drie rollen: student, docent en beheerder (in de configuratie
`student`, `teacher` en `admin`). Een gebruiker zonder rol kan eduLIMS niet
gebruiken en krijgt een melding dat hij contact moet opnemen met een
beheerder. Een gebruiker heeft één rol, of docent en beheerder samen; een
student kan geen andere rol hebben.

De rollen van een gebruiker komen uit de identity provider of uit eduLIMS:

- **Uit de identity provider.** Stuurt de identity provider een rol voor
  eduLIMS mee, dan beslist die: eduLIMS zet de rollen bij elke aanmelding
  opnieuw, en de gegevens tonen **Via Microsoft Entra ID** of
  **Via Keycloak**. Wijzig deze rollen in de identity provider; de wijziging
  werkt vanaf de volgende aanmelding.
- **Uit eduLIMS.** Stuurt de identity provider geen rol voor eduLIMS mee,
  dan gelden de rollen die een beheerder in eduLIMS heeft toegekend, en de
  gegevens tonen **Via eduLIMS**. Wijzig ze in de gegevens onder **Rollen
  wijzigen**: vink de rollen aan en kies **Rollen opslaan**. De wijziging
  werkt meteen.

Niemand kan zijn eigen rollen wijzigen; vraag een andere beheerder.

Bij elke keer inloggen leest eduLIMS de rollen uit het ID-token en zet ze om
naar een rol in eduLIMS:

- **Microsoft Entra ID:** wijs de app-rol `edulims-student`,
  `edulims-teacher` of `edulims-admin` van de app-registratie van eduLIMS toe
  aan de gebruiker, of aan een groep waarin de gebruiker zit.
- **Keycloak:** geef de gebruiker de realmrol `edulims-student`,
  `edulims-teacher` of `edulims-admin`.

De wijziging werkt vanaf de volgende keer dat de gebruiker inlogt. De namen
van de rollen zijn instelbaar ([Identity providers](/operations/identity-providers/)).

## Geplande taken

| Taak                                                                               | Requirement                      |
| ---------------------------------------------------------------------------------- | -------------------------------- |
| Gebruikers aanmaken en een rol toekennen                                           | [B1](/development/requirements/) |
| Klassen aanmaken en studenten koppelen, met de hand of met een CSV-import          | [B2](/development/requirements/) |
| De analyseapparaten registreren en zien of FerroBRIDGE en FerroEHR bereikbaar zijn | [B3](/development/requirements/) |
| Het logboek van uploads, HL7-berichten en fouten bekijken                          | [B4](/development/requirements/) |

De requirements zijn in het Engels.
