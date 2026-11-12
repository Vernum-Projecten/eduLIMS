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

## Overzicht

Het beheerportaal opent op het overzicht, dat in één oogopslag laat zien hoe
eduLIMS ervoor staat:

- **Accounts:** hoeveel gebruikers er in totaal zijn, hoeveel elke rol hebben
  (een docent die ook beheerder is, telt bij allebei), hoeveel sessies actief
  zijn en hoeveel gebruikers geblokkeerd zijn. Kies een tegel om
  **Gebruikers en rollen** met dat filter te openen, bijvoorbeeld alleen de
  studenten of alleen de geblokkeerde gebruikers. Twee tegels tellen de
  klassen die niet zijn gearchiveerd en de klasuitnodigingen die nog openstaan;
  kies er een om **Klassen** te openen.
- **Koppelingen:** de status van FerroEHR en FerroBRIDGE, als pictogram met
  tekst, en wanneer eduLIMS ze het laatst controleerde. Kies er een om
  **Analyzers en koppelingen** te openen.
- **Recente activiteit:** de 10 nieuwste gebeurtenissen uit het
  activiteitenlogboek, zoals een aanmelding of een rolwijziging, met wie het
  deed, de uitkomst en wanneer. **Volledig activiteitenlogboek** opent het
  hele logboek.

De aantallen zijn die van het moment dat de pagina opende; open het
overzicht opnieuw voor nieuwe aantallen.

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

## Analyzers en koppelingen

**Analyzers en koppelingen** laat zien of eduLIMS de diensten bereikt die de
metingen bewaren, en het register van de laboratoriumanalyzers.

### Status van de koppelingen

Boven aan de pagina staan FerroEHR (waar de metingen worden bewaard) en
FerroBRIDGE (dat de HL7-berichten van de Afinion 2 ontvangt). Voor elk zie
je:

- **De status,** als pictogram met tekst: **Beschikbaar**,
  **Niet beschikbaar**, **Geweigerd (authenticatie)** (de dienst antwoordt,
  maar weigert de inloggegevens van eduLIMS), **Nog niet gecontroleerd**, of
  **Onbekend: geen controle in de laatste 5 minuten**.
- **Laatste controle** en **Laatst beschikbaar:** hoe lang geleden, en de
  datum en tijd.
- **Antwoordtijd:** hoe lang de dienst over zijn antwoord deed, in
  milliseconden.
- **Reden,** na een fout: bijvoorbeeld **Geen verbinding met de dienst**, of
  dat hij niet binnen 5 seconden antwoordde. De reden toont nooit een adres,
  een wachtwoord of wat de dienst antwoordde.

eduLIMS controleert beide diensten zelf elke minuut, en de pagina werkt zich
bij zolang hij open staat. Een dienst die stopt, staat dus binnen enkele
minuten op **Niet beschikbaar**, zonder dat je de pagina opnieuw laadt.
**Nu controleren** controleert ze allebei meteen. Is een dienst niet
beschikbaar, vraag dan degene die de server beheert om ernaar te kijken. De
adressen die eduLIMS controleert, horen bij de configuratie van de server;
je kunt ze op deze pagina niet wijzigen.

### Analyzerregister

Het register toont elke analyzer met het model, het serienummer, de locatie,
de route naar FerroEHR (**HL7 via FerroBRIDGE** voor de Afinion 2, die zijn
resultaten zelf verstuurt; **Excel-upload** voor de Epoch 2, waarvan
studenten de export uploaden), de status (**In gebruik**, **In onderhoud** of
**Buiten gebruik**) en het moment van de laatste wijziging.

- **Zoek** op een deel van het model, het serienummer of de locatie.
  **Filter** op **Status** en **Route**, **sorteer** met de kolomkoppen en
  kies het **aantal rijen per pagina**, zoals bij **Gebruikers en rollen**.
  De zoekopdracht en de filters staan in het adres.
- **Analyzer toevoegen** opent een formulier: het model, het serienummer van
  het typeplaatje, de locatie, de route, de status en eventueel notities. Een
  serienummer komt per model één keer voor; eduLIMS meldt het bij het veld
  als het al bestaat. Notities gaan over de analyzer, nooit over personen.
- **Bewerken** in het rijmenu (de knop aan het eind van de rij) opent
  hetzelfde formulier met de gegevens van de analyzer.
- **Buiten gebruik stellen** in het rijmenu haalt een analyzer uit gebruik
  nadat je dat bevestigt. Hij blijft in het register staan, zodat eerdere
  resultaten hun apparaat houden, maar je kunt hem niet meer wijzigen. Dit
  kun je niet ongedaan maken.

Alleen beheerders wijzigen het register. Elke toevoeging, wijziging en
buitengebruikstelling komt in het activiteitenlogboek.

## Klassen

Docenten maken hun eigen klassen aan en nodigen hun studenten en
mededocenten uit; zie de handleiding voor docenten. **Klassen** in het
Beheerportaal toont elke klas in eduLIMS, het nieuwste studiejaar eerst, met
de eigenaar, de mededocenten, het aantal studenten, het aantal openstaande
uitnodigingen en of de klas is gearchiveerd. Cijfers en resultaten staan er
niet in. De lijst toont actieve klassen, tot je **Gearchiveerd** kiest onder
**Status**. Zoek op de klasnaam of de naam van een docent, en filter op
status, studiejaar en eigenaar; de filters staan in het adres, dus je kunt
een gefilterde lijst delen.

Je bent geen lid van de klassen die je beheert, en geen van de acties
hieronder maakt je lid. Elke actie vraagt een bevestiging of een kort
formulier:

- **Nieuwe klas:** maak een klas aan namens een docent. Kies de naam, het
  studiejaar en de eigenaar: zoek een docent op naam of e-mailadres. Alleen
  mensen met de rol docent die niet geblokkeerd zijn, staan in de lijst. De
  klas opent op een eigen pagina.
- **Klaspagina:** open een klas uit de lijst voor de leden (namen en
  klasrollen), de openstaande uitnodigingen en de aantallen.
- **Studenten importeren:** typ of plak op de klaspagina adressen van
  studenten, of lees een csv-bestand met één adres per regel. **Lijst
  controleren** laat per adres zien wat er gebeurt voordat er iets wordt
  aangemaakt: geen geldig adres, dubbel in de lijst, al lid, al uitgenodigd
  of nieuw. **Importeren** maakt daarna voor elk nieuw adres een
  openstaande studentuitnodiging aan, dezelfde uitnodiging die een docent
  aanmaakt. Een student komt pas in de klas als die met dat adres inlogt.
- **Eigenaarschap overdragen:** kies iemand met de rol docent die niet
  geblokkeerd is als nieuwe eigenaar, lid van de klas of niet. De oude eigenaar blijft mededocent
  zolang die de rol docent heeft, en verlaat anders de klas.
- **Archiveren** en **Heropenen:** een gearchiveerde klas is alleen-lezen
  voor de eigenaar en mededocenten en houdt leden, groepen en geschiedenis.

Wie inlogt met een adres waarop een klas heeft uitgenodigd, komt zonder
verdere stap in die klas. Stuurt de identity provider geen eduLIMS-rol voor
iemand die voor het eerst inlogt, dan geeft een openstaande uitnodiging als
student de rol student, en alleen die rol, als de e-mailadressen van de
provider als geverifieerd zijn gemarkeerd. Een rol die de identity provider
heeft ingetrokken, komt zo nooit terug. Een gebruiker die eigenaar is van een
klas kun je niet verwijderen: draag eerst het eigenaarschap van die klassen
over, hier of door de eigenaar aan een mededocent. De rollen docent en
beheerder komen altijd van de identity provider of uit **Gebruikers en
rollen**.

Aanmaken, uitnodigen, accepteren, verwijderen, archiveren, heropenen,
kopiëren, eigenaarschap overdragen en elke wijziging van practicumgroepen
komen in het activiteitenlogboek, alleen met id's, ook de acties van
beheerders.

## Systeem

**Systeem** toont de instellingen van eduLIMS zelf. Onder de link naar
**Identiteitsproviders** zie je, alleen lezen:

- **Ingeschakelde identiteitsproviders:** voor elke provider waarmee mensen nu
  kunnen inloggen de provider-id en het protocol, de URL die bij de
  identiteitsprovider is geregistreerd (de **Redirect-URI** voor OpenID
  Connect, de **Assertion consumer service-URL** voor SAML), de rolclaim of
  het rolattribuut, de standaardrol en de rollentoewijzing. Een
  uitgeschakelde provider staat er niet bij. Wijzig een provider onder
  **Identiteitsproviders**.
- **Versie en build:** de eduLIMS-versie, de commit waaruit hij is gebouwd,
  de buildtijd en de SLSA-herkomst: de release-image waarvan
  `gh attestation verify` de attestatie controleert. Een server die geen
  release-image draait, zoals een ontwikkelserver, toont **Niet beschikbaar**.

De pagina toont nooit een geheim: geen clientgeheim, geen ondertekensleutel
en geen waarde van de geheime instellingen van de server.

## Activiteitenlogboek

**Activiteitenlogboek** toont wat er in eduLIMS is gebeurd, nieuwste eerst,
25 gebeurtenissen per pagina: elke aanmelding, mislukte of geweigerde
aanmelding, afmelding, beëindigde sessie, rolwijziging, blokkade en
deblokkade, en elk aangemaakt of verwijderd account. Elke rij toont:

- **Tijd:** de datum en tijd, in de tijdzone van Amsterdam.
- **Actie** en **Uitkomst:** wat er gebeurde, en of het **Gelukt**,
  **Mislukt** of **Geweigerd** is. Elke uitkomst heeft naast de naam een eigen
  pictogram.
- **Door:** de gebruiker die het deed, **eduLIMS** als eduLIMS het zelf deed,
  of **Niet ingelogd** bij een poging om in te loggen.
- **Over:** de gebruiker waar de gebeurtenis over gaat, of het soort object,
  zoals **Een sessie**.
- **Details:** de reden, de aanmeldmethode en, bij een rolwijziging of een
  blokkade, de nieuwe rollen, de vorige rollen of de laatste dag van de
  blokkade.

Kies een naam onder **Door** of **Over** om de gegevens van die gebruiker te
openen. De gegevens van een gebruiker linken ook naar **Gebeurtenissen door
deze gebruiker** en **Gebeurtenissen over deze gebruiker**.

Filter het logboek met de knoppen erboven, en combineer de filters:

- **Door gebruiker** en **Over gebruiker:** typ een deel van een naam of
  e-mailadres en kies de gebruiker uit de lijst.
- **Actie** en **Uitkomst:** kies een of meer waarden; bij elke waarde staat
  hoeveel gebeurtenissen die met de andere filters zou tonen.
- **Periode:** kies een dag in de kalender om die dag te zien, en daarna een
  tweede dag om die de eerste of laatste dag van de periode te maken. De dagen
  zijn in de tijdzone van Amsterdam. **Periode wissen** haalt de periode weg.

**Wissen** wist alle filters. Met het menu van de kolom **Tijd** sorteer je
het logboek **Oplopend** (oudste eerst) of **Aflopend** (nieuwste eerst). De filters, de sortering en
de pagina staan in het adres, dus je kunt een weergave bewaren als bladwijzer
of naar een andere beheerder sturen.

Het logboek bewaart alleen id's en codes. eduLIMS zoekt de namen op om ze op
dit scherm te tonen en schrijft ze nooit in het logboek. Een verwijderde
gebruiker staat er als **Verwijderde gebruiker**. Gebeurtenissen blijven 12
maanden bewaard.

## Geplande taken

| Taak                                                                               | Requirement                      |
| ---------------------------------------------------------------------------------- | -------------------------------- |
| Het logboek van uploads, HL7-berichten en fouten bekijken                          | [B4](/development/requirements/) |

De requirements zijn in het Engels.
