<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Regressionstest für native LiaScript-Quiztypen im Freeze-Link.
tags: LiaScript, Freeze, Regressionstest

import: ../../README.md
-->

# Native Quiztypen

## Eingabequiz

Gib die Hauptstadt Deutschlands ein.

[[Berlin]]

@ADetails(1;Eingabequiz)

## MultipleChoice

Wähle alle geraden Zahlen aus.

- [[X]] 2
- [[ ]] 3
- [[X]] 4
- [[ ]] 5

@ADetails(2;MultipleChoice)

## SingleChoice

Wähle das richtige Ergebnis von 2 + 2 aus.

- [( )] 3
- [(X)] 4
- [( )] 5

@ADetails(1;SingleChoice)

## FreeText

Beschreibe in einem Satz, was ein Freeze-Link enthält.

[[___ ___]]

@ADetails(0;FreeText)

## MatrixChoiceQuiz

Ordne jede Zahl als gerade oder ungerade ein.

- [[gerade] (ungerade)]
- [    (X)       ( )   ] 2
- [    ( )       (X)   ] 3
- [    (X)       ( )   ] 4

@ADetails(3;MatrixChoiceQuiz)

## AuswahlQuiz

Wähle die Farbe Rot aus.

[[(Rot)|Blau|Grün|Gelb]]

@ADetails(1;AuswahlQuiz)

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time)
