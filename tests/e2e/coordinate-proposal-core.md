<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Gepinnte Freeze-Regressionsfixture fuer alle Quizfamilien und Aliasnamen aus lia-coordinate Proposal.
tags: LiaScript, Freeze, Koordinatensystem, JSXGraph, Quiz, Regressionstest

import: https://cdn.jsdelivr.net/gh/LiaTemplates/JSXGraph@main/README.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-coordinate/c8720f8672d0ae6e2a585cef47dbec880f528892/README.md
import: ./freeze-harness.md
-->

# lia-coordinate Proposal: Quizfamilien

Diese Fixture deckt alle sechs Quizfamilien und alle vierzehn oeffentlichen
deutschen und englischen Aliasnamen des gepinnten Proposal-Commits ab.

## CreatePoint und ErzeugePunkt

Verschiebe die Punkte jeweils auf ihre Zielkoordinaten und pruefe die Antwort.

@CoordinateSystem(`xmin=-5;xmax=5;ymin=-4;ymax=4;width=800;id=coord_core_points`)

@AxisLabel(`id=coord_core_points;xlabel=$x$;ylabel=$y$`)

Setze den Punkt $A$ auf $(2|3)$.

@CreatePoint(`coord_core_points;A;2;3`,`<!-- data-solution-button="2" -->`)

@ADetails(1;CreatePoint)

Setze den Punkt $B$ auf $(-3|-1)$.

@ErzeugePunkt(`coord_core_points;B;-3;-1`,`<!-- data-solution-button="2" -->`)

@ADetails(2;ErzeugePunkt)

## PointOnGraph und PunktGraph

Lege jeden Punkt auf den zugehoerigen Funktionsgraphen.

@CoordinateSystem(`xmin=-5;xmax=5;ymin=-4;ymax=4;width=800;id=coord_core_graph_points`)

@AxisLabel(`id=coord_core_graph_points;xlabel=$x$;ylabel=$y$`)

@PointOnGraph(`coord_core_graph_points;C;f;2*x-1;0.05`)

@ADetails(3;PointOnGraph)

@PunktGraph(`coord_core_graph_points;D;g;-0.5*x+2;0.05`)

@ADetails(4;PunktGraph)

## PointsOnGraph und PunkteAufGraph

Verteile die Punktgruppen mit dem geforderten Mindestabstand auf ihren Graphen.

@CoordinateSystem(`xmin=-6;xmax=6;ymin=-5;ymax=5;width=800;id=coord_core_graph_groups`)

@AxisLabel(`id=coord_core_graph_groups;xlabel=$x$;ylabel=$y$`)

@PointsOnGraph(`coord_core_graph_groups;n=3;d=2;P;f;x-1;0.05`)

@ADetails(5;PointsOnGraph)

@PunkteAufGraph(`coord_core_graph_groups;n=3;d=2;Q;g;-x+2;0.05`)

@ADetails(6;PunkteAufGraph)

## Reconstruction

Stelle mit der Schar die Gerade $2x-1$ her und pruefe sie anschliessend.

@CoordinateSystem(`xmin=-7;xmax=7;ymin=-5;ymax=5;width=800;id=coord_core_reconstruction_en`)

@AxisLabel(`id=coord_core_reconstruction_en;xlabel=$x$;ylabel=$y$`)

@Schar(`f;x;mx+n;coord_core_reconstruction_en;term=1;#00a6d6`)

@Reconstruction(`coord_core_reconstruction_en;2x-1;0.1`)

@ADetails(7;Reconstruction)

## Rekonstruktion

Stelle mit der Schar die Gerade $-x+2$ her und pruefe sie anschliessend.

@CoordinateSystem(`xmin=-7;xmax=7;ymin=-5;ymax=5;width=800;id=coord_core_reconstruction_de`)

@AxisLabel(`id=coord_core_reconstruction_de;xlabel=$x$;ylabel=$y$`)

@Schar(`g;x;mx+n;coord_core_reconstruction_de;term=1;#e63946`)

@Rekonstruktion(`coord_core_reconstruction_de;-x+2;0.1`)

@ADetails(8;Rekonstruktion)

## Polygonmetriken: alle vier Aliasnamen

Konstruiere ueber die DGS-Oberflaeche ein rechtwinkliges 3-4-5-Dreieck.
Sein Umfang ist 12 und seine Flaeche ist 6.

@CoordinateSystem(`xmin=-1;xmax=7;ymin=-1;ymax=5;width=800;id=coord_core_metrics`)

@DGS(`coord_core_metrics;tools=[200;510;920]`)

@PerimeterQuiz(`coord_core_metrics;3;12;0.05`,`<!-- data-solution-button="2" -->`)

@ADetails(9;PerimeterQuiz)

@UmfangQuiz(`coord_core_metrics;3;12;0.05`,`<!-- data-solution-button="2" -->`)

@ADetails(10;UmfangQuiz)

@AreaQuiz(`coord_core_metrics;3;6;0.05`,`<!-- data-solution-button="2" -->`)

@ADetails(11;AreaQuiz)

@FlaecheQuiz(`coord_core_metrics;3;6;0.05`,`<!-- data-solution-button="2" -->`)

@ADetails(12;FlaecheQuiz)

## ConstructionQuiz und KonstruktionQuiz

Konstruiere gegen den Uhrzeigersinn ein 3-4-5-Dreieck. Die feste Variante
prueft die Reihenfolge $S4,W90,S3$; die offene Variante prueft nur das
Vorkommen derselben Eigenschaften.

@CoordinateSystem(`xmin=-1;xmax=7;ymin=-1;ymax=5;width=800;id=coord_core_construction`)

@DGS(`coord_core_construction;tools=[200;510]`)

@ConstructionQuiz(`coord_core_construction;3;open;W90,S3,S4;lengthTolerance=0.05;angleTolerance=1`,`<!-- data-solution-button="2" -->`)

@ADetails(13;ConstructionQuiz)

@KonstruktionQuiz(`coord_core_construction;3;fest;S4,W90,S3;streckentoleranz=0.05;winkeltoleranz=1`,`<!-- data-solution-button="2" -->`)

@ADetails(14;KonstruktionQuiz)

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time)
