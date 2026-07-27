<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Gepinnte Freeze-Regressionsfixture fuer @canvas, OCR und folienuebergreifende Zeichnungen.
tags: LiaScript, Freeze, Canvas, OCR, Regressionstest

import: https://raw.githubusercontent.com/MINT-the-GAP/lia-canvas-ocr/b76fd9980e2018d19f22a35d5e31c15898d9c308/README.md
import: ./freeze-harness.md
-->

# Canvas/OCR Freeze

Diese Fixture prueft Stift, Radierer, Markierrechteck, Hintergrund, lange
Punktpfade, Theme-Wechsel und das Sammeln ueber mehrere LiaScript-Folien. Fuer
den Theme-Test wird die erste Zeichnung im Dark-Theme erstellt und der erzeugte
Freigabelink anschliessend im Light-Theme geoeffnet; der Standard-Stift muss dort
weiterhin mit der aktuellen, gut sichtbaren Theme-Farbe gerendert werden.

## Erste Zeichnung

Schreibe das Ergebnis handschriftlich, aktiviere anschliessend ein Raster und
radiere einen kleinen Teil wieder aus.

$17 + 25 =$ [[ 42 ]] @canvas

@ADetails(2;CanvasErsteFolie)

## Zweite Zeichnung

Zeichne mehrere lange Kurven und fuege ein Markierrechteck hinzu. Navigiere
danach zur ersten Zeichnung zurueck und anschliessend wieder hierher.

$9 \cdot 8 =$ [[ 72 ]] @canvas

@ADetails(3;CanvasZweiteFolie)

## Explizites Leeren

Zeichne kurz in das Feld und verwende dann die Canvas-Aktion zum vollstaendigen
Leeren. Im Freigabelink darf die geloeschte Zeichnung nicht wieder erscheinen.

$6 + 7 =$ [[ 13 ]] @canvas

@ADetails(1;CanvasClear)

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time)
