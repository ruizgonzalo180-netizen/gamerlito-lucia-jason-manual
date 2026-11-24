/* The two single-rendition playlists contain the same recording, audio and timeline. */
function createGameStream(video, onReady, onFailure) {
  const renditions = {
    original:{url:'game/qhd/index.m3u8', height:1440, codec:'avc1.4d4033'},
    '720p':{url:'game/mobile/index.m3u8', height:720, codec:'avc1.640028'}
  };
  const nativeHls = Boolean(video.canPlayType('application/vnd.apple.mpegurl'));
  const useHlsJs = window.Hls && Hls.isSupported() &&
    !(nativeHls && navigator.vendor === 'Apple Computer, Inc.');
  let state = 'idle', revision = 0;
  let preferred = 'original', active = 'original', lastStatus = '';
  let player = null, aborter = null, objectUrl = null;
  let resumeAt = 0, freeze = null;

  function position() {
    return state === 'ready' && Number.isFinite(video.currentTime) ? video.currentTime : resumeAt;
  }
  function qualityStatus() {
    if (state === 'idle') return 'Available during gameplay';
    if (state === 'failed') return 'Video unavailable';
    if (state === 'loading' || !video.videoHeight) return 'Loading '+renditions[active].height+'p…';
    return video.videoHeight+'p · 60 fps'+(preferred !== active ? ' (fallback)' : '');
  }
  function announce() {
    const value = qualityStatus();
    if (value !== lastStatus) {
      lastStatus = value;
      video.dispatchEvent(new Event('gamequalitychange'));
    }
  }

  function clearFreeze() {
    if (freeze) freeze.remove();
    freeze=null;
  }
  function freezePicture() {
    if (freeze || video.hidden || video.readyState < 2 || !video.videoWidth) return;
    const frame=document.createElement('canvas');
    frame.width=video.videoWidth; frame.height=video.videoHeight;
    const ctx=frame.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video,0,0);
    window.DuoDisplay?.maskCapture(ctx,video,0,0,frame.width,frame.height);
    frame.style.objectFit=getComputedStyle(video).objectFit;
    frame.style.transform=video.style.transform;
    frame.setAttribute('aria-hidden','true');
    video.after(frame);
    freeze=frame;
  }
  function revealFrame() {
    if (state==='ready' && !video.seeking && video.readyState>=2) clearFreeze();
  }
  function release() {
    revision++;
    state='idle';
    aborter?.abort(); aborter=null;
    if (player) player.destroy();
    player=null;
    if (video.hasAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl=null;
  }

  // Browsers with only progressive MP4 support can assemble a single rendition locally.
  async function loadAsFile(url, signal) {
    const playlist = new URL(url, document.baseURI);
    const response = await fetch(playlist, {signal});
    if (!response.ok) throw new Error('Playlist unavailable');
    const text = await response.text();
    const init = text.match(/^#EXT-X-MAP:URI="([^"]+)"/m);
    const parts = text.split(/\r?\n/).filter(line => line && !line.startsWith('#'));
    if (!init || !parts.length) throw new Error('Incomplete playlist');
    const buffers = [];
    for (const name of [init[1], ...parts]) {
      const part = await fetch(new URL(name, playlist), {signal});
      if (!part.ok) throw new Error('Video fragment unavailable');
      buffers.push(await part.blob());
    }
    return new Blob(buffers, {type:'video/mp4'});
  }
  function supportsOriginal() {
    const mime='video/mp4; codecs="'+renditions.original.codec+'"';
    if (useHlsJs) {
      const mediaSource=Hls.getMediaSource?.() || window.MediaSource || window.ManagedMediaSource;
      return !mediaSource?.isTypeSupported || mediaSource.isTypeSupported(mime);
    }
    return nativeHls || Boolean(video.canPlayType(mime));
  }
  function fail(id) {
    if (id!==revision || state==='idle' || state==='failed') return;
    resumeAt=position();
    if (active==='original') {
      freezePicture();
      release();
      load('720p');
    } else {
      state='failed';
      announce();
      onFailure();
    }
  }
  function load(quality) {
    const id=++revision;
    active=quality==='original' && !supportsOriginal() ? '720p' : quality;
    const {url}=renditions[active];
    state='loading';
    announce();
    if (useHlsJs) {
      player=new Hls({startPosition:resumeAt, maxBufferLength:16, backBufferLength:16});
      player.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) fail(id); });
      player.loadSource(url);
      player.attachMedia(video);
    } else if (nativeHls) {
      video.src=url;
      video.load();
    } else if (video.canPlayType('video/mp4')) {
      aborter=new AbortController();
      loadAsFile(url, aborter.signal).then(blob=>{
        if (id!==revision) return;
        objectUrl=URL.createObjectURL(blob);
        video.src=objectUrl;
      }).catch(()=>fail(id));
    } else {
      fail(id);
    }
  }
  video.addEventListener('loadedmetadata',()=>{
    if (state!=='loading') return;
    if (resumeAt>0) {
      const end=Number.isFinite(video.duration) ? Math.max(0,video.duration-.015) : resumeAt;
      video.currentTime=Math.min(end,resumeAt);
    }
    state='ready';
    announce();
    onReady();
  });
  for (const event of ['loadeddata','seeked','playing','timeupdate']) video.addEventListener(event,revealFrame);
  video.addEventListener('resize',announce);
  video.addEventListener('error',()=>{ if (video.error) fail(revision); });

  return {
    prepare() {
      if (state==='idle') load(preferred);
      if (state==='failed') onFailure();
      return state==='ready';
    },
    setQuality(value) {
      if ((value!=='original' && value!=='720p') || value===preferred) return;
      preferred=value;
      if (state==='idle') return;
      if (state!=='failed' && value===active) { announce(); return; }
      resumeAt=position();
      freezePicture();
      release();
      load(value);
    },
    preferredQuality:()=>preferred,
    qualityStatus, position,
    restart() {
      resumeAt=0;
      if (state==='ready') video.currentTime=0;
    },
    retry() {
      if (state==='failed' || video.error) {
        resumeAt=position();
        release();
      }
    },
    reset() {
      if (state!=='idle') release();
      clearFreeze();
      resumeAt=0;
      announce();
    }
  };
}
