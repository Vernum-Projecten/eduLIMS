---
title: Handleiding voor docenten
description: Inloggen in het Docentportaal, en wat je er straks mee kunt.
sidebar:
  label: Docent
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

In het Docentportaal beheer je de testcatalogus, bereid je een simulatie met
haar labs voor en volg je elk lab op een live dashboard. Een lab is een groep
studenten die in een simulatie één laboratorium draait. In eduLIMS wordt niet
beoordeeld.

:::caution[In ontwikkeling]
eduLIMS is nog in ontwikkeling. Deze handleiding beschrijft wat nu werkt en
noemt de taken die gepland zijn. Elke geplande taak verwijst naar een
conceptrequirement, die nog kan veranderen.
:::

## Inloggen

1. Open eduLIMS in je browser en kies **Inloggen**.
2. Kies de inlogknop van je onderwijsinstelling en log in met je account van
   de instelling.

eduLIMS opent het Docentportaal als je account de rol docent heeft. Die rol
komt uit je identity provider; een beheerder regelt dat. Staat op de
inlogpagina dat je account geen rol heeft, neem dan contact op met een
beheerder.

Je ziet alleen wat van jou is: nu de klassen waarvan je eigenaar of
mededocent bent, en straks je eigen simulaties. De simulaties van andere
docenten, en de resultaten daarin, blijven verborgen.

## Je weg vinden

De zijbalk links toont de onderdelen van het Docentportaal; de huidige pagina is
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
toont alleen wat die rol mag zien: als beheerder zie je geen resultaten. Het gebruikersmenu onderaan de zijbalk toont al je rollen.

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

## Klassen

:::note[Klassen worden vervangen]
De schermen voor klassen hieronder werken nu, en ze horen bij het eerdere
model. De product owner heeft op 19 november 2026 besloten dat eduLIMS geen
klassen heeft: je bereidt straks een simulatie met haar labs voor (zie
[Geplande taken](#geplande-taken)). Tot die verbouwing klaar is, werken de
schermen zoals dit hoofdstuk beschrijft.
:::

**Klassen** in de zijbalk toont de klassen waarvan je eigenaar of
mededocent bent. Elke klas staat met het studiejaar ernaast, zoals **LS-2A**
`2026–2027`, zodat twee klassen met dezelfde naam in verschillende jaren uit
elkaar te houden zijn. **Gearchiveerd** toont de klassen van eerdere jaren.

### Een klas aanmaken

1. Kies **Nieuwe klas**.
2. Vul de naam van de klas in en het studiejaar als twee opeenvolgende jaren,
   zoals `2026-2027`.
3. Kies **Klas aanmaken**. Je wordt **eigenaar** van de klas en de pagina van
   de klas gaat open.

De pagina van de klas heeft drie tabbladen: **Leden**, **Uitnodigingen** en
**Practicumgroepen**. Alleen de eigenaar kan de klas bewerken, archiveren,
heropenen, kopiëren of verwijderen, mededocenten uitnodigen en een mededocent eigenaar
maken. Een mededocent nodigt studenten uit, verwijdert ze en beheert de
practicumgroepen.

### Studenten en mededocenten uitnodigen

eduLIMS verstuurt geen e-mail. Jij voegt adressen toe, en iemand komt in de
klas zodra die met dat adres inlogt.

1. Open het tabblad **Uitnodigingen**.
2. Kies **Student**, of **Mededocent** als je eigenaar bent. Een mededocent
   moet al een docentaccount in eduLIMS hebben: een uitnodiging maakt niemand
   docent, dus vraag een collega zonder account om eerst één keer in te
   loggen.
3. Typ of plak de adressen, één per regel of gescheiden door komma's, of lees
   ze uit een csv-bestand met één adres per regel.
4. Kies **Lijst controleren**. eduLIMS laat per adres zien wat er gebeurt: het
   wordt uitgenodigd, of het valt af omdat het geen geldig adres is, al in de
   klas zit of al is uitgenodigd. Een adres voor een mededocent zonder
   docentaccount in eduLIMS valt ook af. Een uitnodiging als student voor een
   account dat geen studentaccount is, wordt wel gemaakt, maar die persoon komt
   nooit in de klas.
5. Kies **Uitnodigen** om de uitnodigingen voor de overgebleven adressen te
   maken.
6. Kies **Uitnodigingstekst kopiëren** en deel de tekst via je eigen kanaal,
   zoals de cursuspagina. Daarin staan de inloglink en de stappen.

Een uitnodiging is 30 dagen geldig. **Openstaande uitnodigingen** toont de
uitnodigingen die nog niet zijn gebruikt; **Verlengen** maakt een
uitnodiging, verlopen of niet, weer 30 dagen geldig en **Intrekken** trekt
haar in. eduLIMS verwijdert oude uitnodigingen 90 dagen nadat ze zijn
gebruikt, ingetrokken of verlopen.

### Studenten met een code laten aansluiten

Een student die inlogt met een ander adres dan het adres dat je uitnodigde,
komt niet via de uitnodiging in de klas. Zet voor hen de klascode aan op het
tabblad **Uitnodigingen**. De code staat uit tot je hem aanzet.

1. Kies onder **Klascode** hoeveel dagen de code werkt (7 tenzij je dat
   wijzigt, hoogstens 30) en hoeveel studenten er hoogstens mee in de klas
   kunnen (100 tenzij je dat wijzigt, hoogstens 500).
2. Kies **Klascode aanzetten**. eduLIMS toont de code, zoals `ABCDE-FGH23`,
   één keer. Kies **Code kopiëren** en deel hem met je studenten. eduLIMS
   bewaart alleen een vingerafdruk van de code, dus als je de pagina verlaat,
   kan eduLIMS de code niet meer tonen.
3. Studenten vullen de code in op hun overzicht en komen als student in de
   klas.

Het paneel toont tot wanneer de code werkt en hoeveel studenten ermee in de
klas kwamen. **Nieuwe code** maakt een nieuwe code met nieuwe instellingen; de
oude code werkt meteen niet meer. **Uitzetten** zet de code uit; studenten die
al in de klas kwamen, blijven erin. Een code werkt nooit zolang de klas
gearchiveerd is, en wie te veel verkeerde codes achter elkaar invult, moet 15
minuten wachten. Een student die je uit de klas haalt, kan niet met de code
terugkomen, en zijn openstaande uitnodigingen voor de klas worden ingetrokken;
nodig zijn adres opnieuw uit om hem weer toe te laten. Zegt het
paneel dat de code niet meer werkt omdat het geheim van de server is
gewijzigd, maak dan een nieuwe code.

### Practicumgroepen

Studenten werken vaak in tweetallen of kleine groepen. Een klas kan meerdere
**groepsindelingen** hebben, zoals "Tweetallen" en "Groepen van vier", en een
student zit in hooguit één groep per indeling. Studenten wisselen nooit zelf
van groep.

- **Groepen maken** maakt lege groepen in een indeling; kies daarna per
  student een groep bij **Studenten en hun groep**. Die keuze werkt met het
  toetsenbord.
- **Klas indelen** zet elke student in een nieuwe indeling, in groepen van
  hooguit de grootte die je kiest, alfabetisch of willekeurig.
- **Groepsindeling kopiëren** neemt de groepen van een indeling over uit een
  andere klas waarin je lesgeeft, zonder de studenten.

### Aan het eind van het jaar

- **Archiveren** maakt een klas alleen-lezen: geen uitnodigingen, nieuwe
  leden of groepswijzigingen. De leden en groepen blijven bewaard en de klas
  staat onder **Gearchiveerd**. De eigenaar kan een gearchiveerde klas
  **Heropenen** om die weer te wijzigen.
- **Kopiëren naar nieuw jaar** maakt een klas met dezelfde naam, het
  volgende studiejaar, dezelfde mededocenten en dezelfde groepsindelingen,
  zonder studenten. Nodig daar de nieuwe studenten uit.
- **Verwijderen** is voor een klas die je per vergissing hebt aangemaakt. De
  klas verdwijnt met de leden, uitnodigingen en practicumgroepen. Een klas met
  practica, inzendingen of cijfers kun je niet verwijderen; archiveer die dan.

## Uitloggen

Kies je naam onderaan de zijbalk en dan **Uitloggen**. eduLIMS beëindigt je sessie op de
server.

## Geplande taken

| Taak                                                                                                                                                                                                                 | Requirement                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| De testcatalogus beheren: een bepaling toevoegen met naam, eenheid en materiaal, en per bepaling kiezen of de groep of eduLIMS de concentratie berekent uit een plaat van de Epoch 2                                 | [D9](/development/requirements/)  |
| Een simulatie voorbereiden: de naam, de labs (elk met de naam en het logo die de groep heeft bedacht, en de e-mailadressen van de leden) en vooraf de juiste waarde per bepaling en monster, één keer voor alle labs | [D10](/development/requirements/) |
| Elk lab live volgen op het [dashboard](/development/teacher-dashboard/): de tijden van elke aanvraag, elke meting met de vrijgegeven meting gemarkeerd, en de nauwkeurigheid van elk vrijgegeven resultaat           | [D11](/development/requirements/) |
| Per bepaling instellen hoe ver een resultaat van de juiste waarde mag liggen voor groen, geel en rood                                                                                                                | [D13](/development/requirements/) |

Je voert de juiste waarden één keer per simulatie in. Ze gelden voor elk lab, dus
een lab toevoegen of verwijderen kost je geen extra werk. Een aanvraag voor
een controlemonster staat op het dashboard met zijn tijden en nauwkeurigheid,
net als elke andere.

Een simulatie heeft een eigen naam en hoort bij geen klas. Je maakt elk lab
in de simulatie aan met de labnaam en het logo die de groep heeft bedacht, en
je voegt de leden van een lab toe door hun e-mailadressen te plakken. Een
student die met een van die adressen inlogt, komt in dat lab; eduLIMS
verstuurt geen e-mail. Een student die met een ander adres inlogt, komt in
het lab met de code van het lab. Het dashboard toont een lab onder zijn naam
en zijn logo, en de labs strijden tegen elkaar.

In de testcatalogus kies je per bepaling wie de concentratie berekent uit een
plaat van de Epoch 2: de groep of eduLIMS. Als eduLIMS rekent, trekt het de
blanco af en legt het een rechte lijn door de standaarden die de groep heeft
gemarkeerd. Een monster buiten het bereik van de standaarden krijgt geen
getal, maar de melding dat het buiten het bereik valt.

Een vrijgegeven resultaat is definitief: het lab kan het niet wijzigen
en kan voor die bepaling geen andere meting vrijgeven.

Een streeftijd voor spoedaanvragen ([D12](/development/requirements/)) en een
ranglijst van de labs ([D14](/development/requirements/)) worden in deze
iteratie niet gebouwd.

Studenten zien nooit een juiste waarde of de nauwkeurigheid van een
resultaat.

De requirements en het dashboard zijn beschreven in het Engels.
