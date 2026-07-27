<!--
author: MINT-the-GAP; Martin Lommatzsch; Jihad Hyadi
version: 1.0.0
language: de
comment: Gepinnte Freeze-Regressionsfixture fuer alle kombinierten Geometriequiz-Aliase aus lia-coordinate Proposal.
tags: LiaScript, Freeze, Koordinatensystem, DGS, Quiz, Regressionstest

import: https://cdn.jsdelivr.net/gh/LiaTemplates/JSXGraph@main/README.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-coordinate/c1b95de593010ee7eb96b1140bb276e1a39bf845/README.md
import: ./freeze-harness.md
-->

# lia-coordinate Proposal: kombinierte Geometriequizze

Diese Fixture deckt `@KoordQuiz`, `@GeometrieQuiz`, `@CoordinateQuiz` und
`@GeometryQuiz` des gepinnten Proposal-Commits ab.

## Alle vier Aliasnamen auf demselben DGS-Board

Konstruiere gegen den Uhrzeigersinn das Rechteck $(0|0)$, $(4|0)$, $(4|3)$,
$(0|3)$. Alle vier Quizze pruefen dieselbe Konstruktion mit Flaeche 12 und
Umfang 14.

@CoordinateSystem(`xmin=-1;xmax=6;ymin=-1;ymax=5;width=800;id=coord_combined`)

@DGS(`coord_combined;tools=[200;510;920]`)

@KoordQuiz(`coord_combined;4;Konstruktion(offen;W90,W90,W90,W90;winkeltoleranz=1);Flaeche(12;0.05);Umfang(14;0.05)`,`<!-- -->`)

@ADetails(1;KoordQuiz)

@GeometrieQuiz(`coord_combined;4;Konstruktion(offen;W90,W90,W90,W90;winkeltoleranz=1);Flaeche(12;0.05);Umfang(14;0.05)`,`<!-- -->`)

@ADetails(2;GeometrieQuiz)

@CoordinateQuiz(`coord_combined;4;Construction(open;Angle90,Angle90,Angle90,Angle90;angleTolerance=1);Area(12;0.05);Perimeter(14;0.05)`,`<!-- -->`)

@ADetails(4;CoordinateQuiz)

@GeometryQuiz(`coord_combined;4;Construction(open;Angle90,Angle90,Angle90,Angle90;angleTolerance=1);Area(12;0.05);Perimeter(14;0.05)`,`<!-- -->`)

@ADetails(8;GeometryQuiz)

## Abgabe

@Abgabe

@Auswertung(F12;Tab;Time)
