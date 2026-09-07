'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Matches Vehicle3D's studio palette so this reads as the same vehicle
// language, not a second visual style introduced for one screen.
const BODY = 0x1b1e23;
const GLASS = 0x090c10;
const TIRE = 0x0b0f15;
const HUB = 0x39424f;
const GREEN = 0x00e599;

function buildCar(): THREE.Group {
  const car = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: BODY, roughness: 0.8, metalness: 0.1 });
  const glassMat = new THREE.MeshStandardMaterial({ color: GLASS, roughness: 0.3, metalness: 0.2 });
  const tireMat = new THREE.MeshStandardMaterial({ color: TIRE, roughness: 0.95 });
  const hubMat = new THREE.MeshStandardMaterial({ color: HUB, roughness: 0.4, metalness: 0.6 });

  const lower = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 1), bodyMat);
  lower.position.y = 0.4;
  car.add(lower);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.9), glassMat);
  cabin.position.set(-0.1, 0.85, 0);
  car.add(cabin);

  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.12, 0.85),
    new THREE.MeshStandardMaterial({ color: GREEN, emissive: GREEN, emissiveIntensity: 1.4 })
  );
  tail.position.set(-1.14, 0.42, 0);
  car.add(tail);

  for (const [x, z] of [
    [0.75, 0.52],
    [0.75, -0.52],
    [-0.75, 0.52],
    [-0.75, -0.52],
  ] as const) {
    const wheel = new THREE.Group();
    const tireMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 20), tireMat);
    tireMesh.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.22, 12), hubMat);
    hub.rotation.z = Math.PI / 2;
    wheel.add(tireMesh, hub);
    wheel.position.set(x, 0.28, z);
    car.add(wheel);
  }

  return car;
}

/**
 * A one-shot flourish for "a trip started" — the vehicle drives off past the
 * frame edge, pauses, and drives back on to repeat. Icon-scale on purpose:
 * one small canvas at the top of Recent trip starts, not one per row, so it
 * costs a single WebGL context regardless of how many trips are listed.
 */
export function TripStartFlourish({ className = '' }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 200;
    const height = container.clientHeight || 64;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 50);
    camera.position.set(4.2, 1.9, 4.2);
    camera.lookAt(0, 0.4, 0);

    scene.add(new THREE.HemisphereLight(0xaebacb, 0x0a0c0f, 1.2));
    const key = new THREE.DirectionalLight(0xfff4e6, 1.1);
    key.position.set(4, 6, 5);
    scene.add(key);

    const car = buildCar();
    scene.add(car);

    // A stationary "workplace" marker the car pulls away from — a low pad of
    // light under the start position — so the loop reads as "leaving
    // somewhere" rather than a car sliding across an empty void.
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 32),
      new THREE.MeshBasicMaterial({ color: 0x2a2f36, transparent: true, opacity: 0.5 })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(1.6, 0.01, 0);
    scene.add(pad);

    let raf = 0;
    const start = performance.now();
    // Drive out over 1.6s, hold off-frame for 1.2s, then reset — a loop
    // rather than a single play so the flourish is still there minutes later.
    const DRIVE_MS = 1600;
    const HOLD_MS = 1200;
    const CYCLE_MS = DRIVE_MS + HOLD_MS;

    const animate = (now: number) => {
      const t = (now - start) % CYCLE_MS;
      if (t < DRIVE_MS) {
        const p = t / DRIVE_MS;
        const eased = p * p * (3 - 2 * p); // smoothstep — no jolt at either end
        car.position.x = 1.6 - eased * 4.4;
        car.rotation.y = 0;
        car.visible = true;
      } else {
        car.visible = false;
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    // Rebuilding on resize would be overkill for a decorative flourish this
    // small — just keep the aspect ratio correct if the container changes.
    const resize = () => {
      const w = container.clientWidth || width;
      const h = container.clientHeight || height;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} className={`h-16 w-full ${className}`} aria-hidden="true" />;
}
