<!--
author: lia-freeze-v2 E2E
version: 1.0.1
language: de

script: ../../dist/index.js

import: https://raw.githubusercontent.com/MINT-the-GAP/lia-resetter/eead3d7f4ff93888eac8a970be4ad5951b4a81db/README.md
import: https://raw.githubusercontent.com/MINT-the-GAP/lia-coordinate/Proposal/README.md

@ADetails: @ADetails_(@uid,`@0`)

@ADetails_
<lia-adetails class="lia-assignment-details" data-adetails-instance="lia-adetails-@0" data-adetails="@1"></lia-adetails>
@end
-->

# Resetter + ADetails ownership

Die Konstruktion bleibt fuer diesen Integrationstest absichtlich leer. Dadurch
muss bereits der erste Klick auf **Pruefen** eine sichtbare native Rueckmeldung
erzeugen, bevor der Resetter denselben Quiz-Zustand wieder oeffnet.

@KonstruktionQuiz(`reset_coord_construction;3;fest;S4,W90,S3;streckentoleranz=0.05;winkeltoleranz=1`,`<!-- data-solution-button="2" -->`)

@resetter

@ADetails(2;ResetterCombination)
