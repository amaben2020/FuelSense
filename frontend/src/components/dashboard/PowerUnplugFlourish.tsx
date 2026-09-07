'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const PLUG = 0x2a2f36;
const PIN = 0xc9d2de;
const SOCKET = 0x14171b;
const RED = 0xff6b6b;

/**
 * A plug pulling out of a socket and staying apart — not a disconnect/
 * reconnect loop, because while this banner is showing the tracker really is
 * disconnected. It settles into a slow pulsing spark in the gap rather than
 * cycling back together, which would read as "it's fine now" for a state
 * that isn't. Icon-scale, one WebGL context, vanilla three.js — same
 * discipline as TripStartFlourish.
 */
export function PowerUnplugFlourish({ className = '' }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 64;
    const height = container.clientHeight || 64;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 50);
    camera.position.set(0, 0.6, 4.6);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xaebacb, 0x0a0c0f, 1.3));
    const key = new THREE.DirectionalLight(0xfff4e6, 1.1);
    key.position.set(3, 4, 4);
    scene.add(key);

    // Socket, fixed on the left.
    const socket = new THREE.Group();
    const socketBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.1, 0.9),
      new THREE.MeshStandardMaterial({ color: SOCKET, roughness: 0.85 })
    );
    socket.add(socketBody);
    socket.position.x = -1.3;
    scene.add(socket);

    // Plug, animated pulling away to the right.
    const plug = new THREE.Group();
    const plugBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.7, 24),
      new THREE.MeshStandardMaterial({ color: PLUG, roughness: 0.6, metalness: 0.15 })
    );
    plugBody.rotation.z = Math.PI / 2;
    plug.add(plugBody);
    for (const y of [0.18, -0.18]) {
      const pin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.55, 10),
        new THREE.MeshStandardMaterial({ color: PIN, metalness: 0.7, roughness: 0.3 })
      );
      pin.rotation.z = Math.PI / 2;
      pin.position.set(-0.55, y, 0);
      plug.add(pin);
    }
    scene.add(plug);

    // Spark in the gap once separated — a small pulsing point light and a
    // glowing sprite-like sphere, the one moving element once the pull is done.
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 12, 12),
      new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.9 })
    );
    scene.add(spark);
    const sparkLight = new THREE.PointLight(RED, 0, 3);
    scene.add(sparkLight);

    let raf = 0;
    const start = performance.now();
    const PULL_MS = 900;
    const PLUG_REST_X = 1.1;

    const animate = (now: number) => {
      const t = now - start;
      if (t < PULL_MS) {
        const p = t / PULL_MS;
        const eased = 1 - (1 - p) * (1 - p); // ease-out — quick pull, settles
        plug.position.x = -1.3 + eased * (PLUG_REST_X - -1.3);
        spark.visible = false;
        sparkLight.intensity = 0;
      } else {
        plug.position.x = PLUG_REST_X;
        const pulse = 0.5 + 0.5 * Math.sin((t - PULL_MS) / 260);
        spark.visible = true;
        spark.position.set((PLUG_REST_X - 1.3) / 2 - 0.2, 0, 0);
        spark.material.opacity = 0.4 + pulse * 0.5;
        sparkLight.position.copy(spark.position);
        sparkLight.intensity = pulse * 1.4;
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

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

  return <div ref={containerRef} className={`h-16 w-16 ${className}`} aria-hidden="true" />;
}
