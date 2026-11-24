(() => {
  'use strict';
  const view = document.querySelector('#game-view');
  const launcher = document.querySelector('#launcher');
  const title = document.querySelector('#game-cover');
  const intro = document.querySelector('#game-intro');
  const ident = document.querySelector('#game-ident');
  const footage = document.querySelector('#game-footage');
  const videos = [intro,ident,footage];
  const gameStream = createGameStream(footage,
    () => {
      syncAudio(); sprint(sprintHeld);
      if (phase==='playing' && !pauses.size) startVideo(footage);
    },
    () => { if (phase==='playing') showFeedback('The clip could not load.','Retry'); }
  );
  const feedback = document.querySelector('#playback-message');
  const note = document.querySelector('#playback-note');
  const action = document.querySelector('#playback-action');
  const enableAudio = document.querySelector('#enable-game-audio');
  const pauses = new Set();
  let phase = 'home', generation = 0;
  let entryFrame = null, entryStarted = null, elapsedBeforePause = 0;
  let rate = 1, sensitivity = 1, fit = 'cover';
  let volume = .65, soundNeedsTap = false, sprintHeld = false;
  let shownAction;
  const sceneActions = window.GAMERLITO_TIMELINE.markers;
  const manual = document.body.dataset.duoMode === 'manual';
  let stickDirection = 0, stickTimer = null;
  let vectorX = 0, vectorY = 0, panX = 0, panY = 0, zoom = 1, lift = 0;
  let jumpStart = null, lastTick = 0, animation = null;
  const limit = (value,low,high) => Math.max(low,Math.min(high,value));

  function setPhase(next) {
    phase=next;
    shownAction=undefined;
    view.dataset.phase=next;
    if(next!=='playing') resetStickNavigation();
    window.DuoDisplay?.sync();
    if(next!=='home' && next!=='joining') window.GameHUD.setStage(next==='playing'?'playing':'launch');
  }
  function activeVideo() { return phase==='title'?intro:phase==='ident'?ident:phase==='playing'?footage:null; }
  function freezeEntryClock() {
    if(entryFrame!==null) cancelAnimationFrame(entryFrame);
    entryFrame=null;
    if(entryStarted===null)return;
    elapsedBeforePause+=performance.now()-entryStarted;
    entryStarted=null;
  }
  function paintEntry() {
    entryFrame=null;
    if(entryStarted===null || pauses.size)return;
    const elapsed=elapsedBeforePause+performance.now()-entryStarted;
    if(phase==='joining'){
      if(elapsed<window.JoinScreen.durationMs) {
        window.JoinScreen.paint(elapsed);
        if(elapsed>=window.JoinScreen.coverMs && !launcher.hidden){
          launcher.hidden=true;
          view.hidden=false;
        }
      }else{
        launcher.hidden=true;
        launcher.classList.remove('join-pending');
        view.hidden=false;
        freezeEntryClock();
        window.GameHUD.mount();
        setPhase('title');
        if(!title.complete || !title.naturalWidth) {
          const token=generation;
          const revealTitle=()=>{if(token===generation && phase==='title')window.JoinScreen.hide();};
          title.addEventListener('load',revealTitle,{once:true});
          intro.addEventListener('loadeddata',revealTitle,{once:true});
          if(intro.readyState>=2)revealTitle();
        } else window.JoinScreen.hide();
        intro.hidden=false;
        syncAudio();
        startVideo(intro);
      }
    }
    if(phase==='joining') entryFrame=requestAnimationFrame(paintEntry);
  }
  function runEntryClock() {
    if(entryStarted!==null || pauses.size || phase!=='joining')return;
    if(!window.JoinScreen.ready) {
      const token=generation;
      window.JoinScreen.prepare().then(()=>{if(token===generation)runEntryClock();});
      return;
    }
    entryStarted=performance.now();
    paintEntry();
  }
  function hideFeedback() { feedback.hidden=true; }
  function showFeedback(message,label) {
    note.textContent=message;
    action.textContent=label;
    feedback.hidden=false;
  }
  function startVideo(video) {
    if(pauses.size || video!==activeVideo()) return;
    const token=generation;
    hideFeedback();
    if (video===footage && !gameStream.prepare()) return;
    video.play().catch(error=>{
      if(token!==generation || video!==activeVideo() || pauses.size || error.name==='AbortError') return;
      if(error.name==='NotAllowedError' && !video.muted) {
        soundNeedsTap=true; syncAudio(); startVideo(video);
      } else if(error.name==='NotAllowedError') showFeedback('Tap to start playback.','Play');
      else showFeedback('The clip could not start.','Retry');
    });
  }
  function showDecodedFrame(video) {
    const token=generation;
    const reveal=()=>{
      if(video!==activeVideo() || generation!==token) return;
      video.style.opacity='1';
      title.hidden=true;
      if(video!==intro) intro.hidden=true;
      if(video===footage) ident.hidden=true;
    };
    if(video.readyState>=2) reveal();
    else if(video.requestVideoFrameCallback) video.requestVideoFrameCallback(reveal);
  }
  function beginFootage(rewind) {
    const restarting=phase==='playing';
    hideFeedback();
    freezeEntryClock();
    intro.pause();
    ident.pause();
    setPhase('playing');
    footage.hidden=false;
    if(rewind) gameStream.restart();
    footage.loop=true;
    sprint(false);
    syncAudio();
    syncAction();
    footage.style.objectFit=fit;
    resetCamera();
    if(!restarting) footage.style.opacity='0';
    startVideo(footage);
  }
  function suspend(reason) {
    if(phase==='home' || pauses.has(reason)) return;
    resetStickNavigation();
    pauses.add(reason); freezeEntryClock();
    activeVideo()?.pause();
    sprint(false);
    syncAudio();
    vectorX=vectorY=0;
    window.DuoDisplay?.sync();
  }
  function wake(reason) {
    pauses.delete(reason);
    syncAudio();
    window.DuoDisplay?.sync();
    if(pauses.size || phase==='home') return;
    if(phase==='joining') runEntryClock();
    else if(activeVideo()) startVideo(activeVideo());
  }
  function clearRuntime() {
    generation++;
    resetStickNavigation();
    gameStream.reset();
    freezeEntryClock();
    elapsedBeforePause=0;
    window.JoinScreen.hide();
    launcher.classList.remove('join-pending');
    pauses.clear(); hideFeedback();
    soundNeedsTap=false; enableAudio.hidden=true;
    sprint(false);
    videos.forEach(video=>{
      video.pause(); video.hidden=true; video.style.opacity='0';
      if(video.readyState>=1) video.currentTime=0;
    });
    title.hidden=false;
    resetCamera();
  }
  function goHome() {
    if(phase==='home') return;
    clearRuntime();
    setPhase('home');
    window.GameHUD.unmount();
    view.hidden=true; launcher.hidden=false; launcher.inert=false;
    window.Launcher.show('home');
  }
  function startExperience() {
    if(phase!=='home') return;
    clearRuntime();
    launcher.inert=true;
    launcher.classList.add('join-pending');
    const cover=document.getElementById('game-cover');
    if(!cover.hasAttribute('src')) cover.src=cover.dataset.entrySrc;
    setPhase('joining');
    if(document.hidden) pauses.add('hidden');
    runEntryClock();
    const token=generation;
    setTimeout(()=>{
      if(token!==generation || phase==='home') return;
      const suffix = gameStream.preferredQuality()==='720p' ? '-720' : '';
      intro.src='intro/cover'+suffix+'.mp4';
      intro.preload='auto'; intro.load();
      const prepareIdent=()=>{
        if (generation !== token || phase === 'home') return;
        ident.src='intro/ident'+suffix+'.mp4';
        ident.preload='auto'; ident.load();
      };
      if (intro.readyState >= 3) prepareIdent();
      else intro.addEventListener('canplay',prepareIdent,{once:true});
    },0);
  }
  function resetCamera() {
    if(animation!==null) cancelAnimationFrame(animation);
    animation=null; jumpStart=null; lastTick=0;
    vectorX=vectorY=panX=panY=lift=0; zoom=1;
    footage.style.transform='none';
    window.DuoDisplay?.positionCredit();
  }
  function tick(now) {
    animation=null;
    if(phase!=='playing') return;
    const dt=lastTick?Math.min((now-lastTick)/1000,.06):1/60;
    lastTick=now;
    const moving=Boolean(vectorX||vectorY);
    const ease=Math.min(1,dt*(moving?4:3));
    panX+=(vectorX*.048*limit(sensitivity,.25,1.5)-panX)*ease;
    panY+=(vectorY*.035*limit(sensitivity,.25,1.5)-panY)*ease;
    lift=0;
    if(jumpStart!==null){
      const progress=(now-jumpStart)/500;
      if(progress>=1) jumpStart=null;
      else lift=Math.sin(Math.PI*progress)*.026;
    }
    const neededZoom=1+2.1*Math.max(Math.abs(panX),Math.abs(panY-lift));
    zoom=neededZoom;
    footage.style.transform=`translate3d(${(-100*panX).toFixed(3)}%,${(100*(lift-panY)).toFixed(3)}%,0) scale(${zoom.toFixed(4)})`;
    window.DuoDisplay?.positionCredit();
    if(moving || jumpStart!==null || Math.abs(panX)+Math.abs(panY)>.0003) animation=requestAnimationFrame(tick);
    else resetCamera();
  }
  function requestTick() { if(animation===null) {lastTick=0; animation=requestAnimationFrame(tick);} }
  function resetStickNavigation() {
    clearTimeout(stickTimer); stickTimer=null; stickDirection=0;
  }
  function control(x,y) {
    if(phase!=='playing' || pauses.size) { vectorX=vectorY=0; resetStickNavigation(); return; }
    vectorX=limit(Number(x)||0,-1,1); vectorY=limit(Number(y)||0,-1,1); requestTick();
    if(!manual) return;
    const direction=Math.abs(vectorY)>.85 && Math.abs(vectorX)<.4 ? -Math.sign(vectorY) : 0;
    if(direction===stickDirection) return;
    resetStickNavigation(); stickDirection=direction;
    if(direction) stickTimer=setTimeout(()=>{
      if(phase!=='playing' || pauses.size || !window.GameHUD.canAct()) return;
      if(direction>0) performAction();
      else {
        const previous=sceneActions.filter(cue=>cue.t<footage.currentTime-1).at(-1);
        seekTo(previous?.t || 0);
      }
    },650);
  }
  function seekTo(time) {
    if(phase!=='playing' || footage.readyState<1 || !Number.isFinite(footage.duration)) return;
    footage.currentTime=limit(time,0,Math.max(0,footage.duration-.08));
    syncAction();
  }
  function jump() {
    if(phase!=='playing' || pauses.size) return;
    seekTo(footage.currentTime+5);
  }
  function currentAction() {
    if(phase!=='playing') return null;
    return sceneActions.find(cue=>cue.t>gameStream.position()+.35) || {t:0,label:"Replay the clip"};
  }
  function syncAction() {
    const label=currentAction()?.label || null;
    if(label===shownAction)return;
    shownAction=label;
    window.GameHUD.setAction(label);
  }
  function performAction() {
    if (phase !== 'playing' || pauses.size || footage.readyState < 1) return;
    const action = currentAction();
    if (!action) return;
    seekTo(action.t);
  }
  function sprint(down) {
    sprintHeld=Boolean(down) && phase==='playing' && !pauses.size;
    footage.playbackRate=sprintHeld?Math.min(4,rate*1.6):rate;
  }
  function snapshot() {
    if(phase==='home'||phase==='joining') return null;
    const video=activeVideo();
    const img=video && video.readyState>=2 ? video : title;
    const sw=img.videoWidth||img.naturalWidth,sh=img.videoHeight||img.naturalHeight;
    if(!sw||!sh||!view.clientWidth||!view.clientHeight) return null;
    const canvas=document.createElement('canvas');
    const size=Math.min(1,1280/Math.max(view.clientWidth,view.clientHeight));
    canvas.width=Math.max(1,Math.round(view.clientWidth*size));
    canvas.height=Math.max(1,Math.round(view.clientHeight*size));
    const ctx=canvas.getContext('2d'); if(!ctx)return null;
    const w=canvas.width,h=canvas.height;
    ctx.fillStyle=img===title?'#180a1c':'#101115'; ctx.fillRect(0,0,w,h);
    const cover=img!==footage || fit==='cover';
    const z=img===footage?zoom:1;
    const ratio=(cover?Math.max(w/sw,h/sh):Math.min(w/sw,h/sh))*z;
    const x=(w-sw*ratio)/2-(img===footage?panX*w:0);
    const y=(h-sh*ratio)/2+(img===footage?(lift-panY)*h:0);
    ctx.drawImage(img,x,y,sw*ratio,sh*ratio);
    if(img===footage) window.DuoDisplay?.maskCapture(ctx,img,x,y,sw*ratio,sh*ratio);
    return canvas.toDataURL('image/jpeg',.83);
  }
  function syncAudio() {
    for(const video of videos) {
      video.volume=volume;
      video.muted=soundNeedsTap || volume===0;
    }
    enableAudio.hidden=!(soundNeedsTap && volume>0 && activeVideo() && !pauses.size);
  }
  function setVolume(value) {
    volume=limit(Number(value)||0,0,1);
    syncAudio();
  }
  enableAudio.addEventListener('click',()=>{
    const video=activeVideo();
    if(!video) return;
    soundNeedsTap=false;syncAudio();startVideo(video);
  });
  footage.addEventListener('timeupdate',syncAction);
  footage.addEventListener('seeked',syncAction);
  for(const video of videos){
    video.addEventListener('playing',()=>showDecodedFrame(video));
    video.addEventListener('error',()=>{
      if(video!==footage && video.error && /\/(cover|ident)\.mp4$/.test(video.currentSrc)) {
        const time=video.currentTime;
        if(time>0) video.addEventListener('loadedmetadata',()=>{video.currentTime=time;},{once:true});
        video.src=video.currentSrc.replace(/\.mp4$/,'-720.mp4');
        video.load();
        if(video===activeVideo()) startVideo(video);
        return;
      }
      if(video!==footage && video===activeVideo())showFeedback('The clip could not load.','Retry');
    });
  }
  intro.addEventListener('ended',()=>{
    if(phase!=='title')return;
    setPhase('ident');
    gameStream.prepare();
    ident.hidden=false;
    syncAudio();
    startVideo(ident);
  });
  ident.addEventListener('ended',()=>{if(phase==='ident')beginFootage(true);});
  action.addEventListener('click',()=>{
    const video=activeVideo();
    if(!video) return;
    if (video===footage) gameStream.retry();
    else if(video.error) video.load();
    startVideo(video);
  });
  document.addEventListener('visibilitychange',()=>document.hidden?suspend('hidden'):wake('hidden'));
  window.addEventListener('blur',()=>{control(0,0);sprint(false);});
  window.Player={
    pause:()=>suspend('menu'), resume:()=>wake('menu'), leave:goHome,
    restart:()=>{ if(phase!=='home'){ pauses.delete('menu');pauses.delete('user');beginFootage(true); } },
    togglePlayback:()=>{ if(phase==='playing') pauses.has('user') ? wake('user') : suspend('user'); },
    get userPaused(){return pauses.has('user');},
    setQuality:gameStream.setQuality, qualityStatus:gameStream.qualityStatus,
    setVolume, setRate:value=>{rate=limit(Number(value)||1,.25,3);sprint(sprintHeld);},
    setFit:value=>{fit=value==='cover'?'cover':'contain';footage.style.objectFit=fit; resetCamera();},
    setSensitivity:value=>{sensitivity=limit(Number(value)||1,.1,3);},
    control,jump,snapshot,performAction,sprint,
    get stage(){return phase;}, get paused(){return pauses.size>0;}
  };
  window.startExperience=startExperience;
})();
