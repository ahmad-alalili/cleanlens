/**
 * Advanced Camera App — Mobile-First
 * Camera, zoom, wide-angle, freeze+draw, torch, video recording
 * All UI panels are independent fixed elements
 * Recording uses composite canvas to capture everything visible
 */
(function(){
'use strict';

// DOM
const video      = document.getElementById('cameraFeed');
const frzCanvas  = document.getElementById('freezeCanvas');
const drawCanvas = document.getElementById('drawCanvas');
const topBar     = document.getElementById('topBar');
const rightPanel = document.getElementById('rightPanel');
const leftPanel  = document.getElementById('leftPanel');
const bottomBar  = document.getElementById('bottomBar');
const powerBtn   = document.getElementById('powerBtn');
const freezeBtn  = document.getElementById('freezeBtn');
const torchBtn   = document.getElementById('torchBtn');
const hideUIBtn  = document.getElementById('hideUIBtn');
const restoreBtn = document.getElementById('restoreBtn');
const statusBadge= document.getElementById('statusBadge');
const statusText = statusBadge.querySelector('.status-text');
const resText    = document.getElementById('resolutionText');
const camText    = document.getElementById('cameraText');
const errorModal = document.getElementById('errorModal');
const errorTitle = document.getElementById('errorTitle');
const errorMsg   = document.getElementById('errorMessage');
const errorRetry = document.getElementById('errorRetryBtn');
const fsBtn      = document.getElementById('fullscreenBtn');
const fsExpand   = fsBtn.querySelector('.fs-expand');
const fsCompress = fsBtn.querySelector('.fs-compress');
const drawBar    = document.getElementById('drawToolbar');
const colorsEl   = document.getElementById('drawColors');
const sizesEl    = document.getElementById('drawSizes');
const eraserBtn  = document.getElementById('eraserBtn');
const undoBtn    = document.getElementById('undoBtn');
const clearBtn   = document.getElementById('clearDrawBtn');
const unfreezeBtn= document.getElementById('unfreezeBtn');
const zoomSlider = document.getElementById('zoomSlider');
const zoomLabel  = document.getElementById('zoomLabel');
const lensMain   = document.getElementById('lensMain');
const lensWide   = document.getElementById('lensWide');
const settingsBtn  = document.getElementById('settingsBtn');
const settingsPanel= document.getElementById('settingsPanel');
const settingsOverlay= document.getElementById('settingsOverlay');
const settingsClose= document.getElementById('settingsClose');
const qualityOpts = document.getElementById('qualityOptions');
const fpsOpts     = document.getElementById('fpsOptions');

const frzCtx  = frzCanvas.getContext('2d');
const drawCtx = drawCanvas.getContext('2d');

// State
let stream=null, track=null;
let torchOn=false, torchSupported=false;
let uiHidden=false, frozen=false;
let currentLens='main';
let allDevices=[], hasMultiCam=false;

// Drawing
let dColor='#ff3b30', dSize=3, isEraser=false, drawing=false;
let paths=[];
let currentPath=null;
let dHistory=[];

// Settings
let recSettings={
    quality: '1080',
    fps: 30
};

// ═══════════════════════════
//  INIT
// ═══════════════════════════
function init(){
    powerBtn.addEventListener('click', toggleCamera);
    freezeBtn.addEventListener('click', toggleFreeze);
    torchBtn.addEventListener('click', toggleTorch);
    fsBtn.addEventListener('click', toggleFS);
    hideUIBtn.addEventListener('click', hideUI);
    restoreBtn.addEventListener('click', showUI);
    unfreezeBtn.addEventListener('click', unfreeze);
    errorRetry.addEventListener('click', ()=>{ closeErr(); toggleCamera(); });

    lensMain.addEventListener('click', ()=>switchLens('main'));
    lensWide.addEventListener('click', ()=>switchLens('wide'));
    zoomSlider.addEventListener('input', onZoom);

    document.addEventListener('fullscreenchange', updateFSIcon);
    document.addEventListener('webkitfullscreenchange', updateFSIcon);

    // Settings
    settingsBtn.addEventListener('click', openSettings);
    settingsClose.addEventListener('click', closeSettings);
    settingsOverlay.addEventListener('click', closeSettings);
    initSettings();

    // Keys
    document.addEventListener('keydown', e=>{
        if(e.code==='Space'){e.preventDefault(); toggleUI();}
        if(e.code==='Escape'&&!document.fullscreenElement){
            if(settingsPanel.classList.contains('on')){closeSettings(); return;}
            if(frozen) unfreeze(); else if(uiHidden) showUI();
        }
        if(e.code==='KeyF'&&stream&&!frozen){e.preventDefault(); toggleTorch();}
        if(e.code==='KeyG'&&stream){e.preventDefault(); toggleFreeze();}
        if(e.code==='KeyZ'&&(e.ctrlKey||e.metaKey)&&frozen){e.preventDefault(); undo();}
    });

    // Double-tap
    let lastTap=0;
    let wasMultiTouch=false;
    document.addEventListener('touchstart', e=>{
        if(e.touches.length > 1) wasMultiTouch=true;
    }, {passive: true});
    document.addEventListener('touchend', e=>{
        if(e.touches.length > 0) return;
        if(wasMultiTouch){ wasMultiTouch=false; return; }
        if(frozen && (e.target===drawCanvas || drawBar.contains(e.target))) return;
        const now=Date.now();
        if(now-lastTap<300){e.preventDefault(); toggleUI();}
        lastTap=now;
    });

    // Pinch-to-zoom and two-finger swipe
    let lastPinchDist = 0;
    
    let twoFingerStartY = 0;
    let twoFingerStartX = 0;
    let twoFingerSwipeTriggered = false;

    let fzPinchDist = 0;
    let fzPinchCenter = {x:0, y:0};

    document.addEventListener('touchstart', e => {
        if(e.touches.length === 2) {
            if(!frozen) {
                if(!zoomSlider.disabled) {
                    lastPinchDist = Math.hypot(
                        e.touches[0].clientX - e.touches[1].clientX,
                        e.touches[0].clientY - e.touches[1].clientY
                    );
                }
            } else {
                fzPinchDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                fzPinchCenter = {
                    x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                    y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                };
            }
            
            twoFingerStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            twoFingerStartX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            twoFingerSwipeTriggered = false;
        }
    }, {passive: false});

    document.addEventListener('touchmove', e => {
        if(e.touches.length === 2) {
            e.preventDefault(); 
            let currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            let currentX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            
            if(!twoFingerSwipeTriggered && Math.abs(currentX - twoFingerStartX) < 100) {
                if(currentY - twoFingerStartY > 100) {
                    toggleTorch();
                    twoFingerSwipeTriggered = true;
                } else if(twoFingerStartY - currentY > 100) {
                    toggleFreeze();
                    twoFingerSwipeTriggered = true;
                }
            }

            if(!frozen) {
                const currentDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                if(lastPinchDist > 0 && !zoomSlider.disabled && !twoFingerSwipeTriggered) {
                    const delta = currentDist - lastPinchDist;
                    const maxZ = parseFloat(zoomSlider.max) || 10;
                    const minZ = parseFloat(zoomSlider.min) || 1;
                    const sensitivity = (maxZ - minZ) / 300; 
                    let newZoom = parseFloat(zoomSlider.value) + (delta * sensitivity);
                    newZoom = Math.max(minZ, Math.min(newZoom, maxZ));
                    zoomSlider.value = newZoom;
                    onZoom();
                    lastPinchDist = currentDist;
                }
            } else {
                const currentDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                const currentCenter = { x: currentX, y: currentY };
                
                if(fzPinchDist > 0 && !twoFingerSwipeTriggered) {
                    const scaleDiff = currentDist / fzPinchDist;
                    let newScale = freezeScale * scaleDiff;
                    newScale = Math.max(1, Math.min(newScale, 10));
                    
                    const scaleRatio = newScale / freezeScale;
                    
                    freezePanX = currentCenter.x - (currentCenter.x - freezePanX) * scaleRatio;
                    freezePanY = currentCenter.y - (currentCenter.y - freezePanY) * scaleRatio;
                    
                    freezePanX += (currentCenter.x - fzPinchCenter.x);
                    freezePanY += (currentCenter.y - fzPinchCenter.y);
                    
                    freezeScale = newScale;
                    
                    const maxPanX = 0;
                    const minPanX = window.innerWidth * (1 - freezeScale);
                    const maxPanY = 0;
                    const minPanY = window.innerHeight * (1 - freezeScale);
                    
                    freezePanX = Math.max(minPanX, Math.min(maxPanX, freezePanX));
                    freezePanY = Math.max(minPanY, Math.min(maxPanY, freezePanY));
                    
                    updateFreezeTransform();
                    
                    fzPinchDist = currentDist;
                    fzPinchCenter = currentCenter;
                }
            }
        }
    }, {passive: false});

    // Draw toolbar
    colorsEl.addEventListener('click', e=>{
        const s=e.target.closest('.clr-dot'); if(!s) return;
        colorsEl.querySelectorAll('.clr-dot').forEach(x=>x.classList.remove('active'));
        s.classList.add('active');
        dColor=s.dataset.color; isEraser=false; eraserBtn.classList.remove('active');
    });
    sizesEl.addEventListener('click', e=>{
        const b=e.target.closest('.sz-btn'); if(!b) return;
        sizesEl.querySelectorAll('.sz-btn').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        dSize=parseInt(b.dataset.size,10);
    });
    eraserBtn.addEventListener('click', ()=>{
        isEraser=!isEraser; eraserBtn.classList.toggle('active',isEraser);
    });
    undoBtn.addEventListener('click', undo);
    clearBtn.addEventListener('click', clearDraw);

    // Draw: mouse
    drawCanvas.addEventListener('mousedown', onDrawStart);
    drawCanvas.addEventListener('mousemove', onDraw);
    drawCanvas.addEventListener('mouseup', onDrawEnd);
    drawCanvas.addEventListener('mouseleave', onDrawEnd);
    // Draw: touch
    drawCanvas.addEventListener('touchstart', onTouchStart, {passive:false});
    drawCanvas.addEventListener('touchmove', onTouchMove, {passive:false});
    drawCanvas.addEventListener('touchend', onDrawEnd);
    drawCanvas.addEventListener('touchcancel', onDrawEnd);

    checkFS();
    startCam();
}

// ═══════════════════════════
//  CAMERA
// ═══════════════════════════
async function enumCams(){
    try{
        const d=await navigator.mediaDevices.enumerateDevices();
        allDevices=d.filter(x=>x.kind==='videoinput');
        hasMultiCam=allDevices.length>1;
        // Always show wide lens button — user can try it
        // Only hide if we're certain there's exactly 1 camera AND labels are available
        if(allDevices.length===1 && allDevices[0].label){
            lensWide.style.display='none';
        } else {
            lensWide.style.display='';
        }
    }catch(_){}
}

async function toggleCamera(){
    if(stream){if(frozen) unfreeze(); stopCam(); return;}
    await startCam();
}

async function startCam(){
    try{
        const fm = currentLens==='wide' ? {exact:'environment'} : {ideal:'environment'};
        
        // Resolution based on settings
        let targetWidth = 1920, targetHeight = 1080;
        if(recSettings.quality === '720') {
            targetWidth = 1280; targetHeight = 720;
        } else if(recSettings.quality === 'max') {
            targetWidth = 9999; targetHeight = 9999;
        }

        const targetFps = recSettings.fps || 30;

        const c = {
            video:{
                facingMode:fm, 
                width:{ideal:targetWidth}, 
                height:{ideal:targetHeight}, 
                frameRate:{ideal:targetFps, min:Math.min(24, targetFps)}
            },
            audio:false
        };
        if(currentLens==='wide' && hasMultiCam){
            const wd=findWide();
            if(wd){delete c.video.facingMode; c.video.deviceId={exact:wd.deviceId};}
        }

        stream=await navigator.mediaDevices.getUserMedia(c);
        track=stream.getVideoTracks()[0];
        video.srcObject=stream;
        await video.play();

        const caps=track.getCapabilities?track.getCapabilities():{};
        torchSupported=!!caps.torch;

        // Zoom
        if(caps.zoom){
            zoomSlider.min=caps.zoom.min||1;
            zoomSlider.max=caps.zoom.max||1;
            zoomSlider.step=(caps.zoom.max-caps.zoom.min)>20?.5:.1;
            zoomSlider.value=track.getSettings().zoom||caps.zoom.min||1;
            zoomSlider.disabled=false;
            updZoomLbl();
        }else{
            zoomSlider.disabled=true; zoomLabel.textContent='--';
        }

        const s=track.getSettings();
        const fps=s.frameRate?Math.round(s.frameRate):'?';
        resText.textContent=`${s.width||'?'}×${s.height||'?'} ${fps}fps`;
        const lbl=track.label||'';
        camText.textContent=lbl.length>22?lbl.substring(0,20)+'…':(lbl||'الكاميرا الخلفية');

        powerBtn.classList.add('c-on');
        freezeBtn.disabled=false;
        statusBadge.classList.add('on');
        statusText.textContent='الكاميرا مفعّلة';
        // Torch — always enable, some devices don't advertise support
        torchBtn.disabled=false;
        torchSupported=!!caps.torch;

        enumCams();
    }catch(err){
        console.error(err); handleErr(err);
    }
}

function findWide(){
    const w=allDevices.find(d=>/wide|ultra|0\.5|超广/i.test(d.label));
    if(w) return w;
    if(allDevices.length>=3) return allDevices[allDevices.length-1];
    if(allDevices.length===2&&track){
        const cur=track.getSettings().deviceId;
        return allDevices.find(d=>d.deviceId!==cur);
    }
    return null;
}

async function switchLens(lens){
    if(lens===currentLens&&stream) return;
    currentLens=lens;
    lensMain.classList.toggle('active',lens==='main');
    lensWide.classList.toggle('active',lens==='wide');
    if(stream){if(frozen) unfreeze(); stopCam(); await startCam();}
}

let lastZoomTime = 0;
let zoomPending = false;

function onZoom(){
    if(!track) return;
    updZoomLbl();
    
    const now = Date.now();
    const limit = 50;
    if (now - lastZoomTime > limit) {
        lastZoomTime = now;
        try{track.applyConstraints({advanced:[{zoom:parseFloat(zoomSlider.value)}]});}catch(_){}
        zoomPending = false;
    } else if (!zoomPending) {
        zoomPending = true;
        setTimeout(() => {
            if (zoomPending) {
                lastZoomTime = Date.now();
                zoomPending = false;
                try{track.applyConstraints({advanced:[{zoom:parseFloat(zoomSlider.value)}]});}catch(_){}
            }
        }, limit - (now - lastZoomTime));
    }
}
function updZoomLbl(){
    const v=parseFloat(zoomSlider.value);
    zoomLabel.textContent=v>=10?Math.round(v)+'×':v.toFixed(1)+'×';
}

async function toggleTorch(){
    if(!track) return;
    try{
        torchOn=!torchOn;
        await track.applyConstraints({advanced:[{torch:torchOn}]});
        torchSupported=true; // it worked, so it is supported
        torchBtn.classList.toggle('t-on',torchOn);
        if(!frozen) statusText.textContent=torchOn?'الكاميرا + الفلاش':'الكاميرا مفعّلة';
    }catch(e){
        torchOn=false;
        torchBtn.classList.remove('t-on');
        console.warn('Torch not available:', e);
    }
}

function stopCam(){
    if(stream) stream.getTracks().forEach(t=>t.stop());
    stream=null;track=null;torchOn=false;torchSupported=false;
    video.srcObject=null;
    powerBtn.classList.remove('c-on');
    torchBtn.classList.remove('t-on');
    freezeBtn.disabled=true;torchBtn.disabled=true;
    statusBadge.classList.remove('on');
    statusText.textContent='غير متصل';
    resText.textContent='--';camText.textContent='الكاميرا الخلفية';
    zoomSlider.disabled=true;zoomLabel.textContent='--';
}

// ═══════════════════════════
//  FREEZE
// ═══════════════════════════
function toggleFreeze(){
    if(!stream) return;
    frozen ? unfreeze() : freeze();
}

let torchWasOnBeforeFreeze = false;
let freezeScale = 1;
let freezePanX = 0;
let freezePanY = 0;

function updateFreezeTransform() {
    const transform = `translate(${freezePanX}px, ${freezePanY}px) scale(${freezeScale})`;
    frzCanvas.style.transformOrigin = '0 0';
    drawCanvas.style.transformOrigin = '0 0';
    frzCanvas.style.transform = transform;
    drawCanvas.style.transform = transform;
}

function freeze(){
    if(!stream||!track) return;
    const dpr = window.devicePixelRatio || 1;
    const sw = window.innerWidth;
    const sh = window.innerHeight;
    const cw = sw * dpr;
    const ch = sh * dpr;

    // Set both canvases to screen pixel size
    frzCanvas.width = cw; frzCanvas.height = ch;
    frzCanvas.style.width = sw + 'px';
    frzCanvas.style.height = sh + 'px';

    drawCanvas.width = cw; drawCanvas.height = ch;
    drawCanvas.style.width = sw + 'px';
    drawCanvas.style.height = sh + 'px';

    // Draw video frame with "cover" fit onto freeze canvas
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const vAspect = vw / vh;
    const sAspect = cw / ch;
    let dx, dy, dw, dh;
    if (vAspect > sAspect) {
        // Video is wider — crop sides
        dh = ch; dw = ch * vAspect;
        dx = (cw - dw) / 2; dy = 0;
    } else {
        // Video is taller — crop top/bottom
        dw = cw; dh = cw / vAspect;
        dx = 0; dy = (ch - dh) / 2;
    }
    frzCtx.drawImage(video, dx, dy, dw, dh);

    // Scale draw context for DPR so strokes are crisp
    drawCtx.clearRect(0, 0, cw, ch);
    drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Show
    frzCanvas.classList.add('on');
    drawCanvas.classList.add('on');
    drawBar.classList.add('on');

    topBar.classList.add('hide');
    rightPanel.classList.add('hide');
    leftPanel.classList.add('hide');
    bottomBar.classList.add('hide');

    frozen=true;
    freezeBtn.classList.add('f-on');
    dHistory=[]; paths=[]; currentPath=null; drawing=false;

    torchWasOnBeforeFreeze = torchOn;
    if(torchOn) {
        torchOn = false;
        try { track.applyConstraints({advanced:[{torch:false}]}); } catch(e){}
        torchBtn.classList.remove('t-on');
    }
    
    freezeScale = 1;
    freezePanX = 0;
    freezePanY = 0;
    updateFreezeTransform();
}

function unfreeze(){
    frzCanvas.classList.remove('on');
    drawCanvas.classList.remove('on');
    drawBar.classList.remove('on');

    // Restore UI
    topBar.classList.remove('hide');
    rightPanel.classList.remove('hide');
    leftPanel.classList.remove('hide');
    bottomBar.classList.remove('hide');

    frozen=false;
    freezeBtn.classList.remove('f-on');
    
    if(torchWasOnBeforeFreeze && !torchOn) {
        torchOn = true;
        try { track.applyConstraints({advanced:[{torch:true}]}); } catch(e){}
        torchBtn.classList.add('t-on');
    }
    
    if(stream) statusText.textContent=torchOn?'الكاميرا + الفلاش':'الكاميرا مفعّلة';
    drawCtx.setTransform(1,0,0,1,0,0);
    drawCtx.clearRect(0,0,drawCanvas.width,drawCanvas.height);
    dHistory=[]; paths=[]; currentPath=null;
}

// ═══════════════════════════
//  DRAWING
// ═══════════════════════════
function pos(e){
    const r = drawCanvas.getBoundingClientRect();
    const scaleX = drawCanvas.offsetWidth / r.width;
    const scaleY = drawCanvas.offsetHeight / r.height;
    return { 
        x: (e.clientX - r.left) * scaleX, 
        y: (e.clientY - r.top) * scaleY 
    };
}

function redrawAll() {
    const dpr = window.devicePixelRatio || 1;
    drawCtx.setTransform(1,0,0,1,0,0);
    drawCtx.clearRect(0,0,drawCanvas.width,drawCanvas.height);
    drawCtx.setTransform(dpr,0,0,dpr,0,0);

    for(const path of paths) {
        drawCtx.globalCompositeOperation = 'source-over';
        drawCtx.strokeStyle = path.color;
        drawCtx.lineWidth = path.size;
        drawCtx.lineCap = 'round';
        drawCtx.lineJoin = 'round';

        if(path.points.length === 1) {
            drawCtx.beginPath();
            drawCtx.arc(path.points[0].x, path.points[0].y, path.size/2, 0, Math.PI*2);
            drawCtx.fillStyle = path.color;
            drawCtx.fill();
        } else {
            drawCtx.beginPath();
            drawCtx.moveTo(path.points[0].x, path.points[0].y);
            for(let i=1; i<path.points.length; i++){
                drawCtx.lineTo(path.points[i].x, path.points[i].y);
            }
            drawCtx.stroke();
        }
    }
}

function erasePathAt(p) {
    const threshold = 15; // px
    let erased = false;
    for(let i=paths.length-1; i>=0; i--) {
        const path = paths[i];
        for(let pt of path.points) {
            const dx = pt.x - p.x;
            const dy = pt.y - p.y;
            if(dx*dx + dy*dy < threshold*threshold) {
                paths.splice(i, 1);
                erased = true;
                break;
            }
        }
        if(erased) break;
    }
    if(erased) redrawAll();
}

function setupBrush(){
    drawCtx.globalCompositeOperation='source-over';
    drawCtx.strokeStyle = currentPath ? currentPath.color : dColor;
    drawCtx.lineWidth = currentPath ? currentPath.size : dSize;
    drawCtx.lineCap='round';
    drawCtx.lineJoin='round';
}

function onDrawStart(e){
    if(!frozen) return;
    const p=pos(e);

    dHistory.push(JSON.stringify(paths));
    if(dHistory.length>50) dHistory.shift();

    if(isEraser) {
        erasePathAt(p);
        drawing = true; // allow drag to erase
    } else {
        drawing=true;
        currentPath = { color: dColor, size: dSize, points: [p] };
        paths.push(currentPath);

        setupBrush();
        drawCtx.beginPath();
        drawCtx.arc(p.x, p.y, dSize/2, 0, Math.PI*2);
        drawCtx.fillStyle = dColor;
        drawCtx.fill();
    }
}

function onDraw(e){
    if(!drawing||!frozen) return;
    const p=pos(e);
    if(isEraser) {
        erasePathAt(p);
    } else {
        currentPath.points.push(p);
        setupBrush();

        const len=currentPath.points.length;
        if(len < 3){
            drawCtx.beginPath();
            drawCtx.moveTo(currentPath.points[len-2].x, currentPath.points[len-2].y);
            drawCtx.lineTo(p.x, p.y);
            drawCtx.stroke();
        } else {
            const a=currentPath.points[len-3];
            const b=currentPath.points[len-2];
            const c=currentPath.points[len-1];
            const mx1=(a.x+b.x)/2, my1=(a.y+b.y)/2;
            const mx2=(b.x+c.x)/2, my2=(b.y+c.y)/2;
            drawCtx.beginPath();
            drawCtx.moveTo(mx1, my1);
            drawCtx.quadraticCurveTo(b.x, b.y, mx2, my2);
            drawCtx.stroke();
        }
    }
}

function onDrawEnd(){
    drawing=false;
    currentPath=null;
}

let singleTouchPathAdded = false;

function onTouchStart(e){
    if(!frozen) return; 
    if(e.touches.length > 1) {
        if(drawing) {
            onDrawEnd();
            if(singleTouchPathAdded) {
                undo();
                singleTouchPathAdded = false;
            }
        }
        return;
    }
    e.preventDefault(); 
    singleTouchPathAdded = true;
    onDrawStart(e.touches[0]);
}
function onTouchMove(e){
    if(!frozen) return; 
    if(e.touches.length > 1) return;
    if(!drawing) return; 
    e.preventDefault(); 
    singleTouchPathAdded = false;
    onDraw(e.touches[0]);
}

function undo(){
    if(!dHistory.length) return;
    paths = JSON.parse(dHistory.pop());
    redrawAll();
}

function clearDraw(){
    dHistory.push(JSON.stringify(paths));
    paths = [];
    redrawAll();
}

// ═══════════════════════════
//  UI TOGGLE
// ═══════════════════════════
function toggleUI(){uiHidden?showUI():hideUI();}
function hideUI(){
    topBar.classList.add('hide');
    rightPanel.classList.add('hide');
    leftPanel.classList.add('hide');
    bottomBar.classList.add('hide');
    if(frozen) drawBar.classList.remove('on');
    restoreBtn.classList.add('on');
    uiHidden=true;
    setTimeout(()=>{if(uiHidden) restoreBtn.style.opacity='.3';},3000);
}
function showUI(){
    if(!frozen){
        topBar.classList.remove('hide');
        rightPanel.classList.remove('hide');
        leftPanel.classList.remove('hide');
        bottomBar.classList.remove('hide');
    }
    if(frozen) drawBar.classList.add('on');
    restoreBtn.classList.remove('on');
    restoreBtn.style.opacity='';
    uiHidden=false;
}

// ═══════════════════════════
//  FULLSCREEN
// ═══════════════════════════
function isFullscreen(){return !!(document.fullscreenElement||document.webkitFullscreenElement||document.msFullscreenElement)}
function toggleFS(){
    if(!isFullscreen()){
        const el=document.documentElement;
        if(el.requestFullscreen) el.requestFullscreen().catch(()=>{});
        else if(el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        else if(el.msRequestFullscreen) el.msRequestFullscreen();
        else if(video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    }else{
        if(document.exitFullscreen) document.exitFullscreen().catch(()=>{});
        else if(document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if(document.msExitFullscreen) document.msExitFullscreen();
    }
}
function updateFSIcon(){
    const f=isFullscreen();
    fsExpand.style.display=f?'none':'';
    fsCompress.style.display=f?'':'none';
    fsBtn.classList.toggle('on',f);
    statusBadge.style.display=f?'none':'';
}
function checkFS(){
    const el=document.documentElement;
    if(!(el.requestFullscreen||el.webkitRequestFullscreen||el.msRequestFullscreen||video.webkitEnterFullscreen))
        fsBtn.style.display='none';
}

// ═══════════════════════════
//  ERROR
// ═══════════════════════════
function handleErr(err){
    let t='خطأ في الكاميرا', m='حدث خطأ غير متوقع.';
    if(err.name==='NotAllowedError'){t='الإذن مطلوب';m='يرجى السماح بالوصول إلى الكاميرا.';}
    else if(err.name==='NotFoundError'){t='لا توجد كاميرا';m='لم يتم اكتشاف كاميرا.';}
    else if(err.name==='NotReadableError'){t='الكاميرا مشغولة';m='أغلق التطبيقات الأخرى.';}
    else if(err.name==='OverconstrainedError'){t='خطأ';m='الكاميرا لا تدعم الإعدادات المطلوبة.';}
    errorTitle.textContent=t; errorMsg.textContent=m;
    errorModal.classList.add('on');
}
function closeErr(){errorModal.classList.remove('on');}



// ═══════════════════════════
//  SETTINGS
// ═══════════════════════════
function loadSettings(){
    try{
        const saved=localStorage.getItem('recSettings');
        if(saved) recSettings={...recSettings, ...JSON.parse(saved)};
    }catch(_){}
}

function saveSettings(){
    try{localStorage.setItem('recSettings', JSON.stringify(recSettings));}catch(_){}
}

function initSettings(){
    loadSettings();

    // Apply saved state to buttons
    applyOptState(qualityOpts, recSettings.quality);
    applyOptState(fpsOpts, String(recSettings.fps));

    // Event listeners
    qualityOpts.addEventListener('click', async e=>{
        const b=e.target.closest('.opt-btn'); if(!b||b.disabled) return;
        selectOpt(qualityOpts, b);
        recSettings.quality=b.dataset.val;
        saveSettings();
        if(stream){
            if(frozen) unfreeze();
            stopCam();
            await startCam();
        }
    });
    fpsOpts.addEventListener('click', async e=>{
        const b=e.target.closest('.opt-btn'); if(!b||b.disabled) return;
        selectOpt(fpsOpts, b);
        recSettings.fps=parseInt(b.dataset.val,10);
        saveSettings();
        if(stream){
            if(frozen) unfreeze();
            stopCam();
            await startCam();
        }
    });
}

function applyOptState(container, val){
    container.querySelectorAll('.opt-btn').forEach(b=>{
        b.classList.toggle('active', b.dataset.val===val);
    });
}

function selectOpt(container, btn){
    container.querySelectorAll('.opt-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
}

function openSettings(){
    settingsOverlay.classList.add('on');
    settingsPanel.classList.add('on');
}

function closeSettings(){
    settingsOverlay.classList.remove('on');
    settingsPanel.classList.remove('on');
}

window.addEventListener('beforeunload', ()=>{
    stopCam();
});
init();
})();
