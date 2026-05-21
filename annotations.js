// ============================================================
// annotations.js — Fabric.js annotation layer + tool switching
// ============================================================

let fCanvas;
let currentMode = 'pan';

// Callback to notify main.js of tool changes (set externally to avoid circular imports)
let onToolChangeCallback = null;

export function setToolChangeCallback(cb) {
    onToolChangeCallback = cb;
}

export function setupAnnotations() {
    const canvasEl = document.getElementById('annotation-canvas');
    fCanvas = new fabric.Canvas(canvasEl, {
        isDrawingMode: false,
        selection: false,
        hoverCursor: 'default'
    });

    fCanvas.setBackgroundColor('transparent', fCanvas.renderAll.bind(fCanvas));

    // ─── Tool Buttons ───
    document.getElementById('btn-pan').addEventListener('click', (e) => setMode('pan', e.target.closest('.btn')));
    document.getElementById('btn-measure').addEventListener('click', (e) => setMode('measure', e.target.closest('.btn')));
    document.getElementById('btn-cople').addEventListener('click', (e) => setMode('cople', e.target.closest('.btn')));
    document.getElementById('btn-draw').addEventListener('click', (e) => setMode('draw', e.target.closest('.btn')));
    document.getElementById('btn-rect').addEventListener('click', (e) => setMode('rect', e.target.closest('.btn')));
    document.getElementById('btn-text').addEventListener('click', (e) => setMode('text', e.target.closest('.btn')));
    
    document.getElementById('btn-delete').addEventListener('click', (e) => setMode('delete', e.target.closest('.btn')));
    document.getElementById('btn-sum').addEventListener('click', (e) => setMode('sum', e.target.closest('.btn')));
    
    // Allow deleting Fabric objects with Backspace/Delete keys
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            const activeObjects = fCanvas.getActiveObjects();
            if (activeObjects.length) {
                // Prevent browser navigation for Backspace
                if (e.key === 'Backspace' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                }
                fCanvas.discardActiveObject();
                activeObjects.forEach((obj) => fCanvas.remove(obj));
            }
        }
    });

    document.getElementById('btn-export').addEventListener('click', () => {
        const dxfCanvas = document.getElementById('dxf-canvas');
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = dxfCanvas.width;
        tempCanvas.height = dxfCanvas.height;
        const ctx = tempCanvas.getContext('2d');
        
        ctx.fillStyle = '#0f1117';
        ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        ctx.drawImage(dxfCanvas, 0, 0);
        ctx.drawImage(fCanvas.getElement(), 0, 0);
        
        const link = document.createElement('a');
        link.download = 'plano_anotado.png';
        link.href = tempCanvas.toDataURL('image/png');
        link.click();
    });

    // ─── Shape drawing (Rect) ───
    let isDrawingShape = false;
    let shapeStart = null;
    let currentShape = null;

    fCanvas.on('mouse:down', (o) => {
        if (currentMode === 'rect') {
            isDrawingShape = true;
            const pointer = fCanvas.getPointer(o.e);
            shapeStart = { x: pointer.x, y: pointer.y };
            currentShape = new fabric.Rect({
                left: pointer.x,
                top: pointer.y,
                width: 0,
                height: 0,
                fill: 'transparent',
                stroke: '#ef4444',
                strokeWidth: 3,
                strokeDashArray: [5, 5],
                selectable: true
            });
            fCanvas.add(currentShape);
        } else if (currentMode === 'text') {
            const pointer = fCanvas.getPointer(o.e);
            const text = new fabric.IText('Nota...', {
                left: pointer.x,
                top: pointer.y,
                fontFamily: 'Inter',
                fill: '#10b981',
                fontSize: 24,
                fontWeight: 'bold'
            });
            fCanvas.add(text);
            fCanvas.setActiveObject(text);
            text.enterEditing();
            text.selectAll();
            setMode('pan', document.getElementById('btn-pan'));
        }
    });

    fCanvas.on('mouse:move', (o) => {
        if (!isDrawingShape) return;
        const pointer = fCanvas.getPointer(o.e);
        
        if (currentMode === 'rect') {
            if (pointer.x < shapeStart.x) currentShape.set({ left: pointer.x });
            if (pointer.y < shapeStart.y) currentShape.set({ top: pointer.y });
            currentShape.set({
                width: Math.abs(pointer.x - shapeStart.x),
                height: Math.abs(pointer.y - shapeStart.y)
            });
            fCanvas.renderAll();
        }
    });

    fCanvas.on('mouse:up', () => {
        if (isDrawingShape) {
            isDrawingShape = false;
            if (currentShape && currentShape.width < 5 && currentShape.height < 5) {
                fCanvas.remove(currentShape);
            } else if (currentShape) {
                currentShape.setCoords();
            }
            currentShape = null;
        }
    });
}

export function setMode(mode, btnElement) {
    currentMode = mode;
    
    // Notify main.js via callback (no circular import)
    if (onToolChangeCallback) onToolChangeCallback(mode);
    
    // UI Update
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');

    // Fabric state update
    fCanvas.isDrawingMode = (mode === 'draw');
    fCanvas.selection = (mode === 'pan');

    const fabricWrapper = document.querySelector('.canvas-container');
    
    if (mode === 'draw') {
        fCanvas.freeDrawingBrush.color = '#eab308';
        fCanvas.freeDrawingBrush.width = 4;
        if (fabricWrapper) fabricWrapper.style.pointerEvents = 'auto';
    } else if (mode === 'pan' || mode === 'measure' || mode === 'cople' || mode === 'delete' || mode === 'sum') {
        // In pan/measure/cople/delete/sum mode, let clicks pass through to the DXF canvas
        fCanvas.forEachObject(obj => obj.set('selectable', mode === 'pan'));
        if (fabricWrapper) fabricWrapper.style.pointerEvents = 'none';
    } else {
        fCanvas.forEachObject(obj => obj.set('selectable', false));
        if (fabricWrapper) fabricWrapper.style.pointerEvents = 'auto';
    }
}

export function resizeAnnotations(width, height) {
    if (fCanvas) {
        fCanvas.setWidth(width);
        fCanvas.setHeight(height);
        fCanvas.renderAll();
    }
}
