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
(een identity provider of eduLIMS), de aanmeldmethoden, de status
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
meteen afgemeld, en elke aanmelding wordt geweigerd, ook via elke identity
provider, tot de laatste dag voorbij is of je **Deblokkeren** kiest.
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
  opnieuw, en de gegevens tonen **Via** en de naam van de provider, zoals
  **Via Keycloak**. Wijzig deze rollen in de identity provider; de wijziging
  werkt vanaf de volgende aanmelding.
- **Uit eduLIMS.** Stuurt de identity provider geen rol voor eduLIMS mee,
  dan gelden de rollen die een beheerder in eduLIMS heeft toegekend, en de
  gegevens tonen **Via eduLIMS**. Wijzig ze in de gegevens onder **Rollen
  wijzigen**: vink de rollen aan en kies **Rollen opslaan**. De wijziging
  werkt meteen.

Niemand kan zijn eigen rollen wijzigen; vraag een andere beheerder.

Bij elke keer inloggen leest eduLIMS de rollen uit de identity provider (de
rolclaim van het ID-token, of een SAML-attribuut) en zet ze om met de
rollentoewijzing van die provider. Met de gebruikelijke toewijzing:

- **Microsoft Entra ID:** wijs de app-rol `edulims-student`,
  `edulims-teacher` of `edulims-admin` van de app-registratie van eduLIMS toe
  aan de gebruiker, of aan een groep waarin de gebruiker zit.
- **Keycloak:** geef de gebruiker de realmrol `edulims-student`,
  `edulims-teacher` of `edulims-admin`.

De wijziging werkt vanaf de volgende keer dat de gebruiker inlogt.

## Identiteitsproviders

**Systeem → Identiteitsproviders** toont de diensten waarmee mensen inloggen:
OpenID Connect-providers (zoals Microsoft Entra ID of Keycloak) en SAML
2.0-providers (zoals een federatie). Elke provider heeft een eigen inlogknop,
rollentoewijzing en e-maildomeinen.

- **OIDC-provider toevoegen** of **SAML-provider toevoegen** opent het
  formulier. Een nieuwe provider staat eerst uit. Het clientgeheim en de
  ondertekeningssleutel worden versleuteld opgeslagen en nooit meer getoond:
  laat het veld leeg om ze te houden, of vul het in om ze te vervangen.
- De pagina van de provider toont de URL's die je bij de identity provider
  registreert, met een kopieerknop.
- **Aanmelding testen** logt in een nieuw tabblad in via de provider en toont
  welke claims binnenkomen en welke rollen die zouden geven. Niemand wordt
  aangemeld, dus je kunt een provider testen voordat je hem aanzet.
- **Aanzetten** zet de knop op de inlogpagina; **Uitzetten** haalt hem weg en
  weigert elke aanmelding via de provider. De laatste provider die aanstaat
  kun je hier niet uitzetten; de beheerder van de server wel.
- **Provider verwijderen** verwijdert een provider waarmee nog niemand heeft
  ingelogd. Een provider met accounts kun je alleen uitzetten.
- **Rollentoewijzing:** elke waarde die de provider stuurt (een app-rol, een
  realmrol, een groep) en de rol in eduLIMS die ze geeft. De **standaardrol**
  geldt voor een nieuwe gebruiker voor wie de provider geen bekende waarde
  stuurt; laat hem op geen staan om die gebruiker te weigeren.
- **De e-mailadressen van deze provider zijn geverifieerd:** zet dit alleen
  aan voor een provider die elk adres beheert dat hij stuurt, zoals de eigen
  tenant van de instelling.
- **E-maildomeinen:** wie op de inlogpagina een adres in een van deze domeinen
  invult, gaat naar deze provider.

Elke wijziging komt in het activiteitenlogboek, zonder geheimen of waarden.
Het instellen bij de identity provider zelf staat in
[Identity providers](/operations/identity-providers/).

## Klassen

Docenten maken hun eigen klassen aan en nodigen hun studenten en
mededocenten uit; zie de handleiding voor docenten. **Klassen** in het
Beheerportaal toont elke klas in eduLIMS, het nieuwste studiejaar eerst, met
de eigenaar, de mededocenten, het aantal studenten, het aantal openstaande
uitnodigingen en of de klas is gearchiveerd. Cijfers en resultaten staan er
niet in. De lijst is alleen-lezen.

Wie inlogt met een adres waarop een klas heeft uitgenodigd, komt zonder
verdere stap in die klas. Stuurt de identity provider geen eduLIMS-rol voor
die persoon, dan geeft een openstaande uitnodiging als student de rol
student, en alleen die rol, als de e-mailadressen van de provider als
geverifieerd zijn gemarkeerd. De rollen docent en beheerder komen altijd van
de identity provider of uit **Gebruikers en rollen**.

Aanmaken, uitnodigen, accepteren, verwijderen, archiveren, kopiëren,
eigenaarschap overdragen en elke wijziging van practicumgroepen komen in het
activiteitenlogboek, alleen met id's.

## Geplande taken

| Taak                                                                               | Requirement                      |
| ---------------------------------------------------------------------------------- | -------------------------------- |
| Gebruikers aanmaken en een rol toekennen                                           | [B1](/development/requirements/) |
| Klassen aanmaken en studenten koppelen, met de hand of met een CSV-import          | [B2](/development/requirements/) |
| De analyseapparaten registreren en zien of FerroBRIDGE en FerroEHR bereikbaar zijn | [B3](/development/requirements/) |
| Het logboek van uploads, HL7-berichten en fouten bekijken                          | [B4](/development/requirements/) |

De requirements zijn in het Engels.
