<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Regressionstest für Kachelquizze im dezentralen Freeze-Link.
tags: LiaScript, Freeze, Kachelquiz, Regressionstest

import: https://raw.githubusercontent.com/MINT-the-GAP/lia-Kachel/Proposal/README.md
import: ../../README.md
-->

# Kachelquizze

## Natives Kachelquiz

Ordne Alpha dem Feld zu.

[->[Alpha]]

@ADetails(1;KachelNative)

## Natives Kachelquiz mit Auswahl

Wähle Rot aus.

[->[(Rot)|Blau]]

@ADetails(1;KachelAuswahl)

## Inline-Kachelbereich

<div class="Kachel">

Setze zuerst gelb und danach rot ein.

[->[(gelb)]][->[(rot)|blau]]

</div>

@ADetails(2;KachelInline)

## Kachelfolge

Ordne A, B und C in beliebiger Reihenfolge zu.

@Kachelfolge(`[->[(A)]][->[(B)]][->[(C)|X]]`)

@ADetails(2;Kachelfolge)

## Kachelfolge N

Ordne Karmesin, Scharlach und Rubinrot zu.

@KachelfolgeN(`[->[(Karmesin)]][->[(Scharlach)]][->[(Rubinrot)|Kobalt]]`)

@ADetails(2;KachelfolgeN)

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time)
