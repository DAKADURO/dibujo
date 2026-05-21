import DxfParser from 'dxf-parser';
import { setupAnnotations, resizeAnnotations, setToolChangeCallback } from './annotations.js';
import { generateBOM, exportBOMtoCSV } from './bom.js';

const dxfInput = document.getElementById('dxf-input');
const canvas = document.getElementById('dxf-canvas');
const ctx = canvas.getContext('2d');
const loading = document.getElementById('loading');

let dxfData = null;
let viewState = {
    x: 0,
    y: 0,
    scale: 1,
    isDragging: false,
    lastX: 0,
    lastY: 0
};

// ─── Measurement State ───
let measurements = [];
let measurePending = null; // first click point (in DXF coords)
let currentTool = 'pan';
let currentSnapPoint = null;
let currentMousePt = null;

// ─── Cople Array State ───
export const virtualCouplings = [];

// ─── BOM State ───
let bomData = null;

// ─── Setup Canvas ───
function resizeCanvas() {
    const container = document.getElementById('canvas-container');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    
    if (dxfData) drawDxf();
    resizeAnnotations(container.clientWidth, container.clientHeight);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
setupAnnotations();
setToolChangeCallback((tool) => {
    currentTool = tool;
    const container = document.getElementById('canvas-container');
    const infoCople = document.getElementById('info-cople');
    
    if (tool === 'measure') {
        container.classList.add('measure-mode');
    } else {
        container.classList.remove('measure-mode');
    }
    
    if (tool === 'cople' || tool === 'delete') {
        container.classList.add('measure-mode'); // Use crosshair
        if (tool === 'cople' && infoCople) infoCople.style.display = 'flex';
        else if (infoCople) infoCople.style.display = 'none';
    } else {
        if (infoCople) infoCople.style.display = 'none';
    }
});

// ─── File Upload ───
dxfInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    loading.classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = (event) => {
        const fileContent = event.target.result;
        const parser = new DxfParser();
        
        // Monkey-patch ATTRIB support
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
            dxfData = parser.parseSync(fileContent);
            console.log('DXF Parsed:', dxfData);
            fitToScreen();
            drawDxf();
            // Reset measurements and BOM
            measurements = [];
            measurePending = null;
            bomData = null;
        } catch (err) {
            console.error('Error parsing DXF', err);
            alert('Error al leer el archivo DXF.');
        } finally {
            loading.classList.add('hidden');
        }
    };
    reader.readAsText(file);
});

// ─── Coordinate Transforms ───
function screenToDxf(screenX, screenY) {
    const rect = canvas.getBoundingClientRect();
    const cx = screenX - rect.left;
    const cy = screenY - rect.top;
    const dxfX = (cx - viewState.x) / viewState.scale;
    const dxfY = -(cy - viewState.y) / viewState.scale;  // Y is inverted
    return { x: dxfX, y: dxfY };
}

function dxfToScreen(dxfX, dxfY) {
    const sx = dxfX * viewState.scale + viewState.x;
    const sy = -dxfY * viewState.scale + viewState.y;
    return { x: sx, y: sy };
}

// ─── Fit to Screen ───
function fitToScreen() {
    if (!dxfData || !dxfData.entities || dxfData.entities.length === 0) return;
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    for (const ent of dxfData.entities) {
        const points = getEntityPoints(ent);
        for (const p of points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
    }

    if (minX === Infinity) { minX = 0; minY = 0; maxX = 1000; maxY = 1000; }

    const width = maxX - minX;
    const height = maxY - minY;
    const scaleX = canvas.width / width;
    const scaleY = canvas.height / height;
    
    viewState.scale = Math.min(scaleX, scaleY) * 0.9;
    
    const centerX = minX + width / 2;
    const centerY = minY + height / 2;
    viewState.x = canvas.width / 2 - centerX * viewState.scale;
    viewState.y = canvas.height / 2 + centerY * viewState.scale;
}

function getEntityPoints(ent) {
    const pts = [];
    if (ent.vertices) {
        for (const v of ent.vertices) pts.push(v);
    }
    if (ent.center) pts.push(ent.center);
    if (ent.startPoint) pts.push(ent.startPoint);
    if (ent.position) pts.push(ent.position);
    if (ent.endPoint) pts.push(ent.endPoint);
    return pts;
}

// ─── Draw DXF ───
function drawDxf() {
    if (!dxfData) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    
    ctx.translate(viewState.x, viewState.y);
    ctx.scale(viewState.scale, -viewState.scale);
    
    ctx.lineWidth = 1 / viewState.scale;
    
    for (const ent of dxfData.entities) {
        ctx.strokeStyle = getEntityColor(ent);
        drawEntity(ent);
    }
    
    ctx.restore();
    
    // Draw overlays (in screen coords)
    drawCouplings();
    drawMeasurements();
    
    // Update zoom display
    const zoomEl = document.getElementById('zoom-level');
    if (zoomEl) zoomEl.textContent = Math.round(viewState.scale * 100) + '%';
}

// ─── Draw Entity ───
function drawEntity(entity) {
    ctx.beginPath();
    if (entity.type === 'LINE') {
        if (!entity.vertices || entity.vertices.length < 2) return;
        ctx.moveTo(entity.vertices[0].x, entity.vertices[0].y);
        ctx.lineTo(entity.vertices[1].x, entity.vertices[1].y);
    } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
        if (!entity.vertices || entity.vertices.length === 0) return;
        ctx.moveTo(entity.vertices[0].x, entity.vertices[0].y);
        for (let i = 1; i < entity.vertices.length; i++) {
            ctx.lineTo(entity.vertices[i].x, entity.vertices[i].y);
        }
        if (entity.shape) ctx.closePath();
    } else if (entity.type === 'CIRCLE') {
        const cx = entity.center ? entity.center.x : (entity.x || 0);
        const cy = entity.center ? entity.center.y : (entity.y || 0);
        const r = entity.radius || entity.r || 0;
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
    } else if (entity.type === 'ARC') {
        const cx = entity.center ? entity.center.x : (entity.x || 0);
        const cy = entity.center ? entity.center.y : (entity.y || 0);
        const r = entity.radius || entity.r || 0;
        ctx.arc(cx, cy, r, entity.startAngle || 0, entity.endAngle || 0);
    } else if (entity.type === 'ELLIPSE') {
        if (entity.center && entity.majorAxisEndPoint) {
            const cx = entity.center.x;
            const cy = entity.center.y;
            const mx = entity.majorAxisEndPoint.x;
            const my = entity.majorAxisEndPoint.y;
            const majorR = Math.sqrt(mx * mx + my * my);
            const minorR = majorR * (entity.axisRatio || 1);
            const rotation = Math.atan2(my, mx);
            ctx.ellipse(cx, cy, majorR, minorR, rotation, entity.startAngle || 0, entity.endAngle || Math.PI * 2);
        }
    } else if (entity.type === 'SPLINE') {
        const pts = entity.controlPoints || entity.fitPoints || entity.vertices;
        if (pts && pts.length > 0) {
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, pts[i].y);
            }
        }
    } else if (entity.type === 'SOLID' || entity.type === '3DFACE') {
        const pts = entity.points || entity.vertices || [];
        if (pts.length >= 3) {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            ctx.lineTo(pts[1].x, pts[1].y);
            if (pts.length === 4) {
                ctx.lineTo(pts[3].x, pts[3].y);
                ctx.lineTo(pts[2].x, pts[2].y);
            } else {
                ctx.lineTo(pts[2].x, pts[2].y);
            }
            ctx.closePath();
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fill();
        }
    } else if (entity.type === 'TEXT' || entity.type === 'MTEXT' || entity.type === 'ATTRIB') {
        ctx.save();
        
        const alignPt = (entity.halign && entity.halign > 0 && entity.endPoint) ? entity.endPoint : 
                        (entity.startPoint || entity.position || entity);
        const x = alignPt.x || 0;
        const y = alignPt.y || 0;
        
        ctx.translate(x, y);
        if (entity.rotation) {
            ctx.rotate(entity.rotation * Math.PI / 180);
        }
        
        if (entity.halign === 1 || entity.halign === 4) {
            ctx.textAlign = 'center';
        } else if (entity.halign === 2 || entity.halign === 5) {
            ctx.textAlign = 'right';
        } else {
            ctx.textAlign = 'left';
        }
        
        let height = entity.textHeight || entity.height || 12;
        if (height === 0) height = 12;
        
        const FONT_SCALE = 100;
        ctx.scale(1 / FONT_SCALE, -1 / FONT_SCALE);
        
        ctx.font = `${height * FONT_SCALE}px "Inter", sans-serif`;
        ctx.fillStyle = ctx.strokeStyle;
        let txt = entity.text || '';
        
        txt = txt.replace(/\\S(.*?)[#^](.*?);/g, '$1/$2');
        txt = txt.replace(/\\[^;]+;/g, '');
        txt = txt.replace(/\\P/g, ' ');
        txt = txt.replace(/[{}]/g, ''); 
        txt = txt.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±');
        
        ctx.fillText(txt, 0, 0);
        ctx.restore();
    } else if (entity.type === 'INSERT') {
        const block = dxfData.blocks ? dxfData.blocks[entity.name] : null;
        if (block && block.entities) {
            ctx.save();
            const ix = entity.position ? entity.position.x : (entity.x || 0);
            const iy = entity.position ? entity.position.y : (entity.y || 0);
            ctx.translate(ix, iy);
            if (entity.rotation) {
                ctx.rotate(entity.rotation * Math.PI / 180);
            }
            const sx = entity.xScale !== undefined ? entity.xScale : (entity.scaleX !== undefined ? entity.scaleX : 1);
            const sy = entity.yScale !== undefined ? entity.yScale : (entity.scaleY !== undefined ? entity.scaleY : 1);
            ctx.scale(sx, sy);
            
            for (const ent of block.entities) {
                const prevColor = ctx.strokeStyle;
                ctx.strokeStyle = (ent.colorIndex === 0 || ent.colorIndex === 256 || ent.colorIndex === undefined) 
                                   ? prevColor 
                                   : getEntityColor(ent);
                drawEntity(ent);
                ctx.strokeStyle = prevColor;
            }
            ctx.restore();
        }
    } else if (entity.type === 'DIMENSION') {
        const block = dxfData.blocks ? dxfData.blocks[entity.block] : null;
        if (block && block.entities) {
            ctx.save();
            for (const ent of block.entities) {
                const prevColor = ctx.strokeStyle;
                ctx.strokeStyle = (ent.colorIndex === 0 || ent.colorIndex === 256 || ent.colorIndex === undefined) 
                                   ? getEntityColor(entity)
                                   : getEntityColor(ent);
                drawEntity(ent);
                ctx.strokeStyle = prevColor;
            }
            ctx.restore();
        }
    }
    
    if (entity.type !== 'TEXT' && entity.type !== 'MTEXT' && entity.type !== 'ATTRIB' 
        && entity.type !== 'INSERT' && entity.type !== 'DIMENSION'
        && entity.type !== 'SOLID' && entity.type !== '3DFACE') {
        ctx.stroke();
    }
}

// ─── Colors ───
function getEntityColor(entity) {
    let colorInt = entity.color;
    
    if (colorInt === undefined || entity.colorIndex === 256 || entity.colorIndex === 0) {
        if (dxfData.tables && dxfData.tables.layer && dxfData.tables.layer.layers) {
            const layer = dxfData.tables.layer.layers[entity.layer];
            if (layer && layer.color !== undefined) {
                colorInt = layer.color;
            }
        }
    }
    
    if (colorInt !== undefined) {
        let hex = colorInt.toString(16).padStart(6, '0');
        return hex === 'ffffff' ? '#f3f4f6' : '#' + hex;
    }
    
    return '#f3f4f6';
}

// ══════════════════════════════════════════════════
//  MEASUREMENT TOOL
// ══════════════════════════════════════════════════

function drawMeasurements() {
    if (measurements.length === 0 && !measurePending) return;
    
    ctx.save();
    
    const lineWidth = 2;
    const fontSize = 14;
    const crossSize = 8;
    
    // Draw completed measurements
    for (const m of measurements) {
        const p1 = dxfToScreen(m.p1.x, m.p1.y);
        const p2 = dxfToScreen(m.p2.x, m.p2.y);
        
        // Dimension line
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Cross markers
        drawCross(p1.x, p1.y, crossSize, '#06b6d4');
        drawCross(p2.x, p2.y, crossSize, '#06b6d4');
        
        // Distance label
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        
        const label = formatDistance(m.distance);
        
        ctx.font = `bold ${fontSize}px "Inter", sans-serif`;
        const tw = ctx.measureText(label).width;
        
        // Label background
        ctx.fillStyle = 'rgba(6, 182, 212, 0.15)';
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.5)';
        ctx.lineWidth = 1;
        const pad = 6;
        ctx.beginPath();
        ctx.roundRect(midX - tw / 2 - pad, midY - fontSize / 2 - pad, tw + pad * 2, fontSize + pad * 2, 4);
        ctx.fill();
        ctx.stroke();
        
        // Label text
        ctx.fillStyle = '#06b6d4';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, midX, midY);
    }
    
    // Draw pending first point
    if (measurePending && currentMousePt) {
        const sp = dxfToScreen(measurePending.x, measurePending.y);
        drawCross(sp.x, sp.y, crossSize, '#f59e0b');
        
        // Live line to cursor or snap point
        const targetPt = currentSnapPoint || currentMousePt;
        const tp = dxfToScreen(targetPt.x, targetPt.y);
        
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.font = `11px "Inter", sans-serif`;
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('Clic en 2° punto', sp.x + 12, sp.y - 6);
    }
    
    // Draw snap indicator
    if (currentTool === 'measure' && currentSnapPoint) {
        const sp = dxfToScreen(currentSnapPoint.x, currentSnapPoint.y);
        ctx.strokeStyle = '#22c55e'; // Green for snap
        ctx.lineWidth = 2;
        const sSize = 5;
        ctx.strokeRect(sp.x - sSize, sp.y - sSize, sSize * 2, sSize * 2);
    }
    
    ctx.restore();
}

function findClosestSnapPoint(mouseDxfPt, maxScreenDist) {
    if (!dxfData || !dxfData.entities) return null;
    
    let closestPt = null;
    let minDistSq = Infinity;
    const maxDxfDistSq = Math.pow(maxScreenDist / viewState.scale, 2);
    
    for (const ent of dxfData.entities) {
        const points = getEntityPoints(ent);
        for (const p of points) {
            if (p.x === undefined || p.y === undefined) continue;
            const dx = p.x - mouseDxfPt.x;
            const dy = p.y - mouseDxfPt.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < maxDxfDistSq && distSq < minDistSq) {
                minDistSq = distSq;
                closestPt = { x: p.x, y: p.y };
            }
        }
    }
    return closestPt;
}

function drawCross(x, y, size, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();
    
    // Circle around cross
    ctx.beginPath();
    ctx.arc(x, y, size * 0.7, 0, Math.PI * 2);
    ctx.stroke();
}

function formatDistance(d) {
    if (d >= 1000) {
        return (d / 1000).toFixed(2) + ' m';
    } else if (d >= 1) {
        return d.toFixed(2) + ' mm';
    } else {
        return d.toFixed(4) + ' mm';
    }
}

function handleMeasureClick(e) {
    if (currentTool !== 'measure') return;
    
    const rawPt = screenToDxf(e.clientX, e.clientY);
    const pt = currentSnapPoint || rawPt;
    
    if (!measurePending) {
        // First click
        measurePending = pt;
        const infoMeasure = document.getElementById('info-measure');
        if (infoMeasure) infoMeasure.style.display = 'flex';
        const mv = document.getElementById('measure-value');
        if (mv) mv.textContent = 'Selecciona 2° punto...';
    } else {
        // Second click — complete measurement
        const dx = pt.x - measurePending.x;
        const dy = pt.y - measurePending.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        measurements.push({
            p1: { ...measurePending },
            p2: { ...pt },
            distance: distance
        });
        
        const mv = document.getElementById('measure-value');
        if (mv) mv.textContent = formatDistance(distance);
        
        measurePending = null;
    }
    
    drawDxf();
}

// ─── Delete mode logic ───
function handleDeleteClick(e) {
    if (currentTool !== 'delete') return;
    
    // We do collision detection in screen coordinates because measurements/couplings are drawn with fixed screen pixel sizes
    const clickScreen = {
        x: e.clientX - canvas.getBoundingClientRect().left,
        y: e.clientY - canvas.getBoundingClientRect().top
    };
    
    const clickDxf = screenToDxf(e.clientX, e.clientY);
    const maxScreenDistSq = 15 * 15;
    
    let deletedSomething = false;
    
    // 1. Check measurements
    for (let i = measurements.length - 1; i >= 0; i--) {
        const m = measurements[i];
        const p1s = dxfToScreen(m.p1.x, m.p1.y);
        const p2s = dxfToScreen(m.p2.x, m.p2.y);
        
        // Check distance to line segment
        const dSq = distToSegmentSquaredScreen(clickScreen, p1s, p2s);
        
        // Also check distance to text label center
        const midX = (p1s.x + p2s.x) / 2;
        const midY = (p1s.y + p2s.y) / 2;
        const distToCenterSq = (clickScreen.x - midX)**2 + (clickScreen.y - midY)**2;
        
        if (dSq < maxScreenDistSq || distToCenterSq < maxScreenDistSq * 2) {
            measurements.splice(i, 1);
            deletedSomething = true;
            break; // Delete one at a time
        }
    }
    
    if (!deletedSomething) {
        // 2. Check virtual couplings
        for (let i = virtualCouplings.length - 1; i >= 0; i--) {
            const c = virtualCouplings[i];
            const p = dxfToScreen(c.x, c.y);
            const dSq = (clickScreen.x - p.x)**2 + (clickScreen.y - p.y)**2;
            if (dSq < maxScreenDistSq) {
                virtualCouplings.splice(i, 1);
                deletedSomething = true;
                break;
            }
        }
    }
    
    if (deletedSomething) {
        drawDxf();
        // If BOM is open, we could refresh it, but the user has to click it again anyway.
    }
}

function distToSegmentSquaredScreen(p, v, w) {
    const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
    if (l2 === 0) return (p.x - v.x)**2 + (p.y - v.y)**2;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
    return (p.x - proj.x)**2 + (p.y - proj.y)**2;
}

// ══════════════════════════════════════════════════
//  COPLE ARRAY TOOL
// ══════════════════════════════════════════════════

function drawCouplings() {
    if (virtualCouplings.length === 0) return;
    ctx.save();
    
    // Draw couplings as small red rectangles perpendicular to the line
    const width = 10;
    const height = 4;
    
    ctx.fillStyle = '#ef4444'; // Red
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    
    for (const c of virtualCouplings) {
        const p = dxfToScreen(c.x, c.y);
        ctx.save();
        ctx.translate(p.x, p.y);
        // Angle comes from DXF, we need to invert Y for screen coords
        ctx.rotate(-c.angle);
        
        ctx.fillRect(-width/2, -height/2, width, height);
        ctx.strokeRect(-width/2, -height/2, width, height);
        ctx.restore();
    }
    
    ctx.restore();
}

function handleCopleClick(e) {
    if (currentTool !== 'cople') return;
    if (!dxfData || !dxfData.entities) return;
    
    const pt = screenToDxf(e.clientX, e.clientY);
    const maxScreenDist = 15;
    const maxDxfDistSq = Math.pow(maxScreenDist / viewState.scale, 2);
    
    let closestEnt = null;
    let closestDistSq = Infinity;
    
    // Valid layers roughly for piping
    const pipeLayers = ['TUBOS', 'LINEA', 'I2DRUCKL', 'I2HDRUCKL', 'ALIMENTACION', 'AIRE', 'A-CONEX'];
    
    for (const ent of dxfData.entities) {
        if (ent.type !== 'LINE' && ent.type !== 'LWPOLYLINE' && ent.type !== 'POLYLINE') continue;
        
        // Find distance to segment
        let pts = [];
        if (ent.type === 'LINE') {
            pts = ent.vertices || [];
        } else {
            pts = ent.vertices || [];
        }
        
        for (let i = 0; i < pts.length - 1; i++) {
            const dSq = distToSegmentSquared(pt, pts[i], pts[i+1]);
            if (dSq < maxDxfDistSq && dSq < closestDistSq) {
                closestDistSq = dSq;
                closestEnt = ent;
            }
        }
    }
    
    if (closestEnt) {
        const inputDist = parseFloat(document.getElementById('cople-dist').value);
        if (isNaN(inputDist) || inputDist <= 0) {
            alert('Por favor ingresa una distancia válida.');
            return;
        }
        
        let pts = closestEnt.vertices || [];
        let distanceAccum = 0;
        let generated = 0;
        
        for (let i = 0; i < pts.length - 1; i++) {
            const p1 = pts[i];
            const p2 = pts[i+1];
            
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const segLen = Math.sqrt(dx*dx + dy*dy);
            const angle = Math.atan2(dy, dx);
            
            let localD = inputDist - distanceAccum;
            
            while (localD <= segLen) {
                // Generate a coupling
                const cx = p1.x + (dx / segLen) * localD;
                const cy = p1.y + (dy / segLen) * localD;
                
                virtualCouplings.push({
                    x: cx,
                    y: cy,
                    angle: angle,
                    layer: closestEnt.layer
                });
                
                generated++;
                localD += inputDist;
            }
            
            // leftover length
            distanceAccum = segLen - (localD - inputDist);
        }
        
        drawDxf();
    }
}

function distToSegmentSquared(p, v, w) {
    const l2 = distSquared(v, w);
    if (l2 === 0) return distSquared(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return distSquared(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}

function distSquared(v, w) {
    return (v.x - w.x)*(v.x - w.x) + (v.y - w.y)*(v.y - w.y);
}

// ─── Clear measurements ───
document.getElementById('btn-clear-measures')?.addEventListener('click', () => {
    measurements = [];
    measurePending = null;
    virtualCouplings.length = 0; // Clear couplings as well
    const infoMeasure = document.getElementById('info-measure');
    if (infoMeasure) infoMeasure.style.display = 'none';
    drawDxf();
});

// ══════════════════════════════════════════════════
//  TOOL SWITCHING (exported for annotations.js)
// ══════════════════════════════════════════════════

// (Tool switching is handled via setToolChangeCallback)

// ══════════════════════════════════════════════════
//  BOM PANEL
// ══════════════════════════════════════════════════

document.getElementById('btn-bom')?.addEventListener('click', () => {
    if (!dxfData) {
        alert('Carga un archivo DXF primero.');
        return;
    }
    
    bomData = generateBOM(dxfData, virtualCouplings);
    if (!bomData || bomData.summary.length === 0) {
        alert('No se encontraron elementos de tubería en el archivo.');
        return;
    }
    
    renderBOMTable(bomData.summary);
    document.getElementById('bom-panel').classList.remove('hidden');
});

document.getElementById('btn-close-bom')?.addEventListener('click', () => {
    document.getElementById('bom-panel').classList.add('hidden');
});

document.getElementById('btn-bom-csv')?.addEventListener('click', () => {
    if (!bomData) return;
    const csv = exportBOMtoCSV(bomData.summary);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'BOM_Tuberia.csv';
    link.click();
    URL.revokeObjectURL(url);
});

// BOM filter buttons
document.querySelectorAll('.bom-filter').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.bom-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const filter = btn.dataset.filter;
        if (bomData) {
            const filtered = filter === 'all' 
                ? bomData.summary 
                : bomData.summary.filter(r => r.category === filter);
            renderBOMTable(filtered);
        }
    });
});

function renderBOMTable(data) {
    const tbody = document.getElementById('bom-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    data.forEach((row, i) => {
        const tr = document.createElement('tr');
        
        let catClass = 'tuberia';
        if (row.category.includes('Válvula')) catClass = 'valvula';
        else if (row.category.includes('Accesorio')) catClass = 'accesorio';
        else if (row.category.includes('Instrumento')) catClass = 'instrumento';
        
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td><span class="cat-badge ${catClass}">${row.category}</span></td>
            <td>${row.description}</td>
            <td style="color: var(--text-muted); font-size: 11px;">${row.detail}</td>
            <td style="font-weight: 600; font-variant-numeric: tabular-nums;">${
                typeof row.quantity === 'number' && !Number.isInteger(row.quantity) 
                    ? row.quantity.toFixed(2) 
                    : row.quantity
            }</td>
            <td style="color: var(--text-muted);">${row.unit}</td>
        `;
        tbody.appendChild(tr);
    });
    
    const countEl = document.getElementById('bom-count');
    if (countEl) countEl.textContent = `${data.length} elementos`;
}

// ══════════════════════════════════════════════════
//  PAN / ZOOM / CURSOR EVENTS
// ══════════════════════════════════════════════════

canvas.addEventListener('mousedown', (e) => {
    if (currentTool === 'measure') {
        handleMeasureClick(e);
        return;
    }
    if (currentTool === 'cople') {
        handleCopleClick(e);
        return;
    }
    if (currentTool === 'delete') {
        handleDeleteClick(e);
        return;
    }
    if (currentTool === 'pan') {
        viewState.isDragging = true;
        viewState.lastX = e.clientX;
        viewState.lastY = e.clientY;
    }
});

canvas.addEventListener('mousemove', (e) => {
    // Update cursor coordinates
    if (dxfData) {
        const pt = screenToDxf(e.clientX, e.clientY);
        currentMousePt = pt;
        
        const cx = document.getElementById('cursor-x');
        const cy = document.getElementById('cursor-y');
        if (cx) cx.textContent = `X: ${pt.x.toFixed(2)}`;
        if (cy) cy.textContent = `Y: ${pt.y.toFixed(2)}`;
        
        if (currentTool === 'measure') {
            currentSnapPoint = findClosestSnapPoint(pt, 15); // 15px snap radius
            if (!viewState.isDragging) drawDxf(); // Redraw for live line/snap
        }
    }
    
    if (viewState.isDragging) {
        const dx = e.clientX - viewState.lastX;
        const dy = e.clientY - viewState.lastY;
        viewState.x += dx;
        viewState.y += dy;
        viewState.lastX = e.clientX;
        viewState.lastY = e.clientY;
        drawDxf();
    }
});

window.addEventListener('mouseup', () => {
    viewState.isDragging = false;
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomIntensity = 0.1;
    const wheel = e.deltaY < 0 ? 1 : -1;
    const zoom = Math.exp(wheel * zoomIntensity);
    
    const mouseX = e.clientX - canvas.getBoundingClientRect().left;
    const mouseY = e.clientY - canvas.getBoundingClientRect().top;
    
    viewState.x = mouseX - (mouseX - viewState.x) * zoom;
    viewState.y = mouseY - (mouseY - viewState.y) * zoom;
    viewState.scale *= zoom;
    
    drawDxf();
}, { passive: false });
