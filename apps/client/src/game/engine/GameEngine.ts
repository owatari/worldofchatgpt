import * as THREE from 'three';
import type { ClassId, CombatEvent, MonsterSnapshot, PlayerSnapshot, Vec3 } from '@worldofchatgpt/shared';

interface Snapshot {
  self: PlayerSnapshot;
  players: PlayerSnapshot[];
  monster: MonsterSnapshot;
  selectedTargetId: string | null;
}

interface Effect {
  update: (dt: number) => boolean;
}

interface ClassPalette {
  primary: number;
  secondary: number;
  accent: number;
  cloth: number;
}

const CLASS_PALETTES: Record<ClassId, ClassPalette> = {
  warrior: { primary: 0x9e3439, secondary: 0x322b31, accent: 0xe5b861, cloth: 0x651f28 },
  mage: { primary: 0x58479b, secondary: 0x202442, accent: 0x8ad8ff, cloth: 0x33285e },
  cleric: { primary: 0xe2d5ad, secondary: 0x6c5234, accent: 0xf4cf67, cloth: 0x8f7247 },
};

export class GameEngine {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly selfGroup = new THREE.Group();
  private readonly slimeGroup = this.makeSlime();
  private readonly others = new Map<string, THREE.Group>();
  private readonly effects: Effect[] = [];
  private readonly targetRing = this.makeTargetRing();
  private readonly cameraFocus = new THREE.Vector3(0, 1.05, 0);
  private frame = 0;
  private selfId = '';
  private monsterId = '';
  private elapsed = 0;
  private cameraYaw = 0;
  private cameraPitch = 0.68;
  private cameraDistance = 16;
  private orbitPointerId: number | null = null;
  private orbitLastX = 0;
  private orbitLastY = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly onMonsterClick: (entityId: string) => void,
  ) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.domElement.style.cursor = 'default';
    this.renderer.domElement.style.touchAction = 'none';
    this.container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x101b24);
    this.scene.fog = new THREE.Fog(0x101b24, 26, 58);

    this.addLighting();
    this.addEnvironment();
    this.scene.add(this.selfGroup, this.slimeGroup, this.targetRing);

    this.camera.position.set(0, 11, 13);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.pointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.pointerUp);
    this.renderer.domElement.addEventListener('wheel', this.wheel, { passive: false });
    this.renderer.domElement.addEventListener('contextmenu', this.contextMenu);
    this.frame = requestAnimationFrame(this.animate);
  }

  /** Converts local WASD input into authoritative world-space movement using the current camera heading. */
  getCameraRelativeMovement(strafe: number, forward: number): { x: number; z: number } {
    const forwardX = -Math.sin(this.cameraYaw);
    const forwardZ = -Math.cos(this.cameraYaw);
    const rightX = Math.cos(this.cameraYaw);
    const rightZ = -Math.sin(this.cameraYaw);
    let x = rightX * strafe + forwardX * forward;
    let z = rightZ * strafe + forwardZ * forward;
    const length = Math.hypot(x, z);
    if (length > 1) {
      x /= length;
      z /= length;
    }
    return { x, z };
  }

  setSnapshot(snapshot: Snapshot): void {
    this.selfId = snapshot.self.entityId;
    this.monsterId = snapshot.monster.entityId;
    this.ensureCharacterAppearance(this.selfGroup, snapshot.self.classId, true);
    this.updateCharacterGroup(this.selfGroup, snapshot.self);
    this.updateSlime(snapshot.monster);

    const liveIds = new Set(snapshot.players.map((player) => player.entityId));
    for (const player of snapshot.players) {
      let group = this.others.get(player.entityId);
      if (!group) {
        group = this.makeCharacter(player.classId, false);
        this.others.set(player.entityId, group);
        this.scene.add(group);
      }
      this.ensureCharacterAppearance(group, player.classId, false);
      this.updateCharacterGroup(group, player);
    }
    for (const [id, group] of this.others) {
      if (!liveIds.has(id)) {
        this.scene.remove(group);
        this.others.delete(id);
      }
    }

    this.targetRing.visible = snapshot.selectedTargetId === snapshot.monster.entityId && !snapshot.monster.dead;
  }

  combat(event: CombatEvent): void {
    if (event.kind === 'damage') {
      this.floatingText(`-${event.amount}`, event.at, '#ff736f');
      this.hitFlash(event.targetId);
      return;
    }
    if (event.kind === 'heal') {
      this.floatingText(`+${event.amount}`, event.at, '#79f6a4');
      this.healVfx(event.at);
      return;
    }
    if (event.kind === 'xp') {
      if (event.sourceId === this.selfId) this.floatingText(`+${event.amount} XP`, event.at, '#ffd66b');
      return;
    }
    if (event.kind === 'death') {
      this.deathVfx(event.at);
      return;
    }
    if (event.kind === 'cast') this.castVfx(event);
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.pointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.pointerUp);
    this.renderer.domElement.removeEventListener('wheel', this.wheel);
    this.renderer.domElement.removeEventListener('contextmenu', this.contextMenu);
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  private readonly resize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private readonly pointerDown = (event: PointerEvent): void => {
    if (event.button === 2 || event.button === 1) {
      this.orbitPointerId = event.pointerId;
      this.orbitLastX = event.clientX;
      this.orbitLastY = event.clientY;
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.renderer.domElement.style.cursor = 'grabbing';
      event.preventDefault();
      return;
    }

    if (event.button !== 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.slimeGroup, true);
    if (hits.length && this.monsterId) this.onMonsterClick(this.monsterId);
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (this.orbitPointerId !== event.pointerId) return;
    const dx = event.clientX - this.orbitLastX;
    const dy = event.clientY - this.orbitLastY;
    this.orbitLastX = event.clientX;
    this.orbitLastY = event.clientY;
    this.cameraYaw -= dx * 0.0065;
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + dy * 0.0045, 0.28, 1.18);
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    if (this.orbitPointerId !== event.pointerId) return;
    this.orbitPointerId = null;
    this.renderer.domElement.style.cursor = 'default';
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
  };

  private readonly wheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.cameraDistance = THREE.MathUtils.clamp(this.cameraDistance + event.deltaY * 0.012, 8.5, 24);
  };

  private readonly contextMenu = (event: MouseEvent): void => event.preventDefault();

  private readonly animate = (): void => {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;

    this.animateEntityTransform(this.selfGroup, dt);
    for (const group of this.others.values()) this.animateEntityTransform(group, dt);
    this.animateEntityTransform(this.slimeGroup, dt);

    this.animateCharacter(this.selfGroup, dt);
    for (const group of this.others.values()) this.animateCharacter(group, dt);
    this.animateSlime(dt);

    const focus = this.selfGroup.position;
    const focusTarget = new THREE.Vector3(focus.x, focus.y + 1.05, focus.z);
    this.cameraFocus.lerp(focusTarget, 1 - Math.exp(-dt * 12));
    const horizontal = Math.cos(this.cameraPitch) * this.cameraDistance;
    const desired = new THREE.Vector3(
      this.cameraFocus.x + Math.sin(this.cameraYaw) * horizontal,
      this.cameraFocus.y + Math.sin(this.cameraPitch) * this.cameraDistance,
      this.cameraFocus.z + Math.cos(this.cameraYaw) * horizontal,
    );
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 10));
    this.camera.lookAt(this.cameraFocus);

    this.targetRing.position.set(this.slimeGroup.position.x, 0.055, this.slimeGroup.position.z);
    this.targetRing.rotation.y += dt * 0.65;

    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      if (this.effects[index]?.update(dt)) this.effects.splice(index, 1);
    }

    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  };

  private addLighting(): void {
    const hemi = new THREE.HemisphereLight(0xbde7ff, 0x1e2a1f, 1.55);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffe5b6, 4.2);
    sun.position.set(-10, 17, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 45;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x6ca8ff, 1.1);
    rim.position.set(11, 8, -13);
    this.scene.add(rim);
  }

  private material(color: number, roughness = 0.65, metalness = 0): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
  }

  private emissiveMaterial(color: number, intensity = 1.5): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 0.35,
      metalness: 0.05,
    });
  }

  private makeCharacter(classId: ClassId, self: boolean): THREE.Group {
    const group = new THREE.Group();
    this.buildCharacterAppearance(group, classId, self);
    return group;
  }

  private ensureCharacterAppearance(group: THREE.Group, classId: ClassId, self: boolean): void {
    if (group.userData.classId === classId && group.userData.self === self) return;
    group.clear();
    this.buildCharacterAppearance(group, classId, self);
  }

  private buildCharacterAppearance(group: THREE.Group, classId: ClassId, self: boolean): void {
    const palette = CLASS_PALETTES[classId];
    group.userData.classId = classId;
    group.userData.self = self;
    group.userData.dead = false;
    group.userData.hitPulse = 0;
    group.userData.moveAmount = 0;
    group.userData.lastVisualPosition = group.position.clone();

    const visual = new THREE.Group();
    visual.name = 'visual';
    group.add(visual);

    const skin = this.material(0xefc39f, 0.78);
    const primary = this.material(palette.primary, 0.58, classId === 'warrior' ? 0.18 : 0.02);
    const secondary = this.material(palette.secondary, 0.72, classId === 'warrior' ? 0.24 : 0.02);
    const accent = this.material(palette.accent, 0.34, classId === 'warrior' || classId === 'cleric' ? 0.62 : 0.15);
    const cloth = this.material(palette.cloth, 0.88);
    const dark = this.material(0x201e22, 0.78);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 24),
      new THREE.MeshBasicMaterial({ color: 0x071014, transparent: true, opacity: self ? 0.31 : 0.22, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.018;
    shadow.scale.z = 0.58;
    group.add(shadow);

    if (self) {
      const selfRing = new THREE.Mesh(
        new THREE.RingGeometry(0.7, 0.75, 36),
        new THREE.MeshBasicMaterial({ color: palette.accent, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
      );
      selfRing.rotation.x = -Math.PI / 2;
      selfRing.position.y = 0.026;
      group.add(selfRing);
    }

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.48, 5, 10), primary);
    torso.position.y = 1.23;
    torso.scale.z = 0.78;
    visual.add(torso);

    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 6, 18), accent);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.97;
    belt.scale.z = 0.78;
    visual.add(belt);

    const leftLeg = this.makeLimb('leftLeg', -0.2, 0.78, secondary, 0.11, 0.45);
    const rightLeg = this.makeLimb('rightLeg', 0.2, 0.78, secondary, 0.11, 0.45);
    visual.add(leftLeg, rightLeg);

    for (const x of [-0.2, 0.2]) {
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.25, 0.4), dark);
      boot.position.set(x, 0.15, 0.07);
      boot.rotation.x = -0.08;
      visual.add(boot);
    }

    const leftArm = this.makeLimb('leftArm', -0.47, 1.52, primary, 0.105, 0.43);
    const rightArm = this.makeLimb('rightArm', 0.47, 1.52, primary, 0.105, 0.43);
    leftArm.rotation.z = -0.08;
    rightArm.rotation.z = 0.08;
    visual.add(leftArm, rightArm);

    const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), skin);
    leftHand.position.set(-0.49, 0.95, 0.02);
    const rightHand = leftHand.clone();
    rightHand.position.x = 0.49;
    visual.add(leftHand, rightHand);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.18, 10), skin);
    neck.position.y = 1.7;
    visual.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), skin);
    head.position.y = 1.96;
    head.scale.set(0.96, 1.03, 0.94);
    visual.add(head);

    const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xf7f5e9 });
    const pupil = new THREE.MeshBasicMaterial({ color: 0x17202a });
    for (const x of [-0.12, 0.12]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 6), eyeWhite);
      eye.position.set(x, 2.005, 0.303);
      eye.scale.y = 1.15;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.026, 6, 5), pupil);
      dot.position.set(0, 0, 0.047);
      eye.add(dot);
      visual.add(eye);
    }

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 6), skin);
    nose.position.set(0, 1.94, 0.34);
    nose.rotation.x = Math.PI / 2;
    visual.add(nose);

    if (classId === 'warrior') this.decorateWarrior(visual, accent, secondary, cloth);
    if (classId === 'mage') this.decorateMage(visual, accent, secondary, cloth, palette.accent);
    if (classId === 'cleric') this.decorateCleric(visual, accent, secondary, cloth, palette.accent);

    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = object !== shadow;
        object.receiveShadow = true;
      }
    });
  }

  private makeLimb(
    name: string,
    x: number,
    y: number,
    material: THREE.Material,
    radius: number,
    length: number,
  ): THREE.Group {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material);
    mesh.position.y = -length * 0.55;
    pivot.add(mesh);
    return pivot;
  }

  private decorateWarrior(
    visual: THREE.Group,
    accent: THREE.Material,
    secondary: THREE.Material,
    cloth: THREE.Material,
  ): void {
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.46, 0.12), secondary);
    chest.position.set(0, 1.34, 0.28);
    chest.rotation.x = -0.08;
    visual.add(chest);

    for (const x of [-0.48, 0.48]) {
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 7), accent);
      pauldron.position.set(x, 1.54, 0);
      pauldron.scale.set(1.15, 0.62, 1);
      visual.add(pauldron);
    }

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.37, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.58), secondary);
    helmet.position.y = 2.03;
    visual.add(helmet);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.38, 0.42), cloth);
    crest.position.set(0, 2.32, -0.02);
    crest.rotation.x = -0.18;
    visual.add(crest);

    const weapon = new THREE.Group();
    weapon.position.set(0.61, 1.02, 0.04);
    weapon.rotation.z = -0.18;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 8), this.material(0x4d3527, 0.8));
    grip.position.y = 0.17;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.1), accent);
    guard.position.y = 0.37;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.82, 0.065), this.material(0xc8d0d6, 0.28, 0.82));
    blade.position.y = 0.82;
    blade.scale.x = 0.82;
    weapon.add(grip, guard, blade);
    visual.add(weapon);

    const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.09, 10), secondary);
    shield.position.set(-0.55, 1.08, 0.18);
    shield.rotation.x = Math.PI / 2;
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), accent);
    boss.position.z = 0.06;
    shield.add(boss);
    visual.add(shield);
  }

  private decorateMage(
    visual: THREE.Group,
    accent: THREE.Material,
    secondary: THREE.Material,
    cloth: THREE.Material,
    glowColor: number,
  ): void {
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.95, 12), cloth);
    robe.position.y = 0.72;
    visual.add(robe);

    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.56, 12), secondary);
    hood.position.set(0, 2.3, -0.02);
    hood.rotation.z = -0.06;
    visual.add(hood);
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.045, 6, 18), accent);
    brim.position.y = 2.08;
    brim.rotation.x = Math.PI / 2;
    visual.add(brim);

    const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), this.emissiveMaterial(glowColor, 1.8));
    rune.position.set(0, 1.38, 0.38);
    rune.rotation.z = Math.PI / 4;
    visual.add(rune);

    const staff = new THREE.Group();
    staff.position.set(0.62, 1.03, 0.02);
    staff.rotation.z = -0.16;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.52, 8), this.material(0x62452e, 0.9));
    shaft.position.y = 0.3;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 6, 12), accent);
    collar.position.y = 1.08;
    collar.rotation.x = Math.PI / 2;
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 1), this.emissiveMaterial(glowColor, 2.35));
    orb.position.y = 1.25;
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.27, 0.018, 6, 24),
      new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.7 }),
    );
    halo.position.y = 1.25;
    halo.rotation.x = Math.PI / 2;
    staff.add(shaft, collar, orb, halo);
    visual.add(staff);
  }

  private decorateCleric(
    visual: THREE.Group,
    accent: THREE.Material,
    secondary: THREE.Material,
    cloth: THREE.Material,
    glowColor: number,
  ): void {
    const tabard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.72, 0.08), cloth);
    tabard.position.set(0, 1.03, 0.34);
    visual.add(tabard);

    const crossVertical = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.055), this.emissiveMaterial(glowColor, 1.2));
    crossVertical.position.set(0, 1.4, 0.4);
    const crossHorizontal = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.055), crossVertical.material);
    crossHorizontal.position.set(0, 1.44, 0.4);
    visual.add(crossVertical, crossHorizontal);

    const circlet = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.035, 6, 20), accent);
    circlet.position.y = 2.06;
    circlet.rotation.x = Math.PI / 2;
    visual.add(circlet);

    for (const x of [-0.47, 0.47]) {
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 7), accent);
      pauldron.position.set(x, 1.53, 0);
      pauldron.scale.set(1.12, 0.52, 0.9);
      visual.add(pauldron);
    }

    const mace = new THREE.Group();
    mace.position.set(0.6, 1.05, 0.02);
    mace.rotation.z = -0.18;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.95, 8), secondary);
    handle.position.y = 0.3;
    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), accent);
    head.position.y = 0.86;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), this.emissiveMaterial(glowColor, 1.8));
    gem.position.set(0, 0.86, 0.19);
    mace.add(handle, head, gem);
    visual.add(mace);
  }

  private makeSlime(): THREE.Group {
    const group = new THREE.Group();
    group.userData.hitPulse = 0;
    group.userData.dead = false;

    const blob = new THREE.Mesh(
      new THREE.SphereGeometry(0.86, 24, 16),
      new THREE.MeshPhysicalMaterial({
        color: 0x54d88b,
        roughness: 0.22,
        metalness: 0.02,
        clearcoat: 0.72,
        clearcoatRoughness: 0.18,
        transparent: true,
        opacity: 0.94,
      }),
    );
    blob.name = 'slimeBlob';
    blob.scale.set(1, 0.72, 1);
    blob.position.y = 0.68;
    blob.userData.entity = 'monster';
    blob.castShadow = true;
    blob.receiveShadow = true;
    group.add(blob);

    const lower = new THREE.Mesh(
      new THREE.SphereGeometry(0.67, 18, 12),
      this.material(0x38b86d, 0.42),
    );
    lower.scale.set(1.18, 0.3, 1.05);
    lower.position.set(0, 0.27, -0.02);
    lower.userData.entity = 'monster';
    lower.castShadow = true;
    group.add(lower);

    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), this.emissiveMaterial(0x9bffd0, 1.25));
    core.name = 'slimeCore';
    core.position.set(0, 0.58, -0.08);
    group.add(core);

    const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xf7fff9, roughness: 0.35 });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x13251c });
    for (const x of [-0.25, 0.25]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 9), eyeWhite);
      eye.position.set(x, 0.79, 0.65);
      eye.scale.y = 1.15;
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 6), pupilMat);
      pupil.position.z = 0.095;
      eye.add(pupil);
      blob.add(eye);
    }

    const mouth = new THREE.Mesh(
      new THREE.TorusGeometry(0.15, 0.025, 6, 16, Math.PI),
      new THREE.MeshBasicMaterial({ color: 0x173426 }),
    );
    mouth.position.set(0, 0.59, 0.79);
    mouth.rotation.z = Math.PI;
    group.add(mouth);

    const sprout = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.32, 8), this.material(0x7bf2aa, 0.42));
    sprout.position.set(0.1, 1.25, -0.05);
    sprout.rotation.z = -0.28;
    sprout.userData.entity = 'monster';
    group.add(sprout);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.78, 24),
      new THREE.MeshBasicMaterial({ color: 0x06130d, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.018;
    shadow.scale.z = 0.62;
    group.add(shadow);
    return group;
  }

  private makeTargetRing(): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: 0xffd56a, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false });
    const outer = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.08, 48), material);
    outer.rotation.x = -Math.PI / 2;
    group.add(outer);
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 0.82, 40),
      new THREE.MeshBasicMaterial({ color: 0xffedab, side: THREE.DoubleSide, transparent: true, opacity: 0.42, depthWrite: false }),
    );
    inner.rotation.x = -Math.PI / 2;
    group.add(inner);
    for (let index = 0; index < 4; index += 1) {
      const marker = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 5), material);
      const angle = (Math.PI * 2 * index) / 4;
      marker.position.set(Math.sin(angle) * 1.18, 0.04, Math.cos(angle) * 1.18);
      marker.rotation.x = Math.PI / 2;
      marker.rotation.z = -angle;
      group.add(marker);
    }
    group.visible = false;
    return group;
  }

  private addEnvironment(): void {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(21, 80),
      new THREE.MeshStandardMaterial({ color: 0x485e43, roughness: 0.96, metalness: 0, flatShading: true }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const innerGround = new THREE.Mesh(
      new THREE.CircleGeometry(15.3, 64),
      new THREE.MeshStandardMaterial({ color: 0x607750, roughness: 1, flatShading: true }),
    );
    innerGround.rotation.x = -Math.PI / 2;
    innerGround.position.y = 0.012;
    innerGround.receiveShadow = true;
    this.scene.add(innerGround);

    const arenaLine = new THREE.Mesh(
      new THREE.RingGeometry(13.8, 14.05, 64),
      new THREE.MeshStandardMaterial({ color: 0x9b8a62, roughness: 0.82, flatShading: true }),
    );
    arenaLine.rotation.x = -Math.PI / 2;
    arenaLine.position.y = 0.025;
    this.scene.add(arenaLine);

    const stoneMat = this.material(0x747a73, 0.96);
    const mossMat = this.material(0x3e6843, 0.94);
    const trunkMat = this.material(0x65462f, 0.94);
    const leafDark = this.material(0x274d35, 0.9);
    const leafLight = this.material(0x3f7048, 0.88);

    const stones: Array<[number, number, number]> = [
      [-9, -7, 1.15], [8, -6, 0.85], [-11, 5, 0.72], [10, 7, 1.25],
      [-15, -9, 1.4], [14, -10, 1.1], [-16, 8, 1.2], [16, 9, 1.45],
    ];
    for (const [x, z, scale] of stones) {
      const cluster = new THREE.Group();
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(scale, 0), stoneMat);
      rock.position.y = scale * 0.55;
      rock.rotation.set(0.18, x * 0.17, 0.12);
      rock.scale.z = 0.78;
      rock.castShadow = true;
      rock.receiveShadow = true;
      cluster.add(rock);
      const moss = new THREE.Mesh(new THREE.DodecahedronGeometry(scale * 0.58, 0), mossMat);
      moss.position.set(-scale * 0.18, scale * 0.88, scale * 0.06);
      moss.scale.y = 0.22;
      cluster.add(moss);
      cluster.position.set(x, 0, z);
      this.scene.add(cluster);
    }

    const trees: Array<[number, number, number]> = [
      [-13, -2, 1], [13, 2, 1.08], [-8, 12, 0.92], [8, -12, 1.02],
      [-16, 2, 0.88], [16, -3, 0.9],
    ];
    for (const [x, z, scale] of trees) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 1.8, 7), trunkMat);
      trunk.position.y = 0.9;
      trunk.castShadow = true;
      const crownLow = new THREE.Mesh(new THREE.ConeGeometry(1.18, 2.15, 9), leafDark);
      crownLow.position.y = 2.05;
      crownLow.castShadow = true;
      const crownHigh = new THREE.Mesh(new THREE.ConeGeometry(0.84, 1.72, 8), leafLight);
      crownHigh.position.y = 3.05;
      crownHigh.castShadow = true;
      tree.add(trunk, crownLow, crownHigh);
      tree.position.set(x, 0, z);
      tree.scale.setScalar(scale);
      tree.rotation.y = x * 0.27;
      this.scene.add(tree);
    }

    const grassMat = this.material(0x6e8c51, 0.96);
    for (let index = 0; index < 34; index += 1) {
      const angle = index * 2.399963;
      const radius = 5.5 + (index % 7) * 1.8;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (Math.abs(x) < 2.2 && z > -5 && z < 10) continue;
      const tuft = new THREE.Group();
      for (let blade = 0; blade < 3; blade += 1) {
        const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.42 + blade * 0.04, 4), grassMat);
        mesh.position.set((blade - 1) * 0.09, 0.2, 0);
        mesh.rotation.z = (blade - 1) * 0.18;
        tuft.add(mesh);
      }
      tuft.position.set(x, 0.02, z);
      tuft.rotation.y = angle;
      this.scene.add(tuft);
    }

    const crystalPositions: Array<[number, number]> = [[-12, 9], [12, -8], [-14, -11], [14, 11]];
    for (const [x, z] of crystalPositions) {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.5, 0.35, 8), stoneMat);
      pedestal.position.set(x, 0.18, z);
      pedestal.castShadow = true;
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), this.emissiveMaterial(0x71c9ff, 1.6));
      crystal.position.set(x, 0.72, z);
      crystal.scale.y = 1.5;
      crystal.castShadow = true;
      this.scene.add(pedestal, crystal);
      const light = new THREE.PointLight(0x70c8ff, 1.2, 4.5, 2);
      light.position.set(x, 0.85, z);
      this.scene.add(light);
    }
  }

  private updateCharacterGroup(group: THREE.Group, player: PlayerSnapshot): void {
    this.setEntityTarget(group, player.position, player.rotation);
    group.userData.dead = player.dead;
    group.visible = true;
  }

  private updateSlime(monster: MonsterSnapshot): void {
    this.setEntityTarget(this.slimeGroup, monster.position, monster.rotation);
    this.slimeGroup.userData.dead = monster.dead;
    this.slimeGroup.visible = !monster.dead;
  }

  private setEntityTarget(group: THREE.Group, position: Vec3, rotation: number): void {
    const target = new THREE.Vector3(position.x, 0, position.z);
    group.userData.targetPosition = target;
    group.userData.targetRotation = rotation;
    if (!group.userData.transformInitialized) {
      group.position.copy(target);
      group.rotation.y = rotation;
      group.userData.transformInitialized = true;
      group.userData.lastVisualPosition = target.clone();
    }
  }

  private animateEntityTransform(group: THREE.Group, dt: number): void {
    const target = group.userData.targetPosition as THREE.Vector3 | undefined;
    if (target) group.position.lerp(target, 1 - Math.exp(-dt * 18));
    const targetRotation = group.userData.targetRotation as number | undefined;
    if (targetRotation !== undefined) {
      const delta = Math.atan2(Math.sin(targetRotation - group.rotation.y), Math.cos(targetRotation - group.rotation.y));
      group.rotation.y += delta * (1 - Math.exp(-dt * 20));
    }
  }

  private animateCharacter(group: THREE.Group, dt: number): void {
    const visual = group.getObjectByName('visual');
    if (!visual) return;
    const last = (group.userData.lastVisualPosition as THREE.Vector3 | undefined) ?? group.position.clone();
    const speed = group.position.distanceTo(last) / Math.max(dt, 0.001);
    last.copy(group.position);
    group.userData.lastVisualPosition = last;
    const targetMove = THREE.MathUtils.clamp(speed / 4, 0, 1);
    group.userData.moveAmount = THREE.MathUtils.lerp(group.userData.moveAmount as number, targetMove, 1 - Math.exp(-dt * 10));
    const move = group.userData.moveAmount as number;
    const phase = this.elapsed * (7.5 + move * 5.5);

    visual.position.y = Math.sin(this.elapsed * 2.3) * 0.018 + Math.abs(Math.sin(phase)) * 0.045 * move;
    visual.rotation.z = Math.sin(phase) * 0.018 * move;

    const leftLeg = visual.getObjectByName('leftLeg');
    const rightLeg = visual.getObjectByName('rightLeg');
    const leftArm = visual.getObjectByName('leftArm');
    const rightArm = visual.getObjectByName('rightArm');
    const swing = Math.sin(phase) * 0.62 * move;
    if (leftLeg) leftLeg.rotation.x = swing;
    if (rightLeg) rightLeg.rotation.x = -swing;
    if (leftArm) leftArm.rotation.x = -swing * 0.62;
    if (rightArm) rightArm.rotation.x = swing * 0.62;

    let pulse = (group.userData.hitPulse as number | undefined) ?? 0;
    pulse = Math.max(0, pulse - dt * 6.5);
    group.userData.hitPulse = pulse;
    const dead = Boolean(group.userData.dead);
    group.scale.setScalar(dead ? 0.02 : 1 + pulse * 0.08);
  }

  private animateSlime(dt: number): void {
    const blob = this.slimeGroup.getObjectByName('slimeBlob');
    const core = this.slimeGroup.getObjectByName('slimeCore');
    if (!blob) return;
    const bounce = Math.sin(this.elapsed * 4.5);
    blob.scale.set(1 + bounce * 0.035, 0.72 - bounce * 0.045, 1 + bounce * 0.035);
    blob.position.y = 0.68 + Math.abs(bounce) * 0.055;
    if (core) {
      core.rotation.x += dt * 0.75;
      core.rotation.y += dt * 1.1;
      core.scale.setScalar(1 + Math.sin(this.elapsed * 3.2) * 0.08);
    }
    let pulse = (this.slimeGroup.userData.hitPulse as number | undefined) ?? 0;
    pulse = Math.max(0, pulse - dt * 7);
    this.slimeGroup.userData.hitPulse = pulse;
    this.slimeGroup.scale.setScalar(1 + pulse * 0.1);
  }

  private entityPosition(id: string | null): THREE.Vector3 | null {
    if (!id) return null;
    if (id === this.selfId) return this.selfGroup.position.clone();
    if (id === this.monsterId) return this.slimeGroup.position.clone();
    return this.others.get(id)?.position.clone() ?? null;
  }

  private castVfx(event: Extract<CombatEvent, { kind: 'cast' }>): void {
    const from = this.entityPosition(event.sourceId) ?? new THREE.Vector3(event.at.x, event.at.y, event.at.z);
    const to = this.entityPosition(event.targetId) ?? from.clone().add(new THREE.Vector3(0, 0, -2));
    if (['mage-basic', 'fireball', 'frost-bolt', 'holy-bolt'].includes(event.abilityId)) {
      this.projectile(from, to, event.abilityId);
      return;
    }
    if (event.abilityId === 'heal') {
      this.healVfx({ x: from.x, y: from.y, z: from.z });
      return;
    }
    this.slashVfx(from, event.abilityId === 'whirlwind');
  }

  private projectile(from: THREE.Vector3, to: THREE.Vector3, id: string): void {
    const colors: Record<string, number> = {
      'mage-basic': 0xa884ff,
      fireball: 0xff7138,
      'frost-bolt': 0x6fdcff,
      'holy-bolt': 0xffe589,
    };
    const color = colors[id] ?? 0xffffff;
    const projectile = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(id === 'fireball' ? 0.24 : 0.17, 1),
      this.emissiveMaterial(color, 2.2),
    );
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(id === 'fireball' ? 0.38 : 0.28, 12, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    projectile.add(core, aura);
    const light = new THREE.PointLight(color, id === 'fireball' ? 2.5 : 1.5, 4, 2);
    projectile.add(light);
    from.y += 1.25;
    to.y += 0.72;
    projectile.position.copy(from);
    this.scene.add(projectile);
    let t = 0;
    this.effects.push({
      update: (dt) => {
        t += dt / 0.3;
        const eased = THREE.MathUtils.smoothstep(Math.min(t, 1), 0, 1);
        projectile.position.lerpVectors(from, to, eased);
        projectile.position.y += Math.sin(Math.min(t, 1) * Math.PI) * 0.3;
        projectile.rotation.x += dt * 7;
        projectile.rotation.y += dt * 10;
        aura.scale.setScalar(1 + Math.sin(t * Math.PI * 5) * 0.12);
        if (t >= 1) {
          this.scene.remove(projectile);
          return true;
        }
        return false;
      },
    });
  }

  private slashVfx(at: THREE.Vector3, wide: boolean): void {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(wide ? 1.35 : 0.9, wide ? 0.09 : 0.07, 7, 32, wide ? Math.PI * 1.8 : Math.PI),
      new THREE.MeshBasicMaterial({ color: 0xffe6b2, transparent: true, opacity: 0.92, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    const inner = new THREE.Mesh(
      new THREE.TorusGeometry(wide ? 1.12 : 0.72, 0.025, 5, 28, wide ? Math.PI * 1.8 : Math.PI),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65, depthWrite: false }),
    );
    inner.rotation.x = -Math.PI / 2;
    group.add(mesh, inner);
    group.position.copy(at);
    group.position.y = 0.58;
    this.scene.add(group);
    let life = 0.28;
    this.effects.push({
      update: (dt) => {
        life -= dt;
        group.rotation.y += dt * 8;
        group.scale.multiplyScalar(1 + dt * 1.1);
        (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, life / 0.28);
        (inner.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (life / 0.28) * 0.65);
        if (life <= 0) {
          this.scene.remove(group);
          return true;
        }
        return false;
      },
    });
  }

  private healVfx(at: Vec3): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.65, 0.74, 32),
      new THREE.MeshBasicMaterial({ color: 0x9dffb5, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, 0.06, at.z);
    this.scene.add(ring);

    const particles: THREE.Mesh[] = [];
    for (let index = 0; index < 12; index += 1) {
      const particle = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.06, 0),
        this.emissiveMaterial(0x9dffb5, 1.7),
      );
      const angle = (index / 12) * Math.PI * 2;
      const radius = 0.35 + Math.random() * 0.45;
      particle.position.set(at.x + Math.cos(angle) * radius, 0.12 + Math.random() * 0.45, at.z + Math.sin(angle) * radius);
      particles.push(particle);
      this.scene.add(particle);
    }
    let life = 0.9;
    this.effects.push({
      update: (dt) => {
        life -= dt;
        ring.rotation.z += dt * 1.6;
        ring.scale.multiplyScalar(1 + dt * 0.8);
        (ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (life / 0.9) * 0.7);
        for (const particle of particles) {
          particle.position.y += dt * 1.55;
          particle.rotation.y += dt * 4;
        }
        if (life <= 0) {
          this.scene.remove(ring);
          for (const particle of particles) this.scene.remove(particle);
          return true;
        }
        return false;
      },
    });
  }

  private deathVfx(at: Vec3): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 1.55, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, 0.08, at.z);
    this.scene.add(ring);
    let life = 0.48;
    this.effects.push({
      update: (dt) => {
        life -= dt;
        ring.scale.multiplyScalar(1 + dt * 3);
        (ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, life / 0.48);
        if (life <= 0) {
          this.scene.remove(ring);
          return true;
        }
        return false;
      },
    });
  }

  private hitFlash(targetId: string): void {
    const group = targetId === this.selfId
      ? this.selfGroup
      : targetId === this.monsterId
        ? this.slimeGroup
        : this.others.get(targetId);
    if (!group) return;
    group.userData.hitPulse = 1;
  }

  private floatingText(text: string, at: Vec3, color: string): void {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 112;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.font = '800 44px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = color;
    context.strokeStyle = 'rgba(5, 10, 14, .88)';
    context.lineWidth = 9;
    context.strokeText(text, 160, 56);
    context.fillText(text, 160, 56);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(3.05, 1.08, 1);
    sprite.position.set(at.x, 2.25, at.z);
    this.scene.add(sprite);
    let life = 0.82;
    this.effects.push({
      update: (dt) => {
        life -= dt;
        sprite.position.y += dt * 1.18;
        sprite.scale.multiplyScalar(1 + dt * 0.12);
        material.opacity = Math.max(0, life / 0.82);
        if (life <= 0) {
          this.scene.remove(sprite);
          texture.dispose();
          material.dispose();
          return true;
        }
        return false;
      },
    });
  }
}
