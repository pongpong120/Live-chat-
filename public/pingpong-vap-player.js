/*
 * PingPong VAP renderer — production local renderer for Tencent VAP "simple"
 * (non-VAPX) assets. The supplied assets store RGB and alpha in one H.264
 * video. WebGL composites the RGB frame with the red channel of the alpha
 * frame, so the effect remains transparent instead of showing the packed
 * black/white source video.
 *
 * No remote dependency is required.
 */
(function () {
  "use strict";

  const EFFECTS = Object.freeze({
    vip5: {
      src: "/images/premium-haco/effects/vip_upgrade_notice_lv5_bg.mp4",
      poster: "/images/premium-haco/posters/vip_upgrade_notice_lv5_bg.png",
      duration: 3000,
      info: { w: 750, h: 260, videoW: 752, videoH: 400, rgbFrame: [0, 0, 750, 260], aFrame: [0, 264, 375, 130], fps: 24 }
    },
    vip6: {
      src: "/images/premium-haco/effects/vip_upgrade_notice_lv6_bg.mp4",
      poster: "/images/premium-haco/posters/vip_upgrade_notice_lv6_bg.png",
      duration: 3000,
      info: { w: 750, h: 260, videoW: 752, videoH: 400, rgbFrame: [0, 0, 750, 260], aFrame: [0, 264, 375, 130], fps: 24 }
    },
    svip1: { src: "/images/premium-haco/effects/vap_medal_svip1.mp4", poster: "/images/premium-haco/posters/vap_medal_svip1.png", duration: 4000, info: { w: 400, h: 400, videoW: 608, videoH: 400, rgbFrame: [0, 0, 400, 400], aFrame: [404, 0, 200, 200], fps: 24 } },
    svip2: { src: "/images/premium-haco/effects/vap_medal_svip2.mp4", poster: "/images/premium-haco/posters/vap_medal_svip2.png", duration: 4000, info: { w: 400, h: 400, videoW: 608, videoH: 400, rgbFrame: [0, 0, 400, 400], aFrame: [404, 0, 200, 200], fps: 24 } },
    svip3: { src: "/images/premium-haco/effects/vap_medal_svip3.mp4", poster: "/images/premium-haco/posters/vap_medal_svip3.png", duration: 4000, info: { w: 400, h: 400, videoW: 608, videoH: 400, rgbFrame: [0, 0, 400, 400], aFrame: [404, 0, 200, 200], fps: 24 } },
    svip4: { src: "/images/premium-haco/effects/vap_medal_svip4.mp4", poster: "/images/premium-haco/posters/vap_medal_svip4.png", duration: 4000, info: { w: 400, h: 400, videoW: 608, videoH: 400, rgbFrame: [0, 0, 400, 400], aFrame: [404, 0, 200, 200], fps: 24 } },
    svip5: { src: "/images/premium-haco/effects/vap_medal_svip5.mp4", poster: "/images/premium-haco/posters/vap_medal_svip5.png", duration: 4000, info: { w: 400, h: 400, videoW: 608, videoH: 400, rgbFrame: [0, 0, 400, 400], aFrame: [404, 0, 200, 200], fps: 24 } },
    svip6: { src: "/images/premium-haco/effects/vap_medal_svip6.mp4", poster: "/images/premium-haco/posters/vap_medal_svip6.png", duration: 4000, info: { w: 400, h: 400, videoW: 608, videoH: 400, rgbFrame: [0, 0, 400, 400], aFrame: [404, 0, 200, 200], fps: 24 } }
  });

  function coord(x, y, w, h, vw, vh) {
    return [x / vw, (x + w) / vw, (vh - y - h) / vh, (vh - y) / vh];
  }

  class SimpleVapPlayer {
    constructor(container, cfg, options) {
      this.container = container;
      this.cfg = cfg;
      this.options = options || {};
      this.video = document.createElement("video");
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.setAttribute("playsinline", "");
      this.video.setAttribute("webkit-playsinline", "");
      this.video.preload = "auto";
      this.video.crossOrigin = "anonymous";
      this.video.style.display = "none";
      this.canvas = document.createElement("canvas");
      this.canvas.width = cfg.info.w;
      this.canvas.height = cfg.info.h;
      this.canvas.setAttribute("aria-hidden", "true");
      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";
      this.canvas.style.display = "block";
      this.canvas.style.objectFit = "contain";
      container.innerHTML = "";
      container.appendChild(this.video);
      container.appendChild(this.canvas);
      this.gl = this.canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: false });
      if (!this.gl) throw new Error("WebGL is unavailable for VAP playback");
      this.raf = 0;
      this.done = false;
      this.timer = 0;
      this.setupGL();
      this.video.addEventListener("ended", () => this.finish(), { once: true });
      this.video.addEventListener("error", () => this.finish(true), { once: true });
    }

    setupGL() {
      const gl = this.gl;
      const vs = `attribute vec2 a_position;attribute vec2 a_rgb;attribute vec2 a_alpha;varying vec2 v_rgb;varying vec2 v_alpha;void main(){gl_Position=vec4(a_position,0.0,1.0);v_rgb=a_rgb;v_alpha=a_alpha;}`;
      const fs = `precision mediump float;varying vec2 v_rgb;varying vec2 v_alpha;uniform sampler2D u_video;void main(){vec4 c=texture2D(u_video,v_rgb);float a=texture2D(u_video,v_alpha).r;gl_FragColor=vec4(c.rgb,a);}`;
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "VAP shader error");
        return s;
      };
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "VAP program error");
      gl.useProgram(program);
      this.program = program;
      const info = this.cfg.info;
      const rgb = coord(...info.rgbFrame, info.videoW, info.videoH);
      const alpha = coord(...info.aFrame, info.videoW, info.videoH);
      const data = new Float32Array([
        -1, 1, rgb[0], rgb[3], alpha[0], alpha[3],
         1, 1, rgb[1], rgb[3], alpha[1], alpha[3],
        -1,-1, rgb[0], rgb[2], alpha[0], alpha[2],
         1,-1, rgb[1], rgb[2], alpha[1], alpha[2]
      ]);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const stride = 6 * 4;
      const pos = gl.getAttribLocation(program, "a_position");
      const rgbLoc = gl.getAttribLocation(program, "a_rgb");
      const alphaLoc = gl.getAttribLocation(program, "a_alpha");
      gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(rgbLoc); gl.vertexAttribPointer(rgbLoc, 2, gl.FLOAT, false, stride, 8);
      gl.enableVertexAttribArray(alphaLoc); gl.vertexAttribPointer(alphaLoc, 2, gl.FLOAT, false, stride, 16);
      const texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(program, "u_video"), 0);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.texture = texture;
      this.buffer = buffer;
    }

    draw = () => {
      if (this.done) return;
      const gl = this.gl;
      if (this.video.readyState >= 2) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, this.video); } catch (_) {}
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      this.raf = requestAnimationFrame(this.draw);
    };

    play() {
      this.video.src = this.cfg.src;
      this.video.currentTime = 0;
      this.timer = window.setTimeout(() => this.finish(), this.cfg.duration + 180);
      this.raf = requestAnimationFrame(this.draw);
      const p = this.video.play();
      if (p && p.catch) p.catch(() => this.finish(true));
    }

    finish(error) {
      if (this.done) return;
      this.done = true;
      if (this.raf) cancelAnimationFrame(this.raf);
      if (this.timer) clearTimeout(this.timer);
      try { this.video.pause(); this.video.removeAttribute("src"); this.video.load(); } catch (_) {}
      if (this.options.onDone) this.options.onDone(!!error);
    }

    destroy() {
      this.finish();
      try { this.gl.deleteTexture(this.texture); this.gl.deleteBuffer(this.buffer); this.gl.deleteProgram(this.program); } catch (_) {}
      this.container.innerHTML = "";
    }
  }

  let active = null;

  function play(key, options) {
    const cfg = EFFECTS[key];
    if (!cfg || !options || !options.container) return null;
    if (active) active.destroy();
    try {
      active = new SimpleVapPlayer(options.container, cfg, {
        onDone: () => {
          const done = active;
          active = null;
          if (done) done.destroy();
          if (options.onDone) options.onDone();
        }
      });
      active.play();
      return active;
    } catch (err) {
      console.warn("[PingPong VAP] WebGL playback unavailable:", err);
      active = null;
      if (options.fallbackPoster && cfg.poster) options.fallbackPoster(cfg.poster);
      if (options.onDone) window.setTimeout(options.onDone, 1200);
      return null;
    }
  }

  function stop() { if (active) active.destroy(); active = null; }

  window.PingPongVap = { effects: EFFECTS, play, stop, version: "2026-09-18-premium-entry-v2" };
})();
