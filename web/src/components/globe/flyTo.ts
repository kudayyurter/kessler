import { animate } from "animejs";
import * as THREE from "three";
import { prefersReducedMotion } from "@/lib/motion";

export function shortestAngle(from: number, to: number): number {
  const d = to - from;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/** A group's answer for one object: its position, "pending" (in this group's data but no
 * position computed yet), or "absent" (not in this group's data). */
export type Found = THREE.Vector3 | "pending" | "absent";
export type Locator = (id: number) => Found;

/**
 * Looks for an object across the groups expected to be loaded (by index, e.g. [0] for LEO or
 * [0, 1] for LEO and HIGH) in a sparse locator list, where a group that hasn't loaded (or failed)
 * leaves a hole. Returns the first position found; "absent" only when every expected group is
 * loaded and none has the object; otherwise "pending".
 */
export function locate(locators: readonly (Locator | undefined)[], expected: readonly number[], id: number): Found {
  let pending = false;
  for (const i of expected) {
    const find = locators[i];
    if (!find) {
      pending = true;
      continue;
    }
    const r = find(id);
    if (r instanceof THREE.Vector3) return r;
    if (r === "pending") pending = true;
  }
  return pending ? "pending" : "absent";
}

/** Arcs the camera around the globe (never through it) to look at `target` from `distance`. */
export function flyTo(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  distance: number,
  onDone?: () => void,
): { cancel(): void } {
  const from = new THREE.Spherical().setFromVector3(camera.position);
  const to = new THREE.Spherical().setFromVector3(target.clone().normalize().multiplyScalar(distance));
  const apply = (r: number, phi: number, theta: number) => {
    camera.position.setFromSpherical(new THREE.Spherical(r, phi, theta));
    camera.lookAt(0, 0, 0);
  };
  if (prefersReducedMotion()) {
    apply(to.radius, to.phi, to.theta);
    onDone?.();
    return { cancel() {} };
  }
  const s = { r: from.radius, phi: from.phi, theta: from.theta };
  const anim = animate(s, {
    r: [from.radius, Math.max(from.radius, to.radius) + 0.6, to.radius],
    phi: to.phi,
    theta: from.theta + shortestAngle(from.theta, to.theta),
    duration: 2000,
    ease: "inOutQuart",
    onUpdate: () => apply(s.r, s.phi, s.theta),
    onComplete: () => onDone?.(),
  });
  return { cancel: () => anim.pause() };
}
