<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Fokussierter Regressionstest für die verzögerte Auswertung mit Send.
tags: LiaScript, Freeze, Prüfung, Send

import: ../../README.md
-->

# Prüfung mit verzögerter Auswertung

In diesem Kurs werden Antworten zunächst nur gespeichert. Die Bewertung und
Rückmeldung erfolgt beim Erzeugen des Freeze-Links.

## Richtige Texteingabe

Wie heißt die Hauptstadt Deutschlands?

[[Berlin]]

@ADetails(2;Richtige Texteingabe)

## Falsche Einfachauswahl

Welches Ergebnis ist richtig für \(2 + 2\)?

- [( )] 3
- [(X)] 4
- [( )] 5

@ADetails(3;Falsche Einfachauswahl)

## Unbearbeitete Aufgabe

Wie viel ist \(3 + 3\)?

[[6]]

@ADetails(1;Unbearbeitete Aufgabe)

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time;Send)
