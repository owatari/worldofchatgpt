import * as THREE from 'three';
import {
  STARTER_VISUAL_EQUIPMENT,
  type ClassId,
  type CombatEvent,
  type MonsterSnapshot,
  type PlayerSnapshot,
  type Vec3,
  type VisualEquipment,
} from '@worldofchatgpt/shared';

interface Snapshot {
  self: PlayerSnapshot;
  players: PlayerSnapshot[];
  monster: MonsterSnapshot;
  selectedTargetId: string | null;
}

interface Effect {
  update: (dt: number) => boolean;
}

type SurfaceKind = 'skin' | 'cloth' | 'leather' | 'metal' | 'wood' | 'gem';
type CharacterAction = 'idle' | 'walk' | 'attack' | 'cast' | 'dying' | 'dead';

interface TimedAction {
  type: CharacterAction;
  startedAt: number;
  duration: number;
}

interface CharacterRig {
  visual: THREE.Group;
  hips: THREE.Bone;
  spine: THREE.Bone;
  chest: THREE.Bone;
  neck: THREE.Bone;
  head: THREE.Bone;
  leftUpperArm: THREE.Bone;
  leftForearm: THREE.Bone;
  leftHand: THREE.Bone;
  rightUpperArm: THREE.Bone;
  rightForearm: THREE.Bone;
  rightHand: THREE.Bone;
  leftThigh: THREE.Bone;
  leftShin: THREE.Bone;
  leftFoot: THREE.Bone;
  rightThigh: THREE.Bone;
  rightShin: THREE.Bone;
  rightFoot: THREE.Bone;
  hairRoot: THREE.Group;
  headSlot: THREE.Group;
  shouldersSlot: THREE.Group;
  chestSlot: THREE.Group;
  handsSlot: THREE.Group;
  legsSlot: THREE.Group;
  feetSlot: THREE.Group;
  accessorySlot: THREE.Group;
  weaponSocket: THREE.Group;
  offhandSocket: THREE.Group;
}

interface ClassPalette {
  primary: number;
  secondary: number;
  accent: number;
  dark: number;
  hair: number;
}

const CLASS_PALETTES: Record<ClassId, ClassPalette> = {
  warrior: { primary: 0x8e3036, secondary: 0x343038, accent: 0xd6b05d, dark: 0x242329, hair: 0x3a241c },
  mage: { primary: 0x5c4aa7, secondary: 0x26213f, accent: 0x79cff8, dark: 0x171827, hair: 0x211b31 },
  cleric: { primary: 0xd8cba5, secondary: 0x735735, accent: 0xe7c058, dark: 0x382f28, hair: 0x6c4330 },
};

const MELEE_ABILITIES = new Set(['warrior-basic', 'power-strike', 'whirlwind', 'cleric-basic']);

export class GameEngine {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly selfGroup = new THREE.Group();
  private readonly slimeGroup = this.makeSlime();
  private readonly others = new Map<string, THREE.Group>();
  private readonly effects: Effect[] = [];
  private readonly targetRing = this.makeTargetRing();
  private readonly cameraFocus = new THREE.Vector3(0, 1.1, 0);
  private readonly textureCache = new Map<string, THREE.CanvasTexture>();
  private readonly materialCache = new Map<string, THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial>();
  private frame = 0;
  private elapsed = 0;
  private selfId = '';
  private monsterId = '';
  private cameraYaw = 0;
  private cameraPitch = 0.65;
  private cameraDistance = 14.5;
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
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.domElement.style.touchAction = 'none';
    this.container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x101820);
    this.scene.fog = new THREE.Fog(0x101820, 28, 62);
    this.addLighting();
    this.addEnvironment();
    this.scene.add(this.selfGroup, this.slimeGroup, this.targetRing);

    this.camera.position.set(0, 9.5, 12);
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

    this.ensureCharacterAppearance(this.selfGroup, snapshot.self, true);
    this.updateCharacterGroup(this.selfGroup, snapshot.self);
    this.updateSlime(snapshot.monster);

    const liveIds = new Set(snapshot.players.map((player) => player.entityId));
    for (const player of snapshot.players) {
      let group = this.others.get(player.entityId);
      if (!group) {
        group = new THREE.Group();
        this.others.set(player.entityId, group);
        this.scene.add(group);
      }
      this.ensureCharacterAppearance(group, player, false);
      this.updateCharacterGroup(group, player);
    }

    for (const [id, group] of this.others) {
      if (liveIds.has(id)) continue;
      this.disposeObject(group);
      this.scene.remove(group);
      this.others.delete(id);
    }

    this.targetRing.visible = snapshot.selectedTargetId === snapshot.monster.entityId && !snapshot.monster.dead;
  }

  combat(event: CombatEvent): void {
    if (event.kind === 'cast') {
      if (event.sourceId === this.monsterId) {
        this.slimeGroup.userData.attackPulse = 1;
      } else {
        const source = this.entityGroup(event.sourceId);
        if (source) this.triggerCharacterAction(source, MELEE_ABILITIES.has(event.abilityId) ? 'attack' : 'cast');
      }
      this.castVfx(event);
      return;
    }

    if (event.kind === 'damage') {
      this.floatingText(`-${event.amount}`, event.at, '#ff756f');
      this.hitFlash(event.targetId);
      return;
    }

    if (event.kind === 'heal') {
      this.floatingText(`+${event.amount}`, event.at, '#78f2a0');
      this.healVfx(event.at);
      return;
    }

    if (event.kind === 'death') {
      const target = this.entityGroup(event.targetId);
      if (target && event.targetId !== this.monsterId) this.triggerCharacterAction(target, 'dying', 0.9);
      this.deathVfx(event.at);
      return;
    }

    if (event.kind === 'xp' && event.sourceId === this.selfId) {
      this.floatingText(`+${event.amount} XP`, event.at, '#ffd56a');
    }
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
    for (const texture of this.textureCache.values()) texture.dispose();
    for (const material of this.materialCache.values()) material.dispose();
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
    this.cameraYaw -= dx * 0.006;
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + dy * 0.004, 0.28, 1.18);
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
    this.cameraDistance = THREE.MathUtils.clamp(this.cameraDistance + event.deltaY * 0.011, 7.5, 23);
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
    const focusTarget = new THREE.Vector3(focus.x, focus.y + 1.15, focus.z);
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
    this.targetRing.rotation.y += dt * 0.55;

    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      if (this.effects[index]?.update(dt)) this.effects.splice(index, 1);
    }

    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  };

  private addLighting(): void {
    const hemi = new THREE.HemisphereLight(0xc9e7ff, 0x1c271f, 1.5);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffe5bc, 4.1);
    sun.position.set(-11, 18, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 48;
    sun.shadow.bias = -0.00045;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x6c9dff, 0.9);
    rim.position.set(10, 7, -13);
    this.scene.add(rim);
  }

  private ensureCharacterAppearance(group: THREE.Group, player: PlayerSnapshot, self: boolean): void {
    const equipment = player.equipment ?? STARTER_VISUAL_EQUIPMENT[player.classId];
    const key = `${player.classId}:${self ? 'self' : 'other'}:${this.equipmentKey(equipment)}`;
    if (group.userData.appearanceKey === key) return;

    group.clear();
    group.userData.appearanceKey = key;
    group.userData.classId = player.classId;
    group.userData.dead = player.dead;
    group.userData.hitPulse = 0;
    group.userData.moveAmount = 0;
    group.userData.lastVisualPosition = group.position.clone();
    group.userData.action = undefined;

    const rig = this.buildCharacterRig(player.classId, self, equipment);
    group.userData.rig = rig;
    group.add(rig.visual);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.58, 32),
      new THREE.MeshBasicMaterial({ color: 0x05090d, transparent: true, opacity: self ? 0.3 : 0.22, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.z = 0.58;
    shadow.position.y = 0.018;
    group.add(shadow);

    if (self) {
      const palette = CLASS_PALETTES[player.classId];
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.69, 0.735, 42),
        new THREE.MeshBasicMaterial({ color: palette.accent, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.025;
      group.add(ring);
    }

    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = !object.material.transparent || object.material.opacity > 0.6;
      object.receiveShadow = true;
    });
  }

  private buildCharacterRig(classId: ClassId, self: boolean, equipment: VisualEquipment): CharacterRig {
    const palette = CLASS_PALETTES[classId];
    const visual = new THREE.Group();
    visual.name = 'visual';
    visual.scale.setScalar(self ? 1.02 : 1);

    const hips = this.bone('hips', 0, 0.86, 0);
    const spine = this.bone('spine', 0, 0.23, 0);
    const chest = this.bone('chest', 0, 0.34, 0);
    const neck = this.bone('neck', 0, 0.34, 0);
    const head = this.bone('head', 0, 0.18, 0);
    hips.add(spine);
    spine.add(chest);
    chest.add(neck);
    neck.add(head);
    visual.add(hips);

    const leftUpperArm = this.bone('leftUpperArm', -0.42, 0.23, 0);
    const leftForearm = this.bone('leftForearm', 0, -0.43, 0);
    const leftHand = this.bone('leftHand', 0, -0.36, 0);
    const rightUpperArm = this.bone('rightUpperArm', 0.42, 0.23, 0);
    const rightForearm = this.bone('rightForearm', 0, -0.43, 0);
    const rightHand = this.bone('rightHand', 0, -0.36, 0);
    chest.add(leftUpperArm, rightUpperArm);
    leftUpperArm.add(leftForearm);
    leftForearm.add(leftHand);
    rightUpperArm.add(rightForearm);
    rightForearm.add(rightHand);

    const leftThigh = this.bone('leftThigh', -0.19, -0.02, 0);
    const leftShin = this.bone('leftShin', 0, -0.48, 0);
    const leftFoot = this.bone('leftFoot', 0, -0.43, 0.08);
    const rightThigh = this.bone('rightThigh', 0.19, -0.02, 0);
    const rightShin = this.bone('rightShin', 0, -0.48, 0);
    const rightFoot = this.bone('rightFoot', 0, -0.43, 0.08);
    hips.add(leftThigh, rightThigh);
    leftThigh.add(leftShin);
    leftShin.add(leftFoot);
    rightThigh.add(rightShin);
    rightShin.add(rightFoot);

    const skin = this.surfaceMaterial(`skin-${classId}`, 'skin', 0xeabf9b);
    const underCloth = this.surfaceMaterial(`undercloth-${classId}`, 'cloth', palette.dark);

    this.attachCapsule(spine, 0.28, 0.43, underCloth, new THREE.Vector3(0, 0.16, 0), new THREE.Vector3(1, 1, 0.82));
    this.attachCapsule(leftUpperArm, 0.105, 0.3, underCloth, new THREE.Vector3(0, -0.22, 0));
    this.attachCapsule(rightUpperArm, 0.105, 0.3, underCloth, new THREE.Vector3(0, -0.22, 0));
    this.attachCapsule(leftForearm, 0.095, 0.24, skin, new THREE.Vector3(0, -0.18, 0));
    this.attachCapsule(rightForearm, 0.095, 0.24, skin, new THREE.Vector3(0, -0.18, 0));
    this.attachCapsule(leftThigh, 0.12, 0.34, underCloth, new THREE.Vector3(0, -0.24, 0));
    this.attachCapsule(rightThigh, 0.12, 0.34, underCloth, new THREE.Vector3(0, -0.24, 0));
    this.attachCapsule(leftShin, 0.1, 0.29, underCloth, new THREE.Vector3(0, -0.21, 0));
    this.attachCapsule(rightShin, 0.1, 0.29, underCloth, new THREE.Vector3(0, -0.21, 0));

    const leftPalm = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), skin);
    leftPalm.scale.set(0.9, 1.08, 0.82);
    leftHand.add(leftPalm);
    const rightPalm = leftPalm.clone();
    rightHand.add(rightPalm);

    const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.115, 0.19, 12), skin);
    neckMesh.position.y = 0.04;
    neck.add(neckMesh);

    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.33, 24, 18), skin);
    headMesh.position.y = 0.24;
    headMesh.scale.set(0.94, 1.04, 0.9);
    head.add(headMesh);

    this.buildFace(head, skin);
    const hairRoot = new THREE.Group();
    hairRoot.name = 'hairRoot';
    head.add(hairRoot);
    this.buildHair(hairRoot, classId, palette.hair, equipment.head);

    const headSlot = this.slot(head, 'headSlot');
    const shouldersSlot = this.slot(chest, 'shouldersSlot');
    const chestSlot = this.slot(spine, 'chestSlot');
    const handsSlot = this.slot(visual, 'handsSlot');
    const legsSlot = this.slot(hips, 'legsSlot');
    const feetSlot = this.slot(visual, 'feetSlot');
    const accessorySlot = this.slot(chest, 'accessorySlot');
    const weaponSocket = this.slot(rightHand, 'weaponSocket');
    const offhandSocket = this.slot(leftHand, 'offhandSocket');

    const rig: CharacterRig = {
      visual,
      hips,
      spine,
      chest,
      neck,
      head,
      leftUpperArm,
      leftForearm,
      leftHand,
      rightUpperArm,
      rightForearm,
      rightHand,
      leftThigh,
      leftShin,
      leftFoot,
      rightThigh,
      rightShin,
      rightFoot,
      hairRoot,
      headSlot,
      shouldersSlot,
      chestSlot,
      handsSlot,
      legsSlot,
      feetSlot,
      accessorySlot,
      weaponSocket,
      offhandSocket,
    };

    this.buildEquipmentSlots({ classId, palette, equipment, rig });
    return rig;
  }

  private buildFace(head: THREE.Bone, skin: THREE.Material): void {
    const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x1b2027, roughness: 0.35 });
    const irisMaterial = new THREE.MeshStandardMaterial({ color: 0x6e94a3, roughness: 0.25 });
    for (const x of [-0.115, 0.115]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.043, 12, 8), eyeMaterial);
      eye.position.set(x, 0.285, 0.292);
      eye.scale.set(1, 1.15, 0.6);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 6), irisMaterial);
      iris.position.z = 0.035;
      eye.add(iris);
      head.add(eye);

      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, 0.025), eyeMaterial);
      brow.position.set(x, 0.37, 0.292);
      brow.rotation.z = x < 0 ? -0.08 : 0.08;
      head.add(brow);
    }

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.034, 0.09, 10), skin);
    nose.position.set(0, 0.225, 0.33);
    nose.rotation.x = Math.PI / 2;
    head.add(nose);

    const mouth = new THREE.Mesh(
      new THREE.TorusGeometry(0.065, 0.009, 5, 16, Math.PI),
      new THREE.MeshBasicMaterial({ color: 0x6f3f3d }),
    );
    mouth.position.set(0, 0.135, 0.303);
    mouth.rotation.z = Math.PI;
    head.add(mouth);

    for (const x of [-0.31, 0.31]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), skin);
      ear.position.set(x, 0.25, 0);
      ear.scale.set(0.48, 0.86, 0.55);
      head.add(ear);
    }
  }

  private buildHair(root: THREE.Group, classId: ClassId, color: number, headItem: string | null): void {
    const hair = this.surfaceMaterial(`hair-${classId}`, 'cloth', color, { roughness: 0.8 });
    const helmetCoversTop = headItem?.includes('helm') ?? false;

    if (!helmetCoversTop) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.35, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), hair);
      cap.position.y = 0.34;
      cap.scale.set(1.02, 0.9, 0.96);
      root.add(cap);
    }

    const locks = classId === 'mage' ? 7 : classId === 'cleric' ? 6 : 5;
    for (let index = 0; index < locks; index += 1) {
      const t = index / Math.max(1, locks - 1);
      const x = THREE.MathUtils.lerp(-0.28, 0.28, t);
      const lock = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, classId === 'mage' ? 0.28 : 0.2, 5, 8), hair);
      lock.position.set(x, 0.2 - Math.abs(x) * 0.08, -0.23 - Math.abs(x) * 0.04);
      lock.rotation.z = -x * 0.9;
      lock.rotation.x = classId === 'mage' ? 0.18 : 0.08;
      root.add(lock);
    }

    if (classId === 'mage') {
      for (const side of [-1, 1]) {
        const sideLock = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.36, 5, 8), hair);
        sideLock.position.set(side * 0.29, 0.12, -0.03);
        sideLock.rotation.z = side * -0.16;
        root.add(sideLock);
      }
    }
  }

  private buildEquipmentSlots(args: { classId: ClassId; palette: ClassPalette; equipment: VisualEquipment; rig: CharacterRig }): void {
    const { classId, palette, equipment, rig } = args;
    if (equipment.head) this.buildHeadEquipment(rig.headSlot, equipment.head, classId, palette);
    if (equipment.shoulders) this.buildShoulders(rig.shouldersSlot, equipment.shoulders, palette);
    if (equipment.chest) this.buildChest(rig.chestSlot, equipment.chest, classId, palette);
    if (equipment.hands) this.buildHands(rig, equipment.hands, palette);
    if (equipment.legs) this.buildLegs(rig, equipment.legs, classId, palette);
    if (equipment.feet) this.buildFeet(rig, equipment.feet, palette);
    if (equipment.accessory) this.buildAccessory(rig.accessorySlot, equipment.accessory, palette);
    if (equipment.weapon) this.buildWeapon(rig.weaponSocket, equipment.weapon, classId, palette);
    if (equipment.offhand) this.buildOffhand(rig.offhandSocket, equipment.offhand, palette);
  }

  private buildHeadEquipment(slot: THREE.Group, id: string, classId: ClassId, palette: ClassPalette): void {
    const metal = this.surfaceMaterial(id, 'metal', classId === 'cleric' ? 0xd9bc63 : 0x858f99);
    const accent = this.surfaceMaterial(`${id}-accent`, 'metal', palette.accent);
    if (id.includes('helm')) {
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.37, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), metal);
      shell.position.y = 0.35;
      slot.add(shell);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, 0.09), metal);
      brow.position.set(0, 0.29, 0.26);
      slot.add(brow);
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.34, 0.28), accent);
      ridge.position.set(0, 0.57, -0.02);
      ridge.rotation.x = -0.18;
      slot.add(ridge);
      return;
    }

    const circlet = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.028, 8, 28), accent);
    circlet.position.y = 0.29;
    circlet.rotation.x = Math.PI / 2;
    slot.add(circlet);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), this.surfaceMaterial(`${id}-gem`, 'gem', palette.accent));
    gem.position.set(0, 0.31, 0.31);
    slot.add(gem);
  }

  private buildShoulders(slot: THREE.Group, id: string, palette: ClassPalette): void {
    const kind: SurfaceKind = id.includes('mantle') ? 'cloth' : 'metal';
    const material = this.surfaceMaterial(id, kind, id.includes('mantle') ? palette.secondary : palette.accent);
    for (const x of [-0.45, 0.45]) {
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 10), material);
      pauldron.position.set(x, 0.2, 0);
      pauldron.scale.set(1.16, 0.52, 0.92);
      slot.add(pauldron);
      if (!id.includes('mantle')) {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 6, 20), this.surfaceMaterial(`${id}-rim`, 'metal', 0xc6cbd0));
        rim.position.set(x, 0.18, 0.035);
        rim.rotation.x = Math.PI / 2;
        slot.add(rim);
      }
    }
  }

  private buildChest(slot: THREE.Group, id: string, classId: ClassId, palette: ClassPalette): void {
    const cloth = this.surfaceMaterial(id, 'cloth', palette.primary);
    const leather = this.surfaceMaterial(`${id}-leather`, 'leather', palette.secondary);
    const metal = this.surfaceMaterial(`${id}-metal`, 'metal', palette.accent);
    if (classId === 'warrior') {
      const breast = new THREE.Mesh(new THREE.CapsuleGeometry(0.315, 0.34, 7, 14), leather);
      breast.position.set(0, 0.17, 0.03);
      breast.scale.z = 0.82;
      slot.add(breast);
      for (let y = -0.02; y <= 0.28; y += 0.1) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.055, 0.065), metal);
        plate.position.set(0, y, 0.29);
        slot.add(plate);
      }
      return;
    }

    const tunic = new THREE.Mesh(new THREE.CapsuleGeometry(0.31, 0.38, 7, 14), cloth);
    tunic.position.set(0, 0.17, 0.02);
    tunic.scale.z = 0.82;
    slot.add(tunic);
    const frontPanel = new THREE.Mesh(new THREE.BoxGeometry(classId === 'cleric' ? 0.3 : 0.24, 0.6, 0.045), cloth);
    frontPanel.position.set(0, -0.14, 0.32);
    slot.add(frontPanel);
    const clasp = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), this.surfaceMaterial(`${id}-clasp`, 'gem', palette.accent));
    clasp.position.set(0, 0.28, 0.34);
    slot.add(clasp);
  }

  private buildHands(rig: CharacterRig, id: string, palette: ClassPalette): void {
    const kind: SurfaceKind = id.includes('gauntlet') ? 'metal' : 'leather';
    const material = this.surfaceMaterial(id, kind, id.includes('ivory') ? 0xd9cfae : palette.secondary);
    for (const hand of [rig.leftHand, rig.rightHand]) {
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 10), material);
      glove.scale.set(0.95, 1.1, 0.88);
      hand.add(glove);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.13, 0.16, 12), material);
      cuff.position.y = 0.12;
      hand.add(cuff);
    }
  }

  private buildLegs(rig: CharacterRig, id: string, classId: ClassId, palette: ClassPalette): void {
    const material = this.surfaceMaterial(id, 'cloth', id.includes('brown') ? 0x58422f : palette.dark);
    for (const thigh of [rig.leftThigh, rig.rightThigh]) {
      const trouser = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.34, 6, 12), material);
      trouser.position.y = -0.24;
      thigh.add(trouser);
    }
    if (classId !== 'warrior') {
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.43, 0.56, 16, 1, false), this.surfaceMaterial(`${id}-skirt`, 'cloth', palette.primary));
      skirt.position.set(0, -0.25, 0);
      rig.hips.add(skirt);
    }
  }

  private buildFeet(rig: CharacterRig, id: string, palette: ClassPalette): void {
    const kind: SurfaceKind = id.includes('iron') || id.includes('sun') ? 'metal' : 'leather';
    const material = this.surfaceMaterial(id, kind, id.includes('sun') ? palette.accent : 0x312a28);
    for (const foot of [rig.leftFoot, rig.rightFoot]) {
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.38), material);
      boot.position.set(0, -0.03, 0.09);
      boot.rotation.x = -0.08;
      foot.add(boot);
    }
  }

  private buildAccessory(slot: THREE.Group, id: string, palette: ClassPalette): void {
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.014, 6, 24, Math.PI * 1.2), this.surfaceMaterial(`${id}-chain`, 'metal', 0xbfa45d));
    chain.position.set(0, 0.18, 0.29);
    chain.rotation.z = Math.PI * 0.9;
    slot.add(chain);
    const pendant = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), this.surfaceMaterial(id, 'gem', palette.accent));
    pendant.position.set(0, 0.04, 0.35);
    slot.add(pendant);
  }

  private buildWeapon(slot: THREE.Group, id: string, classId: ClassId, palette: ClassPalette): void {
    void classId;
    slot.rotation.z = -0.16;
    slot.position.set(0.02, -0.02, 0.02);
    if (id.includes('staff')) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.052, 1.45, 12), this.surfaceMaterial(id, 'wood', 0x694b32));
      shaft.position.y = 0.55;
      slot.add(shaft);
      const cage = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.024, 6, 24), this.surfaceMaterial(`${id}-metal`, 'metal', 0xa9b1bb));
      cage.position.y = 1.26;
      cage.rotation.x = Math.PI / 2;
      slot.add(cage);
      const focus = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 1), this.surfaceMaterial(`${id}-focus`, 'gem', palette.accent));
      focus.position.y = 1.26;
      slot.add(focus);
      return;
    }

    if (id.includes('mace')) {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.8, 12), this.surfaceMaterial(`${id}-handle`, 'leather', 0x594130));
      handle.position.y = 0.3;
      slot.add(handle);
      const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18, 1), this.surfaceMaterial(id, 'metal', palette.accent));
      head.position.y = 0.78;
      slot.add(head);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), this.surfaceMaterial(`${id}-gem`, 'gem', 0xffe693));
      gem.position.set(0, 0.78, 0.17);
      slot.add(gem);
      return;
    }

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.32, 10), this.surfaceMaterial(`${id}-grip`, 'leather', 0x4a3427));
    grip.position.y = 0.12;
    slot.add(grip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.055, 0.07), this.surfaceMaterial(`${id}-guard`, 'metal', palette.accent));
    guard.position.y = 0.3;
    slot.add(guard);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.78, 0.045), this.surfaceMaterial(id, 'metal', 0xc9d0d4));
    blade.position.y = 0.7;
    slot.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.071, 0.18, 4), blade.material);
    tip.position.y = 1.18;
    tip.rotation.y = Math.PI / 4;
    slot.add(tip);
  }

  private buildOffhand(slot: THREE.Group, id: string, palette: ClassPalette): void {
    if (!id.includes('shield')) return;
    slot.position.set(0, 0.04, 0.1);
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.075, 18), this.surfaceMaterial(id, 'metal', 0x707981));
    shield.rotation.x = Math.PI / 2;
    shield.scale.y = 1.18;
    slot.add(shield);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 18), this.surfaceMaterial(`${id}-face`, 'leather', palette.primary));
    face.rotation.x = Math.PI / 2;
    face.position.z = 0.05;
    slot.add(face);
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), this.surfaceMaterial(`${id}-boss`, 'metal', palette.accent));
    boss.position.z = 0.08;
    slot.add(boss);
  }

  private makeSlime(): THREE.Group {
    const group = new THREE.Group();
    group.userData.hitPulse = 0;
    group.userData.attackPulse = 0;
    group.userData.moveAmount = 0;
    group.userData.lastVisualPosition = new THREE.Vector3();

    const gel = new THREE.MeshPhysicalMaterial({
      color: 0x54d588,
      roughness: 0.18,
      metalness: 0,
      clearcoat: 0.85,
      clearcoatRoughness: 0.12,
      transmission: 0.04,
      thickness: 0.3,
      transparent: true,
      opacity: 0.94,
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.82, 28, 20), gel);
    body.name = 'slimeBody';
    body.position.y = 0.58;
    body.scale.set(1, 0.68, 1);
    body.userData.entity = 'monster';
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const base = new THREE.Mesh(
      new THREE.SphereGeometry(0.68, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0x39af69, roughness: 0.42, metalness: 0 }),
    );
    base.name = 'slimeBase';
    base.position.y = 0.22;
    base.scale.set(1.16, 0.28, 1.08);
    base.userData.entity = 'monster';
    base.castShadow = true;
    group.add(base);

    const highlight = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0xb7ffcf, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    highlight.name = 'slimeHighlight';
    highlight.position.set(-0.22, 0.82, 0.36);
    highlight.scale.set(1.15, 0.7, 0.42);
    group.add(highlight);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.72, 30),
      new THREE.MeshBasicMaterial({ color: 0x06120d, transparent: true, opacity: 0.26, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.z = 0.62;
    shadow.position.y = 0.018;
    group.add(shadow);
    return group;
  }

  private makeTargetRing(): THREE.Group {
    const group = new THREE.Group();
    const main = new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false });
    const outer = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.04, 48), main);
    outer.rotation.x = -Math.PI / 2;
    group.add(outer);
    for (let index = 0; index < 4; index += 1) {
      const marker = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 5), main);
      const angle = (Math.PI * 2 * index) / 4;
      marker.position.set(Math.sin(angle) * 1.13, 0.04, Math.cos(angle) * 1.13);
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
      new THREE.MeshStandardMaterial({ color: 0x4b6045, roughness: 0.96, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const inner = new THREE.Mesh(
      new THREE.CircleGeometry(15.3, 64),
      new THREE.MeshStandardMaterial({ color: 0x617950, roughness: 1 }),
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.012;
    inner.receiveShadow = true;
    this.scene.add(inner);

    const border = new THREE.Mesh(
      new THREE.RingGeometry(13.8, 14.05, 64),
      new THREE.MeshStandardMaterial({ color: 0x9a8965, roughness: 0.82 }),
    );
    border.rotation.x = -Math.PI / 2;
    border.position.y = 0.025;
    this.scene.add(border);

    const stone = this.surfaceMaterial('environment-stone', 'metal', 0x6c736f, { roughness: 0.95, metalness: 0 });
    const moss = this.surfaceMaterial('environment-moss', 'cloth', 0x3d6842, { roughness: 0.95 });
    const trunk = this.surfaceMaterial('environment-trunk', 'wood', 0x67472f);
    const leaves = this.surfaceMaterial('environment-leaves', 'cloth', 0x305b3a, { roughness: 0.9 });

    for (const [x, z, scale] of [[-9, -7, 1.1], [8, -6, 0.85], [-11, 5, 0.72], [10, 7, 1.25], [-15, -9, 1.35], [15, 9, 1.2]] as const) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(scale, 1), stone);
      rock.position.set(x, scale * 0.5, z);
      rock.scale.z = 0.78;
      rock.rotation.set(0.18, x * 0.15, 0.12);
      rock.castShadow = true;
      this.scene.add(rock);
      const patch = new THREE.Mesh(new THREE.DodecahedronGeometry(scale * 0.52, 0), moss);
      patch.position.set(x - scale * 0.15, scale * 0.82, z + scale * 0.04);
      patch.scale.y = 0.2;
      this.scene.add(patch);
    }

    for (const [x, z, scale] of [[-13, -2, 1], [13, 2, 1.08], [-8, 12, 0.92], [8, -12, 1.02], [-16, 3, 0.86], [16, -3, 0.9]] as const) {
      const tree = new THREE.Group();
      const trunkMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 1.8, 10), trunk);
      trunkMesh.position.y = 0.9;
      const crownA = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), leaves);
      crownA.position.y = 2.15;
      crownA.scale.y = 1.18;
      const crownB = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), leaves);
      crownB.position.set(0.15, 3.02, -0.06);
      tree.add(trunkMesh, crownA, crownB);
      tree.position.set(x, 0, z);
      tree.scale.setScalar(scale);
      tree.traverse((object) => { if (object instanceof THREE.Mesh) object.castShadow = true; });
      this.scene.add(tree);
    }
  }

  private updateCharacterGroup(group: THREE.Group, player: PlayerSnapshot): void {
    this.setEntityTarget(group, player.position, player.rotation);
    const wasDead = Boolean(group.userData.dead);
    group.userData.dead = player.dead;
    group.visible = true;
    if (player.dead && !wasDead) this.triggerCharacterAction(group, 'dying', 0.9);
    if (!player.dead && wasDead) {
      group.userData.action = undefined;
      const rig = group.userData.rig as CharacterRig | undefined;
      if (rig) {
        rig.visual.rotation.set(0, 0, 0);
        rig.visual.position.set(0, 0, 0);
      }
    }
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
    if (group.userData.transformInitialized) return;
    group.position.copy(target);
    group.rotation.y = rotation;
    group.userData.transformInitialized = true;
    group.userData.lastVisualPosition = target.clone();
  }

  private animateEntityTransform(group: THREE.Group, dt: number): void {
    const target = group.userData.targetPosition as THREE.Vector3 | undefined;
    if (target) group.position.lerp(target, 1 - Math.exp(-dt * 18));
    const targetRotation = group.userData.targetRotation as number | undefined;
    if (targetRotation === undefined) return;
    const delta = Math.atan2(Math.sin(targetRotation - group.rotation.y), Math.cos(targetRotation - group.rotation.y));
    group.rotation.y += delta * (1 - Math.exp(-dt * 20));
  }

  private animateCharacter(group: THREE.Group, dt: number): void {
    const rig = group.userData.rig as CharacterRig | undefined;
    if (!rig) return;

    const last = (group.userData.lastVisualPosition as THREE.Vector3 | undefined) ?? group.position.clone();
    const speed = group.position.distanceTo(last) / Math.max(dt, 0.001);
    last.copy(group.position);
    group.userData.lastVisualPosition = last;
    const targetMove = THREE.MathUtils.clamp(speed / 4.5, 0, 1);
    const previousMove = (group.userData.moveAmount as number | undefined) ?? 0;
    group.userData.moveAmount = THREE.MathUtils.lerp(previousMove, targetMove, 1 - Math.exp(-dt * 10));
    const move = group.userData.moveAmount as number;

    let action = group.userData.action as TimedAction | undefined;
    const dead = Boolean(group.userData.dead);
    if (dead && !action) {
      action = { type: 'dead', startedAt: this.elapsed, duration: Infinity };
      group.userData.action = action;
    }
    if (action && action.type !== 'dead' && this.elapsed - action.startedAt >= action.duration) {
      if (action.type === 'dying') {
        action = { type: 'dead', startedAt: this.elapsed, duration: Infinity };
        group.userData.action = action;
      } else {
        action = undefined;
        group.userData.action = undefined;
      }
    }

    const state: CharacterAction = action?.type ?? (move > 0.12 ? 'walk' : 'idle');
    const alpha = 1 - Math.exp(-dt * 15);
    const walkPhase = this.elapsed * (8 + move * 5);
    const walkSwing = state === 'walk' ? Math.sin(walkPhase) * 0.55 * move : 0;
    const breath = Math.sin(this.elapsed * 2.1) * 0.015;

    let leftArmX = -walkSwing * 0.55;
    let rightArmX = walkSwing * 0.55;
    let leftForearmX = -0.08;
    let rightForearmX = -0.08;
    let leftThighX = walkSwing;
    let rightThighX = -walkSwing;
    let leftShinX = Math.max(0, -walkSwing) * 0.38;
    let rightShinX = Math.max(0, walkSwing) * 0.38;
    let chestY = 0;
    let chestZ = 0;
    let headX = 0;
    let visualTilt = 0;
    let visualDrop = 0;

    if (state === 'attack' && action) {
      const t = THREE.MathUtils.clamp((this.elapsed - action.startedAt) / action.duration, 0, 1);
      const strike = Math.sin(t * Math.PI);
      rightArmX = -1.6 * strike;
      rightForearmX = -0.6 - 0.7 * strike;
      leftArmX = 0.35 * strike;
      chestY = -0.45 * strike;
      chestZ = -0.12 * strike;
      headX = 0.08 * strike;
    }

    if (state === 'cast' && action) {
      const t = THREE.MathUtils.clamp((this.elapsed - action.startedAt) / action.duration, 0, 1);
      const raise = Math.sin(t * Math.PI);
      leftArmX = -0.75 * raise;
      rightArmX = -1.1 * raise;
      leftForearmX = -0.75 * raise;
      rightForearmX = -0.55 * raise;
      chestY = Math.sin(t * Math.PI * 2) * 0.08;
      headX = -0.08 * raise;
    }

    if ((state === 'dying' || state === 'dead') && action) {
      const t = state === 'dead' ? 1 : THREE.MathUtils.smoothstep((this.elapsed - action.startedAt) / action.duration, 0, 1);
      visualTilt = -1.25 * t;
      visualDrop = -0.38 * t;
      leftArmX = 0.9 * t;
      rightArmX = 0.7 * t;
      leftForearmX = -0.45 * t;
      rightForearmX = -0.4 * t;
      leftThighX = 0.25 * t;
      rightThighX = -0.18 * t;
      headX = 0.35 * t;
    }

    this.lerpBone(rig.leftUpperArm, leftArmX, 0, -0.06, alpha);
    this.lerpBone(rig.rightUpperArm, rightArmX, 0, 0.06, alpha);
    this.lerpBone(rig.leftForearm, leftForearmX, 0, 0, alpha);
    this.lerpBone(rig.rightForearm, rightForearmX, 0, 0, alpha);
    this.lerpBone(rig.leftThigh, leftThighX, 0, 0, alpha);
    this.lerpBone(rig.rightThigh, rightThighX, 0, 0, alpha);
    this.lerpBone(rig.leftShin, leftShinX, 0, 0, alpha);
    this.lerpBone(rig.rightShin, rightShinX, 0, 0, alpha);
    this.lerpBone(rig.chest, breath, chestY, chestZ, alpha);
    this.lerpBone(rig.head, headX, 0, 0, alpha);

    const stepBounce = state === 'walk' ? Math.abs(Math.sin(walkPhase)) * 0.045 * move : 0;
    rig.visual.position.y = THREE.MathUtils.lerp(rig.visual.position.y, breath + stepBounce + visualDrop, alpha);
    rig.visual.rotation.z = THREE.MathUtils.lerp(rig.visual.rotation.z, visualTilt, alpha);

    let pulse = (group.userData.hitPulse as number | undefined) ?? 0;
    pulse = Math.max(0, pulse - dt * 6.5);
    group.userData.hitPulse = pulse;
    group.scale.setScalar(1 + pulse * 0.055);
  }

  private animateSlime(dt: number): void {
    const body = this.slimeGroup.getObjectByName('slimeBody');
    const base = this.slimeGroup.getObjectByName('slimeBase');
    const highlight = this.slimeGroup.getObjectByName('slimeHighlight');
    if (!body || !base) return;

    const last = (this.slimeGroup.userData.lastVisualPosition as THREE.Vector3 | undefined) ?? this.slimeGroup.position.clone();
    const speed = this.slimeGroup.position.distanceTo(last) / Math.max(dt, 0.001);
    last.copy(this.slimeGroup.position);
    this.slimeGroup.userData.lastVisualPosition = last;
    const targetMove = THREE.MathUtils.clamp(speed / 3.8, 0, 1);
    const previousMove = (this.slimeGroup.userData.moveAmount as number | undefined) ?? 0;
    const move = THREE.MathUtils.lerp(previousMove, targetMove, 1 - Math.exp(-dt * 9));
    this.slimeGroup.userData.moveAmount = move;

    const idle = Math.sin(this.elapsed * 2.8);
    const walk = Math.sin(this.elapsed * (7.5 + move * 2));
    const hop = Math.abs(walk) * move;
    let attackPulse = (this.slimeGroup.userData.attackPulse as number | undefined) ?? 0;
    attackPulse = Math.max(0, attackPulse - dt * 3.2);
    this.slimeGroup.userData.attackPulse = attackPulse;

    const squash = idle * 0.025 * (1 - move) - hop * 0.1 + attackPulse * 0.12;
    const stretch = hop * 0.08 - attackPulse * 0.08;
    body.scale.set(1 + squash, 0.68 + stretch, 1 + squash);
    body.position.y = 0.58 + hop * 0.12;
    base.scale.set(1.16 + squash * 0.65, 0.28 - stretch * 0.2, 1.08 + squash * 0.65);
    base.position.y = 0.22 + hop * 0.03;
    if (highlight) highlight.position.y = 0.82 + hop * 0.1;

    let pulse = (this.slimeGroup.userData.hitPulse as number | undefined) ?? 0;
    pulse = Math.max(0, pulse - dt * 7);
    this.slimeGroup.userData.hitPulse = pulse;
    this.slimeGroup.scale.setScalar(1 + pulse * 0.08);
  }

  private triggerCharacterAction(group: THREE.Group, type: 'attack' | 'cast' | 'dying', duration?: number): void {
    group.userData.action = {
      type,
      startedAt: this.elapsed,
      duration: duration ?? (type === 'attack' ? 0.46 : type === 'cast' ? 0.68 : 0.9),
    } satisfies TimedAction;
  }

  private entityGroup(id: string | null): THREE.Group | null {
    if (!id) return null;
    if (id === this.selfId) return this.selfGroup;
    if (id === this.monsterId) return this.slimeGroup;
    return this.others.get(id) ?? null;
  }

  private entityPosition(id: string | null): THREE.Vector3 | null {
    return this.entityGroup(id)?.position.clone() ?? null;
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
      'mage-basic': 0x9f82ff,
      fireball: 0xff7138,
      'frost-bolt': 0x6bd7ff,
      'holy-bolt': 0xffe58b,
    };
    const color = colors[id] ?? 0xffffff;
    const projectile = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(id === 'fireball' ? 0.23 : 0.16, 1), this.surfaceMaterial(`projectile-${id}`, 'gem', color));
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(id === 'fireball' ? 0.36 : 0.27, 14, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    projectile.add(core, aura);
    projectile.add(new THREE.PointLight(color, id === 'fireball' ? 2.3 : 1.4, 4, 2));
    from.y += 1.3;
    to.y += 0.62;
    projectile.position.copy(from);
    this.scene.add(projectile);
    let t = 0;
    this.effects.push({
      update: (dt) => {
        t += dt / 0.3;
        const p = Math.min(t, 1);
        projectile.position.lerpVectors(from, to, THREE.MathUtils.smoothstep(p, 0, 1));
        projectile.position.y += Math.sin(p * Math.PI) * 0.28;
        projectile.rotation.x += dt * 7;
        projectile.rotation.y += dt * 10;
        aura.scale.setScalar(1 + Math.sin(t * Math.PI * 5) * 0.1);
        if (t < 1) return false;
        this.scene.remove(projectile);
        return true;
      },
    });
  }

  private slashVfx(at: THREE.Vector3, wide: boolean): void {
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(wide ? 1.3 : 0.88, wide ? 0.085 : 0.065, 8, 36, wide ? Math.PI * 1.85 : Math.PI),
      new THREE.MeshBasicMaterial({ color: 0xffe5ae, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    arc.rotation.x = -Math.PI / 2;
    arc.position.copy(at);
    arc.position.y = 0.58;
    this.scene.add(arc);
    let life = 0.26;
    this.effects.push({
      update: (dt) => {
        life -= dt;
        arc.rotation.z += dt * 8;
        arc.scale.multiplyScalar(1 + dt * 1.2);
        (arc.material as THREE.MeshBasicMaterial).opacity = Math.max(0, life / 0.26);
        if (life > 0) return false;
        this.scene.remove(arc);
        return true;
      },
    });
  }

  private healVfx(at: Vec3): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.72, 36),
      new THREE.MeshBasicMaterial({ color: 0x9dffb5, transparent: true, opacity: 0.68, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, 0.06, at.z);
    this.scene.add(ring);
    let life = 0.85;
    this.effects.push({
      update: (dt) => {
        life -= dt;
        ring.rotation.z += dt * 1.7;
        ring.scale.multiplyScalar(1 + dt * 0.8);
        (ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, life / 0.85);
        if (life > 0) return false;
        this.scene.remove(ring);
        return true;
      },
    });
  }

  private deathVfx(at: Vec3): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 1.45, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, 0.07, at.z);
    this.scene.add(ring);
    let life = 0.46;
    this.effects.push({
      update: (dt) => {
        life -= dt;
        ring.scale.multiplyScalar(1 + dt * 3);
        (ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, life / 0.46);
        if (life > 0) return false;
        this.scene.remove(ring);
        return true;
      },
    });
  }

  private hitFlash(targetId: string): void {
    const group = this.entityGroup(targetId);
    if (group) group.userData.hitPulse = 1;
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
    sprite.scale.set(3, 1.05, 1);
    sprite.position.set(at.x, 2.3, at.z);
    this.scene.add(sprite);
    let life = 0.8;
    this.effects.push({
      update: (dt) => {
        life -= dt;
        sprite.position.y += dt * 1.15;
        material.opacity = Math.max(0, life / 0.8);
        if (life > 0) return false;
        this.scene.remove(sprite);
        texture.dispose();
        material.dispose();
        return true;
      },
    });
  }

  private equipmentKey(equipment: VisualEquipment): string {
    return [equipment.head, equipment.shoulders, equipment.chest, equipment.hands, equipment.legs, equipment.feet, equipment.accessory, equipment.weapon, equipment.offhand].join('|');
  }

  private bone(name: string, x: number, y: number, z: number): THREE.Bone {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    return bone;
  }

  private slot(parent: THREE.Object3D, name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    parent.add(group);
    return group;
  }

  private attachCapsule(parent: THREE.Object3D, radius: number, length: number, material: THREE.Material, position: THREE.Vector3, scale = new THREE.Vector3(1, 1, 1)): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, 12), material);
    mesh.position.copy(position);
    mesh.scale.copy(scale);
    parent.add(mesh);
    return mesh;
  }

  private lerpBone(bone: THREE.Object3D, x: number, y: number, z: number, alpha: number): void {
    bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, x, alpha);
    bone.rotation.y = THREE.MathUtils.lerp(bone.rotation.y, y, alpha);
    bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, z, alpha);
  }

  private surfaceMaterial(id: string, kind: SurfaceKind, color: number, override?: { roughness?: number; metalness?: number }): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
    const defaultProps: Record<SurfaceKind, { roughness: number; metalness: number }> = {
      skin: { roughness: 0.72, metalness: 0 },
      cloth: { roughness: 0.86, metalness: 0 },
      leather: { roughness: 0.72, metalness: 0.02 },
      metal: { roughness: 0.32, metalness: 0.78 },
      wood: { roughness: 0.82, metalness: 0 },
      gem: { roughness: 0.18, metalness: 0.12 },
    };
    const props = defaultProps[kind];
    const roughness = override?.roughness ?? props.roughness;
    const metalness = override?.metalness ?? props.metalness;
    const key = `${id}:${kind}:${color}:${roughness}:${metalness}`;
    const cached = this.materialCache.get(key);
    if (cached) return cached;

    if (kind === 'gem') {
      const material = new THREE.MeshPhysicalMaterial({
        color,
        emissive: new THREE.Color(color).multiplyScalar(0.22),
        emissiveIntensity: 1.2,
        roughness,
        metalness,
        clearcoat: 0.75,
        clearcoatRoughness: 0.1,
      });
      this.materialCache.set(key, material);
      return material;
    }

    const material = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      map: kind === 'skin' ? null : this.patternTexture(id, kind),
    });
    this.materialCache.set(key, material);
    return material;
  }

  private patternTexture(id: string, kind: Exclude<SurfaceKind, 'skin' | 'gem'>): THREE.CanvasTexture {
    const key = `${id}:${kind}`;
    const cached = this.textureCache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');

    let seed = 2166136261;
    for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) % 10000) / 10000;
    };

    context.fillStyle = '#d7d7d7';
    context.fillRect(0, 0, 64, 64);

    if (kind === 'cloth') {
      context.strokeStyle = 'rgba(70,70,70,.18)';
      context.lineWidth = 1;
      for (let i = 0; i <= 64; i += 4) {
        context.beginPath();
        context.moveTo(i, 0);
        context.lineTo(i, 64);
        context.stroke();
        context.beginPath();
        context.moveTo(0, i);
        context.lineTo(64, i);
        context.stroke();
      }
    } else if (kind === 'wood') {
      for (let y = 3; y < 64; y += 7) {
        context.strokeStyle = `rgba(80,55,36,${0.13 + random() * 0.12})`;
        context.beginPath();
        context.moveTo(0, y + random() * 2);
        for (let x = 0; x <= 64; x += 8) context.lineTo(x, y + Math.sin(x * 0.18 + random()) * 1.5);
        context.stroke();
      }
    } else if (kind === 'metal') {
      for (let i = 0; i < 24; i += 1) {
        const y = Math.floor(random() * 64);
        context.strokeStyle = `rgba(255,255,255,${0.04 + random() * 0.08})`;
        context.beginPath();
        context.moveTo(random() * 18, y);
        context.lineTo(35 + random() * 29, y + random() * 2 - 1);
        context.stroke();
      }
    } else {
      for (let i = 0; i < 90; i += 1) {
        const shade = Math.floor(90 + random() * 90);
        context.fillStyle = `rgba(${shade},${shade},${shade},${0.03 + random() * 0.06})`;
        const radius = 0.5 + random() * 1.5;
        context.beginPath();
        context.arc(random() * 64, random() * 64, radius, 0, Math.PI * 2);
        context.fill();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(kind === 'cloth' ? 2 : 1.5, kind === 'cloth' ? 2 : 1.5);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    this.textureCache.set(key, texture);
    return texture;
  }

  private disposeObject(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
  }
}
