---
title: Handleiding voor studenten
description: Inloggen in het Studentportaal, en wat je er straks mee kunt.
sidebar:
  label: Student
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

In het Studentportaal draai je met je groep een lab tijdens een simulatie.
Je docent maakt het lab aan met de labnaam en het logo die jullie hebben
bedacht. Je registreert patiënten en aanvragen
vanaf de papieren formulieren, koppelt de monsters, meet, en geeft elk
resultaat vrij naar het dossier van de patiënt.

:::caution[In ontwikkeling]
eduLIMS is nog in ontwikkeling. Deze handleiding beschrijft wat nu werkt en
noemt de taken die gepland zijn. Elke geplande taak verwijst naar een
conceptrequirement, die nog kan veranderen.
:::

## Inloggen

1. Open eduLIMS in je browser en kies **Inloggen**.
2. Kies de inlogknop van je onderwijsinstelling, bijvoorbeeld de knop voor
   Microsoft of Keycloak.
3. Log in met je account van de instelling.

eduLIMS opent het Studentportaal. Heeft je account nog geen rol in eduLIMS,
dan staat dat op de inlogpagina. Vraag een beheerder om je account de rol student te geven.

Je ziet alleen het werk van je eigen lab. Het werk van andere labs krijg je
nooit te zien.

## Je weg vinden

De zijbalk links toont de onderdelen van het Studentportaal; de huidige pagina is
gemarkeerd. De knop linksboven (of **Ctrl+B**, **Cmd+B** op een Mac) klapt de
zijbalk in tot pictogrammen en weer uit, en eduLIMS onthoudt die keuze; op een
telefoon opent de knop de zijbalk als paneel. Boven de pagina laat het
kruimelpad zien waar je bent. Onderaan de zijbalk staat je naam: kies die voor
je account en rol, het thema (licht, donker of de instelling van je systeem)
en **Uitloggen**. Onderdelen die nog niet klaar zijn, tonen **Binnenkort
beschikbaar**.

## Als je meer dan één rol hebt

Een studentaccount heeft alleen de rol student. Geef je ook les, dan krijg je
een apart medewerkersaccount voor het Docentportaal.

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

## Met een code in een klas komen

:::note[Klassen worden vervangen]
Dit scherm werkt nu, en het hoort bij het eerdere model. eduLIMS krijgt geen
klassen: je werkt straks in je lab (zie [Geplande taken](#geplande-taken)).
:::

Meestal nodigt je docent je adres uit, en kom je in de klas zodra je de
volgende keer inlogt. Log je in met een ander adres, dan kan je docent je een
klascode geven.

1. Zoek op je overzicht **In een klas komen**.
2. Typ de code bij **Klascode**, zoals `ABCDE-FGH23`. Hoofdletters en kleine
   letters werken allebei, en streepjes en spaties tellen niet mee.
3. Kies **In de klas komen**. De klas staat dan onder **Je klassen**.

Zegt eduLIMS dat de code niet werkt, controleer hem dan bij je docent: hij is
misschien verlopen, of de klas is vol. Na te veel verkeerde codes wacht je 15
minuten voordat je het opnieuw probeert.

## De taal wijzigen

eduLIMS is er in het Nederlands en het Engels. Kies bovenaan de pagina de
taalknop (daarop staat de huidige taal, bijvoorbeeld **Nederlands**) en kies
**Nederlands** of **English**. De pagina laadt opnieuw in die taal. Ben je
ingelogd, dan bewaart eduLIMS je keuze bij je account. Die geldt dan ook de
volgende keer dat je inlogt, op elk apparaat.

## Uitloggen

Kies je naam onderaan de zijbalk en dan **Uitloggen**. eduLIMS beëindigt je sessie op de
server.

## Geplande taken

| Taak                                                                                                                                                                                                                                                 | Requirement                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| In je lab werken: je komt erin zodra je inlogt met het e-mailadres dat je docent heeft toegevoegd, of met de code van het lab                                                                                                                        | [S10](/development/requirements/) |
| De patiënten, aanvragen, monsters en resultaten van je lab delen met de andere leden, onder de naam en het logo van het lab                                                                                                                          | [S10](/development/requirements/) |
| Een patiënt registreren vanaf het papieren aanvraagformulier                                                                                                                                                                                         | [S11](/development/requirements/) |
| Een aanvraag vastleggen: de bepalingen en elk monster met het monsternummer en het materiaal van het formulier; eduLIMS geeft elk monster een labnummer                                                                                              | [S12](/development/requirements/) |
| Een aanvraag voor een controlemonster vastleggen, zonder patiënt; je meet het en geeft het vrij zoals elk ander monster, en het resultaat komt in het controlelogboek van je lab                                                                     | [S16](/development/requirements/) |
| Per bepaling de toleranties van je eigen lab instellen voordat je meet                                                                                                                                                                               | [S13](/development/requirements/) |
| Een Gen5-export (Excel) van de platereader uploaden door die te slepen, de plaat met de 96 waarden bekijken en aangeven welk monster in welke well zit; je groep of eduLIMS berekent de concentratie, zoals je docent voor de bepaling heeft gekozen | [S4](/development/requirements/)  |
| De metingen per monster bekijken, van de Afinion 2 en de Epoch 2; op de Afinion 2 voer je het labnummer van het monster in als patiënt-ID                                                                                                            | [S5](/development/requirements/)  |
| Een monster opnieuw meten; eduLIMS bewaart elke meting                                                                                                                                                                                               | [S14](/development/requirements/) |
| Een resultaat vrijgeven naar het dossier van de patiënt; eduLIMS waarschuwt je als de waarde buiten de tolerantie van je lab valt, en een vrijgegeven resultaat is definitief                                                                        | [S15](/development/requirements/) |

Je maakt je lab niet zelf aan in eduLIMS en geeft het daar geen naam: dat
doet je docent, die ook de e-mailadressen van de leden toevoegt. Log je in
met het adres dat je docent heeft toegevoegd, dan zit je meteen in je lab;
eduLIMS stuurt je geen e-mail. Log je in met een ander adres, dan kom je in
je lab met de code van het lab, die je van je docent krijgt.

Bij een plaat van de Epoch 2 kiest je docent per bepaling wie de concentratie
berekent. Rekent je groep, dan voer je het resultaat in. Rekent eduLIMS, dan
markeer je de standaarden en de blanco's, trekt eduLIMS de blanco af en legt
het een rechte lijn door de standaarden. Een monster buiten het bereik van de
standaarden krijgt geen getal, maar de melding dat het buiten het bereik
valt.

Het monsternummer op het formulier is in elk lab hetzelfde. Het labnummer
dat eduLIMS aan je monster geeft is uniek over alle labs, dus een resultaat
van de Afinion 2 komt bij jouw lab terecht en bij geen ander.

Jij en je lab zijn de analisten. eduLIMS beoordeelt een resultaat niet voor
je: de waarschuwing bij de tolerantie van je eigen lab is de enige controle
die je krijgt.

De requirements zijn in het Engels.
