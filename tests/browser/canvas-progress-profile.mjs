/** Summarize Chromium samples for named exports in the exact tested Parcel bundle. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function summarizeCanvasCpu(profile, bundle) {
  const names = ['captureCanvasProgress', 'captureCanvasForSubmission', 'buildFullCanvasFreezeState', 'compactCanvasStates'];
  const functions = names.map(name => {
    const match = new RegExp('"' + name + '",\\(\\)=>[$\\w]+').exec(bundle);
    if (!match) return { name, presentInBundle: false, sampledSelfMs: 0, sampledInclusiveMs: 0, matchedProfileNodes: 0 };
    const minifiedName = match[0].split('=>')[1];
    const declaration = 'function ' + minifiedName + '(';
    const index = bundle.indexOf(declaration, match.index);
    if (index < 0) return { name, presentInBundle: true, unresolved: true };
    const location = index + declaration.length - 1;
    const before = bundle.slice(0, location);
    const lineNumber = before.split('\n').length - 1;
    const columnNumber = location - before.lastIndexOf('\n') - 1;
    return { name, minifiedName, lineNumber, columnNumber, presentInBundle: true, sampledSelfMs: 0, sampledInclusiveMs: 0, matchedProfileNodes: 0 };
  });
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id);
  const identities = new Map();
  for (const node of profile.nodes) {
    const fn = functions.find(fn => fn.minifiedName === node.callFrame.functionName && fn.lineNumber === node.callFrame.lineNumber && Math.abs(fn.columnNumber - node.callFrame.columnNumber) <= 1);
    if (fn) { identities.set(node.id, fn); fn.matchedProfileNodes++; fn.scriptUrl = node.callFrame.url; }
  }
  let imageMs = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const duration = (profile.timeDeltas?.[i] || 0) / 1000;
    let id = profile.samples[i];
    const own = identities.get(id);
    if (own) own.sampledSelfMs += duration;
    if (nodes.get(id)?.callFrame.functionName === 'getImageData') imageMs += duration;
    const seen = new Set();
    while (id) {
      const fn = identities.get(id);
      if (fn && !seen.has(fn.name)) { fn.sampledInclusiveMs += duration; seen.add(fn.name); }
      id = parents.get(id);
    }
  }
  for (const fn of functions) { fn.sampledSelfMs = Math.round(fn.sampledSelfMs || 0); fn.sampledInclusiveMs = Math.round(fn.sampledInclusiveMs || 0); }
  return { note: 'Sampled CPU time, not exact invocation counts. Function identity is resolved from the exact minified bundle export and source position.', elapsedMs: Math.round((profile.endTime - profile.startTime) / 1000), sampledGetImageDataMs: Math.round(imageMs), functions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [profilePath, bundlePath, outputPath] = process.argv.slice(2);
  const summary = summarizeCanvasCpu(JSON.parse(await readFile(profilePath, 'utf8')), await readFile(bundlePath, 'utf8'));
  if (outputPath) await writeFile(outputPath, JSON.stringify(summary, null, 2));
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}
