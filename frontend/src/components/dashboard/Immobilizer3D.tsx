'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { buildSuv } from './Vehicle3D';

// What immobilizing does to the vehicle, shown on the vehicle. The car drives
// down a road; the command reaches the tracker under the dash; the relay in
// the starter circuit opens; the car rolls to a stop with its lights out, and
// every attempt to start it after that does nothing. Mobilize runs it back.
// Vanilla three.js, same constraint as every other 3D view in the dashboard.

const NEON = 0x00e599;
const RED = 0xff3b3b;
const AMBER = 0xffd166;
const SHELL = 0xe6e9ef;
const COPPER = 0xd08a3e;

export type ImmobilizerSceneState = 'released' | 'engaging' | 'engaged' | 'releasing';

function textSprite(text: string, color: string, size = 30, width = 1024): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `700 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  );
  sprite.scale.set((3.2 * width) / 512, 0.6, 1);
  return sprite;
}

/** What the scene is doing right now, for the caption the modal draws. */
export type ImmobilizerSceneMoment = 'driving' | 'sending' | 'landed' | 'dead' | 'key_turned';

export function Immobilizer3D({
  state,
  plate,
  model,
  onMoment,
}: {
  state: ImmobilizerSceneState;
  plate: string;
  model: string | null;
  onMoment?: (moment: ImmobilizerSceneMoment) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<ImmobilizerSceneState>(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b0d11, 14, 30);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(7.5, 5.2, 9.8);
    camera.lookAt(0, 1.5, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(5, 9, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fd0ff, 0.5);
    rim.position.set(-6, 4, -6);
    scene.add(rim);

    // --- Road, scrolling under the car while it moves.
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 5),
      new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.95 })
    );
    road.rotation.x = -Math.PI / 2;
    scene.add(road);
    const stripes: THREE.Mesh[] = [];
    for (let i = 0; i < 14; i++) {
      const stripe = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 0.12),
        new THREE.MeshBasicMaterial({ color: 0x3a4048 })
      );
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(-19 + i * 3, 0.005, 1.55);
      scene.add(stripe);
      stripes.push(stripe);
    }
    const kerb = new THREE.Mesh(
      new THREE.BoxGeometry(40, 0.12, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x232830, roughness: 0.9 })
    );
    kerb.position.set(0, 0.06, -2.55);
    scene.add(kerb);

    // --- The vehicle itself. Headlamps are found by their emissive colour so
    // the scene can put them out; wheels by their shape so it can spin them.
    const car = buildSuv(plate, model);
    scene.add(car);
    // Headlamps are the two emissive boxes on the nose (x ≈ 2.19, y ≈ 1.28
    // in buildSuv); found by position because colour management rewrites the
    // emissive value and a hex compare finds nothing.
    const headlamps: THREE.MeshStandardMaterial[] = [];
    const wheels: THREE.Group[] = [];
    car.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (mat?.emissive && obj.position.x > 2.1 && Math.abs(obj.position.y - 1.28) < 0.05) {
        headlamps.push(mat);
      }
      if (
        obj instanceof THREE.Group &&
        obj.children.length === 2 &&
        Math.abs(obj.rotation.x - Math.PI / 2) < 0.01
      ) {
        wheels.push(obj);
      }
    });
    const headlightCone = new THREE.SpotLight(0xffe9b0, 0, 14, 0.5, 0.6, 1);
    headlightCone.position.set(2.2, 1.3, 0);
    headlightCone.target.position.set(9, 0.4, 0);
    car.add(headlightCone, headlightCone.target);

    // --- The install, drawn as a callout floating above the bonnet: tracker,
    // relay, starter. Tethered to the engine bay by a thin line.
    const callout = new THREE.Group();
    callout.position.set(1.3, 3.55, 0);
    scene.add(callout);
    const tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 1.5, 6),
      new THREE.MeshBasicMaterial({ color: 0x3d4550 })
    );
    tether.position.set(1.3, 2.35, 0);
    scene.add(tether);
    const tray = new THREE.Mesh(
      new THREE.BoxGeometry(4.4, 0.06, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x101318, roughness: 0.9, transparent: true, opacity: 0.85 })
    );
    callout.add(tray);

    const tracker = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.22, 0.6),
      new THREE.MeshStandardMaterial({ color: SHELL, metalness: 0.15, roughness: 0.55 })
    );
    tracker.position.set(-1.5, 0.14, 0);
    callout.add(tracker);
    const trackerLed = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.02, 12),
      new THREE.MeshBasicMaterial({ color: NEON })
    );
    trackerLed.position.set(-1.8, 0.26, 0.2);
    callout.add(trackerLed);

    const relay = new THREE.Group();
    relay.position.set(0.1, 0.03, 0);
    callout.add(relay);
    const coil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.34, 16),
      new THREE.MeshStandardMaterial({ color: COPPER, roughness: 0.4, metalness: 0.7 })
    );
    coil.position.set(-0.2, 0.2, 0);
    relay.add(coil);
    const pinMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, roughness: 0.3, metalness: 0.9 });
    const contactA = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), pinMat);
    contactA.position.set(0.18, 0.18, 0.18);
    relay.add(contactA);
    const contactB = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), pinMat);
    contactB.position.set(0.18, 0.18, -0.18);
    relay.add(contactB);
    const armPivot = new THREE.Group();
    armPivot.position.set(0.18, 0.34, 0.18);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.36), pinMat);
    arm.position.set(0, 0, -0.18);
    armPivot.add(arm);
    relay.add(armPivot);

    const starter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.7, 20),
      new THREE.MeshStandardMaterial({ color: 0x3b414c, roughness: 0.5, metalness: 0.6 })
    );
    starter.rotation.z = Math.PI / 2;
    starter.position.set(1.55, 0.22, 0);
    callout.add(starter);
    const starterLamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 12, 12),
      new THREE.MeshBasicMaterial({ color: NEON })
    );
    starterLamp.position.set(1.55, 0.5, 0);
    callout.add(starterLamp);

    const wireMat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const doutWire = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(-1.05, 0.14, 0.15),
          new THREE.Vector3(-0.5, 0.05, 0.3),
          new THREE.Vector3(-0.1, 0.2, 0.05),
        ]),
        24,
        0.025,
        6,
        false
      ),
      wireMat(AMBER)
    );
    callout.add(doutWire);
    const starterWire = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.28, 0.34, -0.18),
          new THREE.Vector3(0.8, 0.4, -0.2),
          new THREE.Vector3(1.3, 0.3, 0),
        ]),
        24,
        0.025,
        6,
        false
      ),
      wireMat(0xc8cdd6)
    );
    callout.add(starterWire);

    const labelTracker = textSprite('FMC150 · DOUT1', '#c8cdd6', 26, 512);
    labelTracker.position.set(-1.5, 0.62, 0);
    labelTracker.scale.set(1.9, 0.36, 1);
    callout.add(labelTracker);
    const labelRelay = textSprite('relay 85/86 · 30/87a', '#c8cdd6', 26, 512);
    labelRelay.position.set(0.1, 0.72, 0);
    labelRelay.scale.set(2.2, 0.36, 1);
    callout.add(labelRelay);
    const labelStarter = textSprite('starter', '#c8cdd6', 26, 512);
    labelStarter.position.set(1.55, 0.78, 0);
    labelStarter.scale.set(1.4, 0.36, 1);
    callout.add(labelStarter);

    // The command frame, travelling in from the server to the tracker.
    const framePulse = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 12, 12),
      new THREE.MeshBasicMaterial({ color: NEON })
    );
    framePulse.visible = false;
    scene.add(framePulse);
    const frameCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-9, 7.5, -3),
      new THREE.Vector3(-4, 5.5, -1),
      new THREE.Vector3(-0.2, 3.7, 0),
    ]);
    const frameLabel = textSprite('setdigout', '#00e599', 26, 512);
    frameLabel.scale.set(1.6, 0.3, 1);
    frameLabel.visible = false;
    scene.add(frameLabel);


    const render = () => renderer.render(scene, camera);

    // speed: 0 stopped … 1 cruising. It eases toward the target the state
    // sets, so the car visibly rolls to a halt and pulls away again. All
    // motion is in seconds of wall clock, not ticks: a throttled background
    // tab still plays the sequence at the right pace.
    let speed = stateRef.current === 'released' ? 1 : 0;
    let armAngle = 0;
    let t = 0;
    let pulse = 0;
    let keyTimer = 0;
    let cranking = 0;
    let last = performance.now();
    const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

    const tick = setInterval(() => {
      if (document.hidden) return;
      const now = performance.now();
      const dt = Math.min(1, (now - last) / 1000);
      last = now;
      t += dt;
      const s = stateRef.current;
      const blocked = s === 'engaged' || s === 'engaging';
      const transitioning = s === 'engaging' || s === 'releasing';

      // The command arrives before anything happens to the car: pulse runs
      // server → tracker, and only once it lands does the relay act.
      let landed = !transitioning;
      if (transitioning) {
        pulse = Math.min(1, pulse + dt / 2);
        framePulse.visible = pulse < 1;
        frameLabel.visible = pulse < 1;
        framePulse.position.copy(frameCurve.getPoint(pulse));
        frameLabel.position.copy(framePulse.position).add(new THREE.Vector3(0, 0.35, 0));
        landed = pulse >= 1;
      } else {
        framePulse.visible = false;
        frameLabel.visible = false;
        pulse = 0;
      }

      // Relay: arm opens when the coil is energised, once the frame has landed.
      const coilOn = blocked && (s === 'engaged' || landed);
      const targetArm = coilOn ? -0.6 : 0;
      armAngle += (targetArm - armAngle) * ease(7, dt);
      armPivot.rotation.x = armAngle;
      (coil.material as THREE.MeshStandardMaterial).emissive.setHex(coilOn ? 0x7a4010 : 0x000000);
      (doutWire.material as THREE.MeshStandardMaterial).emissive.setHex(coilOn ? 0x7a5a20 : 0x000000);
      (trackerLed.material as THREE.MeshBasicMaterial).color.setHex(coilOn ? RED : NEON);
      const circuitOpen = Math.abs(armAngle) > 0.3;
      (starterLamp.material as THREE.MeshBasicMaterial).color.setHex(circuitOpen ? RED : NEON);

      // The car: with the starter line open it comes to a halt and its lights
      // die; with it closed it pulls away.
      const targetSpeed = circuitOpen ? 0 : s === 'releasing' && !landed ? 0 : 1;
      speed += (targetSpeed - speed) * ease(targetSpeed > speed ? 0.9 : 1.4, dt);
      if (speed < 0.005) speed = 0;
      for (const w of wheels) w.rotation.y -= speed * 7 * dt;
      for (const stripe of stripes) {
        stripe.position.x -= speed * 6.4 * dt;
        if (stripe.position.x < -20) stripe.position.x += 42;
      }
      car.position.y = speed > 0.02 ? Math.sin(t * 9) * 0.012 * speed : 0;
      const lightsOn = !circuitOpen || speed > 0.05;
      for (const lamp of headlamps) {
        lamp.emissiveIntensity = lightsOn ? 1.6 : 0;
        lamp.color.setHex(lightsOn ? 0xffd66b : 0x2b2418);
      }
      headlightCone.intensity = lightsOn ? 18 : 0;

      // While immobilized: every few seconds someone turns the key. The
      // starter lamp flickers red, nothing else moves.
      const dead = s === 'engaged' && speed === 0;
      if (dead) {
        keyTimer += dt;
        if (keyTimer > 3.2) {
          keyTimer = 0;
          cranking = 1;
        }
        if (cranking > 0) {
          cranking -= dt;
          const flicker = Math.sin(cranking * 40) > 0;
          (starterLamp.material as THREE.MeshBasicMaterial).color.setHex(flicker ? 0xff8080 : 0x5a1a1a);
          for (const lamp of headlamps) lamp.emissiveIntensity = flicker ? 0.4 : 0;
        }
      } else {
        keyTimer = 0;
        cranking = 0;
      }

      onMoment?.(
        s === 'engaged'
          ? cranking > 0
            ? 'key_turned'
            : 'dead'
          : transitioning
            ? landed
              ? 'landed'
              : 'sending'
            : 'driving'
      );

      render();
    }, 50);

    const resize = () => {
      const r = container.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      renderer.setSize(r.width, r.height);
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
      render();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      clearInterval(tick);
      observer.disconnect();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          (m as THREE.SpriteMaterial)?.map?.dispose();
          m?.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plate, model]);

  return <div ref={containerRef} className="h-full w-full" />;
}
