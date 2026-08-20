import * as THREE from 'three';

// three.js 渲染栈 + 第三人称跟随相机 + 每个场景的光照氛围。

export class Stage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 500);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444422, 1);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(18, 26, 12);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const d = 34;
    Object.assign(this.sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 120 });
    this.sun.shadow.camera.updateProjectionMatrix();   // 少了这句，阴影视锥还是默认的 10×10
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(this.ambient);

    // 天空穹顶：一层从地平线到天顶的渐变，比纯色背景耐看得多
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x6f9fd0) },
        uBottom: { value: new THREE.Color(0xe8bd8e) },
        uStars: { value: 0 },
      },
      vertexShader: `varying vec3 vP;
        void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uBottom; uniform float uStars;
        varying vec3 vP;
        // 三维哈希，用方向本身当种子，星星就钉在天上不会跟着相机跑
        float hash(vec3 p){
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }
        void main(){
          vec3 d = normalize(vP);
          vec3 col = mix(uBottom, uTop, smoothstep(-0.05, 0.55, d.y));
          if (uStars > 0.001 && d.y > 0.0) {
            vec3 cell = floor(d * 190.0);
            float h = hash(cell);
            // 只让极少数格子亮，且越靠天顶越密
            float star = smoothstep(0.9975, 0.99995, h) * smoothstep(0.0, 0.35, d.y);
            float twinkle = 0.65 + 0.35 * sin(h * 90.0);
            col += vec3(star * twinkle * uStars * 1.5);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.skyMat);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // 相机状态
    this.camYaw = Math.PI;
    this.camPitch = 0.24;
    this.camDist = 9;
    this.camDistTarget = 9;
    this.lookAt = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this.shake = 0;
    this.view = 'third';        // third / shoulder / first
    this.viewSide = 0;          // 肩后视角的横向偏移
    this.eyeHeight = 1.0;       // 第一人称的眼睛高度，切角色时更新

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // 氛围预设 -----------------------------------------------------------
  setMood({
    sky = 0x9fc4e8, fog = 0x9fc4e8, fogNear = 30, fogFar = 130,
    sun = 0xffffff, sunIntensity = 1.6, sunPos = [18, 26, 12],
    hemiSky = 0xffffff, hemiGround = 0x444422, hemiIntensity = 0.9,
    ambient = 0.25, exposure = 1.05, shadows = true, skyTop = null, stars = 0,
  } = {}) {
    this.scene.background = new THREE.Color(fog);
    this.scene.fog = new THREE.Fog(fog, fogNear, fogFar);
    this.skyMat.uniforms.uBottom.value.setHex(fog);
    this.skyMat.uniforms.uTop.value.setHex(skyTop ?? sky);
    this.skyMat.uniforms.uStars.value = stars;
    this.sun.color.setHex(sun);
    this.sun.intensity = sunIntensity;
    // 太阳每帧跟着玩家平移（阴影视锥才跟得上），所以场景给的是方向偏移而不是绝对坐标
    this.setSunOffset(...sunPos);
    this.sun.castShadow = shadows;
    this.hemi.color.setHex(hemiSky);
    this.hemi.groundColor.setHex(hemiGround);
    this.hemi.intensity = hemiIntensity;
    this.ambient.intensity = ambient;
    this.renderer.toneMappingExposure = exposure;
  }

  orbit(dx, dy) {
    this.camYaw -= dx * 0.005;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.003, -0.15, 0.85);
  }

  zoom(delta) {
    this.camDistTarget = THREE.MathUtils.clamp(this.camDistTarget + delta * 0.01, 4.5, 18);
  }

  addShake(v) { this.shake = Math.min(1, this.shake + v); }

  setView({ id, dist, pitch, side = 0 }, eyeHeight = this.eyeHeight) {
    this.view = id;
    this.viewSide = side;
    this.eyeHeight = eyeHeight;
    if (id !== 'first') {
      this.camDistTarget = dist;
      this.camPitch = pitch;
    }
  }

  updateCamera(dt, target, aimYaw = null) {
    this.camDist += (this.camDistTarget - this.camDist) * Math.min(1, dt * 5);

    // 目标点：角色再往上一点，别老盯着屁股
    const focusY = target.y + 1.4;
    this.lookAt.lerp(new THREE.Vector3(target.x, focusY, target.z), Math.min(1, dt * 8));

    if (aimYaw !== null) {
      let d = aimYaw - this.camYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.camYaw += d * Math.min(1, dt * 1.4);
    }

    const cp = Math.cos(this.camPitch);

    if (this.view === 'first') {
      // 眼睛放在角色头上，朝向和第三人称的视线方向一致：
      // 第三人称是从 camYaw 那个方位往回看，所以视线就是这个方位的反向。
      this._camPos.set(target.x, target.y + this.eyeHeight, target.z);
      this._lookTarget.set(
        this._camPos.x - Math.sin(this.camYaw) * cp,
        this._camPos.y - Math.sin(this.camPitch),
        this._camPos.z - Math.cos(this.camYaw) * cp,
      );
      // 第一人称不做位置平滑，跟手才不晕
      this.camera.position.copy(this._camPos);
      if (this.shake > 0.001) {
        const s = this.shake * this.shake * 0.35;
        this.camera.position.x += (Math.random() - 0.5) * s;
        this.camera.position.y += (Math.random() - 0.5) * s;
        this.shake *= Math.pow(0.02, dt);
      }
      this.camera.lookAt(this._lookTarget);
      this.sky.position.copy(this.camera.position);
      this.sky.scale.setScalar(this.camera.far * 0.75);
      this.sun.target.position.copy(this.lookAt);
      this.sun.target.updateMatrixWorld();
      this.sun.position.copy(this.lookAt).add(this._sunOffset ??= new THREE.Vector3(18, 26, 12));
      return;
    }

    this._camPos.set(
      this.lookAt.x + Math.sin(this.camYaw) * this.camDist * cp,
      this.lookAt.y + Math.sin(this.camPitch) * this.camDist + 1.2,
      this.lookAt.z + Math.cos(this.camYaw) * this.camDist * cp,
    );
    if (this.viewSide) {
      // 沿视线的右手方向平移，把角色挤到画面一侧
      this._camPos.x += Math.cos(this.camYaw) * this.viewSide;
      this._camPos.z -= Math.sin(this.camYaw) * this.viewSide;
    }

    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.5;
      this._camPos.x += (Math.random() - 0.5) * s;
      this._camPos.y += (Math.random() - 0.5) * s;
      this._camPos.z += (Math.random() - 0.5) * s;
      this.shake *= Math.pow(0.02, dt);
    }

    this.camera.position.lerp(this._camPos, Math.min(1, dt * 9));
    this.camera.lookAt(this.lookAt);

    // 天空跟着相机走，永远不会穿帮
    this.sky.position.copy(this.camera.position);
    this.sky.scale.setScalar(this.camera.far * 0.75);

    this.sun.target.position.copy(this.lookAt);
    this.sun.target.updateMatrixWorld();
    this.sun.position.copy(this.lookAt).add(this._sunOffset ??= new THREE.Vector3(18, 26, 12));
  }

  setSunOffset(x, y, z) {
    // 归一化到固定距离，免得场景写的坐标忽远忽近把阴影视锥拉爆
    const v = new THREE.Vector3(x, y, z);
    if (v.lengthSq() < 1e-6) v.set(18, 26, 12);
    this._sunOffset = v.normalize().multiplyScalar(48);
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
