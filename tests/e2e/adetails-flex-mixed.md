<!--
author: MINT-the-GAP
version: 1.0.0
language: de
comment: End-to-End-Regressionskurs für ADetails, dynFlex und mehrere Quizze pro Folie.
tags: LiaScript, Freeze, ADetails, dynFlex, Regressionstest

import: ../../README.md
-->

# ADetails Flex Regression

## Gemischte Aufgaben auf einer Folie

<section class="dynFlex">

<div class="flex-child">

**Eingabe und Auswahl**

Gib die Hauptstadt Deutschlands ein.

[[Berlin]]

@ADetails(1;Flex-Eingabe)

Wähle Rot aus.

[[(Rot)|Blau|Grün]]

@ADetails(BE=1|2|3;Flex-Auswahl)

</div>

<div class="flex-child">

**Mehrfachauswahl und Freitext**

Wähle alle geraden Zahlen.

- [[X]] 2
- [[ ]] 3
- [[X]] 4

@ADetails(2;Flex-Mehrfach)

Begründe deine Entscheidung.

    [[___ ___]]

@ADetails(4;Flex-Freitext)

</div>

<div class="flex-child">

**Einfachauswahl und Matrix**

Wähle das Ergebnis von (2+2).

- [( )] 3
- [(X)] 4
- [( )] 5

@ADetails(3;Flex-Einfach)

Ordne die Zahlen zu.

- [[gerade] (ungerade)]
- [    (X)       ( )   ] 2
- [    ( )       (X)   ] 3

@ADetails(5;Flex-Matrix)

</div>

</section>

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time)
