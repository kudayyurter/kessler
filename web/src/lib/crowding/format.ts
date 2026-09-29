import type { ObjectType } from "@/lib/types";

export interface CrowdingDayHeader {
  version: number;
  day: string;
  generated_at: string;
  generation: string | null;
  source: "live" | "archive";
  count: number;
  skipped: number;
  owners: string[];
  types: ObjectType[];
  columns: { name: string; dtype: string }[];
}

/** One decoded day: parallel arrays, sorted by NORAD ID. */
export interface CrowdingDay {
  header: CrowdingDayHeader;
  norad: Uint32Array;
  owner: Uint16Array;
  type: Uint8Array;
  smaKm: Float64Array;
  ecc: Float64Array;
  incDeg: Float64Array;
}

const MAGIC = "CRW1";
const LAYOUT = "norad_delta:u32,owner:u16,type:u8,sma_dkm:u32,ecc_e6:u32,inc_cdeg:u16";
const BYTES_PER_OBJECT = 4 + 2 + 1 + 4 + 4 + 2;

/** Decodes uncompressed CRW1 bytes (see api/app/crowding/format.py). Columns are not aligned after
 * the JSON header, so they are read with a DataView, not typed-array views. */
export function decodeCrowdingDay(raw: Uint8Array): CrowdingDay {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw.byteLength < 8 || new TextDecoder().decode(raw.subarray(0, 4)) !== MAGIC) throw new Error("not a CRW1 day file");
  const headerLen = view.getUint32(4, true);
  if (raw.byteLength < 8 + headerLen) throw new Error("CRW1 day file is truncated");
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + headerLen))) as CrowdingDayHeader;
  if (header.columns.map((c) => `${c.name}:${c.dtype}`).join(",") !== LAYOUT) throw new Error("unsupported CRW1 columns");
  const n = header.count;
  let off = 8 + headerLen;
  if (raw.byteLength < off + n * BYTES_PER_OBJECT) throw new Error("CRW1 day file is truncated");

  const norad = new Uint32Array(n);
  let id = 0;
  for (let i = 0; i < n; i++) norad[i] = id += view.getUint32(off + 4 * i, true);
  off += 4 * n;
  const owner = new Uint16Array(n);
  for (let i = 0; i < n; i++) owner[i] = view.getUint16(off + 2 * i, true);
  off += 2 * n;
  const type = new Uint8Array(n);
  for (let i = 0; i < n; i++) type[i] = view.getUint8(off + i);
  off += n;
  const smaKm = new Float64Array(n);
  for (let i = 0; i < n; i++) smaKm[i] = view.getUint32(off + 4 * i, true) / 10;
  off += 4 * n;
  const ecc = new Float64Array(n);
  for (let i = 0; i < n; i++) ecc[i] = view.getUint32(off + 4 * i, true) / 1e6;
  off += 4 * n;
  const incDeg = new Float64Array(n);
  for (let i = 0; i < n; i++) incDeg[i] = view.getUint16(off + 2 * i, true) / 100;
  return { header: { ...header, skipped: header.skipped ?? 0 }, norad, owner, type, smaKm, ecc, incDeg };
}
