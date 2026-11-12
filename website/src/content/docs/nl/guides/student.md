---
title: Handleiding voor studenten
description: Inloggen in het Studentportaal, en wat je er straks mee kunt.
sidebar:
  label: Student
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

In het Studentportaal volg je een practicum: je registreert je monsters,
bekijkt je meetresultaten en levert je labverslag in.

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

Je ziet alleen je eigen gegevens. Resultaten, inzendingen en cijfers van
andere studenten krijg je nooit te zien.

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

| Taak                                                                                                        | Requirement                      |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------- |
| De opdracht, het meetprotocol en de deadline van een practicum lezen                                        | [S2](/development/requirements/) |
| Monsters registreren; eduLIMS geeft elk monster een uniek monster-ID                                        | [S3](/development/requirements/) |
| Een Gen5-export (Excel) van de platereader uploaden; eduLIMS controleert elk monster-ID en elke wellpositie | [S4](/development/requirements/) |
| De meetresultaten per monster bekijken, van de Afinion 2 en de Epoch 2                                      | [S5](/development/requirements/) |
| Het labverslag voor de deadline inleveren; na het inleveren is het vergrendeld                              | [S6](/development/requirements/) |
| Je feedback en cijfer bekijken, naast het gemiddelde van het practicum                                      | [S7](/development/requirements/) |
| De status van een inzending zien: concept, ingediend, beoordeeld                                            | [S8](/development/requirements/) |
| Een herkansing of nieuwe versie inleveren                                                                   | [S9](/development/requirements/) |

De requirements zijn in het Engels.
