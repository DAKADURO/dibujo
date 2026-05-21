// ============================================================
// bom.js — Bill of Materials extractor for DXF piping schematics
// ============================================================

// Known valve block names → human-readable types
const VALVE_BLOCK_MAP = {
    'pvc': 'Válvula de Compuerta',
    'pvr': 'Válvula de Retención',
    'pvm': 'Válvula Mariposa',
    'prc': 'Válvula de Presión',
    'ptb': 'Trampa de Bola',
    'ptc': 'Trampa de Cubeta',
    'ptu': 'Trampa Termodinámica',
    'pinlc': 'Válvula de Aguja',
    'pvc-nc': 'Válvula de Compuerta NC',
    'VALVCOM': 'Válvula de Compuerta (COM)',
    'VALVCOM1': 'Válvula de Compuerta (COM1)',
    'CHECKBR': 'Check Valve (Bronce)',
    'JUNTA_FLEXIBLE': 'Junta Flexible',
    'Gs': 'Válvula de Globo',
};

// Layers considered "pipe" layers for length calculation
const PIPE_LAYERS = [
    'TUBOS', 'LINEA', 'I2DRUCKL', 'I2HDRUCKL', 'I2HYDR_VL', 'I2HYDR_RL',
    'I2FORM_VL', 'ALIMENTACION', 'AIRE', 'A-CONEX',
    'ALPLA_low_pressure_PN16', 'ALPLA_CO_low_pressure_PN16',
    'ALPLA_CO_mould_cool_supply', 'ALPLA_CO_mould_cool_return',
    'ALPLA_CO_machine_cool_supply', 'ALPLA_CO_machine_cool_return',
    'ALPLA_CO_condensate',
];

// Layers that contain instrumentation inserts
const INSTRUMENT_LAYERS = ['INSTRUMENTACION', 'INT_Armaturen'];

// Pipe spec text layers
const TEXT_LAYERS = ['TEXTO', 'TEXTO2', 'T2TXT03', 'T4TXT07', 'FORTLUFT'];

/**
 * Main BOM generation function.
 * @param {Object} dxfData — parsed DXF data from dxf-parser
 * @param {Array} virtualCouplings — virtual couplings created by the matrix tool
 * @returns {Object} { valves, fittings, instruments, pipeSpecs, pipeLengths }
 */
export function generateBOM(dxfData, virtualCouplings = []) {
    if (!dxfData || !dxfData.entities) return null;

    const result = {
        valves: [],        // { type, blockName, layer, count, size }
        fittings: [],      // { description, layer, count }
        instruments: [],   // { tag, type, layer }
        pipeSpecs: [],     // { text, layer, diameter }
        pipeLengths: [],   // { layer, totalLength }
        summary: [],       // aggregated rows for UI table
    };

    // ── 1. Valves & Instruments (from INSERT entities) ──
    const insertCounts = {};
    const instrumentList = [];

    for (const ent of dxfData.entities) {
        if (ent.type !== 'INSERT') continue;
        const name = ent.name;
        if (!name || name.startsWith('*')) continue;  // skip anonymous blocks

        // Check if it's a known valve
        const upperName = name.toUpperCase();
        let matched = false;
        for (const [blockKey, valveType] of Object.entries(VALVE_BLOCK_MAP)) {
            if (name === blockKey || upperName === blockKey.toUpperCase()) {
                const key = blockKey;
                if (!insertCounts[key]) {
                    insertCounts[key] = { type: valveType, blockName: key, layer: ent.layer, count: 0 };
                }
                insertCounts[key].count++;
                matched = true;
                break;
            }
        }

        // If on an instrument layer, treat as instrument
        if (!matched && INSTRUMENT_LAYERS.some(l => ent.layer === l)) {
            instrumentList.push({ tag: name, type: 'Instrumento', layer: ent.layer });
        }
    }
    result.valves = Object.values(insertCounts);

    // ── 2. ATTRIBs (block attribute labels like PSV 02, PI 02) ──
    const attribMap = {};
    for (const ent of dxfData.entities) {
        if (ent.type !== 'ATTRIB') continue;
        const txt = (ent.text || '').trim();
        if (!txt) continue;
        const key = `${txt}|${ent.layer}`;
        if (!attribMap[key]) {
            attribMap[key] = { tag: txt, layer: ent.layer, count: 0 };
        }
        attribMap[key].count++;
    }
    result.instruments = Object.values(attribMap);

    // ── 3. Pipe fittings from TEXT entities ──
    const fittingPatterns = [
        { regex: /Red\.\s*/i, type: 'Reducción' },
        { regex: /Winkel/i, type: 'Codo' },
        { regex: /Nippel/i, type: 'Niple' },
        { regex: /Muffe/i, type: 'Mufa / Copla' },
        { regex: /T-St/i, type: 'Tee' },
        { regex: /Flansch/i, type: 'Brida' },
        { regex: /Bogen/i, type: 'Curva' },
    ];

    const fittingCounts = {};
    const pipeSpecSet = {};

    for (const ent of dxfData.entities) {
        if (ent.type !== 'TEXT' && ent.type !== 'MTEXT' && ent.type !== 'ATTRIB') continue;
        let txt = (ent.text || '').trim();
        if (!txt) continue;

        // Clean MTEXT formatting
        txt = txt.replace(/\\S(.*?)[#^](.*?);/g, '$1/$2');
        txt = txt.replace(/\\[^;]+;/g, '');
        txt = txt.replace(/\\P/g, ' ');
        txt = txt.replace(/[{}]/g, '');
        txt = txt.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±');
        txt = txt.trim();

        // Check for fittings
        let isFitting = false;
        for (const pat of fittingPatterns) {
            if (pat.regex.test(txt)) {
                const key = `${pat.type}: ${txt}`;
                if (!fittingCounts[key]) {
                    fittingCounts[key] = { description: txt, type: pat.type, layer: ent.layer, count: 0 };
                }
                fittingCounts[key].count++;
                isFitting = true;
                break;
            }
        }

        // Check for pipe specs (diameters like Ø 4", 2"Ø, 1/2", etc.)
        if (!isFitting && (/[Øø]/.test(txt) || /\d+[""]/.test(txt) || /\d+\s*mm/.test(txt))) {
            if (TEXT_LAYERS.includes(ent.layer)) {
                const key = txt;
                if (!pipeSpecSet[key]) {
                    pipeSpecSet[key] = { text: txt, layer: ent.layer, count: 0 };
                }
                pipeSpecSet[key].count++;
            }
        }
    }
    // Add virtual couplings
    if (virtualCouplings && virtualCouplings.length > 0) {
        fittingCounts['VirtualCople'] = { 
            description: 'Cople (Matriz Virtual)', 
            type: 'Cople', 
            layer: 'Virtual', 
            count: virtualCouplings.length 
        };
    }
    
    result.fittings = Object.values(fittingCounts);
    result.pipeSpecs = Object.values(pipeSpecSet);

    // ── 4. Pipe lengths from LINE / LWPOLYLINE / POLYLINE ──
    const lengthByLayer = {};

    for (const ent of dxfData.entities) {
        if (!PIPE_LAYERS.includes(ent.layer)) continue;

        let segLength = 0;

        if (ent.type === 'LINE' && ent.vertices && ent.vertices.length >= 2) {
            segLength = dist(ent.vertices[0], ent.vertices[1]);
        } else if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && ent.vertices) {
            for (let i = 1; i < ent.vertices.length; i++) {
                segLength += dist(ent.vertices[i - 1], ent.vertices[i]);
            }
        }

        if (segLength > 0) {
            if (!lengthByLayer[ent.layer]) lengthByLayer[ent.layer] = 0;
            lengthByLayer[ent.layer] += segLength;
        }
    }

    result.pipeLengths = Object.entries(lengthByLayer).map(([layer, totalLength]) => ({
        layer,
        totalLength: Math.round(totalLength * 100) / 100,
    }));

    // ── 5. Build unified summary ──
    const summary = [];

    // Valves
    for (const v of result.valves) {
        summary.push({ category: 'Válvula', description: v.type, detail: v.blockName, quantity: v.count, unit: 'pz' });
    }
    // Fittings
    for (const f of result.fittings) {
        summary.push({ category: 'Accesorio', description: f.type, detail: f.description, quantity: f.count, unit: 'pz' });
    }
    // Pipe specs
    for (const p of result.pipeSpecs) {
        summary.push({ category: 'Tubería (spec)', description: p.text, detail: `Capa: ${p.layer}`, quantity: p.count, unit: 'ref' });
    }
    // Pipe lengths
    for (const l of result.pipeLengths) {
        summary.push({ category: 'Tubería (long.)', description: l.layer, detail: '', quantity: l.totalLength, unit: 'mm' });
    }
    // Instruments
    for (const inst of result.instruments) {
        summary.push({ category: 'Instrumento', description: inst.tag, detail: `Capa: ${inst.layer}`, quantity: inst.count, unit: 'pz' });
    }

    result.summary = summary;
    return result;
}

function dist(a, b) {
    const dx = (a.x || 0) - (b.x || 0);
    const dy = (a.y || 0) - (b.y || 0);
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Export summary to CSV string
 */
export function exportBOMtoCSV(summary) {
    const header = 'Categoría,Descripción,Detalle,Cantidad,Unidad\n';
    const rows = summary.map(r =>
        `"${r.category}","${r.description}","${r.detail}","${r.quantity}","${r.unit}"`
    ).join('\n');
    return header + rows;
}
