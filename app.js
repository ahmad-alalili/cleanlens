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
const zoomSlider = document.getElementById('zoomSlider');
const switchCamBtn = document.getElementById('switchCamBtn');
const settingsBtn  = document.getElementById('settingsBtn');
const settingsPanel= document.getElementById('settingsPanel');
const settingsOverlay= document.getElementById('settingsOverlay');
const settingsClose= document.getElementById('settingsClose');
const qualityOpts = document.getElementById('qualityOptions');
const fpsOpts     = document.getElementById('fpsOptions');
const warningOpts = document.getElementById('warningOptions');

const frzCtx  = frzCanvas.getContext('2d');
const drawCtx = drawCanvas.getContext('2d');

// State
let stream=null, track=null;
let torchOn=false, torchSupported=false;
let uiHidden=false, frozen=false;
let currentCamIndex=0;
let allCameras=[];

// Drawing
let dColor='#ff3b30', dSize=3, isEraser=false, drawing=false;
let paths=[];
let currentPath=null;
let dHistory=[];

// Settings
let recSettings={
    quality: '1080',
    fps: 30,
    warnings: 'on'
};

// ═══════════════════════════
//  INIT
// ═══════════════════════════
function init(){
    powerBtn.addEventListener('click', toggleCamera);
    freezeBtn.addEventListener('click', toggleFreeze);
    torchBtn.addEventListener('click', toggleTorch);
    switchCamBtn.addEventListener('click', toggleCameraLens);
    fsBtn.addEventListener('click', toggleFS);
    hideUIBtn.addEventListener('click', hideUI);
    restoreBtn.addEventListener('click', showUI);
    unfreezeBtn.addEventListener('click', unfreeze);
    errorRetry.addEventListener('click', ()=>{ closeErr(); toggleCamera(); });

    document.getElementById('lensRow').addEventListener('click', (e) => {
        const btn = e.target.closest('.lens-pill');
        if(!btn) return;
        document.querySelectorAll('#lensRow .lens-pill').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        
        const zoomVal = parseFloat(btn.getAttribute('data-lens'));
        if(track && !zoomSlider.disabled) {
            zoomSlider.value = zoomVal;
            onZoom();
        }
    });
    
    // Vertical zoom track — supports touch drag, mouse drag, and tap-to-jump
    const zoomTrack = document.getElementById('zoomTrack');
    if(zoomTrack) {
        let zoomDragging = false;

        function setZoomFromY(clientY) {
            if(zoomSlider.disabled) return;
            const rect = zoomTrack.getBoundingClientRect();
            let y = clientY - rect.top;
            y = Math.max(0, Math.min(y, rect.height));
            // Top of track = max zoom, bottom = min zoom
            const percent = 1 - (y / rect.height);
            const min = parseFloat(zoomSlider.min) || 1;
            const max = parseFloat(zoomSlider.max) || 10;
            zoomSlider.value = min + percent * (max - min);
            onZoom();
        }

        // Touch
        zoomTrack.addEventListener('touchstart', (e) => {
            if(zoomSlider.disabled) return;
            e.preventDefault();
            zoomDragging = true;
            setZoomFromY(e.touches[0].clientY);
        }, {passive: false});
        zoomTrack.addEventListener('touchmove', (e) => {
            if(!zoomDragging || zoomSlider.disabled) return;
            e.preventDefault();
            setZoomFromY(e.touches[0].clientY);
        }, {passive: false});
        zoomTrack.addEventListener('touchend', () => { zoomDragging = false; });
        zoomTrack.addEventListener('touchcancel', () => { zoomDragging = false; });

        // Mouse (desktop)
        zoomTrack.addEventListener('mousedown', (e) => {
            if(zoomSlider.disabled) return;
            zoomDragging = true;
            setZoomFromY(e.clientY);
        });
        document.addEventListener('mousemove', (e) => {
            if(!zoomDragging) return;
            setZoomFromY(e.clientY);
        });
        document.addEventListener('mouseup', () => { zoomDragging = false; });
    }

    zoomSlider.addEventListener('input', onZoom);

    document.addEventListener('fullscreenchange', updateFSIcon);
    document.addEventListener('webkitfullscreenchange', updateFSIcon);

    // Settings
    settingsBtn.addEventListener('click', openSettings);
    settingsClose.addEventListener('click', closeSettings);
    settingsOverlay.addEventListener('click', closeSettings);
    initSettings();
    initVisibility();

    // Help
    const helpBtn = document.getElementById('helpBtn');
    const helpPanel = document.getElementById('helpPanel');
    const helpOverlay = document.getElementById('helpOverlay');
    const helpClose = document.getElementById('helpClose');
    helpBtn.addEventListener('click', ()=>{
        helpOverlay.classList.add('on');
        helpPanel.classList.add('on');
    });
    helpClose.addEventListener('click', ()=>{
        helpOverlay.classList.remove('on');
        helpPanel.classList.remove('on');
    });
    helpOverlay.addEventListener('click', ()=>{
        helpOverlay.classList.remove('on');
        helpPanel.classList.remove('on');
    });

    // Keys
    document.addEventListener('keydown', e=>{
        if(e.code==='Space'){e.preventDefault(); toggleUI();}
        if(e.code==='Escape'&&!document.fullscreenElement){
            if(settingsPanel.classList.contains('on')){closeSettings(); return;}
            if(helpPanel.classList.contains('on')){helpOverlay.classList.remove('on'); helpPanel.classList.remove('on'); return;}
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
    initWelcome();
}

// ═══════════════════════════
//  WELCOME ONBOARDING
// ═══════════════════════════
function initWelcome(){
    if(localStorage.getItem('cleanlens_welcomed')) return;
    
    const overlay = document.getElementById('welcomeOverlay');
    const slides = document.querySelectorAll('.welcome-slide');
    const dots = document.querySelectorAll('.welcome-dots .dot');
    const nextBtn = document.getElementById('welcomeNext');
    const skipBtn = document.getElementById('welcomeSkip');
    let current = 0;
    
    overlay.classList.add('on');
    
    function goTo(idx){
        slides[current].classList.remove('active');
        dots[current].classList.remove('active');
        current = idx;
        slides[current].classList.remove('active');
        // Force reflow for animation
        void slides[current].offsetWidth;
        slides[current].classList.add('active');
        dots[current].classList.add('active');
        
        if(current === slides.length - 1){
            nextBtn.textContent = 'ابدأ';
        } else {
            nextBtn.textContent = 'التالي';
        }
    }
    
    function closeWelcome(){
        overlay.classList.remove('on');
        localStorage.setItem('cleanlens_welcomed', '1');
    }
    
    nextBtn.addEventListener('click', ()=>{
        if(current < slides.length - 1){
            goTo(current + 1);
        } else {
            closeWelcome();
        }
    });
    
    skipBtn.addEventListener('click', closeWelcome);
}

// ═══════════════════════════
//  CAMERA
// ═══════════════════════════
function smartCamLabel(cam, index, allBack){
    const label = (cam.label || '').toLowerCase();
    if(/front|user|أمام/.test(label)) return 'أمامية';
    if(/ultra.?wide|0\.5|0,5/.test(label)) return 'واسعة';
    if(/tele|zoom|مقرب/.test(label)) return 'تقريب';
    if(/wide/.test(label) && !/ultra/.test(label)) return 'أساسية';
    if(/back|environment|خلف/.test(label)) {
        return allBack && allBack.length > 1
            ? 'خلفية ' + (allBack.indexOf(cam) + 1)
            : 'خلفية';
    }
    return index === 0 ? 'أساسية' : 'عدسة ' + (index + 1);
}

async function enumCams(){
    try{
        const d = await navigator.mediaDevices.enumerateDevices();
        allCameras = d.filter(x => x.kind === 'videoinput');

        // Sync currentCamIndex with the actually active deviceId
        if(track){
            const settings = track.getSettings();
            const activeId = settings.deviceId;
            if(activeId){
                const idx = allCameras.findIndex(c => c.deviceId === activeId);
                if(idx >= 0) currentCamIndex = idx;
            }
        }

        switchCamBtn.disabled = allCameras.length <= 1;

        const row = document.getElementById('physicalLensRow');
        if(!row) return;

        // Hide row if there's only one camera
        if(allCameras.length <= 1){
            row.style.display = 'none';
            return;
        }

        row.style.display = 'flex';

        // Identify back-facing cameras for smarter naming
        const backCams = allCameras.filter(c => /back|environment|خلف/i.test(c.label || ''));

        // Build / update buttons in stable order
        row.innerHTML = '';
        allCameras.forEach((cam, i) => {
            const btn = document.createElement('button');
            btn.className = 'cam-pill';
            btn.textContent = smartCamLabel(cam, i, backCams);
            btn.dataset.deviceId = cam.deviceId;

            if(i === currentCamIndex) btn.classList.add('active');

            btn.addEventListener('click', async () => {
                if(!stream || i === currentCamIndex) return;
                currentCamIndex = i;
                row.querySelectorAll('.cam-pill').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                if(frozen) unfreeze();
                stopCam();
                await startCam();
            });

            row.appendChild(btn);
        });
    }catch(_){}
}

async function toggleCamera(){
    if(stream){if(frozen) unfreeze(); stopCam(); return;}
    await startCam();
}

async function startCam(){
    try{
        // Resolution based on settings
        let targetWidth = 1920, targetHeight = 1080;
        if(recSettings.quality === '720') {
            targetWidth = 1280; targetHeight = 720;
        } else if(recSettings.quality === '1440') {
            targetWidth = 2560; targetHeight = 1440;
        } else if(recSettings.quality === 'max') {
            targetWidth = 9999; targetHeight = 9999;
        }

        const targetFps = recSettings.fps || 30;

        const c = {
            video:{
                width:{ideal:targetWidth}, 
                height:{ideal:targetHeight}, 
                frameRate:{ideal:targetFps, min:Math.min(24, targetFps)}
            },
            audio:false
        };
        
        if (allCameras.length > 0) {
            c.video.deviceId = { exact: allCameras[currentCamIndex].deviceId };
        } else {
            c.video.facingMode = { ideal: 'environment' };
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
            const zg=document.getElementById('zoomGroup');
            if(zg) zg.classList.remove('disabled');
            updZoomLbl();
        }else{
            zoomSlider.disabled=true;
            const zg=document.getElementById('zoomGroup');
            if(zg) zg.classList.add('disabled');
            const zl=document.getElementById('zoomSvgLabel');
            if(zl) zl.textContent='--';
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

async function toggleCameraLens(){
    if(allCameras.length <= 1 || !stream) return;
    currentCamIndex = (currentCamIndex + 1) % allCameras.length;
    if(frozen) unfreeze(); 
    stopCam(); 
    await startCam();
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
    const v = parseFloat(zoomSlider.value);
    const min = parseFloat(zoomSlider.min) || 1;
    const max = parseFloat(zoomSlider.max) || 10;
    const percent = (v - min) / (max - min || 1);

    const zoomSvgLabel = document.getElementById('zoomSvgLabel');
    if(zoomSvgLabel) {
        zoomSvgLabel.textContent = v >= 10 ? Math.round(v) + '×' : v.toFixed(1) + '×';
    }

    // Update vertical track fill + thumb
    const fill = document.querySelector('.zoom-fill');
    const thumb = document.querySelector('.zoom-thumb');
    const pctStr = (percent * 100) + '%';
    if(fill) fill.style.height = pctStr;
    if(thumb) thumb.style.bottom = pctStr;

    // Sync bottom buttons (1×, 2×, 3×, …)
    const roundedZoom = Math.round(v);
    document.querySelectorAll('#lensRow .lens-pill').forEach(btn => {
        const btnVal = parseFloat(btn.getAttribute('data-lens'));
        btn.classList.toggle('active', btnVal === roundedZoom);
    });
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
    zoomSlider.disabled=true;
    const zg=document.getElementById('zoomGroup');
    if(zg) zg.classList.add('disabled');
    const zl=document.getElementById('zoomSvgLabel');
    if(zl) zl.textContent='--';
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
    applyOptState(warningOpts, recSettings.warnings || 'on');

    // Event listeners
    qualityOpts.addEventListener('click', async e=>{
        const b=e.target.closest('.opt-btn'); if(!b||b.disabled) return;
        selectOpt(qualityOpts, b);
        recSettings.quality=b.dataset.val;
        saveSettings();
        if(b.dataset.val === 'max' && recSettings.warnings !== 'off') {
            showWarning('⚠ أعلى دقة قد ترفع حرارة الجهاز');
        }
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
    warningOpts.addEventListener('click', e=>{
        const b=e.target.closest('.opt-btn'); if(!b||b.disabled) return;
        selectOpt(warningOpts, b);
        recSettings.warnings=b.dataset.val;
        saveSettings();
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

function initVisibility() {
    const toggles = [
        { id: 'showHelp', el: document.getElementById('helpBtn') },
        { id: 'showFullscreen', el: document.getElementById('fullscreenBtn') },
        { id: 'showHideUI', el: document.getElementById('hideUIBtn') },
        { id: 'showFreeze', el: document.getElementById('freezeBtn') },
        { id: 'showFlash', el: document.getElementById('torchBtn') },
        { id: 'showZoomBar', el: document.getElementById('leftPanel') },
        { id: 'showSwitchCam', el: document.getElementById('switchCamBtn') },
        { id: 'showBottomBar', el: document.getElementById('bottomBar') }
    ];
    
    toggles.forEach(t => {
        const cb = document.getElementById(t.id);
        if(!cb || !t.el) return;
        
        const saved = localStorage.getItem('ui_' + t.id);
        if(saved !== null) {
            cb.checked = saved === 'true';
            t.el.style.display = cb.checked ? '' : 'none';
        }
        
        cb.addEventListener('change', () => {
            t.el.style.display = cb.checked ? '' : 'none';
            localStorage.setItem('ui_' + t.id, cb.checked);
        });
    });
}

function openSettings(){
    settingsOverlay.classList.add('on');
    settingsPanel.classList.add('on');
}

function closeSettings(){
    settingsOverlay.classList.remove('on');
    settingsPanel.classList.remove('on');
}

let warningTimer = null;
function showWarning(msg){
    const toast = document.getElementById('warningToast');
    const text = document.getElementById('warningText');
    text.textContent = msg;
    
    // Reset state
    clearTimeout(warningTimer);
    toast.classList.remove('fade-out');
    toast.classList.add('show');
    
    // Start fade out after 3 seconds
    warningTimer = setTimeout(()=>{
        toast.classList.add('fade-out');
        // Fully hide after fade animation
        setTimeout(()=>{
            toast.classList.remove('show','fade-out');
        }, 500);
    }, 3000);
}

window.addEventListener('beforeunload', ()=>{
    stopCam();
});
init();
})();
