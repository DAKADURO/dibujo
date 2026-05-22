// Diagnostic: reads a real DXF file, injects test entities, saves output
const fs = require('fs');

const inputFile = process.argv[2];
if (!inputFile) {
    console.error('Usage: node scratch/diagnose.cjs <path-to-dxf>');
    process.exit(1);
}

const rawContent = fs.readFileSync(inputFile, 'latin1'); // Use latin1 to avoid encoding issues

// Detect line ending style
const hasCRLF = rawContent.includes('\r\n');
const nl = hasCRLF ? '\r\n' : '\n';
console.log(`Line ending: ${hasCRLF ? 'CRLF (Windows)' : 'LF (Unix)'}`);

// Find version
const versionMatch = rawContent.match(/\$ACADVER[^\n]*\n[^\n]*\n([^\n\r]+)/i);
const version = versionMatch ? versionMatch[1].trim() : 'Unknown';
console.log(`DXF Version: ${version}`);
// AC1009 = R12, AC1012 = R13, AC1014 = R14, AC1015 = 2000, AC1018 = 2004, AC1021 = 2007, AC1024 = 2010, AC1027 = 2013, AC1032 = 2018

const needsSubclasses = version >= 'AC1015';
console.log(`Needs AcDb subclasses: ${needsSubclasses}`);

// Find ENTITIES section
const entitiesHeader = rawContent.match(/2[\s\r\n]+ENTITIES/i);
if (!entitiesHeader) {
    console.error('ENTITIES section not found!');
    process.exit(1);
}
const searchStartIndex = entitiesHeader.index + entitiesHeader[0].length;
const searchString = rawContent.substring(searchStartIndex);

// Find the first ENDSEC within the ENTITIES region
// In DXF, ENDSEC is always preceded by group code 0
const endsecMatch = searchString.match(/^[\s\r\n]*0[\s\r\n]+ENDSEC/im);
if (!endsecMatch) {
    console.error('ENDSEC not found after ENTITIES!');
    process.exit(1);
}
const injectionIndex = searchStartIndex + endsecMatch.index;

console.log(`Injection point: char ${injectionIndex} of ${rawContent.length}`);
console.log(`Character at injection: [${rawContent.substring(injectionIndex, injectionIndex+30).replace(/\r/g,'\\r').replace(/\n/g,'\\n')}]`);

// Show what comes just before the injection point (last 100 chars of ENTITIES block)
const before = rawContent.substring(Math.max(0, injectionIndex - 150), injectionIndex);
console.log(`\n--- Content BEFORE injection point ---`);
console.log(before.replace(/\r/g,'\\r').replace(/\n/g,'\\n'));
console.log(`--- End ---\n`);

// Build a simple test LINE entity
let testEntity;
if (needsSubclasses) {
    testEntity = `  0${nl}LINE${nl}  5${nl}F00001${nl}100${nl}AcDbEntity${nl}  8${nl}0${nl} 62${nl}1${nl}100${nl}AcDbLine${nl} 10${nl}0.0${nl} 20${nl}0.0${nl} 30${nl}0.0${nl} 11${nl}100.0${nl} 21${nl}100.0${nl} 31${nl}0.0${nl}`;
} else {
    testEntity = `  0${nl}LINE${nl}  8${nl}0${nl} 62${nl}1${nl} 10${nl}0.0${nl} 20${nl}0.0${nl} 30${nl}0.0${nl} 11${nl}100.0${nl} 21${nl}100.0${nl} 31${nl}0.0${nl}`;
}

const finalDxf = rawContent.substring(0, injectionIndex) + testEntity + rawContent.substring(injectionIndex);

const outputFile = inputFile.replace('.dxf', '_diagnostic.dxf').replace('.DXF', '_diagnostic.dxf');
fs.writeFileSync(outputFile, finalDxf, 'latin1');
console.log(`\n✅ Wrote test file: ${outputFile}`);
console.log(`Open this in AutoCAD. If it works, the injection mechanism is fine.`);
console.log(`If it fails, the problem is in the entity format itself.`);
