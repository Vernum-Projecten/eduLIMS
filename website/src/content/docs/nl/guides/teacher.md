---
title: Handleiding voor docenten
description: Inloggen in het Docentportaal, en wat je er straks mee kunt.
sidebar:
  label: Docent
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

In het Docentportaal zet je een practicum klaar, volg je de metingen van je
studenten en beoordeel je hun labverslagen.

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

Je ziet alleen de practica die van jou zijn of waaraan je gekoppeld bent.
Practica van andere docenten, en de resultaten daarin, blijven verborgen.

## De taal wijzigen

eduLIMS is er in het Nederlands en het Engels. Kies bovenaan de pagina de
taalknop (daarop staat de huidige taal, bijvoorbeeld **Nederlands**) en kies
**Nederlands** of **English**. De pagina laadt opnieuw in die taal. Ben je
ingelogd, dan bewaart eduLIMS je keuze bij je account. Die geldt dan ook de
volgende keer dat je inlogt, op elk apparaat.

## Uitloggen

Kies **Uitloggen** bovenaan de pagina. eduLIMS beëindigt je sessie op de
server.

## Geplande taken

| Taak                                                                             | Requirement                      |
| -------------------------------------------------------------------------------- | -------------------------------- |
| Een practicum maken met opdracht, protocol, deadline en rubric                   | [D1](/development/requirements/) |
| Klassen of losse studenten aan een practicum koppelen                            | [D2](/development/requirements/) |
| De meetresultaten van alle studenten van een practicum bekijken                  | [D3](/development/requirements/) |
| Een inzending per rubriccriterium beoordelen, met feedback en eindcijfer         | [D4](/development/requirements/) |
| Een klas of practicum volgen op het [KPI-dashboard](/development/kpi-dashboard/) | [D5](/development/requirements/) |
| De cijfers exporteren als CSV                                                    | [D6](/development/requirements/) |
| Meetwaarden zien die buiten het verwachte bereik vallen                          | [D7](/development/requirements/) |
| Een rubric van een eerder practicum hergebruiken                                 | [D8](/development/requirements/) |

De requirements en het KPI-dashboard zijn beschreven in het Engels.
