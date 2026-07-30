/*
 * Full browser regression for README.md slide #27.
 *
 * Start Chromium with --remote-debugging-port and pass any page websocket URL.
 * The runner navigates that target to a fresh live README.md#27 course.
 * Canvas drawing serialization has its own exhaustive unit regression in
 * tests/unit/canvas-state.test.cjs; this scenario covers both @canvas OCR
 * controls through the complete live -> Freeze-link -> shared-link round trip.
 */

const endpoint = process.argv[2];
if (!endpoint) {
  console.error('Usage: node chromium-all-quizzes-freeze-cdp.cjs <page-websocket-url>');
  process.exit(2);
}

const socket = new WebSocket(endpoint);
const pending = new Map();
let nextId = 1;

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error('Chromium evaluation failed: ' + JSON.stringify(result.exceptionDetails));
  }
  return result.result?.value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Equivalent counterclockwise 3-4-5 triangles placed below the DGS toolbar
// and away from the plot controls near the origin. Each board still performs
// its own live hit-test before one of these placements is used.
const DGS_TRIANGLE_CANDIDATES = [-38, -40, -42, -44, -45].flatMap(degrees =>
  [2.9, 3].map(topY => {
    const angle = degrees * Math.PI / 180;
    const first = [0.5, topY];
    const second = [
      first[0] + 4 * Math.cos(angle),
      first[1] + 4 * Math.sin(angle),
    ];
    const third = [
      second[0] - 3 * Math.sin(angle),
      second[1] + 3 * Math.cos(angle),
    ];
    return [first, second, third];
  })
);

function evaluateCall(fn, ...args) {
  const serialized = args.map(value => JSON.stringify(value)).join(',');
  return evaluate('(' + fn.toString() + ')(' + serialized + ')');
}

async function trustedClick(point) {
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

async function dgsControlPoint(boardId, kind) {
  return evaluateCall(async function (targetBoardId, targetKind) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const describe = element => {
      if (!(element instanceof Element)) return null;
      const className = typeof element.className === 'string'
        ? element.className
        : element.className?.baseVal || '';
      return {
        tag: element.tagName,
        className,
        text: element.textContent?.trim().slice(0, 80) || '',
      };
    };
    const findButton = container => {
      if (targetKind === 'menu') {
        return container.querySelector('.lia-dgs-menu-button');
      }
      if (targetKind === 'shapes') {
        return container.querySelector(
          '.lia-dgs-top-menu .lia-dgs-polygon-button'
        );
      }
      if (targetKind === 'polygon') {
        return Array.from(container.querySelectorAll(
          '.lia-dgs-shape-submenu .lia-dgs-geometry-tool'
        )).find(element => /Vieleck|Polygon/i.test(element.textContent || '')) || null;
      }
      return null;
    };
    const candidateFractions = [
      [0.5, 0.5],
      [0.25, 0.5],
      [0.75, 0.5],
      [0.5, 0.25],
      [0.5, 0.75],
      [0.2, 0.2],
      [0.8, 0.2],
      [0.2, 0.8],
      [0.8, 0.8],
    ];
    let last = {
      boardId: targetBoardId,
      kind: targetKind,
      hit: false,
      reason: 'DGS board is not ready',
    };

    for (let attempt = 0; attempt < 180; attempt++) {
      const board = window.__boards?.[targetBoardId];
      const container = board?.containerObj;
      if (!(container instanceof HTMLElement) || !container.isConnected) {
        await pause(100);
        continue;
      }

      // DGS appends every toolbar and flyout directly to its board container.
      // Scoping here is essential on the 34-cell slide, where all eight boards
      // otherwise share the same Document/ShadowRoot query scope.
      const root = container.getRootNode();
      let button = findButton(container);
      const menu = container.querySelector('.lia-dgs-top-menu');
      const submenu = container.querySelector('.lia-dgs-shape-submenu');
      const menuOpen = menu?.dataset.open === '1'
        && menu.getAttribute('aria-hidden') !== 'true';
      const submenuOpen = submenu?.dataset.open === '1'
        && submenu.getAttribute('aria-hidden') !== 'true';

      if (!(button instanceof HTMLElement)) {
        last = {
          boardId: targetBoardId,
          kind: targetKind,
          hit: false,
          reason: 'Board-scoped DGS button is missing',
          menuOpen,
          submenuOpen,
        };
        await pause(100);
        continue;
      }
      if ((targetKind === 'shapes' && !menuOpen)
          || (targetKind === 'polygon' && (!menuOpen || !submenuOpen))) {
        last = {
          boardId: targetBoardId,
          kind: targetKind,
          hit: false,
          reason: targetKind === 'shapes'
            ? 'Board-scoped DGS toolbar is closed'
            : 'Board-scoped DGS shape submenu is closed',
          menuOpen,
          submenuOpen,
          button: describe(button),
        };
        await pause(100);
        continue;
      }

      let style = getComputedStyle(button);
      if (button.hidden || button.disabled
          || style.display === 'none'
          || style.visibility === 'hidden'
          || style.pointerEvents === 'none') {
        last = {
          boardId: targetBoardId,
          kind: targetKind,
          hit: false,
          reason: 'Board-scoped DGS button is not interactive',
          menuOpen,
          submenuOpen,
          button: describe(button),
          style: {
            display: style.display,
            visibility: style.visibility,
            pointerEvents: style.pointerEvents,
          },
        };
        await pause(100);
        continue;
      }

      container.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      button.scrollIntoView({ block: 'center', inline: 'nearest' });
      await pause(100);

      if (targetKind === 'shapes' && menu instanceof HTMLElement) {
        // The scrollable toolbar is covered by the 35 px menu toggle on the
        // left and the fixed 98 px end group on the right. Position the Shapes
        // button in the actually clickable interval, not merely at the center
        // of menu.clientWidth.
        const menuRect = menu.getBoundingClientRect();
        const toggleRect = container.querySelector('.lia-dgs-menu-button')
          ?.getBoundingClientRect();
        const endRect = container.querySelector('.lia-dgs-top-menu-end')
          ?.getBoundingClientRect();
        const safeLeft = Math.max(
          menuRect.left,
          toggleRect?.right ?? menuRect.left
        ) + 4;
        const safeRight = Math.min(
          menuRect.right,
          endRect?.left ?? menuRect.right
        ) - 4;
        const scaleX = menu.clientWidth > 0
          ? menuRect.width / menu.clientWidth
          : 0;
        if (safeRight > safeLeft && scaleX > 0) {
          const buttonRect = button.getBoundingClientRect();
          const desiredCenter = (safeLeft + safeRight) / 2;
          const currentCenter = buttonRect.left + buttonRect.width / 2;
          const maxScrollLeft = Math.max(0, menu.scrollWidth - menu.clientWidth);
          menu.scrollLeft = Math.max(0, Math.min(
            maxScrollLeft,
            menu.scrollLeft + (currentCenter - desiredCenter) / scaleX
          ));
        }
      }

      await pause(180);
      button = findButton(container);
      if (!(button instanceof HTMLElement)) {
        last = {
          boardId: targetBoardId,
          kind: targetKind,
          hit: false,
          reason: 'Board-scoped DGS button detached during scrolling',
        };
        await pause(100);
        continue;
      }

      style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      const sampledHits = [];
      for (const [xFraction, yFraction] of candidateFractions) {
        const point = {
          x: rect.left + rect.width * xFraction,
          y: rect.top + rect.height * yFraction,
        };
        if (point.x < 0 || point.y < 0
            || point.x >= innerWidth || point.y >= innerHeight) {
          continue;
        }
        const hit = root?.elementFromPoint?.(point.x, point.y)
          || document.elementFromPoint(point.x, point.y);
        const isHit = hit === button || hit?.closest?.('button') === button;
        if (isHit && style.pointerEvents !== 'none') {
          return {
            point,
            hit: true,
            boardId: targetBoardId,
            kind: targetKind,
            label: button.getAttribute('aria-label') || button.title
              || button.textContent?.trim() || '',
            rect: {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            },
            hitTarget: describe(hit),
          };
        }
        if (sampledHits.length < 5) sampledHits.push(describe(hit));
      }

      last = {
        boardId: targetBoardId,
        kind: targetKind,
        hit: false,
        reason: rect.width > 0 && rect.height > 0
          ? 'All sampled button points are occluded or outside the hit tree'
          : 'Board-scoped DGS button has an empty rectangle',
        menuOpen,
        submenuOpen,
        button: describe(button),
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
        menuScroll: menu instanceof HTMLElement ? {
          left: menu.scrollLeft,
          clientWidth: menu.clientWidth,
          scrollWidth: menu.scrollWidth,
        } : null,
        sampledHits,
      };
      await pause(100);
    }
    return last;
  }, boardId, kind);
}

async function dgsBoardPoints(boardId, coordinates) {
  return evaluateCall(async function (targetBoardId, userCoordinates) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    let board = null;
    let container = null;
    for (let attempt = 0; attempt < 180; attempt++) {
      board = window.__boards?.[targetBoardId] || null;
      container = board?.containerObj || null;
      if (container instanceof HTMLElement && container.isConnected) break;
      await pause(100);
    }
    if (!(container instanceof HTMLElement)) return null;

    // The flex slide can still be scrolling after scrollIntoView. A batch of
    // points computed against one transient rect caused later clicks to drift
    // by almost one user unit. Force an instant scroll and require the complete
    // viewport-to-board transform to remain stable before returning a target.
    container.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    let previous = null;
    let geometry = null;
    let stableSamples = 0;
    for (let attempt = 0; attempt < 120; attempt++) {
      board = window.__boards?.[targetBoardId] || null;
      container = board?.containerObj || null;
      const rect = container instanceof HTMLElement
        ? container.getBoundingClientRect()
        : null;
      const origin = board?.origin?.scrCoords;
      const values = rect && origin ? [
        rect.left,
        rect.top,
        rect.width,
        rect.height,
        Number(origin[1]),
        Number(origin[2]),
        Number(board.unitX),
        Number(board.unitY),
      ] : [];
      if (container instanceof HTMLElement && container.isConnected
          && values.length === 8 && values.every(Number.isFinite)) {
        geometry = { rect, origin, unitX: values[6], unitY: values[7] };
        if (previous && values.every((value, index) =>
          Math.abs(value - previous[index]) < 0.2)) {
          stableSamples += 1;
        } else {
          stableSamples = 0;
        }
        previous = values;
        if (stableSamples >= 4) break;
      } else {
        previous = null;
        stableSamples = 0;
      }
      await pause(50);
    }
    if (!(container instanceof HTMLElement) || !geometry) return null;
    const { rect, origin, unitX, unitY } = geometry;
    const root = container.getRootNode();
    return userCoordinates.map(([x, y]) => {
      const point = {
        x: rect.left + Number(origin[1]) + Number(x) * unitX,
        y: rect.top + Number(origin[2]) - Number(y) * unitY,
      };
      const hit = root?.elementFromPoint?.(point.x, point.y)
        || document.elementFromPoint(point.x, point.y);
      const boardUi = hit?.closest?.([
        'button',
        'input',
        'select',
        'textarea',
        'a',
        '[role=button]',
        '.lia-dgs-set-square-overlay',
        '.lia-dgs-menu-clip',
        '.lia-dgs-side-menu-clip',
        '.lia-dgs-color-popup',
        '.lia-dgs-angle-dialog',
        '.JXG_navigation',
      ].join(','));
      const hitClassName = typeof hit?.className === 'string'
        ? hit.className
        : hit?.className?.baseVal || '';
      const uiClassName = typeof boardUi?.className === 'string'
        ? boardUi.className
        : boardUi?.className?.baseVal || '';
      return {
        point,
        inside: stableSamples >= 4 && !!hit && container.contains(hit) && !boardUi,
        stableSamples,
        hit: hit ? {
          tag: hit.tagName,
          id: hit.id || '',
          className: hitClassName,
        } : null,
        excludedBy: boardUi ? {
          tag: boardUi.tagName,
          id: boardUi.id || '',
          className: uiClassName,
          disabled: !!boardUi.disabled,
        } : null,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
        origin: [Number(origin[1]), Number(origin[2])],
        units: [unitX, unitY],
      };
    });
  }, boardId, coordinates);
}

async function findDgsTriangleCoordinates(boardId) {
  const attempts = [];
  for (const coordinates of DGS_TRIANGLE_CANDIDATES) {
    const targets = await dgsBoardPoints(boardId, coordinates);
    const usable = Array.isArray(targets)
      && targets.length === coordinates.length
      && targets.every(target => target.inside);
    if (usable) return { coordinates, targets, hit: true };
    attempts.push({ coordinates, targets });
  }
  return { boardId, coordinates: null, targets: null, hit: false, attempts };
}

async function waitForDgsPolygonToolActive(boardId) {
  return evaluateCall(async function (targetBoardId) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    let last = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const container = window.__boards?.[targetBoardId]?.containerObj;
      const shapes = container?.querySelector(
        '.lia-dgs-top-menu .lia-dgs-polygon-button'
      );
      const polygon = Array.from(container?.querySelectorAll?.(
        '.lia-dgs-shape-submenu .lia-dgs-geometry-tool'
      ) || []).find(element => /Vieleck|Polygon/i.test(element.textContent || '')) || null;
      last = {
        boardId: targetBoardId,
        active: shapes?.getAttribute('aria-pressed') === 'true'
          && polygon?.getAttribute('aria-pressed') === 'true',
        shapesPressed: shapes?.getAttribute('aria-pressed') || '',
        polygonPressed: polygon?.getAttribute('aria-pressed') || '',
        currentToolId: shapes?.dataset.dgsCurrentToolId || '',
        submenuOpen: container?.querySelector('.lia-dgs-shape-submenu')
          ?.dataset.open || '',
      };
      if (last.active) return last;
      await pause(50);
    }
    return last;
  }, boardId);
}

async function waitForDgsPointProgress(boardId, expectedCoordinates) {
  return evaluateCall(async function (targetBoardId, expected) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    let last = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      window.__persistDgsBoardState?.(targetBoardId, false);
      const snapshot = window.__dgsConstructionStates?.[targetBoardId];
      const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
      const learnerPoints = records.filter(record =>
        record?.type === 'point' && record?.origin !== 'macro'
      );
      const points = learnerPoints.map(record => [Number(record.x), Number(record.y)]);
      const coordinatesMatch = expected.every(([x, y]) => points.some(point =>
        Number.isFinite(point[0]) && Number.isFinite(point[1])
          && Math.abs(point[0] - Number(x)) < 0.08
          && Math.abs(point[1] - Number(y)) < 0.08
      ));
      const container = window.__boards?.[targetBoardId]?.containerObj;
      const selectedVertices = container?.querySelectorAll?.(
        '.lia-dgs-polygon-vertex'
      ).length || 0;
      last = {
        boardId: targetBoardId,
        ready: coordinatesMatch && selectedVertices >= expected.length,
        records: records.length,
        points,
        selectedVertices,
      };
      if (last.ready) return last;
      await pause(50);
    }
    return last;
  }, boardId, expectedCoordinates);
}

async function dgsFirstPolygonVertexPoint(boardId, coordinate) {
  return evaluateCall(async function (targetBoardId, expectedCoordinate) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const fractions = [
      [0.5, 0.5],
      [0.35, 0.5],
      [0.65, 0.5],
      [0.5, 0.35],
      [0.5, 0.65],
    ];
    let previous = null;
    let stableSamples = 0;
    let last = {
      boardId: targetBoardId,
      hit: false,
      reason: 'No selected polygon vertex is ready',
    };
    const initialContainer = window.__boards?.[targetBoardId]?.containerObj;
    initialContainer?.scrollIntoView?.({
      block: 'center', inline: 'center', behavior: 'instant',
    });

    for (let attempt = 0; attempt < 120; attempt++) {
      const board = window.__boards?.[targetBoardId];
      const container = board?.containerObj;
      const rect = container instanceof HTMLElement
        ? container.getBoundingClientRect()
        : null;
      const origin = board?.origin?.scrCoords;
      const values = rect && origin ? [
        rect.left,
        rect.top,
        rect.width,
        rect.height,
        Number(origin[1]),
        Number(origin[2]),
        Number(board.unitX),
        Number(board.unitY),
      ] : [];
      if (!(container instanceof HTMLElement) || !container.isConnected
          || values.length !== 8 || !values.every(Number.isFinite)) {
        previous = null;
        stableSamples = 0;
        await pause(50);
        continue;
      }
      if (previous && values.every((value, index) =>
        Math.abs(value - previous[index]) < 0.2)) {
        stableSamples += 1;
      } else {
        stableSamples = 0;
      }
      previous = values;

      const expectedPoint = {
        x: rect.left + Number(origin[1])
          + Number(expectedCoordinate[0]) * Number(board.unitX),
        y: rect.top + Number(origin[2])
          - Number(expectedCoordinate[1]) * Number(board.unitY),
      };
      const nodes = Array.from(container.querySelectorAll('.lia-dgs-polygon-vertex'))
        .map(node => ({ node, rect: node.getBoundingClientRect() }))
        .filter(entry => entry.rect.width > 0 && entry.rect.height > 0)
        .sort((left, right) => {
          const leftDistance = Math.hypot(
            left.rect.left + left.rect.width / 2 - expectedPoint.x,
            left.rect.top + left.rect.height / 2 - expectedPoint.y
          );
          const rightDistance = Math.hypot(
            right.rect.left + right.rect.width / 2 - expectedPoint.x,
            right.rect.top + right.rect.height / 2 - expectedPoint.y
          );
          return leftDistance - rightDistance;
        });
      last = {
        boardId: targetBoardId,
        hit: false,
        reason: stableSamples >= 4
          ? 'Selected polygon vertices have no trusted rendered hit point'
          : 'Board geometry is still moving',
        selectedVertices: nodes.length,
        stableSamples,
        expectedPoint,
      };
      if (stableSamples >= 4) {
        const root = container.getRootNode();
        // The nearest rendered vertex is the one at the first requested user
        // coordinate. Never fall through to another selected point: clicking
        // a later vertex cannot close the polygon.
        for (const entry of nodes.slice(0, 1)) {
          for (const [xFraction, yFraction] of fractions) {
            const point = {
              x: entry.rect.left + entry.rect.width * xFraction,
              y: entry.rect.top + entry.rect.height * yFraction,
            };
            const hit = root?.elementFromPoint?.(point.x, point.y)
              || document.elementFromPoint(point.x, point.y);
            const isHit = hit === entry.node || entry.node.contains(hit)
              || hit?.closest?.('.lia-dgs-polygon-vertex') === entry.node;
            if (isHit) {
              return {
                boardId: targetBoardId,
                point,
                hit: true,
                selectedVertices: nodes.length,
                stableSamples,
                expectedPoint,
                vertexRect: {
                  left: entry.rect.left,
                  top: entry.rect.top,
                  width: entry.rect.width,
                  height: entry.rect.height,
                },
              };
            }
          }
        }
      }
      await pause(50);
    }
    return last;
  }, boardId, coordinate);
}

async function waitForDgsTriangle(boardId) {
  return evaluateCall(async function (targetBoardId) {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    let last = {
      boardId: targetBoardId,
      polygon: false,
      records: 0,
      points: [],
      vertices: [],
    };
    for (let attempt = 0; attempt < 180; attempt++) {
      window.__persistDgsBoardState?.(targetBoardId, false);
      const snapshot = window.__dgsConstructionStates?.[targetBoardId];
      const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
      const learnerPoints = records.filter(record =>
        record?.type === 'point' && record?.origin !== 'macro'
      );
      last = {
        boardId: targetBoardId,
        polygon: false,
        records: records.length,
        points: learnerPoints.map(record => [Number(record.x), Number(record.y)]),
        vertices: [],
      };
      const polygon = records.find(record =>
        record?.type === 'polygon' && record?.origin !== 'macro'
      );
      if (polygon) {
        const points = records.filter(record => record?.type === 'point');
        const byId = new Map(points.map(record => [String(record.id || ''), record]));
        const byName = new Map(points.map(record => [String(record.name || ''), record]));
        const vertices = (Array.isArray(polygon.points) ? polygon.points : []).map(reference => {
          const point = byId.get(String(reference?.id || ''))
            || byName.get(String(reference?.name || ''));
          return point ? [Number(point.x), Number(point.y)] : [NaN, NaN];
        });
        return {
          boardId: targetBoardId,
          polygon: true,
          records: records.length,
          vertices,
        };
      }
      await pause(100);
    }
    return last;
  }, boardId);
}

async function constructDgsTriangle(boardId) {
  for (const kind of ['menu', 'shapes', 'polygon']) {
    const target = await dgsControlPoint(boardId, kind);
    assert(target?.hit,
      'DGS ' + kind + ' is not a trusted hit target for ' + boardId + ': '
      + JSON.stringify(target));
    await trustedClick(target.point);
    await delay(160);
  }

  const tool = await waitForDgsPolygonToolActive(boardId);
  assert(tool?.active,
    'DGS polygon tool did not become active for ' + boardId + ': '
      + JSON.stringify(tool));

  const placement = await findDgsTriangleCoordinates(boardId);
  assert(placement?.hit,
    'No safe 3-4-5 DGS placement is available for ' + boardId + ': '
      + JSON.stringify(placement));
  const coordinates = placement.coordinates;
  for (let index = 0; index < coordinates.length; index++) {
    // Resolve every target immediately before its CDP click. Reusing a batch
    // across flex-container scrolling produced stale viewport coordinates.
    const targets = await dgsBoardPoints(boardId, [coordinates[index]]);
    assert(Array.isArray(targets) && targets.length === 1,
      'Could not calculate DGS board point #' + index + ' for ' + boardId);
    const target = targets[0];
    assert(target.inside,
      'DGS click #' + index + ' misses ' + boardId + ': ' + JSON.stringify(target));
    await trustedClick(target.point);
    await delay(150);
    const progress = await waitForDgsPointProgress(
      boardId,
      coordinates.slice(0, index + 1)
    );
    assert(progress?.ready,
      'DGS click #' + index + ' did not create the expected learner point for '
        + boardId + ': ' + JSON.stringify(progress));
  }

  // Close on the actual first rendered JSXGraph point. This remains a genuine
  // CDP click while avoiding any assumption that its old viewport coordinate
  // survived the flex slide's scroll/layout updates.
  const closeTarget = await dgsFirstPolygonVertexPoint(boardId, coordinates[0]);
  assert(closeTarget?.hit,
    'DGS first polygon vertex is not a trusted close target for ' + boardId + ': '
      + JSON.stringify(closeTarget));
  await trustedClick(closeTarget.point);
  await delay(150);

  return waitForDgsTriangle(boardId);
}

function assertDgsTriangles(states, label) {
  assert(Array.isArray(states) && states.length === 8,
    label + ' does not contain eight DGS states: ' + JSON.stringify(states));
  for (const state of states) {
    assert(state?.polygon && state.vertices?.length === 3,
      label + ' has no learner triangle for ' + state?.boardId + ': ' + JSON.stringify(state));
    const expected = DGS_TRIANGLE_CANDIDATES.find(candidate =>
      candidate.every((point, index) => {
        const actual = state.vertices[index];
        return Array.isArray(actual)
          && Math.abs(actual[0] - point[0]) < 0.08
          && Math.abs(actual[1] - point[1]) < 0.08;
      })
    );
    assert(expected,
      label + ' has vertices outside every safe 3-4-5 placement for '
        + state.boardId + ': ' + JSON.stringify(state.vertices));
  }
}

socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  if (!('id' in message)) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result || {});
});

socket.addEventListener('error', error => {
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
});

socket.addEventListener('open', async () => {
  try {
    await command('Runtime.enable');
    await command('Page.enable');
    await command('Network.enable');
    await command('Emulation.setEmulatedMedia', { media: 'screen' });
    await command('Network.setCacheDisabled', { cacheDisabled: true });
    await command('Network.clearBrowserCache');
    const currentOrigin = await evaluate('location.origin');
    const origin = /^https?:\/\//.test(currentOrigin || '')
      ? currentOrigin
      : 'http://localhost:8000';
    const sourceUrl = origin + '/lia-freeze-v2/README.md';
    const courseUrl = origin + '/liascript/index.html?' + encodeURIComponent(sourceUrl) + '#27';
    // about:blank has an opaque origin, so Web Storage access is forbidden.
    // Re-enter the local course origin first when a preceding aborted run left
    // the reusable CDP target on an empty document.
    if (!/^https?:\/\//.test(currentOrigin || '')) {
      await command('Page.navigate', { url: sourceUrl });
      await delay(600);
    }
    // CDP's Storage.clearDataForOrigin does not reliably remove the current
    // renderer's sessionStorage. Freeze intentionally keeps shared tokens
    // there, so clear both Web Storage areas while the local origin is active.
    await evaluate('sessionStorage.clear(); localStorage.clear(); true');
    await command('Storage.clearDataForOrigin', {
      origin,
      storageTypes: 'all',
    });
    await command('Page.navigate', { url: 'about:blank' });
    await delay(600);
    assert(await evaluate('location.href') === 'about:blank',
      'Chromium target did not detach from an earlier shared-link document');
    await command('Page.navigate', { url: courseUrl });
    await delay(600);
    // A hard reload after the navigation prevents Chromium's back-forward
    // cache from resurrecting a previously shared/frozen README document.
    await command('Page.reload', { ignoreCache: true });
    await delay(1_400);

    const prepared = await evaluate(String.raw`(async () => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const cells = () => Array.from(document.querySelectorAll('.flex-child'));
      const cell = index => {
        const value = cells()[index];
        if (!value) throw new Error('Missing flex-child #' + index);
        return value;
      };
      const inputValue = (element, value) => {
        const prototype = element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (setter) setter.call(element, value);
        else element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const click = element => {
        if (!(element instanceof Element)) throw new Error('Interactive element is missing');
        element.scrollIntoView({ block: 'center', inline: 'center' });
        if (typeof element.click === 'function') element.click();
        else element.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        }));
      };
      const sendSidecar = (quiz, quizCell) => {
        let kind = 'adetails';
        let host = quizCell?.querySelector('.lia-assignment-details[data-adetails]') || null;
        let roots = host?.shadowRoot
          ? Array.from(host.shadowRoot.querySelectorAll('[data-lia-freeze-adetails-sidecar]'))
          : [];
        if (!host) {
          kind = 'generic';
          const content = quiz?.closest('main.lia-slide__content')
            || document.querySelector('main.lia-slide__content,.lia-content,main,article');
          const task = content
            ? Array.from(content.querySelectorAll('.lia-quiz')).indexOf(quiz) + 1
            : 0;
          host = document.querySelector(
            'lia-freeze-quiz-sidecars[data-lia-freeze-quiz-sidecars]'
          );
          roots = host?.shadowRoot && task > 0
            ? Array.from(host.shadowRoot.querySelectorAll(
              '[data-lia-freeze-task-index]'
            )).filter(entry =>
              entry.getAttribute('data-lia-freeze-task-index') === String(task)
            )
            : [];
        }
        const root = roots[0] || null;
        const statuses = root
          ? Array.from(root.querySelectorAll('.lia-send-status'))
          : [];
        const status = statuses[0]?.textContent?.trim() || '';
        const forbidden = '.lia-send-status,.lia-adetails-points,.lia-adetails-sidecar,'
          + '.lia-adetails-feedback,[data-lia-send-logged],'
          + '[data-lia-freeze-adetails-sidecar]';
        const control = quiz?.querySelector('.lia-quiz__control');
        return {
          kind,
          logged: kind === 'adetails'
            ? root?.getAttribute('data-lia-send-logged') === '1'
            : !!status,
          status,
          ownershipOk: !!host
            && !host.closest('.lia-quiz,.lia-quiz__control')
            && Array.from(host.childNodes).every(node =>
              node.nodeType === Node.TEXT_NODE
            )
            && roots.length === 1
            && statuses.length === 1
            && !quiz?.hasAttribute('data-lia-send-logged')
            && !quiz?.querySelector(forbidden)
            && !control?.querySelector(forbidden),
        };
      };
      const sendInterceptReady = () => {
        const root = document.createElement('div');
        root.className = 'lia-quiz open';
        const button = document.createElement('button');
        button.className = 'lia-quiz__check';
        root.appendChild(button);
        document.body.appendChild(root);
        const permitted = button.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        }));
        root.remove();
        return !permitted;
      };
      const check = async index => {
        const quiz = cell(index).querySelector('.lia-quiz');
        let button = null;
        for (let attempts = 0; !button && attempts < 40; attempts++) {
          button = cell(index).querySelector('.lia-quiz__check');
          if (!button) await pause(50);
        }
        click(button);
        for (let attempts = 0; attempts < 120; attempts++) {
          if (sendSidecar(quiz, cell(index)).status.includes('Antwort gespeichert')) {
            return;
          }
          await pause(100);
        }
        throw new Error('Quiz #' + index + ' was not logged neutrally in Send collect mode');
      };
      const setAndCheck = async (index, value) => {
        inputValue(cell(index).querySelector('.lia-quiz__input'), value);
        await pause(60);
        await check(index);
      };
      const selectChecks = async (index, selected) => {
        for (const itemIndex of selected) {
          click(cell(index).querySelectorAll('input')[itemIndex]);
          await pause(40);
        }
        await check(index);
      };
      const chooseFirstDropdownOption = async index => {
        click(cell(index).querySelector('.lia-dropdown__selected'));
        await pause(60);
        click(cell(index).querySelectorAll('.lia-dropdown__option')[0]);
        await pause(80);
        await check(index);
      };
      const fillDrop = async (index, answers) => {
        for (const answer of answers) {
          const quiz = cell(index).querySelector('.lia-quiz');
          if (/\b(?:solved|success)\b/i.test(quiz?.className || '')) break;
          const target = Array.from(cell(index).querySelectorAll('[role="button"]'))
            .find(element => element.textContent.trim() === '✛');
          if (!target) break;
          click(target);
          await pause(70);
          const source = Array.from(cell(index).querySelectorAll('[draggable="true"]'))
            .find(element => element.textContent.trim() === answer);
          click(source);
          await pause(120);
        }
        await check(index);
      };
      const solveCoordinate = async (index, boardId, pointName, target) => {
        const create = Array.from(cell(index).querySelectorAll('button'))
          .find(button => /Punkt setzen/i.test(button.textContent));
        click(create);
        await pause(180);
        const point = window.__points?.[boardId]?.[pointName];
        if (!point?.moveTo) throw new Error('Coordinate point API missing for ' + boardId + '/' + pointName);
        point.moveTo(target, 0);
        window.__boards?.[boardId]?.update?.();
        window.__pointStates ??= {};
        window.__pointStates[boardId] ??= {};
        const pointState = window.__pointStates[boardId][pointName];
        if (pointState && typeof pointState === 'object') {
          pointState.x = target[0];
          pointState.y = target[1];
        }
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
        await pause(180);
        await check(index);
      };
      const solveDgsTriangle = async (index, boardId) => {
        const waitFor = async (description, getter) => {
          for (let attempt = 0; attempt < 120; attempt++) {
            const value = getter();
            if (value) return value;
            await pause(50);
          }
          throw new Error('Missing ' + description + ' for ' + boardId);
        };
        const board = await waitFor('DGS board', () => window.__boards?.[boardId]);
        const root = board.containerObj?.getRootNode?.() || document;
        click(await waitFor('DGS menu button', () => root.querySelector('.lia-dgs-menu-button')));
        await pause(100);
        click(await waitFor('DGS shapes button', () =>
          root.querySelector('.lia-dgs-top-menu .lia-dgs-polygon-button')));
        await pause(100);
        click(await waitFor('DGS polygon tool', () =>
          Array.from(root.querySelectorAll('.lia-dgs-shape-submenu .lia-dgs-geometry-tool'))
            .find(button => /Vieleck|Polygon/i.test(button.textContent || ''))));
        await pause(120);

        const container = board.containerObj;
        container.scrollIntoView({ block: 'center', inline: 'center' });
        await pause(180);
        const coordinates = [[0, 0], [4, 0], [4, 3], [0, 0]];
        for (let pointIndex = 0; pointIndex < coordinates.length; pointIndex++) {
          const rect = container.getBoundingClientRect();
          const origin = board.origin?.scrCoords;
          const [x, y] = coordinates[pointIndex];
          const clientX = rect.left + Number(origin[1]) + x * Number(board.unitX);
          const clientY = rect.top + Number(origin[2]) - y * Number(board.unitY);
          const target = document.elementFromPoint(clientX, clientY) || container;
          const pointerId = 1000 + index * 10 + pointIndex;
          target.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons: 1,
            clientX,
            clientY,
          }));
          target.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons: 0,
            clientX,
            clientY,
          }));
          await pause(120);
        }
        window.__persistDgsBoardState?.(boardId, false);
        await waitFor('persisted learner polygon', () =>
          window.__dgsConstructionStates?.[boardId]?.records?.some(record =>
            record?.type === 'polygon' && record?.origin !== 'macro'));
        await check(index);
      };
      const solveCircle = async (index, denominator, numerator) => {
        const range = cell(index).querySelector('input[type="range"]');
        inputValue(range, String(denominator));
        for (let attempts = 0; cell(index).querySelectorAll('[data-fq-part]').length !== denominator && attempts < 100; attempts++) {
          await pause(100);
        }
        for (let part = 0; part < numerator; part++) {
          let segment = null;
          for (let attempts = 0; !segment && attempts < 100; attempts++) {
            segment = cell(index).querySelector('[data-fq-part="' + part + '"]');
            if (!segment) await pause(100);
          }
          click(segment);
          await pause(140);
        }
        await check(index);
      };
      let highlighterActivated = false;
      const markText = async (index, color) => {
        if (!highlighterActivated) {
          click(document.querySelector('[title="Text Highlighter"], [aria-label="Text Highlighter"]'));
          await pause(80);
          highlighterActivated = true;
        }
        const swatch = Array.from(document.querySelectorAll('.hl-swatch'))
          .find(button => (button.title || button.getAttribute('aria-label') || '').toLowerCase() === color);
        click(swatch);
        const target = cell(index).querySelector('.lia-hl-target');
        const textNode = target.querySelector('span')?.firstChild || target.firstChild;
        if (!(textNode instanceof Text)) throw new Error('Marker target has no exact text node');
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, textNode.data.length);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
        await pause(220);
        await check(index);
      };

      for (let attempts = 0; cells().length !== 34 && attempts < 100; attempts++) await pause(100);
      if (location.hash !== '#27') throw new Error('Expected fresh README slide #27, got ' + location.hash);
      if (cells().length !== 34) throw new Error('Expected 34 flex children, got ' + cells().length);
      if (document.querySelectorAll('.flex-child .lia-assignment-details').length !== 34) {
        throw new Error('Not every flex child has @ADetails');
      }
      let interceptReady = false;
      for (let attempts = 0; attempts < 600; attempts++) {
        interceptReady = document.body.classList.contains('lia-send-collect')
          && sendInterceptReady();
        if (interceptReady) break;
        await pause(100);
      }
      if (!interceptReady) throw new Error('Send collect click interceptor did not become ready');
      const preGraded = cells().map((item, index) => ({
        index,
        className: item.querySelector('.lia-quiz')?.className || '',
        outcome: item.querySelector('.lia-quiz')?.getAttribute('data-lia-freeze-outcome') || '',
      })).filter(item =>
        /\b(?:solved|resolved|failed|success)\b/i.test(item.className) || item.outcome
      );
      if (preGraded.length) {
        throw new Error('Fresh Send course already contains graded quizzes: '
          + JSON.stringify(preGraded));
      }

      await setAndCheck(0, 'Paris');
      // A second learner Check on the same task must be preserved as 2; the
      // automatic grading pass must not turn it into 3.
      await check(0);
      await setAndCheck(1, 'Rome');
      await setAndCheck(2, 'Solar and wind power are renewable energy sources.');
      await setAndCheck(3, 'Plants convert light into chemical energy.');
      await chooseFirstDropdownOption(4);
      await chooseFirstDropdownOption(5);
      await selectChecks(6, [0, 2]);
      await selectChecks(7, [0, 1]);
      await selectChecks(8, [1]);
      await selectChecks(9, [0]);
      await selectChecks(10, [0, 3]);
      await selectChecks(11, [0, 3]);
      await fillDrop(12, ['yellow', 'blue']);
      await fillDrop(13, ['fish', 'bird']);
      await check(14);
      await check(15);
      await setAndCheck(16, '4');
      await setAndCheck(17, '5');
      await solveCoordinate(18, 'FlexCoordA', 'A', [1, 2]);
      await solveCoordinate(19, 'FlexCoordB', 'B', [-2, 1]);
      await solveCircle(20, 3, 1);
      await solveCircle(21, 4, 3);
      await setAndCheck(22, 'The apple is green.');
      await setAndCheck(23, 'The house is large.');
      await markText(24, 'red');
      await markText(25, 'blue');
      const collectSidecars = cells().slice(0, 26).map((item, index) =>
        sendSidecar(item.querySelector('.lia-quiz'), item)
      );
      return {
        cells: cells().length,
        hash: location.hash,
        href: location.href,
        bodyClasses: document.body.className,
        collectLogged: collectSidecars.filter(item => item.logged).length,
        ownershipViolations: collectSidecars
          .map((item, index) => ({ index, ...item }))
          .filter(item => !item.ownershipOk),
      };
    })()`);

    assert(prepared.cells === 34 && prepared.hash === '#27'
      && !prepared.href.includes('submission')
      && prepared.bodyClasses.includes('lia-send-collect')
      && !/lia-shared-freeze-link|lia-course-frozen/.test(prepared.bodyClasses)
      && prepared.collectLogged === 26
      && prepared.ownershipViolations.length === 0,
      'Base quiz preparation left the expected README slide: ' + JSON.stringify(prepared));
    const dgsBoardIds = [
      'FlexDgsAreaA', 'FlexDgsAreaB',
      'FlexDgsPerimeterA', 'FlexDgsPerimeterB',
      'FlexDgsConstructionA', 'FlexDgsConstructionB',
      'FlexDgsCombinedA', 'FlexDgsCombinedB',
    ];
    const trustedDgsStates = [];
    for (const boardId of dgsBoardIds) {
      trustedDgsStates.push(await constructDgsTriangle(boardId));
    }
    assertDgsTriangles(trustedDgsStates, 'Trusted CDP construction');

    const live = await evaluate(String.raw`(async () => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const cells = () => Array.from(document.querySelectorAll('.flex-child'));
      const cell = index => {
        const value = cells()[index];
        if (!value) throw new Error('Missing flex-child #' + index);
        return value;
      };
      const click = element => {
        if (!(element instanceof Element)) throw new Error('Interactive element is missing');
        element.scrollIntoView({ block: 'center', inline: 'center' });
        if (typeof element.click === 'function') element.click();
        else element.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        }));
      };
      const inputValue = (element, value) => {
        const prototype = element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (setter) setter.call(element, value);
        else element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const visible = element => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && style.pointerEvents !== 'none'
          && element.getClientRects().length > 0;
      };
      const visibleFeedback = element => {
        if (!(element instanceof HTMLElement) || element.hidden) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || '1') !== 0
          && element.getClientRects().length > 0;
      };
      const markerForQuiz = (quiz, quizCell) => {
        const markerSelector = '.lia-assignment-details[data-adetails]';
        return Array.from(quizCell?.querySelectorAll(markerSelector) || []).find(marker => {
          const localScope = marker.closest('.flex-child') || quizCell;
          const ordered = Array.from(localScope?.querySelectorAll(
            '.lia-quiz__check,' + markerSelector
          ) || []);
          const markerIndex = ordered.indexOf(marker);
          for (let index = markerIndex - 1; index >= 0; index--) {
            const candidate = ordered[index];
            if (candidate.matches('.lia-quiz__check')) {
              return candidate.closest('.lia-quiz') === quiz;
            }
          }
          return false;
        }) || null;
      };
      const sendSidecar = (quiz, quizCell) => {
        let kind = 'adetails';
        const markerCount = quizCell?.querySelectorAll(
          '.lia-assignment-details[data-adetails]'
        ).length || 0;
        let host = markerForQuiz(quiz, quizCell);
        let roots = host?.shadowRoot
          ? Array.from(host.shadowRoot.querySelectorAll(
            '[data-lia-freeze-adetails-sidecar]'
          ))
          : [];
        let task = 0;
        let portalCount = 0;
        if (!host && markerCount === 0) {
          kind = 'generic';
          const content = quiz?.closest('main.lia-slide__content')
            || document.querySelector('main.lia-slide__content,.lia-content,main,article');
          task = content
            ? Array.from(content.querySelectorAll('.lia-quiz')).indexOf(quiz) + 1
            : 0;
          const portals = Array.from(document.querySelectorAll(
            'lia-freeze-quiz-sidecars[data-lia-freeze-quiz-sidecars]'
          ));
          portalCount = portals.length;
          host = portals[0] || null;
          roots = host?.shadowRoot && task > 0
            ? Array.from(host.shadowRoot.querySelectorAll(
              '.lia-freeze-generic-quiz-sidecar[data-lia-freeze-task-index]'
            )).filter(entry =>
              entry.getAttribute('data-lia-freeze-task-index') === String(task)
            )
            : [];
        } else if (!host) {
          kind = 'adetails-unbound';
        }
        const root = roots[0] || null;
        const statuses = root
          ? Array.from(root.querySelectorAll('.lia-send-status'))
          : [];
        const feedbacks = root
          ? Array.from(root.querySelectorAll(
            '.lia-adetails-feedback.lia-quiz__feedback'
          ))
          : [];
        const points = root && kind === 'adetails'
          ? Array.from(root.querySelectorAll('.lia-adetails-points'))
          : [];
        const feedbackTexts = feedbacks
          .map(element => element.textContent?.trim() || '')
          .filter(Boolean);
        const visibleFeedbackTexts = feedbacks
          .filter(element => visibleFeedback(element) && !!element.textContent?.trim())
          .map(element => element.textContent.trim());
        const status = statuses[0]?.textContent?.trim() || '';
        const expectedOwner = kind === 'adetails'
          ? host?.getAttribute('data-adetails-instance') || ''
          : '';
        const forbidden = '.lia-send-status,.lia-adetails-points,.lia-adetails-sidecar,'
          + '.lia-adetails-feedback,[data-lia-send-logged],'
          + '[data-lia-freeze-adetails-sidecar]';
        const control = quiz?.querySelector('.lia-quiz__control');
        const ownedRoot = kind === 'adetails'
          ? markerCount === 1
            && !!expectedOwner
            && root?.getAttribute('data-lia-freeze-adetails-sidecar') === '1'
            && root?.getAttribute('data-adetails-owner') === expectedOwner
            && points.length === 1
            && points[0]?.getAttribute('data-adetails-owner') === expectedOwner
            && feedbacks[0]?.getAttribute('part') === 'feedback'
          : kind === 'generic'
            && markerCount === 0
            && portalCount === 1
            && task > 0
            && root?.getAttribute('data-lia-freeze-task-index') === String(task);
        return {
          kind,
          logged: kind === 'adetails'
            ? root?.getAttribute('data-lia-send-logged') === '1'
            : !!status,
          status,
          feedback: {
            count: feedbacks.length,
            nonemptyCount: feedbackTexts.length,
            visibleCount: visibleFeedbackTexts.length,
            texts: feedbackTexts,
            visibleTexts: visibleFeedbackTexts,
          },
          ownership: {
            markerCount,
            portalCount,
            rootCount: roots.length,
            statusCount: statuses.length,
            feedbackCount: feedbacks.length,
            pointsCount: points.length,
            expectedOwner,
            actualOwner: root?.getAttribute('data-adetails-owner') || '',
            pointsOwner: points[0]?.getAttribute('data-adetails-owner') || '',
            task,
            rootTask: root?.getAttribute('data-lia-freeze-task-index') || '',
          },
          ownershipOk: !!host
            && !host.closest('.lia-quiz,.lia-quiz__control')
            && Array.from(host.childNodes).every(node =>
              node.nodeType === Node.TEXT_NODE
            )
            && roots.length === 1
            && statuses.length === 1
            && feedbacks.length === 1
            && ownedRoot
            && !quiz?.hasAttribute('data-lia-send-logged')
            && !quiz?.querySelector(forbidden)
            && !control?.querySelector(forbidden),
        };
      };
      const quizEvidence = index => {
        const quiz = cell(index).querySelector('.lia-quiz');
        const sidecar = sendSidecar(quiz, cell(index));
        const nativeFeedbacks = Array.from(
          quiz?.querySelectorAll('.lia-quiz__feedback') || []
        );
        const nativeFeedbackTexts = nativeFeedbacks
          .map(element => element.textContent?.trim() || '')
          .filter(Boolean);
        const visibleNativeFeedbackTexts = nativeFeedbacks
          .filter(element => visibleFeedback(element) && !!element.textContent?.trim())
          .map(element => element.textContent.trim());
        const nativeVisibleCount = visibleNativeFeedbackTexts.length;
        const sidecarVisibleCount = sidecar.feedback.visibleCount;
        const feedbackOwnershipOk = (
          nativeVisibleCount === 1 && sidecarVisibleCount === 0
        ) || (
          nativeVisibleCount === 0
          && sidecarVisibleCount === 1
          && sidecar.ownershipOk
        );
        const feedback = visibleNativeFeedbackTexts[0]
          || sidecar.feedback.visibleTexts[0]
          || nativeFeedbackTexts[0]
          || sidecar.feedback.texts[0]
          || '';
        const feedbackSource = visibleNativeFeedbackTexts[0]
          ? 'native'
          : sidecar.feedback.visibleTexts[0]
            ? sidecar.kind + '-sidecar'
            : feedback
              ? 'hidden'
              : 'none';
        const resolve = quiz?.querySelector('.lia-quiz__resolve');
        const markerProxy = cell(index).querySelector('.hlq-proxy');
        const markerMessages = Array.from(cell(index).querySelectorAll('.hlq-msg'));
        const markerSolution = markerProxy?.querySelector('[data-hlq-act=solve]');
        const markerValue = markerProxy?.querySelector(
          'input.lia-quiz__input,textarea.lia-quiz__input,input[type=text],input[type=number]'
        )?.value?.trim() || '';
        const quizClass = quiz?.className || '';
        return {
          index,
          quizClass,
          open: /\bopen\b/i.test(quizClass),
          outcomeClass: /\b(?:solved|resolved|failed|success)\b/i.test(quizClass),
          outcome: quiz?.getAttribute('data-lia-freeze-outcome') || '',
          feedback,
          feedbackVisible: nativeVisibleCount + sidecarVisibleCount > 0,
          feedbackAnyText: nativeFeedbackTexts.length + sidecar.feedback.nonemptyCount > 0,
          feedbackSource,
          feedbackOwnershipOk,
          feedbackEvidence: {
            nativeCount: nativeFeedbacks.length,
            nativeNonemptyCount: nativeFeedbackTexts.length,
            nativeVisibleCount,
            sidecar: sidecar.feedback,
          },
          sendLogged: sidecar.logged,
          status: sidecar.status,
          sidecar,
          resolve: {
            exists: !!resolve,
            visible: visible(resolve),
            disabled: !!resolve?.disabled,
            freezeLocked: resolve?.getAttribute('data-lia-freeze-locked') === '1',
            pointerEvents: resolve ? getComputedStyle(resolve).pointerEvents : '',
          },
          marker: {
            proxyValue: markerValue,
            feedbackVisible: markerMessages.some(message =>
              visible(message) && !!message.textContent?.trim()),
            solutionVisible: visible(markerSolution),
          },
          text: (quiz?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 260),
          details: cell(index).querySelector('.lia-assignment-details')?.dataset.adetails || '',
        };
      };
      const readOutcomes = () => cells().map((_, index) => quizEvidence(index));
      const checkDgs = async index => {
        const quiz = cell(index).querySelector('.lia-quiz');
        let button = null;
        for (let attempt = 0; !button && attempt < 120; attempt++) {
          button = quiz?.querySelector('.lia-quiz__check');
          if (!button) await pause(50);
        }
        click(button);
        for (let attempt = 0; attempt < 160; attempt++) {
          const evidence = quizEvidence(index);
          if (evidence.sendLogged && evidence.status.startsWith('Antwort gespeichert')) {
            return evidence;
          }
          await pause(100);
        }
        throw new Error('DGS quiz #' + index + ' was not logged neutrally: '
          + JSON.stringify(quizEvidence(index)));
      };

      if (location.hash !== '#27' || cells().length !== 34) {
        throw new Error('DGS checks did not start on README #27 with 34 cells');
      }
      for (let index = 26; index < 34; index++) await checkDgs(index);
      await pause(500);

      const authoredTags = cells().map(item => item.querySelector('.lia-assignment-details')?.dataset.adetails || '');
      const collectOutcomes = readOutcomes();
      const dgsBoardIds = [
        'FlexDgsAreaA', 'FlexDgsAreaB',
        'FlexDgsPerimeterA', 'FlexDgsPerimeterB',
        'FlexDgsConstructionA', 'FlexDgsConstructionB',
        'FlexDgsCombinedA', 'FlexDgsCombinedB',
      ];
      const readDgsStates = () => dgsBoardIds.map(boardId => {
        const snapshot = window.__dgsConstructionStates?.[boardId];
        const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
        const polygon = records.find(record => record?.type === 'polygon' && record?.origin !== 'macro');
        const points = records.filter(record => record?.type === 'point');
        const byId = new Map(points.map(record => [String(record.id || ''), record]));
        const byName = new Map(points.map(record => [String(record.name || ''), record]));
        const vertices = (Array.isArray(polygon?.points) ? polygon.points : []).map(reference => {
          const point = byId.get(String(reference?.id || '')) || byName.get(String(reference?.name || ''));
          return point ? [Number(point.x), Number(point.y)] : [NaN, NaN];
        });
        return { boardId, polygon: !!polygon, records: records.length, vertices };
      });

      for (let step = 0; step < 5 && !document.getElementById('lia-create-link'); step++) {
        const next = document.querySelector('button[title="next"]');
        click(next);
        await pause(350);
        const examInput = document.querySelector('.lia-exam-name-input');
        const examStart = document.querySelector('.lia-exam-start-btn');
        if (examInput && examStart) {
          inputValue(examInput, 'Chromium Quiz Student');
          click(examStart);
          await pause(300);
        }
      }
      if (!document.getElementById('lia-create-link')) throw new Error('Next navigation did not reach Submit');
      const name = document.getElementById('lia-name');
      inputValue(name, 'Chromium Quiz Student');
      click(document.getElementById('lia-create-link'));

      let link = '';
      for (let attempts = 0; !link && attempts < 6000; attempts++) {
        await pause(100);
        link = document.getElementById('lia-link')?.value || '';
      }
      if (!link) throw new Error('Freeze link was not created');
      for (let attempts = 0; attempts < 6000; attempts++) {
        if (document.body.classList.contains('lia-course-frozen')
            && document.body.classList.contains('lia-send-review')
            && !document.getElementById('lia-send-grading-overlay')) break;
        await pause(100);
      }
      if (!document.body.classList.contains('lia-course-frozen')
          || !document.body.classList.contains('lia-send-review')) {
        throw new Error('Same-tab Send review did not start after Freeze creation');
      }
      const slideAtFreeze = location.hash;

      location.hash = '#27';
      for (let attempts = 0; document.querySelectorAll('.flex-child').length !== 34 && attempts < 3600; attempts++) {
        await pause(100);
      }
      const standardPositiveIndices = [
        0, 1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
        14, 15, 16, 17, 18, 19, 24, 25,
        26, 27, 28, 29, 30, 31, 32, 33,
      ];
      let liveOutcomes = readOutcomes();
      for (let attempts = 0; attempts < 3600; attempts++) {
        liveOutcomes = readOutcomes();
        const outcomesReady = standardPositiveIndices.every(index => {
          const item = liveOutcomes[index];
          return /solved|success|correct|right answer/i.test(
            item.quizClass + ' ' + item.outcome + ' ' + item.feedback
          ) && !!item.feedback;
        });
        const dgsReady = dgsBoardIds.every(boardId =>
          window.__dgsConstructionStates?.[boardId]?.records?.some(record =>
            record?.type === 'polygon' && record?.origin !== 'macro'));
        if (outcomesReady && dgsReady) break;
        await pause(100);
      }
      const dgsStates = readDgsStates();

      document.getElementById('lia-freeze-last')?.click();
      for (let attempts = 0; document.getElementById('lia-eval-placeholder')?.style.display !== 'block' && attempts < 1200; attempts++) {
        await pause(100);
      }
      const sameTabEvaluationText = document.getElementById('lia-eval-placeholder')?.innerText || '';
      const sameTabEvaluation = document.getElementById('lia-eval-placeholder');
      const sameTabSendCheckSummary = sameTabEvaluation?.querySelector(
        '[data-lia-send-check-total]'
      );
      const sameTabSendChecks = {
        total: sameTabSendCheckSummary
          ? Number(sameTabSendCheckSummary.getAttribute('data-lia-send-check-total'))
          : null,
        items: Array.from(
          sameTabEvaluation?.querySelectorAll('[data-lia-send-check-task]') || []
        ).map(row => ({
          key: row.getAttribute('data-lia-send-check-task') || '',
          count: Number(row.getAttribute('data-lia-send-check-count')),
          table: row.getAttribute('data-lia-send-check-table') || '',
        })),
      };
      const evaluationLines = sameTabEvaluationText.split('\n').map(line => line.trim()).filter(Boolean);
      const sameTabTagChecks = liveOutcomes.map(item => {
        const tag = item.details.split(';')[1] || '';
        const offset = evaluationLines.indexOf(tag);
        const block = offset >= 0 ? evaluationLines.slice(offset, offset + 13).join(' ') : '';
        const zeroPoint = item.index === 2 || item.index === 3;
        return {
          index: item.index,
          tag,
          block,
          valid: zeroPoint
            ? /Correct 0 Wrong 0 Resolved 0 Achieved 0 of 0 Score 0%/.test(block)
            : /Correct 1 Wrong 0 Resolved 0 Achieved 1 of 1 Score 100%/.test(block),
        };
      });
      return {
        link,
        authoredTags,
        collectOutcomes,
        liveOutcomes,
        dgsStates,
        slideAtFreeze,
        sameTabFrozen: document.body.classList.contains('lia-course-frozen')
          && document.body.classList.contains('lia-send-review'),
        sameTabEvaluationText,
        sameTabTagChecks,
        sameTabSendChecks,
      };
    })()`);

    assert(live.authoredTags.length === 34, 'Live course did not expose 34 @ADetails declarations');
    assert(new Set(live.authoredTags).size === 34, '@ADetails declarations are not unique');
    assert(live.collectOutcomes.length === 34, 'Send collect audit did not cover all 34 quizzes');
    const collectGraded = live.collectOutcomes.filter(item =>
      !item.open || item.outcomeClass || item.outcome
    );
    const collectNotLogged = live.collectOutcomes.filter(item =>
      !item.sendLogged || !item.status.startsWith('Antwort gespeichert')
    );
    const collectOwnershipViolations = live.collectOutcomes.filter(item =>
      !item.sidecar?.ownershipOk
    );
    const collectFeedback = live.collectOutcomes.filter(item =>
      item.feedbackAnyText || item.feedbackVisible
    );
    const collectSolutions = live.collectOutcomes.filter(item => item.resolve.visible);
    const collectMarkerLeaks = live.collectOutcomes.filter(item =>
      (item.index === 24 || item.index === 25)
      && (item.marker.proxyValue || item.marker.feedbackVisible || item.marker.solutionVisible)
    );
    assert(collectGraded.length === 0,
      'Send graded one or more quizzes before Freeze: ' + JSON.stringify(collectGraded));
    assert(collectNotLogged.length === 0,
      'Send did not mark all answers neutrally as saved: ' + JSON.stringify(collectNotLogged));
    assert(collectOwnershipViolations.length === 0,
      'Send/ADetails sidecars leaked into Elm-owned quiz light DOM: '
      + JSON.stringify(collectOwnershipViolations));
    assert(collectFeedback.length === 0,
      'Send exposed native feedback before Freeze: ' + JSON.stringify(collectFeedback));
    assert(collectSolutions.length === 0,
      'Send exposed a native solution before Freeze: ' + JSON.stringify(collectSolutions));
    assert(collectMarkerLeaks.length === 0,
      'Send ran or exposed the internal Marker check before Freeze: '
      + JSON.stringify(collectMarkerLeaks));
    assert(live.link.includes('submission%3D'), 'Created URL has no encoded submission token');
    assert(live.sameTabFrozen, 'Freeze creation did not enter same-tab Send review mode');
    const standardPositiveIndices = [
      0, 1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
      14, 15, 16, 17, 18, 19, 24, 25,
      26, 27, 28, 29, 30, 31, 32, 33,
    ];
    const sameTabUnresolved = live.liveOutcomes.filter(item =>
      standardPositiveIndices.includes(item.index)
      && !/solved|success|correct|right answer/i.test(
        item.quizClass + ' ' + item.outcome + ' ' + item.feedback
      )
    );
    const sameTabMissingFeedback = live.liveOutcomes.filter(item =>
      standardPositiveIndices.includes(item.index)
      && (!item.feedback || !item.feedbackVisible || !item.feedbackOwnershipOk)
    );
    assert(sameTabUnresolved.length === 0,
      'Same-tab Send review did not grade all positive quizzes: ' + JSON.stringify(sameTabUnresolved));
    assert(sameTabMissingFeedback.length === 0,
      'Same-tab Send review lost visible native-or-owned-sidecar feedback: '
      + JSON.stringify(sameTabMissingFeedback));
    assert([24, 25].every(index => live.liveOutcomes[index]?.marker.proxyValue),
      'Send grading did not run both internal Marker checks: '
      + JSON.stringify([live.liveOutcomes[24], live.liveOutcomes[25]]));
    assert(live.sameTabTagChecks.length === 34 && live.sameTabTagChecks.every(item => item.valid),
      'Same-tab Send evaluation has incorrect per-tag scores: '
      + JSON.stringify(live.sameTabTagChecks.filter(item => !item.valid)));
    assert(live.sameTabEvaluationText.includes('32 of 53 points achieved.'),
      'Same-tab Send evaluation does not report the expected 32 of 53 points');
    const assertSendChecks = (evidence, label) => {
      assert(evidence?.total === 35,
        label + ' has the wrong total Check count: ' + JSON.stringify(evidence));
      const flexItems = (evidence?.items || []).filter(item =>
        item.key.startsWith('#27::send::')
      );
      assert(flexItems.length === 34,
        label + ' does not list all 34 flex-slide tasks: ' + JSON.stringify(evidence));
      const wrong = flexItems.filter((item, index) =>
        item.key !== '#27::send::' + index
        || item.count !== (index === 0 ? 2 : 1)
      );
      assert(wrong.length === 0,
        label + ' has wrong per-task Check counts: ' + JSON.stringify(wrong));
      assert(flexItems[2]?.table === 'survey' && flexItems[3]?.table === 'survey',
        label + ' does not retain the two checked surveys as ungraded rows: '
          + JSON.stringify(flexItems.slice(2, 4)));
      const phantomChecks = evidence.items.filter(item =>
        !item.key.startsWith('#27::send::') && item.count !== 0
      );
      assert(phantomChecks.length === 0,
        label + ' invented Check clicks for untouched course tasks: '
          + JSON.stringify(phantomChecks));
    };
    assertSendChecks(live.sameTabSendChecks, 'Same-tab Send evaluation');
    assertDgsTriangles(live.dgsStates, 'Same-tab Send review');

    await command('Page.navigate', { url: live.link });
    // Page.navigate can briefly expose the replacement document's WindowProxy
    // before its body exists. Poll from fresh CDP evaluations and require one
    // stable second so the long shared assertions never run inside a dying
    // execution context.
    let sharedDocumentStable = 0;
    let sharedDocumentState = null;
    for (let attempts = 0; attempts < 1200; attempts++) {
      try {
        sharedDocumentState = await evaluate(String.raw`(() => ({
          hasBody: !!document.body,
          readyState: document.readyState,
          shared: document.body?.classList.contains('lia-shared-freeze-link') === true,
          review: document.body?.classList.contains('lia-send-review') === true,
          href: location.href,
        }))()`);
      } catch {
        sharedDocumentState = null;
      }
      const ready = sharedDocumentState?.hasBody
        && sharedDocumentState?.readyState !== 'loading'
        && sharedDocumentState?.shared
        && sharedDocumentState?.review
        && String(sharedDocumentState?.href || '').includes('submission');
      sharedDocumentStable = ready ? sharedDocumentStable + 1 : 0;
      if (sharedDocumentStable >= 10) break;
      await delay(100);
    }
    assert(sharedDocumentStable >= 10,
      'Shared document did not become stable after navigation: ' + JSON.stringify(sharedDocumentState));
    const shared = await evaluate(String.raw`(async () => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const visible = element => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && style.pointerEvents !== 'none'
          && element.getClientRects().length > 0;
      };
      const visibleFeedback = element => {
        if (!(element instanceof HTMLElement) || element.hidden) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || '1') !== 0
          && element.getClientRects().length > 0;
      };
      const markerForQuiz = (quiz, quizCell) => {
        const markerSelector = '.lia-assignment-details[data-adetails]';
        return Array.from(quizCell?.querySelectorAll(markerSelector) || []).find(marker => {
          const localScope = marker.closest('.flex-child') || quizCell;
          const ordered = Array.from(localScope?.querySelectorAll(
            '.lia-quiz__check,' + markerSelector
          ) || []);
          const markerIndex = ordered.indexOf(marker);
          for (let index = markerIndex - 1; index >= 0; index--) {
            const candidate = ordered[index];
            if (candidate.matches('.lia-quiz__check')) {
              return candidate.closest('.lia-quiz') === quiz;
            }
          }
          return false;
        }) || null;
      };
      const sendSidecar = (quiz, quizCell) => {
        let kind = 'adetails';
        const markerCount = quizCell?.querySelectorAll(
          '.lia-assignment-details[data-adetails]'
        ).length || 0;
        let host = markerForQuiz(quiz, quizCell);
        let roots = host?.shadowRoot
          ? Array.from(host.shadowRoot.querySelectorAll(
            '[data-lia-freeze-adetails-sidecar]'
          ))
          : [];
        let task = 0;
        let portalCount = 0;
        if (!host && markerCount === 0) {
          kind = 'generic';
          const content = quiz?.closest('main.lia-slide__content')
            || document.querySelector('main.lia-slide__content,.lia-content,main,article');
          task = content
            ? Array.from(content.querySelectorAll('.lia-quiz')).indexOf(quiz) + 1
            : 0;
          const portals = Array.from(document.querySelectorAll(
            'lia-freeze-quiz-sidecars[data-lia-freeze-quiz-sidecars]'
          ));
          portalCount = portals.length;
          host = portals[0] || null;
          roots = host?.shadowRoot && task > 0
            ? Array.from(host.shadowRoot.querySelectorAll(
              '.lia-freeze-generic-quiz-sidecar[data-lia-freeze-task-index]'
            )).filter(entry =>
              entry.getAttribute('data-lia-freeze-task-index') === String(task)
            )
            : [];
        } else if (!host) {
          kind = 'adetails-unbound';
        }
        const root = roots[0] || null;
        const statuses = root
          ? Array.from(root.querySelectorAll('.lia-send-status'))
          : [];
        const feedbacks = root
          ? Array.from(root.querySelectorAll(
            '.lia-adetails-feedback.lia-quiz__feedback'
          ))
          : [];
        const points = root && kind === 'adetails'
          ? Array.from(root.querySelectorAll('.lia-adetails-points'))
          : [];
        const feedbackTexts = feedbacks
          .map(element => element.textContent?.trim() || '')
          .filter(Boolean);
        const visibleFeedbackTexts = feedbacks
          .filter(element => visibleFeedback(element) && !!element.textContent?.trim())
          .map(element => element.textContent.trim());
        const status = statuses[0]?.textContent?.trim() || '';
        const expectedOwner = kind === 'adetails'
          ? host?.getAttribute('data-adetails-instance') || ''
          : '';
        const forbidden = '.lia-send-status,.lia-adetails-points,.lia-adetails-sidecar,'
          + '.lia-adetails-feedback,[data-lia-send-logged],'
          + '[data-lia-freeze-adetails-sidecar]';
        const control = quiz?.querySelector('.lia-quiz__control');
        const ownedRoot = kind === 'adetails'
          ? markerCount === 1
            && !!expectedOwner
            && root?.getAttribute('data-lia-freeze-adetails-sidecar') === '1'
            && root?.getAttribute('data-adetails-owner') === expectedOwner
            && points.length === 1
            && points[0]?.getAttribute('data-adetails-owner') === expectedOwner
            && feedbacks[0]?.getAttribute('part') === 'feedback'
          : kind === 'generic'
            && markerCount === 0
            && portalCount === 1
            && task > 0
            && root?.getAttribute('data-lia-freeze-task-index') === String(task);
        return {
          kind,
          logged: kind === 'adetails'
            ? root?.getAttribute('data-lia-send-logged') === '1'
            : !!status,
          status,
          feedback: {
            count: feedbacks.length,
            nonemptyCount: feedbackTexts.length,
            visibleCount: visibleFeedbackTexts.length,
            texts: feedbackTexts,
            visibleTexts: visibleFeedbackTexts,
          },
          ownership: {
            markerCount,
            portalCount,
            rootCount: roots.length,
            statusCount: statuses.length,
            feedbackCount: feedbacks.length,
            pointsCount: points.length,
            expectedOwner,
            actualOwner: root?.getAttribute('data-adetails-owner') || '',
            pointsOwner: points[0]?.getAttribute('data-adetails-owner') || '',
            task,
            rootTask: root?.getAttribute('data-lia-freeze-task-index') || '',
          },
          ownershipOk: !!host
            && !host.closest('.lia-quiz,.lia-quiz__control')
            && Array.from(host.childNodes).every(node =>
              node.nodeType === Node.TEXT_NODE
            )
            && roots.length === 1
            && statuses.length === 1
            && feedbacks.length === 1
            && ownedRoot
            && !quiz?.hasAttribute('data-lia-send-logged')
            && !quiz?.querySelector(forbidden)
            && !control?.querySelector(forbidden),
        };
      };
      const quizFeedbackEvidence = (quiz, quizCell) => {
        const sidecar = sendSidecar(quiz, quizCell);
        const nativeFeedbacks = Array.from(
          quiz?.querySelectorAll('.lia-quiz__feedback') || []
        );
        const nativeFeedbackTexts = nativeFeedbacks
          .map(element => element.textContent?.trim() || '')
          .filter(Boolean);
        const visibleNativeFeedbackTexts = nativeFeedbacks
          .filter(element => visibleFeedback(element) && !!element.textContent?.trim())
          .map(element => element.textContent.trim());
        const nativeVisibleCount = visibleNativeFeedbackTexts.length;
        const sidecarVisibleCount = sidecar.feedback.visibleCount;
        const ownershipOk = (
          nativeVisibleCount === 1 && sidecarVisibleCount === 0
        ) || (
          nativeVisibleCount === 0
          && sidecarVisibleCount === 1
          && sidecar.ownershipOk
        );
        const text = visibleNativeFeedbackTexts[0]
          || sidecar.feedback.visibleTexts[0]
          || nativeFeedbackTexts[0]
          || sidecar.feedback.texts[0]
          || '';
        const source = visibleNativeFeedbackTexts[0]
          ? 'native'
          : sidecar.feedback.visibleTexts[0]
            ? sidecar.kind + '-sidecar'
            : text
              ? 'hidden'
              : 'none';
        return {
          text,
          visible: nativeVisibleCount + sidecarVisibleCount > 0,
          anyText: nativeFeedbackTexts.length + sidecar.feedback.nonemptyCount > 0,
          source,
          ownershipOk,
          nativeCount: nativeFeedbacks.length,
          nativeNonemptyCount: nativeFeedbackTexts.length,
          nativeVisibleCount,
          sidecar,
        };
      };
      const controlLocked = control => !!control.disabled
        || !!control.readOnly
        || control.getAttribute('data-lia-freeze-locked') === '1'
        || control.hasAttribute('inert')
        || control.getAttribute('aria-disabled') === 'true';
      for (let attempts = 0; attempts < 1200; attempts++) {
        const body = document.body;
        if (body?.classList.contains('lia-shared-freeze-link')
            && body?.classList.contains('lia-send-review')) break;
        await pause(100);
      }
      const sharedBody = document.body;
      if (!sharedBody?.classList.contains('lia-shared-freeze-link')
          || !sharedBody?.classList.contains('lia-send-review')) {
        throw new Error('Shared frozen Send review mode did not start');
      }
      location.hash = '#27';
      for (let attempts = 0; document.querySelectorAll('.flex-child').length !== 34 && attempts < 1200; attempts++) {
        await pause(100);
      }
      const expectedRestoredControls = new Map([
        [0, 'Paris'],
        [1, 'Rome'],
        [2, 'Solar and wind power are renewable energy sources.'],
        [3, 'Plants convert light into chemical energy.'],
        [16, '4'],
        [17, '5'],
        [22, 'The apple is green.'],
        [23, 'The house is large.'],
      ]);
      const dgsBoardIds = [
        'FlexDgsAreaA', 'FlexDgsAreaB',
        'FlexDgsPerimeterA', 'FlexDgsPerimeterB',
        'FlexDgsConstructionA', 'FlexDgsConstructionB',
        'FlexDgsCombinedA', 'FlexDgsCombinedB',
      ];
      let restoredStableSamples = 0;
      for (let attempts = 0; attempts < 1200; attempts++) {
        const currentCells = Array.from(document.querySelectorAll('.flex-child'));
        const restoredAndLocked = Array.from(expectedRestoredControls).every(([index, expected]) => {
          const control = currentCells[index]?.querySelector('.lia-quiz__input,textarea,input[type="text"]');
          return control?.value === expected
            && (control.disabled || control.getAttribute('data-lia-freeze-locked') === '1');
        });
        const dgsRestored = dgsBoardIds.every(boardId =>
          window.__dgsConstructionStates?.[boardId]?.records?.some(record =>
            record?.type === 'polygon' && record?.origin !== 'macro'));
        restoredStableSamples = restoredAndLocked && dgsRestored ? restoredStableSamples + 1 : 0;
        if (restoredStableSamples >= 10) break;
        await pause(100);
      }
      const cells = Array.from(document.querySelectorAll('.flex-child'));
      const values = cells.map(item => Array.from(item.querySelectorAll('input,textarea,select')).map(control => ({
        type: control.type || control.tagName.toLowerCase(),
        value: control.value,
        checked: !!control.checked,
        disabled: !!control.disabled,
      })));
      const outcomes = cells.map((item, index) => {
        const quiz = item.querySelector('.lia-quiz');
        const feedback = quizFeedbackEvidence(quiz, item);
        return {
          index,
          quizClass: quiz?.className || '',
          outcome: quiz?.getAttribute('data-lia-freeze-outcome') || '',
          feedback: feedback.text,
          feedbackVisible: feedback.visible,
          feedbackAnyText: feedback.anyText,
          feedbackSource: feedback.source,
          feedbackOwnershipOk: feedback.ownershipOk,
          feedbackEvidence: {
            nativeCount: feedback.nativeCount,
            nativeNonemptyCount: feedback.nativeNonemptyCount,
            nativeVisibleCount: feedback.nativeVisibleCount,
            sidecar: feedback.sidecar.feedback,
          },
          sidecar: feedback.sidecar,
          markerProxyValue: item.querySelector(
            '.hlq-proxy input.lia-quiz__input,.hlq-proxy textarea.lia-quiz__input,.hlq-proxy input[type=text],.hlq-proxy input[type=number]'
          )?.value?.trim() || '',
          text: (item.innerText || '').replace(/\s+/g, ' ').trim(),
          details: item.querySelector('.lia-assignment-details')?.dataset.adetails || '',
        };
      });
      const standardPositiveIndices = [
        0, 1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
        14, 15, 16, 17, 18, 19, 24, 25,
        26, 27, 28, 29, 30, 31, 32, 33,
      ];
      const unresolved = outcomes.filter(item =>
        standardPositiveIndices.includes(item.index)
        && !/solved|success|correct|right answer/i.test(
          item.quizClass + ' ' + item.outcome + ' ' + item.feedback
        )
      );
      const missingFeedback = outcomes.filter(item =>
        standardPositiveIndices.includes(item.index)
        && (!item.feedback || !item.feedbackVisible || !item.feedbackOwnershipOk)
      );
      const restoredText = [0, 1, 2, 3, 16, 17, 22, 23].map(index => ({ index, values: values[index].map(item => item.value) }));
      const circleStates = [20, 21].map(index => {
        const item = cells[index];
        const widget = item.querySelector('.fq-widget[data-fq-kind="circle"]');
        const parts = Array.from(item.querySelectorAll('[data-fq-part]'));
        return {
          index,
          solved: widget?.getAttribute('data-fq-solved') || '',
          locked: widget?.getAttribute('data-fq-locked') || '',
          denominator: item.querySelector('input[type="range"]')?.value || '',
          selected: parts.filter(part => {
            const fill = (part.getAttribute('fill') || '').toLowerCase();
            return fill && fill !== 'transparent' && fill !== 'none';
          }).length,
        };
      });
      const orthographyStates = [22, 23].map(index => {
        const control = cells[index].querySelector('.orthography-wrap input,.orthography-ui input,input.lia-quiz__input');
        return { index, value: control?.value || '', locked: !!control?.disabled };
      });
      const dgsStates = dgsBoardIds.map(boardId => {
        const snapshot = window.__dgsConstructionStates?.[boardId];
        const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
        const polygon = records.find(record => record?.type === 'polygon' && record?.origin !== 'macro');
        const points = records.filter(record => record?.type === 'point');
        const byId = new Map(points.map(record => [String(record.id || ''), record]));
        const byName = new Map(points.map(record => [String(record.name || ''), record]));
        const vertices = (Array.isArray(polygon?.points) ? polygon.points : []).map(reference => {
          const point = byId.get(String(reference?.id || '')) || byName.get(String(reference?.name || ''));
          return point ? [Number(point.x), Number(point.y)] : [NaN, NaN];
        });
        return { boardId, polygon: !!polygon, records: records.length, vertices };
      });
      const lockedControls = Array.from(document.querySelectorAll('.flex-child input,.flex-child textarea,.flex-child select,.flex-child button'));
      const unlocked = lockedControls.filter(control =>
        !control.matches(
          '.lia-quiz__resolve,.lia-adetails-award-input,.hlq-proxy [data-hlq-act="solve"]'
        ) && !controlLocked(control)
      );
      const reviewResolves = cells.flatMap((item, index) =>
        Array.from(item.querySelectorAll('.lia-quiz__resolve')).map(control => ({
          index,
          visible: visible(control),
          operable: visible(control) && !controlLocked(control),
          disabled: !!control.disabled,
          freezeLocked: control.getAttribute('data-lia-freeze-locked') === '1',
          pointerEvents: getComputedStyle(control).pointerEvents,
        }))
      );

      document.getElementById('lia-freeze-last')?.click();
      for (let attempts = 0; document.getElementById('lia-eval-placeholder')?.style.display !== 'block' && attempts < 100; attempts++) {
        await pause(100);
      }
      const evaluation = document.getElementById('lia-eval-placeholder');
      const evaluationText = evaluation?.innerText || '';
      const sendCheckSummary = evaluation?.querySelector('[data-lia-send-check-total]');
      const sendChecks = {
        total: sendCheckSummary
          ? Number(sendCheckSummary.getAttribute('data-lia-send-check-total'))
          : null,
        items: Array.from(
          evaluation?.querySelectorAll('[data-lia-send-check-task]') || []
        ).map(row => ({
          key: row.getAttribute('data-lia-send-check-task') || '',
          count: Number(row.getAttribute('data-lia-send-check-count')),
          table: row.getAttribute('data-lia-send-check-table') || '',
        })),
      };
      const missingTags = outcomes.map(item => item.details.split(';')[1]).filter(tag => tag && !evaluationText.includes(tag));
      const evaluationLines = evaluationText.split('\n').map(line => line.trim()).filter(Boolean);
      const tagChecks = outcomes.map(item => {
        const tag = item.details.split(';')[1] || '';
        const offset = evaluationLines.indexOf(tag);
        const block = offset >= 0 ? evaluationLines.slice(offset, offset + 13).join(' ') : '';
        const zeroPoint = item.index === 2 || item.index === 3;
        return {
          index: item.index,
          tag,
          block,
          valid: zeroPoint
            ? /Correct 0 Wrong 0 Resolved 0 Achieved 0 of 0 Score 0%/.test(block)
            : /Correct 1 Wrong 0 Resolved 0 Achieved 1 of 1 Score 100%/.test(block),
        };
      });

      location.hash = '#27';
      for (let attempts = 0; document.querySelectorAll('.flex-child').length !== 34 && attempts < 1200; attempts++) {
        await pause(100);
      }
      const reviewCells = Array.from(document.querySelectorAll('.flex-child'));
      const resolveCandidates = reviewCells.flatMap((item, index) =>
        Array.from(item.querySelectorAll('.lia-quiz__resolve')).map(control => ({
          index,
          control,
          root: control.closest('.lia-quiz'),
          operable: visible(control) && !controlLocked(control),
        }))
      ).filter(candidate => candidate.operable);
      const resolveCandidate = resolveCandidates.find(candidate =>
        /\b(?:open|failed)\b/i.test(candidate.root?.className || '')
      ) || resolveCandidates[0];
      if (!resolveCandidate) throw new Error('Shared Send review exposes no operable native solution button');

      const beforeRoot = resolveCandidate.root;
      const beforeClass = beforeRoot?.className || '';
      const beforeValues = Array.from(reviewCells[resolveCandidate.index].querySelectorAll('input,textarea,select'))
        .map(control => ({ value: control.value, checked: !!control.checked }));
      resolveCandidate.control.click();
      let resolved = false;
      for (let attempts = 0; attempts < 200; attempts++) {
        const currentCell = Array.from(document.querySelectorAll('.flex-child'))[resolveCandidate.index];
        const currentRoot = currentCell?.querySelector('.lia-quiz');
        if (/\bresolved\b/i.test(currentRoot?.className || '')) {
          resolved = true;
          break;
        }
        await pause(100);
      }
      await pause(250);
      const resolvedCell = Array.from(document.querySelectorAll('.flex-child'))[resolveCandidate.index];
      const resolvedRoot = resolvedCell?.querySelector('.lia-quiz');
      const afterValues = Array.from(resolvedCell?.querySelectorAll('input,textarea,select') || [])
        .map(control => ({ value: control.value, checked: !!control.checked }));
      const visibleSolutionEvidence = Array.from(resolvedCell?.querySelectorAll(
        '.text-success,.is-success,[class*=correct],[class*=solution]'
      ) || []).filter(visible).map(item => ({
        tag: item.tagName,
        className: item.className || '',
        text: item.textContent?.trim() || '',
      }));
      resolved = resolved
        || visibleSolutionEvidence.length > 0
        || JSON.stringify(beforeValues) !== JSON.stringify(afterValues);

      document.getElementById('lia-freeze-last')?.click();
      for (let attempts = 0; document.getElementById('lia-eval-placeholder')?.style.display !== 'block' && attempts < 1200; attempts++) {
        await pause(100);
      }
      const evaluationAfterResolve = document.getElementById('lia-eval-placeholder')?.innerText || '';
      const evaluationAfterResolveRoot = document.getElementById('lia-eval-placeholder');
      const sendCheckSummaryAfterResolve = evaluationAfterResolveRoot?.querySelector(
        '[data-lia-send-check-total]'
      );
      const sendChecksAfterResolve = {
        total: sendCheckSummaryAfterResolve
          ? Number(sendCheckSummaryAfterResolve.getAttribute('data-lia-send-check-total'))
          : null,
        items: Array.from(
          evaluationAfterResolveRoot?.querySelectorAll('[data-lia-send-check-task]') || []
        ).map(row => ({
          key: row.getAttribute('data-lia-send-check-task') || '',
          count: Number(row.getAttribute('data-lia-send-check-count')),
          table: row.getAttribute('data-lia-send-check-table') || '',
        })),
      };
      return {
        href: location.href,
        cells: cells.length,
        restoredStable: restoredStableSamples >= 10,
        outcomes,
        unresolved,
        missingFeedback,
        restoredText,
        circleStates,
        orthographyStates,
        dgsStates,
        unlocked: unlocked.map(control => ({ tag: control.tagName, text: control.textContent?.trim() || '', type: control.type || '' })),
        reviewResolves,
        resolution: {
          index: resolveCandidate.index,
          beforeClass,
          afterClass: resolvedRoot?.className || '',
          resolved,
          visibleSolutionEvidence,
        },
        evaluationVisible: evaluation?.style.display === 'block',
        evaluationText,
        evaluationAfterResolve,
        sendChecks,
        sendChecksAfterResolve,
        missingTags,
        tagChecks,
      };
    })()`);

    const normalizeFeedback = value => String(value || '').replace(/\s+/g, ' ').trim();
    const feedbackMismatches = live.liveOutcomes
      .filter(item => normalizeFeedback(item.feedback))
      .map(item => ({
        index: item.index,
        live: normalizeFeedback(item.feedback),
        shared: normalizeFeedback(shared.outcomes[item.index]?.feedback),
      }))
      .filter(item => item.live !== item.shared);
    const sharedSidecarOwnershipViolations = shared.outcomes.filter(item =>
      !item.sidecar?.ownershipOk
    );
    const expectedRestoredValues = new Map([
      [0, 'Paris'],
      [1, 'Rome'],
      [2, 'Solar and wind power are renewable energy sources.'],
      [3, 'Plants convert light into chemical energy.'],
      [16, '4'],
      [17, '5'],
      [22, 'The apple is green.'],
      [23, 'The house is large.'],
    ]);

    assert(shared.cells === 34, 'Shared link restored ' + shared.cells + ' instead of 34 flex children');
    assert(shared.restoredStable, 'Eight exact restored control values did not remain locked and stable for one second');
    assert(shared.outcomes.every(item => item.details), 'Shared link lost one or more @ADetails declarations');
    assert(sharedSidecarOwnershipViolations.length === 0,
      'Shared review has unowned or duplicate feedback sidecars: '
      + JSON.stringify(sharedSidecarOwnershipViolations));
    assert(shared.unresolved.length === 0, 'Positive quizzes not restored as correct: ' + JSON.stringify(shared.unresolved));
    assert(shared.missingFeedback.length === 0,
      'Standard quizzes lost visible native-or-owned-sidecar feedback: '
      + JSON.stringify(shared.missingFeedback));
    assert(feedbackMismatches.length === 0, 'Freeze feedback differs from live feedback: ' + JSON.stringify(feedbackMismatches));
    assert([24, 25].every(index => shared.outcomes[index]?.markerProxyValue),
      'Shared Send review lost an internally graded Marker result: '
      + JSON.stringify([shared.outcomes[24], shared.outcomes[25]]));
    assert(shared.restoredText.every(item => item.values.includes(expectedRestoredValues.get(item.index))), 'Shared link lost or changed a text/free-text/OCR/orthography value: ' + JSON.stringify(shared.restoredText));
    assert(shared.unlocked.length === 0, 'Shared link left quiz controls unlocked: ' + JSON.stringify(shared.unlocked));
    assert(shared.reviewResolves.some(control => control.visible && control.operable),
      'Shared Send review exposes no visible and operable native solution button: '
      + JSON.stringify(shared.reviewResolves));
    assert(shared.resolution.resolved,
      'Clicking the preserved native solution button exposed no solution evidence: '
      + JSON.stringify(shared.resolution));
    assert(shared.circleStates[0].solved === '1' && shared.circleStates[0].locked === '1' && shared.circleStates[0].denominator === '3' && shared.circleStates[0].selected === 1, 'Circle A state was not fully restored: ' + JSON.stringify(shared.circleStates[0]));
    assert(shared.circleStates[1].solved === '1' && shared.circleStates[1].locked === '1' && shared.circleStates[1].denominator === '4' && shared.circleStates[1].selected === 3, 'Circle B state was not fully restored: ' + JSON.stringify(shared.circleStates[1]));
    assert(shared.orthographyStates[0].value === 'The apple is green.' && shared.orthographyStates[0].locked, 'Orthography A value/lock was not restored');
    assert(shared.orthographyStates[1].value === 'The house is large.' && shared.orthographyStates[1].locked, 'Orthography B value/lock was not restored');
    assertDgsTriangles(shared.dgsStates, 'Shared Freeze link');
    assert(shared.evaluationVisible, 'Evaluation slide did not open in shared mode');
    assert(shared.missingTags.length === 0, 'Evaluation misses @ADetails tags: ' + shared.missingTags.join(', '));
    assert(shared.tagChecks.length === 34 && shared.tagChecks.every(item => item.valid), 'Evaluation has incorrect per-tag scores: ' + JSON.stringify(shared.tagChecks.filter(item => !item.valid)));
    assert(shared.evaluationText.includes('32 of 53 points achieved.'), 'Evaluation does not report the expected 32 of 53 points');
    assertSendChecks(shared.sendChecks, 'Shared Freeze-link evaluation');
    assertSendChecks(shared.sendChecksAfterResolve, 'Shared evaluation after solution review');
    assert(JSON.stringify(shared.sendChecksAfterResolve) === JSON.stringify(shared.sendChecks),
      'Solution review changed the frozen per-task Check counts: '
        + JSON.stringify({ before: shared.sendChecks, after: shared.sendChecksAfterResolve }));
    assert(normalizeFeedback(shared.evaluationAfterResolve) === normalizeFeedback(shared.evaluationText),
      'Frozen evaluation changed after native solution review: '
      + JSON.stringify({ before: shared.evaluationText, after: shared.evaluationAfterResolve }));

    // Build the temporary archive under screen media, just like a real browser.
    // Print CSS only becomes active when window.print() opens the dialog. Keeping
    // it active while all 29 slides are mounted makes the growing DGS-heavy
    // archive participate in layout and turns this regression into a multi-minute
    // stress test unrelated to the actual print path.
    await command('Emulation.setEmulatedMedia', { media: 'screen' });
    const printReady = await evaluate(String.raw`new Promise(resolve => {
      window.print = () => {
        const archive = document.getElementById('lia-print-slides');
        const evaluationPage = document.getElementById('lia-eval-placeholder');
        const evaluationAfterArchive = !!archive && !!evaluationPage
          && !!(archive.compareDocumentPosition(evaluationPage) & Node.DOCUMENT_POSITION_FOLLOWING);
        resolve({
          called: true,
          printClass: document.body.classList.contains('lia-print-report'),
          evaluationAfterArchive,
          coursePages: archive?.querySelectorAll(':scope > .lia-print-slide').length || 0,
        });
      };
      document.getElementById('lia-freeze-print')?.click();
      // A timed Chromium trace on this README took 329,657 ms end-to-end:
      // the three final, DGS-heavy mounts began at 61.7 s, 135.5 s and
      // 231.5 s. Keep a measured CI margin without weakening the assertion.
      setTimeout(() => resolve({ called: false, coursePages: 0 }), 600000);
    })`);

    assert(printReady.called, 'Shared PDF control did not call print()');
    assert(printReady.printClass, 'Print archive was prepared outside print mode');
    assert(printReady.evaluationAfterArchive, 'Evaluation precedes the course archive in actual print DOM order');
    assert(printReady.coursePages === 29, 'Print archive prepared ' + printReady.coursePages + ' instead of 29 course pages');

    // The intercepted print() call leaves the archive in place. Activate print
    // media now, inspect exactly what the dialog would render, then fire the
    // browser's normal cleanup signal.
    await command('Emulation.setEmulatedMedia', { media: 'print' });
    const print = await evaluate(String.raw`(() => {
      const coursePages = Array.from(document.querySelectorAll('#lia-print-slides > .lia-print-slide'));
      const evaluationPage = document.getElementById('lia-eval-placeholder');
      const pages = evaluationPage ? [...coursePages, evaluationPage] : coursePages;
      const records = pages.map((page, index) => {
          const style = getComputedStyle(page);
          const rect = page.getBoundingClientRect();
          const text = (page.innerText || '').replace(/\s+/g, ' ').trim();
          return {
            index,
            title: page === evaluationPage
              ? 'Evaluation'
              : page.querySelector('h1,h2,h3,h4,h5,h6')?.textContent?.replace(/\s+/g, ' ').trim() || '',
            textPrefix: text.slice(0, 180),
            textLength: text.length,
            media: page.querySelectorAll('img,svg,canvas').length,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            width: rect.width,
            height: rect.height,
          };
      });
      return {
        archiveDisplay: getComputedStyle(document.getElementById('lia-print-slides')).display,
        records,
      };
    })()`);
    await evaluate(`(() => { window.dispatchEvent(new Event('afterprint')); return true; })()`);
    await command('Emulation.setEmulatedMedia', { media: 'screen' });

    assert(print.records.length === 30, 'Print archive has ' + print.records.length + ' instead of exactly 30 pages');
    const expectedPrintTitles = [
      'LiaScript Freeze Plugin',
      'How it works',
      'Quick start',
      'Macros',
      '@Abgabe',
      '@Auswertung',
      '@Exam(N)',
      '@ADetails',
      'Full example course',
      'Quiz 1',
      'Quiz 2',
      'Quiz 3',
      'Quiz 4',
      'Quiz 5',
      'Quiz 6',
      'Quiz 7',
      'Quiz 8',
      'Quiz 9',
      'Quiz 10',
      'Quiz 11',
      'Quiz 12',
      'Quiz 13',
      'Quiz 14',
      'Quiz 15',
      'Quiz 16',
      'Quiz 17',
      'All quiz types twice in flex children',
      'Test slide',
      'Submit',
      'Evaluation',
    ];
    const titleMismatches = print.records
      .map((page, index) => ({
        index,
        expected: expectedPrintTitles[index],
        actual: page.title,
        prefix: page.textPrefix,
      }))
      .filter(item => !(item.actual + ' ' + item.prefix).includes(item.expected));
    assert(titleMismatches.length === 0, 'Print pages are missing or out of order: ' + JSON.stringify(titleMismatches));
    const blankPages = print.records.filter(page => page.textLength === 0 && page.media === 0);
    assert(blankPages.length === 0, 'Print archive contains blank pages: ' + JSON.stringify(blankPages));
    const hiddenPages = print.records.filter(page => page.display === 'none' || page.visibility === 'hidden' || Number(page.opacity) === 0 || page.width <= 0 || page.height <= 0);
    assert(hiddenPages.length === 0, 'Print archive contains hidden/zero-size pages: ' + JSON.stringify(hiddenPages));

    process.stdout.write(JSON.stringify({
      live: {
        slideAtFreeze: live.slideAtFreeze,
        details: live.authoredTags.length,
        linkLength: live.link.length,
      },
      shared: {
        cells: shared.cells,
        details: shared.outcomes.length,
        restoredStable: shared.restoredStable,
        feedbackRoundTrips: live.liveOutcomes.filter(item => normalizeFeedback(item.feedback)).length,
        tagScoresVerified: shared.tagChecks.length,
        restoredText: shared.restoredText,
        circleStates: shared.circleStates,
        orthographyStates: shared.orthographyStates,
        evaluationExcerpt: shared.evaluationText.replace(/\s+/g, ' ').slice(0, 500),
      },
      print: {
        pages: print.records.length,
        titles: print.records.map(page => page.title || page.textPrefix),
        blankPages: blankPages.length,
        hiddenPages: hiddenPages.length,
      },
      canvas: {
        browserCoverage: 'both @canvas OCR values round-tripped through the shared Freeze link',
        drawingStateCoverage: 'tests/unit/canvas-state.test.cjs',
      },
    }, null, 2));
  } catch (error) {
    console.error(error.stack || String(error));
    process.exitCode = 1;
  } finally {
    socket.close();
  }
});
