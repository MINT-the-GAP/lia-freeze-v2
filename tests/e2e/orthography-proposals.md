<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Regressionstest für lia-orthography Proposals im dezentralen Freeze-Link.
tags: LiaScript, Freeze, Orthography, Regressionstest

import: https://raw.githubusercontent.com/MINT-the-GAP/lia-orthography/Proposals/README.md
import: ./freeze-harness.md
-->

# Orthography Proposals

## Orthography

Korrigiere den Satz. Die Lösung wird nach zwei Fehlversuchen freigegeben.

@orthography(`<!-- data-solution-button="2" -->`,`Der Apfl ist rot.`,`Der Apfel ist rot.`)

@ADetails(2;Orthography)

## OrthographyText

Korrigiere den längeren Text. Die Lösungsschaltfläche bleibt deaktiviert.

@orthographytext(`<!-- data-solution-button="false" -->`,`Das ist ein längerer Tst, der im Textfeld korrigiert werden soll.`,`Das ist ein längerer Test, der im Textfeld korrigiert werden soll.`)

@ADetails(3;OrthographyText)

## Diktat

Anna besucht den @diktat(Zoo) und sieht ein @diktat(Lama).

@ADetails(1;Diktat)

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time)
