(() => {
  'use strict';
  const video = document.querySelector('#game-footage');
  const surface = document.querySelector('#game-surface');
  const mask = document.querySelector('#credit-privacy');
  const hud = document.querySelector('#game-hud');
  const automatic = hud.dataset.duoMode === 'auto';
  const joystick = hud.querySelector('.gh-stick span');
  const playback = hud.querySelector('[data-gh="playback"]');
  const action = hud.querySelector('[data-gh="act"]');
  const actionHint = document.createElement('b');
  actionHint.className = 'duo-action-hint';
  actionHint.setAttribute('aria-hidden','true');
  action.append(actionHint);
  const labels = {aim:'Aim', fire:'Fire', interact:'Interact', crouch:'Crouch', drive:'Drive', look:'Look', menu:'Select'};
  const buttons = {act:action, sprint:hud.querySelector('[data-gh="sprint"]'), jump:hud.querySelector('[data-gh="jump"]')};
  const segments = window.GAMERLITO_TIMELINE.segments;
  const neutral = [0,0,0,0,'idle'];
  const creditStart = 456.4;
  let lastFrame = 0, pendingFrame = null, waiting = false;

  function segmentAt(time) {
    let lo=0, hi=segments.length;
    while(lo<hi) {
      const mid=(lo+hi)>>>1;
      if(segments[mid][0]<=time) lo=mid+1;
      else hi=mid;
    }
    const segment=segments[lo-1];
    return segment && time<segment[1] ? segment : neutral;
  }

  function renderControls(time) {
    const paused=window.Player.userPaused;
    if(playback.dataset.paused!==String(paused)) {
      playback.dataset.paused=String(paused);
      playback.setAttribute('aria-label',paused?'Resume playback':'Pause playback');
      playback.title=paused?'Resume (P)':'Pause (P)';
    }
    if(!automatic) return;
    const active=window.Player.stage==='playing' && !window.Player.paused && !video.paused &&
      !video.seeking && !waiting && !document.hidden && window.GameHUD.canAct();
    const [start, , dx, dy, label]=active ? segmentAt(time) : neutral;
    const rest=label==='scene' || label==='idle';
    if(hud.dataset.demoAction!==label) hud.dataset.demoAction=label;
    if(!window.GameHUD.stickInUse()) {
      const x=rest?0:dx, y=rest?0:dy;
      joystick.style.transform=x||y?'translate('+x*50+'%,'+y*50+'%)':'';
    }
    let held=null;
    if(label==='run') held='sprint';
    else if(label==='jump') held='jump';
    else if(label==='aim' || label==='fire' || label==='interact') held='act';
    else if((label==='crouch' || label==='menu' || label==='drive') && time-start<.35) held='act';
    for(const [key,button] of Object.entries(buttons)) {
      const pressed=String(key===held);
      if(button.dataset.demoHeld!==pressed) button.dataset.demoHeld=pressed;
    }
    if(held==='act' && actionHint.textContent!==labels[label]) actionHint.textContent=labels[label];
  }

  // These coordinates enclose just the two credit lines on the 640 x 360 card.
  function creditBounds(x,y,width,height) {
    return [x+width*314/640, y+height*14/360, width*241/640, height*81/360];
  }
  function cardVisible() {
    return window.Player.stage==='playing' && (video.currentTime>=creditStart || lastFrame>=creditStart);
  }
  function positionCredit() {
    if(!cardVisible() || !video.videoWidth) { mask.hidden=true; return; }
    const area=surface.getBoundingClientRect(), rect=video.getBoundingClientRect();
    const scale=(getComputedStyle(video).objectFit==='contain'?Math.min:Math.max)(
      rect.width/video.videoWidth,rect.height/video.videoHeight
    );
    const width=video.videoWidth*scale, height=video.videoHeight*scale;
    const [x,y,w,h]=creditBounds(rect.left-area.left+(rect.width-width)/2,rect.top-area.top+(rect.height-height)/2,width,height);
    mask.style.left=x+'px'; mask.style.top=y+'px'; mask.style.width=w+'px'; mask.style.height=h+'px';
    mask.style.setProperty('--credit-blur',Math.max(5,width/37)+'px'); mask.hidden=false;
  }
  function maskCapture(ctx,frame,x,y,width,height) {
    if(!cardVisible()) return;
    const [left,top,w,h]=creditBounds(x,y,width,height);
    ctx.save();
    ctx.beginPath(); ctx.rect(left,top,w,h); ctx.clip();
    if('filter' in ctx) {
      ctx.filter='blur('+Math.max(5,width/37)+'px)';
      ctx.drawImage(frame,x,y,width,height);
    } else {
      ctx.fillStyle='#0b1013'; ctx.fillRect(left,top,w,h);
    }
    ctx.restore();
  }

  function sync(time=video.currentTime) {
    renderControls(time);
    positionCredit();
  }
  function scheduleFrame() {
    if(pendingFrame!==null || video.paused || video.ended) return;
    const onFrame=(_,metadata)=>{
      pendingFrame=null;
      lastFrame=metadata?.mediaTime ?? video.currentTime;
      sync(lastFrame);
      scheduleFrame();
    };
    pendingFrame=video.requestVideoFrameCallback ?
      video.requestVideoFrameCallback(onFrame) : requestAnimationFrame(onFrame);
  }
  function cancelFrame() {
    if (pendingFrame===null) return;
    if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(pendingFrame);
    else cancelAnimationFrame(pendingFrame);
    pendingFrame=null;
  }
  video.addEventListener('playing',()=>{waiting=false;sync();scheduleFrame();});
  video.addEventListener('waiting',()=>{waiting=true;sync();});
  video.addEventListener('seeking',()=>sync());
  video.addEventListener('seeked',()=>{
    waiting=false;
    if(video.readyState>=2) lastFrame=video.currentTime;
    sync();scheduleFrame();
  });
  for(const event of ['pause','ended']) video.addEventListener(event,()=>{cancelFrame();sync();});
  for(const event of ['timeupdate','loadeddata']) video.addEventListener(event,()=>sync());
  video.addEventListener('emptied',()=>{cancelFrame();lastFrame=0;waiting=false;sync();});
  window.addEventListener('resize',positionCredit);
  window.DuoDisplay={sync,positionCredit,maskCapture};
  sync();
})();
