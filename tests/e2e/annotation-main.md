<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Gepinnte Freeze-Regressionsfixture fuer lia-annotation main.
tags: LiaScript, Freeze, Annotation, OCR, Regressionstest

import: https://raw.githubusercontent.com/MINT-the-GAP/lia-annotation/826b92b2153d5112a0ebc6ce239e494decff4f63/README.md
import: ./freeze-harness.md
-->

# Annotation Freeze

Diese Fixture prueft folienuebergreifende Annotationen, Punkt- und Kurvenpfade,
Radierer-Reihenfolge, Sichtbarkeit, Undo/Redo, explizites Leeren, spaetes Mounten
und den Read-only-Zustand im Freigabelink. OCR-Auswahlrahmen und OCR-Entwuerfe
sind absichtlich temporaer und duerfen nicht im Link wieder erscheinen.

## Erste Folie

Zeichne mit Rot einen einzelnen Punkt und eine lange Kurve. Wechsle danach
Farbe, Breite und Deckkraft, zeichne eine zweite Kurve und radiere nur deren
Mitte. Nutze einmal Undo und Redo.

$17 + 25 =$ [[ 42 ]]

@ADetails(2;AnnotationErsteFolie)

## Zweite Folie

Zeichne hier mehrere lange, glatte Kurven. Blende die Annotationen kurz aus,
wieder ein und navigiere anschliessend mehrfach zwischen beiden Folien. Der
Freigabelink wird spaeter von einer anderen Folie aus erzeugt.

$9 \cdot 8 =$ [[ 72 ]]

@ADetails(3;AnnotationZweiteFolie)

## Explizites Leeren

Zeichne auf dieser Folie einen Strich und verwende danach Clear all fuer die
aktuelle Folie. Die geloeschte Tinte darf im Freigabelink nicht wiederkehren.

$6 + 7 =$ [[ 13 ]]

@ADetails(1;AnnotationClear)

## Abgabe

Erzeuge den Link bei sichtbaren Annotationen. Im geoeffneten Link muessen alle
Pfade nach Navigation und Resize erhalten bleiben. Pen, Eraser, Undo, Redo,
Clear, Farb-, Breiten-, Alpha- und OCR-Aktionen duerfen nichts mutieren; nur das
Ein- und Ausblenden der vorhandenen Annotationen bleibt erlaubt.

@Abgabe

@Auswertung(F12;Tab;Time)
