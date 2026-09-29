import { R_EARTH_KM } from "@/lib/crowding/grid";
import { EARTH_RADIUS_KM } from "@/lib/orbit";

/** A crowding altitude (km above R_E) as a radius in scene units (1 = EARTH_RADIUS_KM). */
export function ringRadius(altKm: number): number {
  return (R_EARTH_KM + altKm) / EARTH_RADIUS_KM;
}

/** The circle where a sphere of radius `s` meets its tangent lines from a viewer at distance `d`:
 * it sits `offset` from the centre towards the viewer, with this `radius`. */
export function silhouette(s: number, d: number): { offset: number; radius: number } {
  if (d <= s) return { offset: 0, radius: s };
  return { offset: (s * s) / d, radius: s * Math.sqrt(1 - (s * s) / (d * d)) };
}

export function unitCircle(n: number): Float32Array {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    out[3 * i] = Math.cos(t);
    out[3 * i + 1] = Math.sin(t);
  }
  return out;
}

/** Every other segment of the circle at latitude `latDeg` on a sphere of `radius` (scene y is
 * north), as start/end pairs for THREE.LineSegments. Empty near the poles. */
export function dashedLatitude(radius: number, latDeg: number, n = 96): Float32Array {
  if (Math.abs(latDeg) >= 89.9) return new Float32Array(0);
  const phi = (latDeg * Math.PI) / 180;
  const y = radius * Math.sin(phi);
  const r = radius * Math.cos(phi);
  const out = new Float32Array((n / 2) * 2 * 3);
  for (let k = 0; k < n / 2; k++) {
    for (const [j, step] of [[0, 2 * k], [1, 2 * k + 1]] as const) {
      const t = (step / n) * 2 * Math.PI;
      out.set([r * Math.cos(t), y, r * Math.sin(t)], (2 * k + j) * 3);
    }
  }
  return out;
}
