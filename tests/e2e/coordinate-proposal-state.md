<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.1.0
language: de
comment: Gepinnte Freeze-Regressionsfixture fuer interaktive Zustaende und Navigation aus lia-coordinate Proposal.
tags: LiaScript, Freeze, Koordinatensystem, JSXGraph, DGS, Zustand, Navigation, Regressionstest

import: https://cdn.jsdelivr.net/gh/LiaTemplates/JSXGraph@main/README.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-coordinate/c8720f8672d0ae6e2a585cef47dbec880f528892/README.md
import: ./freeze-harness.md
-->

# lia-coordinate Proposal: Zustands- und Navigationstest

Bearbeite auf jeder Folie mindestens einen Zustand. Erzeuge danach den
Freeze-Link und besuche im Lehrerprofil jede Folie zweimal vorwaerts und
rueckwaerts. Beim erneuten Besuch duerfen weder Werte verloren gehen noch
Objekte doppelt angelegt werden.

## Board, Slider, PlotInput und Table

Testhandlungen:

1. Verschiebe den Slider $a$ auf einen gut erkennbaren Wert.
2. Trage in PlotInput eine eigene Funktion ein und plotte sie.
3. Fuell mindestens zwei Spalten der Wertetabelle und erzeuge deren Punkte.
4. Veraendere Ausschnitt, Zoom und manuelle Boardgroesse.

@CoordinateSystem(`xmin=-6;xmax=6;ymin=-5;ymax=5;width=800;id=coord_state_inputs`)

@AxisLabel(`id=coord_state_inputs;xlabel=$x$;ylabel=$y$`)

@Slider(`coord_state_inputs;a;-3;3;0.1;1;#ff00ff;[[-4;4];[-2.5;4]]`)

@PlotFunction(`coord_state_inputs;f;a*x^2-2;#e63946`)

@PlotInput(`coord_state_inputs;g;#0055cc`)

@Table(`n=3;x;f;P;id=coord_state_inputs`)

## DGS-Konstruktion und Instrumente

Testhandlungen:

1. Erzeuge mehrere Punkte und mindestens ein zusammengesetztes Objekt.
2. Verschiebe und formatiere ein Objekt.
3. Nutze Undo und Redo einmal.
4. Veraendere Pan, Zoom und Achsenskalierung.
5. Bewege Geodreieck und Zirkel an gut erkennbare Positionen.
6. Zeichne mit dem Freihandwerkzeug einen langen gebogenen Strich und einen einzelnen Punkt; radiere einen anderen Strich wieder weg.

@CoordinateSystem(`xmin=-5;xmax=5;ymin=-4;ymax=4;width=800;id=coord_state_dgs`)

@AxisLabel(`id=coord_state_dgs;xlabel=$x$;ylabel=$y$`)

@DGS(`coord_state_dgs;tools=[200;310;510;700;910;920]`)

@Geodreieck(`coord_state_dgs`)

@Zirkel(`coord_state_dgs`)

## Schar

Testhandlungen:

1. Veraendere $m$ und $n$ auf von den Startwerten abweichende Werte.
2. Skaliere und minimiere das Bedienpanel.
3. Schalte die Termdarstellung um.

@CoordinateSystem(`xmin=-7;xmax=7;ymin=-5;ymax=5;width=800;id=coord_state_schar`)

@AxisLabel(`id=coord_state_schar;xlabel=$x$;ylabel=$y$`)

@Schar(`f;x;mx+n;coord_state_schar;term=1;#00a6d6`)

## Regression

Testhandlungen:

1. Zeichne einen langen, dicht gesampelten Kurvenstrich, einen geraden Strich und einen einzelnen Punkt.
2. Verwende mindestens zwei Farben und erzeuge mindestens drei Regressionspunkte.
3. Waehle ein Regressionsmodell und oeffne eine Analyse.
4. Minimiere das Analysefenster und aendere seine Groesse.
5. Lasse bewusst einen Undo- und einen Redo-Schritt im Verlauf stehen.

@CoordinateSystem(`xmin=-7;xmax=7;ymin=-5;ymax=5;width=800;id=coord_state_regression`)

@AxisLabel(`id=coord_state_regression;xlabel=$x$;ylabel=$y$`)

@Regression(`coord_state_regression`)

## Navigations- und Remount-Kontrolle

Notiere vor der Abgabe fuer jede vorherige Folie mindestens einen sichtbaren
Referenzwert. Navigiere anschliessend zweimal durch alle Folien. Objektzahlen,
Koordinaten, Eingaben, Panelzustaende, Boardausschnitte und Styles muessen bei
jeder Rueckkehr unveraendert bleiben. Insbesondere muessen Freihandstriche aus
DGS und Regression in Anzahl, Reihenfolge, Farbe, Breite und sichtbarer Form
erhalten bleiben; der radierte Strich darf nicht wieder erscheinen.

@CoordinateSystem(`xmin=-4;xmax=4;ymin=-3;ymax=3;width=800;id=coord_state_navigation`)

@Point(`coord_state_navigation;N;2;1;#e63946;0.8`)

@Strecke(`coord_state_navigation;[[0;0];[2;1]];#457b9d;s;length=1;->|;3px`)

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time)
