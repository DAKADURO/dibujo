import fs from 'fs';
import DxfParser from 'dxf-parser';

const fileContent = fs.readFileSync('h:/DIBUJO/MX, SBM Toluca-schematic-cooling_comp-air_ 2026.dxf', 'utf-8');
const parser = new DxfParser();

if (parser._entityHandlers && parser._entityHandlers['TEXT']) {
    parser._entityHandlers['ATTRIB'] = {
        ForEntityName: 'ATTRIB',
        parseEntity: function(scanner, curr) {
            const ent = parser._entityHandlers['TEXT'].parseEntity(scanner, curr);
            ent.type = 'ATTRIB';
            return ent;
        }
    };
}

try {
    const dxfData = parser.parseSync(fileContent);
    
    // Get all layer names
    const layers = dxfData.tables?.layer?.layers;
    if (layers) {
        console.log('=== ALL LAYERS ===');
        Object.keys(layers).forEach(k => {
            console.log(`  ${k}`);
        });
    }
    
    // Gather text entities that look like pipe specs (contain " or Ø or mm)
    const allTexts = dxfData.entities.filter(e => 
        (e.type === 'TEXT' || e.type === 'MTEXT' || e.type === 'ATTRIB') && e.text
    );
    
    console.log('\n=== TEXTS WITH PIPE/SIZE INFO ===');
    const pipeTexts = allTexts.filter(t => 
        /[Øø"]/.test(t.text) || /\d+\s*mm/.test(t.text) || /m3\/h/.test(t.text) || 
        /red\./i.test(t.text) || /SS/.test(t.text) || /Kg\/cm/.test(t.text) ||
        /\d+"/.test(t.text)
    );
    pipeTexts.slice(0, 20).forEach(t => {
        let txt = t.text.replace(/\\[^;]+;/g, '').replace(/\\P/g, ' ').replace(/[{}]/g, '');
        txt = txt.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±');
        console.log(`  Layer: ${t.layer} | Text: "${txt}"`);
    });
    
    // Entity type counts
    const typeCounts = {};
    dxfData.entities.forEach(e => {
        typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
    });
    console.log('\n=== ENTITY TYPE COUNTS ===');
    Object.entries(typeCounts).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => {
        console.log(`  ${k}: ${v}`);
    });
    
    // Block names
    if (dxfData.blocks) {
        const blockNames = Object.keys(dxfData.blocks).filter(n => !n.startsWith('*'));
        console.log('\n=== NAMED BLOCKS (non-anonymous) ===');
        blockNames.slice(0, 30).forEach(n => console.log(`  ${n}`));
    }
    
} catch (err) {
    console.error('Error parsing:', err.message);
}
