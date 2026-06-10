/**
 * Multi-unit verification: tests that each symbol measures correctly
 * regardless of whether the DXF document uses mm, m, in, or ft.
 *
 * Run: node scratch/verify_units.cjs
 */

// ── parseLengthToDxf replicado con soporte de ft ──────────────────────────────
function parseLengthToDxf(L, unit = 'mm') {
    if (!L || typeof L !== 'string') return null;
    let valMm = null;
    const inMatch = L.match(/([\d.]+)\s*[\"in]/);
    if (inMatch) {
        valMm = parseFloat(inMatch[1]) * 25.4;
    } else {
        const mmMatch = L.match(/([\d.]+)\s*mm/i);
        if (mmMatch) valMm = parseFloat(mmMatch[1]);
    }
    if (valMm === null || isNaN(valMm) || valMm <= 0) return null;
    if (unit === 'm')  return valMm / 1000;
    if (unit === 'in') return valMm / 25.4;
    if (unit === 'ft') return valMm / 304.8;
    return valMm; // 'mm' default
}

// ── detectUnits replicated (INSUNITS codes) ───────────────────────────────────
const INSUNITS_LABELS = {
    0:  'unitless/no header',
    1:  'in',   // inches
    2:  'ft',   // feet
    4:  'mm',   // millimetres
    5:  'cm',   // centimetres (rare)
    6:  'm',    // metres
};

// ── Reference component from catalog ─────────────────────────────────────────
const COMPONENT = {
    name: 'Tee Igual 8005 (4")',
    type: 'tee',
    L: '10.31"',    // 10.31 inches = 261.874 mm (exact reference)
};

const REF_MM = 10.31 * 25.4; // 261.874 mm — the ground truth

// ── Units to test ─────────────────────────────────────────────────────────────
const UNITS_TO_TEST = ['mm', 'm', 'in', 'ft'];

console.log('='.repeat(76));
console.log('  Multi-Unit Verification: ' + COMPONENT.name);
console.log('  Ground truth: ' + REF_MM.toFixed(4) + ' mm  (' + COMPONENT.L + ')');
console.log('='.repeat(76));

let allOk = true;

for (const unit of UNITS_TO_TEST) {
    const catalogL   = parseLengthToDxf(COMPONENT.L, unit);   // in DXF units
    const sSize      = catalogL / 2;                            // half-size in DXF units
    const dxfSpanDxf = sSize * 2;                              // straight span in DXF units

    // Convert back to mm for comparison
    let spanMm;
    switch (unit) {
        case 'mm': spanMm = dxfSpanDxf; break;
        case 'm':  spanMm = dxfSpanDxf * 1000; break;
        case 'in': spanMm = dxfSpanDxf * 25.4; break;
        case 'ft': spanMm = dxfSpanDxf * 304.8; break;
    }

    const delta = Math.abs(spanMm - REF_MM);
    const ok    = delta < 0.01;
    if (!ok) allOk = false;

    console.log(`\n${ok ? '✅' : '❌'}  INSUNITS = ${unit}`);
    console.log(`   parseLengthToDxf("${COMPONENT.L}", '${unit}') = ${catalogL.toFixed(6)} ${unit}`);
    console.log(`   sSize (half)  = ${sSize.toFixed(6)} ${unit}`);
    console.log(`   DXF export    drawSeg(-${sSize.toFixed(4)}, 0, +${sSize.toFixed(4)}, 0)  in ${unit}`);
    console.log(`   AutoCAD reads = ${dxfSpanDxf.toFixed(6)} ${unit} = ${spanMm.toFixed(4)} mm`);
    console.log(`   Expected      = ${REF_MM.toFixed(4)} mm`);
    console.log(`   Error         = ${delta.toFixed(6)} mm  ${ok ? '✓ OK' : '⚠️  MISMATCH!'}`);
}

// ── Also verify detectUnits reads INSUNITS correctly ─────────────────────────
console.log('\n' + '─'.repeat(76));
console.log('  detectUnits() INSUNITS code → currentUnit mapping');
console.log('─'.repeat(76));
function detectUnits(insunits) {
    if (insunits === 1) return 'in';
    if (insunits === 2) return 'ft';
    if (insunits === 4) return 'mm';
    if (insunits === 6) return 'm';
    return 'mm'; // default if missing
}
const testCodes = [0, 1, 2, 4, 6, undefined];
for (const code of testCodes) {
    const unit = detectUnits(code);
    const label = INSUNITS_LABELS[code] ?? 'not set';
    console.log(`   INSUNITS ${String(code).padEnd(10)} → currentUnit = '${unit}'  (${label})`);
}

console.log('\n' + '='.repeat(76));
if (allOk) {
    console.log('  ✅  ALL units produce the correct real-world dimensions in DXF export');
} else {
    console.log('  ❌  MISMATCH detected — fix parseLengthToDxf unit conversion');
}
console.log('='.repeat(76) + '\n');

// ── Screen rendering sanity check ─────────────────────────────────────────────
console.log('─ Screen rendering sanity (viewState.scale examples) ─');
// If a drawing has 1m pipe and the canvas is 800px wide at 1:1
const scales = [
    { label: '1 px/mm  (zoom-in)',   scale: 1.0 },
    { label: '0.5 px/mm (normal)',   scale: 0.5 },
    { label: '0.1 px/mm (zoom-out)', scale: 0.1 },
];
const catL_mm = parseLengthToDxf(COMPONENT.L, 'mm');
for (const { label, scale } of scales) {
    const screenPx = (catL_mm / 2) * scale * 2;  // = catalogL * scale
    console.log(`  scale = ${label}`);
    console.log(`    s = ${(catL_mm/2 * scale).toFixed(2)} px → symbol spans ${screenPx.toFixed(2)} px on canvas`);
}
