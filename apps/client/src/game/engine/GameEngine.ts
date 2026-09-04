import * as THREE from 'three';
import type { ClassId, CombatEvent, MonsterSnapshot, PlayerSnapshot, Vec3 } from '@worldofchatgpt/shared';

interface Snapshot { self: PlayerSnapshot; players: PlayerSnapshot[]; monster: MonsterSnapshot; selectedTargetId: string | null; }
interface Effect { update: (dt: number) => boolean; }

export class GameEngine {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly selfGroup = this.makeCharacter('mage', true);
  private readonly slimeGroup = this.makeSlime();
  private readonly others = new Map<string, THREE.Group>();
  private readonly effects: Effect[] = [];
  private readonly targetRing: THREE.Mesh;
  private frame = 0;
  private selfId = '';
  private monsterId = '';

  constructor(private readonly container: HTMLElement, private readonly onMonsterClick: (entityId: string) => void) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x17212b);
    this.scene.fog = new THREE.Fog(0x17212b, 24, 48);

    const hemi = new THREE.HemisphereLight(0xcfe7ff, 0x283322, 1.7); this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffefd1, 3.2); sun.position.set(-8, 14, 7); sun.castShadow = true; this.scene.add(sun);
    sun.shadow.mapSize.set(1024, 1024);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(20, 64), new THREE.MeshStandardMaterial({ color: 0x53664a, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
    this.addEnvironment();
    this.scene.add(this.selfGroup, this.slimeGroup);

    this.targetRing = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.25, 40), new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    this.targetRing.rotation.x = -Math.PI / 2; this.targetRing.position.y = 0.04; this.targetRing.visible = false; this.scene.add(this.targetRing);

    this.camera.position.set(10, 12, 14);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.frame = requestAnimationFrame(this.animate);
  }

  setSnapshot(snapshot: Snapshot): void {
    this.selfId = snapshot.self.entityId;
    this.monsterId = snapshot.monster.entityId;
    this.updateCharacterGroup(this.selfGroup, snapshot.self);
    this.updateSlime(snapshot.monster);

    const liveIds = new Set(snapshot.players.map((p) => p.entityId));
    for (const player of snapshot.players) {
      let group = this.others.get(player.entityId);
      if (!group) { group = this.makeCharacter(player.classId, false); this.others.set(player.entityId, group); this.scene.add(group); }
      this.updateCharacterGroup(group, player);
    }
    for (const [id, group] of this.others) if (!liveIds.has(id)) { this.scene.remove(group); this.others.delete(id); }

    this.targetRing.visible = snapshot.selectedTargetId === snapshot.monster.entityId && !snapshot.monster.dead;
    this.targetRing.position.x = snapshot.monster.position.x;
    this.targetRing.position.z = snapshot.monster.position.z;
  }

  combat(event: CombatEvent): void {
    if (event.kind === 'damage') { this.floatingText(`-${event.amount}`, event.at, '#ff6b6b'); this.hitFlash(event.targetId); return; }
    if (event.kind === 'heal') { this.floatingText(`+${event.amount}`, event.at, '#77f5a5'); this.healVfx(event.at); return; }
    if (event.kind === 'xp') { if (event.sourceId === this.selfId) this.floatingText(`+${event.amount} XP`, event.at, '#ffd166'); return; }
    if (event.kind === 'death') { this.deathVfx(event.at); return; }
    if (event.kind === 'cast') this.castVfx(event);
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown);
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  private readonly resize = (): void => {
    const width = this.container.clientWidth || window.innerWidth; const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height, false);
  };

  private readonly pointerDown = (event: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.slimeGroup, true);
    if (hits.length && this.monsterId) this.onMonsterClick(this.monsterId);
  };

  private readonly animate = (): void => {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const focus = this.selfGroup.position;
    const desired = new THREE.Vector3(focus.x + 10, focus.y + 12, focus.z + 14);
    this.camera.position.lerp(desired, 1 - Math.pow(0.002, dt));
    this.camera.lookAt(focus.x, focus.y + 0.7, focus.z);
    this.targetRing.rotation.z += dt * 0.7;
    for (let i = this.effects.length - 1; i >= 0; i--) if (this.effects[i]?.update(dt)) this.effects.splice(i, 1);
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  };

  private makeCharacter(classId: ClassId, self: boolean): THREE.Group {
    const group = new THREE.Group();
    const palette: Record<ClassId, number> = { warrior: 0xc74d4d, mage: 0x6d5bd0, cleric: 0xe9c65b };
    const bodyMat = new THREE.MeshStandardMaterial({ color: palette[classId], roughness: 0.75 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xf0c9a4, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: self ? 0x25313b : 0x374550, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 1.05, 8), bodyMat); body.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 10), skin); head.position.y = 1.82;
    const legs = [-0.22, 0.22].map((x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.25), dark); m.position.set(x, 0.37, 0); return m; });
    const weapon = new THREE.Mesh(classId === 'mage' ? new THREE.CylinderGeometry(0.05, 0.05, 1.35, 6) : new THREE.BoxGeometry(0.11, 0.9, 0.16), new THREE.MeshStandardMaterial({ color: classId === 'cleric' ? 0xd8bd72 : 0x9fa9b3, metalness: 0.4, roughness: 0.5 }));
    weapon.position.set(0.58, 1.03, 0.05); weapon.rotation.z = -0.18;
    group.add(body, head, ...legs, weapon); group.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    return group;
  }

  private makeSlime(): THREE.Group {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x58c985, roughness: 0.45, metalness: 0.05 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.82, 16, 12), mat); body.scale.y = 0.72; body.position.y = 0.65;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x17212b });
    for (const x of [-0.27, 0.27]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), eyeMat); eye.position.set(x, 0.78, 0.62); body.add(eye); }
    body.userData.entity = 'monster'; body.castShadow = true; group.add(body); return group;
  }

  private addEnvironment(): void {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x66706b, roughness: 1 });
    for (const [x, z, s] of [[-9,-7,1.1],[8,-6,.8],[-11,5,.7],[10,7,1.25]] as const) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat); rock.position.set(x, s * 0.55, z); rock.rotation.set(0.2, x, 0.1); rock.castShadow = true; this.scene.add(rock);
    }
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6f4e37 }); const leafMat = new THREE.MeshStandardMaterial({ color: 0x365f42 });
    for (const [x, z] of [[-12,-1],[12,1],[-7,11],[7,-11]] as const) {
      const tree = new THREE.Group(); const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.16,.24,1.5,7), trunkMat); trunk.position.y=.75;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(1.1,2.2,8), leafMat); crown.position.y=2.15; tree.add(trunk,crown); tree.position.set(x,0,z); tree.traverse(o=>{if(o instanceof THREE.Mesh)o.castShadow=true;}); this.scene.add(tree);
    }
  }

  private updateCharacterGroup(group: THREE.Group, player: PlayerSnapshot): void {
    group.position.set(player.position.x, 0, player.position.z); group.rotation.y = player.rotation; group.visible = true;
    group.scale.setScalar(player.dead ? 0.01 : 1);
  }

  private updateSlime(monster: MonsterSnapshot): void {
    this.slimeGroup.position.set(monster.position.x, 0, monster.position.z); this.slimeGroup.rotation.y = monster.rotation; this.slimeGroup.visible = !monster.dead;
  }

  private entityPosition(id: string | null): THREE.Vector3 | null {
    if (!id) return null; if (id === this.selfId) return this.selfGroup.position.clone(); if (id === this.monsterId) return this.slimeGroup.position.clone(); return this.others.get(id)?.position.clone() ?? null;
  }

  private castVfx(event: Extract<CombatEvent, { kind: 'cast' }>): void {
    const from = this.entityPosition(event.sourceId) ?? new THREE.Vector3(event.at.x, event.at.y, event.at.z);
    const to = this.entityPosition(event.targetId) ?? from.clone().add(new THREE.Vector3(0,0,-2));
    if (['mage-basic','fireball','frost-bolt','holy-bolt'].includes(event.abilityId)) { this.projectile(from, to, event.abilityId); return; }
    if (event.abilityId === 'heal') { this.healVfx({ x: from.x, y: from.y, z: from.z }); return; }
    this.slashVfx(from, event.abilityId === 'whirlwind');
  }

  private projectile(from: THREE.Vector3, to: THREE.Vector3, id: string): void {
    const colors: Record<string, number> = { 'mage-basic': 0xa884ff, fireball: 0xff7138, 'frost-bolt': 0x6fdcff, 'holy-bolt': 0xfff1a8 };
    const orb = new THREE.Mesh(new THREE.SphereGeometry(id === 'fireball' ? .28 : .2, 10, 8), new THREE.MeshBasicMaterial({ color: colors[id] ?? 0xffffff }));
    from.y += 1.25; to.y += .7; orb.position.copy(from); this.scene.add(orb); let t=0;
    this.effects.push({ update: (dt) => { t += dt / .28; orb.position.lerpVectors(from,to,Math.min(t,1)); orb.scale.setScalar(1 + Math.sin(t*Math.PI)*.45); if(t>=1){this.scene.remove(orb);return true;} return false; } });
  }

  private slashVfx(at: THREE.Vector3, wide: boolean): void {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(wide ? 1.35 : .9, .07, 6, 28, wide ? Math.PI*1.8 : Math.PI), new THREE.MeshBasicMaterial({ color: 0xffe6b2, transparent:true, opacity:.85 }));
    mesh.rotation.x=-Math.PI/2; mesh.position.copy(at); mesh.position.y=.55; this.scene.add(mesh); let life=.24;
    this.effects.push({update:(dt)=>{life-=dt; mesh.rotation.z+=dt*8; (mesh.material as THREE.MeshBasicMaterial).opacity=Math.max(0,life/.24); if(life<=0){this.scene.remove(mesh);return true;} return false;}});
  }

  private healVfx(at: Vec3): void {
    const particles: THREE.Mesh[]=[]; for(let i=0;i<9;i++){const p=new THREE.Mesh(new THREE.SphereGeometry(.06,6,5),new THREE.MeshBasicMaterial({color:0x9dffb5}));p.position.set(at.x+(Math.random()-.5)*1.2,.1+Math.random()*.5,at.z+(Math.random()-.5)*1.2);particles.push(p);this.scene.add(p);} let life=.8;
    this.effects.push({update:(dt)=>{life-=dt; for(const p of particles)p.position.y+=dt*1.8;if(life<=0){for(const p of particles)this.scene.remove(p);return true;}return false;}});
  }

  private deathVfx(at: Vec3): void {
    const ring=new THREE.Mesh(new THREE.RingGeometry(.2,1.6,32),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.7,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set(at.x,.08,at.z);this.scene.add(ring);let life=.45;
    this.effects.push({update:(dt)=>{life-=dt;ring.scale.multiplyScalar(1+dt*3);(ring.material as THREE.MeshBasicMaterial).opacity=Math.max(0,life/.45);if(life<=0){this.scene.remove(ring);return true;}return false;}});
  }

  private hitFlash(targetId: string): void {
    const group=targetId===this.selfId?this.selfGroup:targetId===this.monsterId?this.slimeGroup:this.others.get(targetId); if(!group)return; group.scale.setScalar(1.12); let life=.1;
    this.effects.push({update:(dt)=>{life-=dt;if(life<=0){group.scale.setScalar(1);return true;}return false;}});
  }

  private floatingText(text: string, at: Vec3, color: string): void {
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=96;const ctx=canvas.getContext('2d');if(!ctx)return;ctx.font='bold 42px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.shadowColor='#000';ctx.shadowBlur=8;ctx.fillText(text,128,48);
    const texture=new THREE.CanvasTexture(canvas);const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false});const sprite=new THREE.Sprite(material);sprite.scale.set(2.7,1,1);sprite.position.set(at.x,2.2,at.z);this.scene.add(sprite);let life=.8;
    this.effects.push({update:(dt)=>{life-=dt;sprite.position.y+=dt*1.2;material.opacity=Math.max(0,life/.8);if(life<=0){this.scene.remove(sprite);texture.dispose();material.dispose();return true;}return false;}});
  }
}
