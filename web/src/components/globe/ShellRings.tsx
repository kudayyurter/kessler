"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { latitudeLimitDeg, ringAltitudeKm } from "@/lib/crowding/shell";
import { dashedLatitude, ringRadius, silhouette, unitCircle } from "@/lib/crowding/rings";
import { useExplorer } from "@/lib/store";

const RING_COLOR = "#7fd06b";

/** The hovered (or pinned) crowding cell drawn around the globe: a true-scale ring at the shell's
 * altitude, always facing the camera, and dashed circles at the highest latitudes the band's
 * orbits reach. */
export function ShellRings() {
  const hover = useExplorer((s) => s.hoverShell);
  const pinned = useExplorer((s) => s.shell);
  const shell = hover ?? pinned;
  const alt = shell ? ringAltitudeKm(shell) : null;
  if (!shell || alt === null) return null;
  return <Rings radius={ringRadius(alt)} latDeg={latitudeLimitDeg(shell)} />;
}

function Rings({ radius, latDeg }: { radius: number; latDeg: number }) {
  const camera = useThree((s) => s.camera);
  const limb = useRef<THREE.LineLoop>(null);
  const limbGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(unitCircle(160), 3));
    return g;
  }, []);
  const latGeometry = useMemo(() => {
    const north = dashedLatitude(radius, latDeg);
    const south = dashedLatitude(radius, -latDeg);
    const both = new Float32Array(north.length + south.length);
    both.set(north);
    both.set(south, north.length);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(both, 3));
    return g;
  }, [radius, latDeg]);
  useEffect(() => () => limbGeometry.dispose(), [limbGeometry]);
  useEffect(() => () => latGeometry.dispose(), [latGeometry]);

  useFrame(() => {
    const l = limb.current;
    if (!l) return;
    const { offset, radius: r } = silhouette(radius, camera.position.length());
    l.position.copy(camera.position).setLength(offset);
    l.quaternion.copy(camera.quaternion);
    l.scale.setScalar(r);
  });

  return (
    <>
      <lineLoop ref={limb} geometry={limbGeometry} renderOrder={2}>
        <lineBasicMaterial color={RING_COLOR} transparent opacity={0.9} depthTest={false} />
      </lineLoop>
      <lineSegments geometry={latGeometry}>
        <lineBasicMaterial color={RING_COLOR} transparent opacity={0.6} />
      </lineSegments>
    </>
  );
}
