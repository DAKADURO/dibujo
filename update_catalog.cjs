const fs = require('fs');

const data = {
    // Equal Tee
    '1005': '6.26"',
    '2005': '6.54"',
    '4005': '8.58"',
    '5005': '9.13"',
    '6005': '7.87"',
    '7005': '8.66"',
    '8005': '10.31"',
    '9005': '13.07"',
    'A005': '14.76"',
    'M005': '17.56"',
    // Reducing Tee
    '2107': '6.81"',
    '4207': '7.95"',
    '5207': '8.78"',
    '5407': '8.78"',
    // Valves
    '1052': '6.46"',
    '2052': '6.69"',
    '4052': '9.13"',
    '5052': '10.67"',
    '6052': '8.11"',
    '1252': '4.13"',
    '2252': '4.49"',
    '2452': '4.53"',
    '4452': '6.10"',
    '5552': '6.54"',
    '6652': '6.3"',
    '1152': '5.28"',
    '2152': '5.63"',
    // Quick Drop Connectors
    '2110': '110 mm',
    '2210': '110 mm',
    '4110': '125 mm',
    '4210': '125 mm',
    '5110': '129 mm',
    '5210': '129 mm',
    '6110': '152 mm',
    '6210': '152 mm',
    '7110': '158 mm',
    '7210': '158 mm',
    '8110': '154 mm',
    '8210': '154 mm',
    '9110': '202 mm',
    '9210': '202 mm',
    'A210': '256 mm',
    '8410': '204 mm',
    '9410': '267 mm',
    '9510': '255 mm',
    'A410': '329 mm',
    'A510': '330 mm',
    '2011': '54 mm',
    '4011': '72 mm',
    '4111': '72 mm',
    '5011': '83 mm',
    '5111': '83 mm',
    '6011': '126 mm',
    '6111': '126 mm',
    '7011': '138 mm',
    '7111': '138 mm',
    '8011': '170 mm',
    '9011': '219 mm',
    // Reducing Connector
    '2121': '130 mm',
    '4221': '156 mm',
    '5221': '160 mm',
    '5421': '172 mm',
    '8421': '156 mm',
    '6521': '157 mm',
    '7521': '158 mm',
    '7621': '126 mm',
    '8621': '152 mm',
    '8721': '141 mm',
    '9721': '155 mm',
    '9821': '172 mm',
    'A921': '170 mm',
    // Flanges
    '6170': '85 mm',
    '7170': '82 mm',
    '8170': '92 mm',
    '9170': '100 mm',
    'A170': '109 mm',
    '7671': '85 mm',
    '8671': '87 mm',
    '6771': '87 mm',
    '8771': '84 mm',
    '0771': '84 mm',
    '7871': '92 mm',
    '0871': '92 mm',
    '9871': '92 mm',
    '0971': '100 mm'
};

let content = fs.readFileSync('main.js', 'utf8');

for (const [code, L] of Object.entries(data)) {
    // Regex for objects matching { code: '...' ... label: '...' }
    const regex = new RegExp(`({ code: '${code}',[^}]+label: '[^']+')([ ]*})`, 'g');
    content = content.replace(regex, `$1, L: '${L}'$2`);
}

// Add missing tee-igual array
if (!content.includes("'tee-igual'")) {
    const teeIgualStr = `
    'tee-igual': [
        { code: '1005', d1: '20mm (3/4")', label: '1005: Igual 20mm (3/4")', L: '6.26"' },
        { code: '2005', d1: '25mm (1")', label: '2005: Igual 25mm (1")', L: '6.54"' },
        { code: '4005', d1: '40mm (1 1/2")', label: '4005: Igual 40mm (1 1/2")', L: '8.58"' },
        { code: '5005', d1: '50mm (2")', label: '5005: Igual 50mm (2")', L: '9.13"' },
        { code: '6005', d1: '63mm (2 1/2")', label: '6005: Igual 63mm (2 1/2")', L: '7.87"' },
        { code: '7005', d1: '80mm (3")', label: '7005: Igual 80mm (3")', L: '8.66"' },
        { code: '8005', d1: '100mm (4")', label: '8005: Igual 100mm (4")', L: '10.31"' },
        { code: '9005', d1: '150mm (6")', label: '9005: Igual 150mm (6")', L: '13.07"' },
        { code: 'A005', d1: '200mm (8")', label: 'A005: Igual 200mm (8")', L: '14.76"' },
        { code: 'M005', d1: '250mm (10")', label: 'M005: Igual 250mm (10")', L: '17.56"' }
    ],`;
    content = content.replace("'tee-red': [", teeIgualStr.trim() + "\\n    'tee-red': [");
    
    content = content.replace(
        "options = [\\n                    ...CATALOG_AIRPIPE['standard'].map(o => ({ ...o, label: \\`Igual \\${o.label}\\` })),\\n                    ...CATALOG_AIRPIPE['tee-red']\\n                ];",
        "options = [\\n                    ...CATALOG_AIRPIPE['tee-igual'],\\n                    ...CATALOG_AIRPIPE['tee-red']\\n                ];"
    );
}

// Check and add missing valves
if (!content.includes("code: '6052'")) {
    content = content.replace(
        "{ code: '5052'", 
        `{ code: '5052', d1: '50mm (2")', d2: '50mm (2")', label: '5052: 50mm (2") (Brass Ball Valve)', L: '10.67"' },\n        { code: '6052', d1: '63mm (2 1/2")', d2: '63mm (2 1/2")', label: '6052: 63mm (2 1/2") (Brass Ball Valve)', L: '8.11"' },\n        // Dummy to match replacement if needed: { code: '5052'`
    ).replace(",\\n        // Dummy to match replacement if needed: { code: '5052'", "");
}

if (!content.includes("code: '5552'")) {
    content = content.replace(
        "{ code: '6552'", 
        `{ code: '5552', d1: '50mm (2")', label: '5552: 50mm (2") (1-port Wall Bracket)', L: '6.54"' },\n        { code: '6652', d1: '63mm (2 1/2")', label: '6652: 63mm (2 1/2") (1-port Wall Bracket)', L: '6.3"' },\n        { code: '6552'`
    );
}

fs.writeFileSync('main.js', content, 'utf8');
console.log('Update finished.');
