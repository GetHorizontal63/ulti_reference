import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export default function STLViewer({ url, glb = null, rotationY = 0, rotationX = 0.15, color = '#4a90d9', texture = null }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.5;
    el.appendChild(renderer.domElement);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 1000);

    const doRender = () => renderer.render(scene, camera);

    let mouseGroup = null;
    const onMouseMove = (e) => {
      if (!mouseGroup) return;
      const mx = (e.clientX / window.innerWidth)  * 2 - 1;  // −1 … +1
      const my = (e.clientY / window.innerHeight) * 2 - 1;
      mouseGroup.rotation.y = rotationY + mx * 0.08;
      mouseGroup.rotation.x = rotationX + my * 0.05;  // + = inverted vertical
      doRender();
    };
    window.addEventListener('mousemove', onMouseMove);

    const setSize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      doRender();
    };
    setSize();
    const ro = new ResizeObserver(setSize);
    ro.observe(el);

    // STL lights — strong directional to show emboss depth
    const ambientSTL = new THREE.AmbientLight(0xffffff, 0.20);
    const keySTL = new THREE.DirectionalLight(0xffffff, 2.2);
    keySTL.position.set(2, 10, 4);
    const fillSTL = new THREE.DirectionalLight(0xffffff, 0.5);
    fillSTL.position.set(-5, 0, 3);
    const rimSTL = new THREE.DirectionalLight(0xffffff, 0.3);
    rimSTL.position.set(0, -5, -4);

    // GLB lights — env map provides colour; one soft directional adds depth
    const keyGLB = new THREE.DirectionalLight(0xffffff, 0.35);
    keyGLB.position.set(2, 6, 8);

    // Lights are added in loadSTL() or the GLB branch below

    const fitCamera = (object) => {
      const box = new THREE.Box3().setFromObject(object);
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      const hFov = (camera.fov * Math.PI) / 180 / 2;
      camera.position.set(0, 0, (sphere.radius / Math.tan(hFov)) * 1.18);
      camera.updateProjectionMatrix();
    };

    if (glb) {
      // PBR materials need an environment map — generate one from a simple white room
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      const envTexture = pmrem.fromScene(new RoomEnvironment()).texture;
      scene.environment = envTexture;
      scene.environmentIntensity = 0.5;
      pmrem.dispose();
      scene.add(keyGLB);

      // ── GLB path ────────────────────────────────────────────────────────────
      new GLTFLoader().load(glb, (gltf) => {
        const model = gltf.scene;

        // Clamp metalness so the key light doesn't blow out specular highlights
        model.traverse((child) => {
          if (child.isMesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((mat) => {
              if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
                mat.metalness = 0.15;
                mat.roughness = 0.6;
              }
            });
          }
        });

        // Center
        const box = new THREE.Box3().setFromObject(model);
        const center = new THREE.Vector3();
        box.getCenter(center);
        model.position.sub(center);

        const group = new THREE.Group();
        group.rotation.y = rotationY;
        group.rotation.x = rotationX;
        group.add(model);
        scene.add(group);
        mouseGroup = group;

        fitCamera(group);
        doRender();
      }, undefined, () => {
        // GLB not found — fall through to STL
        scene.environment = null;
        loadSTL();
      });
    } else {
      loadSTL();
    }

    function loadSTL() {
      // STL lights (env map not needed)
      scene.add(ambientSTL);
      scene.add(keySTL);
      scene.add(fillSTL);
      scene.add(rimSTL);

      new STLLoader().load(url, (geometry) => {
        geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        geometry.boundingBox.getCenter(center);
        geometry.translate(-center.x, -center.y, -center.z);

        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox;
        const size = new THREE.Vector3();
        bbox.getSize(size);

        geometry.computeVertexNormals();

        const group = new THREE.Group();
        group.rotation.y = rotationY;
        group.rotation.x = rotationX;
        scene.add(group);
        mouseGroup = group;

        group.add(new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({
          color:     new THREE.Color(color),
          specular:  new THREE.Color(0x224466),
          shininess: 80,
          side:      THREE.DoubleSide,
        })));

        fitCamera(group);

        // PNG overlay when no GLB
        if (texture) {
          const pos = geometry.attributes.position;
          const zThreshold = bbox.max.z - size.z * 0.1;
          let fcx = 0, fcy = 0, fcount = 0;
          for (let i = 0; i < pos.count; i++) {
            if (pos.getZ(i) >= zThreshold) {
              fcx += pos.getX(i); fcy += pos.getY(i); fcount++;
            }
          }
          const planeCX = fcount > 0 ? fcx / fcount : 0;
          const planeCY = fcount > 0 ? fcy / fcount : 0;

          const img = new Image();
          img.onload = () => {
            const tex = new THREE.Texture(img);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.needsUpdate = true;
            const planeGeo = new THREE.PlaneGeometry(size.x * 1.15, size.y * 1.15);
            const planeMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, alphaTest: 0.05 });
            const plane = new THREE.Mesh(planeGeo, planeMat);
            plane.position.set(planeCX, planeCY, bbox.max.z + Math.max(size.z * 0.05, 0.5));
            group.add(plane);
            doRender();
          };
          img.src = texture;
        }

        doRender();
      });
    }

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      ro.disconnect();
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [url, glb, rotationY, rotationX, color, texture]);

  return <div ref={mountRef} style={{ width: '100%', height: '100%' }} />;
}

