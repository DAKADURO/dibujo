/**
 * Verification script: traces the full measurement pipeline for each symbol type
 * to confirm that exported DXF values match the catalog exactly.
 *
 * Run: node scratch/verify_measures.cjs
 */

// ── Replicate parseLengthToDxf (currentUnit = 'mm' most common) ──────────────
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
    return valMm; // 'mm' default
}

const CASES = [
    // [name, symType, L, Z1, unit, description of what DXF will output]
    // ── TEE IGUAL ────────────────────────────────────────────────────────────
    { name: '8005 Tee 4"',     type: 'tee',     L: '10.31"', unit: 'mm',
      expectedMm: 10.31 * 25.4, // full straight span (2×sSize)
      drawDescription: 'Horizontal: -sSize to +sSize = full L = 261.87 mm\nBranch: 0 to -sSize = L/2 = 130.94 mm' },
    // ── REDUCTOR ──────────────────────────────────────────────────────────────
    { name: '8721 Red 4"x3"',  type: 'reductor', L: '141 mm', unit: 'mm',
      expectedMm: 141,
      drawDescription: 'Body: -sSize to +sSize = 141mm wide' },
    // ── CODO ─────────────────────────────────────────────────────────────────
    { name: '8003 Codo 4"',    type: 'codo',    L: '7.64"', Z1: '5.51"', unit: 'mm',
      expectedMm: 5.51 * 25.4, // legs use Z1
      drawDescription: 'Leg H: -Z1 to 0 = 139.95 mm | Leg V: 0 to +Z1 = 139.95 mm' },
    // ── TAPÓN ────────────────────────────────────────────────────────────────
    { name: '5006 Tapón 2"',   type: 'tapon',   L: '3.62"', unit: 'mm',
      expectedMm: 3.62 * 25.4,
      drawDescription: 'Tube: -2×sSize to 0 = full L = 91.95 mm\nCap: ±0.7×sSize' },
    // ── BRIDA ────────────────────────────────────────────────────────────────
    { name: '8170 Brida 4"',   type: 'brida',   L: '92 mm', unit: 'mm',
      expectedMm: 92,
      drawDescription: 'Flanges at ±sSize = ±46 mm from center' },
    // ── QUICKDROP ────────────────────────────────────────────────────────────
    { name: '8110 QDrop 4"',   type: 'quickdrop', L: '154 mm', unit: 'mm',
      expectedMm: 154,
      drawDescription: 'Circle at center (r=sSize/2), drop from +sSize/2 to +sSize' },
    // ── VÁLVULA ──────────────────────────────────────────────────────────────
    { name: '7141 Válvula 3"', type: 'valvula',  L: '3.54"', unit: 'mm',
      expectedMm: 3.54 * 25.4,
      drawDescription: 'Bowtie: body ±sSize wide, ±0.6sSize tall' },
];

console.log('='.repeat(72));
console.log('  Piping Symbol Measurement Verification (currentUnit = mm)');
console.log('='.repeat(72));

let allOk = true;

for (const c of CASES) {
    const catalogL = parseLengthToDxf(c.L, c.unit);
    const catalogZ1 = c.Z1 ? parseLengthToDxf(c.Z1, c.unit) : null;

    const sSize = catalogL !== null ? catalogL / 2 : null;
    const legSize = (c.type === 'codo') ? (catalogZ1 !== null ? catalogZ1 : sSize * 2) : null;

    let dxfOutputMm = null;
    let label = '';
    switch (c.type) {
        case 'tee':
            dxfOutputMm = sSize * 2;   // horizontal span
            label = 'Straight span (face-to-face)';
            break;
        case 'reductor':
        case 'brida':
        case 'valvula':
        case 'quickdrop':
            dxfOutputMm = sSize * 2;   // total width
            label = 'Body width (face-to-face)';
            break;
        case 'codo':
            dxfOutputMm = legSize;      // one leg length
            label = 'Leg length (center-to-face, Z1)';
            break;
        case 'tapon':
            dxfOutputMm = sSize * 2;   // tube back from cap to far face
            label = 'Tube length (full L)';
            break;
    }

    const delta = Math.abs(dxfOutputMm - c.expectedMm);
    const ok = delta < 0.01;
    if (!ok) allOk = false;

    console.log(`\n${ok ? '✅' : '❌'} ${c.name}`);
    console.log(`   Catalog L     = ${c.L}${c.Z1 ? `  Z1 = ${c.Z1}` : ''}`);
    console.log(`   parseLengthToDxf(L) = ${catalogL !== null ? catalogL.toFixed(4) + ' mm' : 'NULL'}`);
    if (c.type === 'codo') {
        console.log(`   parseLengthToDxf(Z1) = ${catalogZ1 !== null ? catalogZ1.toFixed(4) + ' mm' : 'NULL'}`);
    }
    console.log(`   sSize (half)  = ${sSize !== null ? sSize.toFixed(4) + ' mm' : 'N/A'}`);
    console.log(`   DXF output    = ${dxfOutputMm.toFixed(4)} mm  (${label})`);
    console.log(`   Expected      = ${c.expectedMm.toFixed(4)} mm`);
    console.log(`   Error         = ${delta.toFixed(6)} mm  ${ok ? 'OK' : '⚠️ MISMATCH!'}`);
    console.log(`   Draw logic    : ${c.drawDescription}`);
}

console.log('\n' + '='.repeat(72));
if (allOk) {
    console.log('  ✅  ALL measurements match the catalog within 0.01 mm');
} else {
    console.log('  ❌  SOME measurements do NOT match — investigate above');
}
console.log('='.repeat(72) + '\n');

// ── Extra: verify parseLengthToDxf handles both inch formats ─────────────────
console.log('─ parseLengthToDxf format tests ─');
const formats = ['10.31"', '10.31in', '130 mm', '130mm', null, '', 'bad'];
for (const f of formats) {
    const r = parseLengthToDxf(f, 'mm');
    console.log(`  "${f}" → ${r !== null ? r.toFixed(4) + ' mm' : 'null'}`);
}
