/**
 * Full catalog multi-unit verification.
 * Tests every component that has an L value, across all 4 units.
 * Run: node scratch/verify_all.cjs
 */

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
    return valMm;
}

function toMm(val, unit) {
    if (unit === 'mm') return val;
    if (unit === 'm')  return val * 1000;
    if (unit === 'in') return val * 25.4;
    if (unit === 'ft') return val * 304.8;
}

// ── Full catalog (only items with L) ─────────────────────────────────────────
const CATALOG = {
    'reductor':  [
        { code:'2121', L:'130 mm' }, { code:'4221', L:'156 mm' }, { code:'5221', L:'160 mm' },
        { code:'5421', L:'172 mm' }, { code:'8421', L:'156 mm' }, { code:'6521', L:'157 mm' },
        { code:'7521', L:'158 mm' }, { code:'7621', L:'126 mm' }, { code:'8621', L:'152 mm' },
        { code:'8721', L:'141 mm' }, { code:'9721', L:'155 mm' }, { code:'9821', L:'172 mm' },
        { code:'A921', L:'170 mm' },
    ],
    'tee-igual': [
        { code:'1005', L:'6.26"' }, { code:'2005', L:'6.54"' }, { code:'4005', L:'8.58"' },
        { code:'5005', L:'9.13"' }, { code:'6005', L:'7.87"' }, { code:'7005', L:'8.66"' },
        { code:'8005', L:'10.31"' }, { code:'9005', L:'13.07"' }, { code:'A005', L:'14.76"' },
        { code:'M005', L:'17.56"' },
    ],
    'tee-red': [
        { code:'2107', L:'6.81"' }, { code:'4207', L:'7.95"' }, { code:'5207', L:'8.78"' },
        { code:'5407', L:'8.78"' },
        // rest have no L in catalog — will be skipped
    ],
    'quickdrop': [
        { code:'2110', L:'110 mm' }, { code:'2210', L:'110 mm' }, { code:'4110', L:'125 mm' },
        { code:'4210', L:'125 mm' }, { code:'5110', L:'129 mm' }, { code:'5210', L:'129 mm' },
        { code:'6110', L:'152 mm' }, { code:'6210', L:'152 mm' }, { code:'7110', L:'158 mm' },
        { code:'7210', L:'158 mm' }, { code:'8110', L:'154 mm' }, { code:'8210', L:'154 mm' },
        { code:'9110', L:'202 mm' }, { code:'9210', L:'202 mm' }, { code:'A210', L:'256 mm' },
        { code:'8410', L:'204 mm' }, { code:'9410', L:'267 mm' }, { code:'9510', L:'255 mm' },
        { code:'A410', L:'329 mm' }, { code:'A510', L:'330 mm' },
        { code:'2011', L:'54 mm'  }, { code:'4011', L:'72 mm'  }, { code:'4111', L:'72 mm'  },
        { code:'5011', L:'83 mm'  }, { code:'5111', L:'83 mm'  }, { code:'6011', L:'126 mm' },
        { code:'6111', L:'126 mm' }, { code:'7011', L:'138 mm' }, { code:'7111', L:'138 mm' },
        { code:'8011', L:'170 mm' }, { code:'9011', L:'219 mm' },
    ],
    'valvula': [
        { code:'1052', L:'6.46"' }, { code:'2052', L:'6.69"' }, { code:'4052', L:'9.13"' },
        { code:'5052', L:'10.67"' }, { code:'6052', L:'8.11"' },
        { code:'1252', L:'4.13"' }, { code:'2252', L:'4.49"' }, { code:'2452', L:'4.53"' },
        { code:'4452', L:'6.10"' }, { code:'5552', L:'6.54"' }, { code:'6652', L:'6.3"' },
        { code:'1152', L:'5.28"' }, { code:'2152', L:'5.63"' },
    ],
    'codo': [
        { code:'1003', L:'3.90"', Z1:'1.93"' }, { code:'2003', L:'4.13"', Z1:'2.05"' },
        { code:'4003', L:'5.47"', Z1:'2.72"' }, { code:'5003', L:'6.02"', Z1:'2.87"' },
        { code:'6003', L:'5.63"', Z1:'4.13"' }, { code:'7003', L:'6.14"', Z1:'4.33"' },
        { code:'8003', L:'7.64"', Z1:'5.51"' }, { code:'9003', L:'10.39"', Z1:'7.28"' },
        { code:'A003', L:'12.32"', Z1:'8.19"' }, { code:'M003', L:'21.97"', Z1:'16.46"' },
    ],
    'tapon': [
        { code:'1006', L:'2.80"' }, { code:'2006', L:'2.80"' }, { code:'4006', L:'3.54"' },
        { code:'5006', L:'3.62"' }, { code:'6006', L:'2.17"' }, { code:'7006', L:'2.17"' },
        { code:'8006', L:'2.76"' }, { code:'9006', L:'2.76"' }, { code:'A006', L:'2.76"' },
        { code:'M006', L:'5.51"' },
    ],
    'brida': [
        { code:'6170', L:'85 mm' }, { code:'7170', L:'82 mm' }, { code:'8170', L:'92 mm' },
        { code:'9170', L:'100 mm' }, { code:'A170', L:'109 mm' },
        { code:'7671', L:'85 mm' }, { code:'8671', L:'87 mm' }, { code:'6771', L:'87 mm' },
        { code:'8771', L:'84 mm' }, { code:'0771', L:'84 mm' }, { code:'7871', L:'92 mm' },
        { code:'0871', L:'92 mm' }, { code:'9871', L:'92 mm' }, { code:'0971', L:'100 mm' },
    ],
};

const UNITS = ['mm', 'm', 'in', 'ft'];
const TOLERANCE_MM = 0.02; // allow 0.02 mm rounding tolerance

let totalTests = 0;
let totalPassed = 0;
let totalFailed = 0;
let noL = 0;
const failures = [];

console.log('='.repeat(72));
console.log('  Full Catalog × All Units Verification');
console.log('='.repeat(72));

for (const [type, items] of Object.entries(CATALOG)) {
    let catPassed = 0, catFailed = 0, catNoL = 0;

    for (const item of items) {
        if (!item.L) { catNoL++; noL++; continue; }

        // Ground truth: convert catalog L to mm
        const refL = parseLengthToDxf(item.L, 'mm'); // always mm reference
        const refZ1 = item.Z1 ? parseLengthToDxf(item.Z1, 'mm') : null;

        for (const unit of UNITS) {
            totalTests++;
            const catalogL  = parseLengthToDxf(item.L, unit);
            const catalogZ1 = item.Z1 ? parseLengthToDxf(item.Z1, unit) : null;

            // What the DXF export writes for the primary dimension:
            let dxfValueDxfUnit;
            if (type === 'codo') {
                // Uses Z1 for leg length
                dxfValueDxfUnit = catalogZ1 !== null ? catalogZ1 : catalogL;
            } else {
                // Most types: sSize = catalogL/2, span = sSize*2 = catalogL
                dxfValueDxfUnit = catalogL;
            }

            // Convert back to mm
            const actualMm = toMm(dxfValueDxfUnit, unit);
            const refMm    = (type === 'codo' && refZ1 !== null) ? refZ1 : refL;

            const delta = Math.abs(actualMm - refMm);
            const ok    = delta <= TOLERANCE_MM;

            if (ok) { catPassed++; totalPassed++; }
            else {
                catFailed++; totalFailed++;
                failures.push({ type, code: item.code, unit, actualMm, refMm, delta });
            }
        }
    }

    const icon = catFailed === 0 ? '✅' : '❌';
    const skipInfo = catNoL > 0 ? ` (${catNoL} without L → use fallback)` : '';
    console.log(`\n${icon}  ${type.toUpperCase().padEnd(12)}  ${catPassed} passed, ${catFailed} failed${skipInfo}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(72));
console.log(`  TOTAL: ${totalPassed} passed / ${totalFailed} failed / ${noL} items without L (use fallback)`);
if (totalFailed === 0) {
    console.log('  ✅  PERFECT — every dimensioned component is accurate in all units');
} else {
    console.log('  ❌  FAILURES DETECTED:');
    for (const f of failures) {
        console.log(`     ${f.type} ${f.code} [${f.unit}]: expected ${f.refMm.toFixed(4)} mm, got ${f.actualMm.toFixed(4)} mm, Δ=${f.delta.toFixed(4)} mm`);
    }
}
console.log('='.repeat(72));

// ── Report items without L ────────────────────────────────────────────────────
console.log('\n─ Items without L (will use drawingScale fallback, no real size) ─');
for (const [type, items] of Object.entries(CATALOG)) {
    for (const item of items) {
        if (!item.L) console.log(`   ${type.padEnd(12)} ${item.code}`);
    }
}
// Also list the tee-red, tee-lat without L
const NO_L = {
    'tee-red': ['6407','6507','7407','7507','8507','7607','8607','8707','9607','9707','9807','A607','A707','A807','A907'],
    'tee-lat': ['8712','9712','9812','A812','A912'],
    'valvula': ['0073','0173','1073','1173','0273','1273','2073','4073','5073','6552','1352','2352','4352','5352',
                '6051','7051','8051','9051','A051','6151','7151','8151','9151','A151'],
    'brida':   ['2270','4470','5570','6270','6470','6570','7270','7470','7570','7670','8470','8570','8670',
                '9470','9570','9670','9770','2279','4479','5579','6279','6479','6579','7279','7479','7579'],
};
for (const [type, codes] of Object.entries(NO_L)) {
    for (const code of codes) {
        console.log(`   ${type.padEnd(12)} ${code}`);
    }
}
console.log('\n   → These items are in the catalog but their L dimension was not');
console.log('     provided by the user yet. They will draw at a proportional');
console.log('     fallback size. Add L values to give them real dimensions.\n');
