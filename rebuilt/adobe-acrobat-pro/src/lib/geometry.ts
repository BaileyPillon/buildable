/**
 * Mapping between the "view" (what you see: page rotation applied, origin top-left,
 * y pointing down, units = PDF points) and PDF user space (origin bottom-left, y up,
 * before /Rotate). Matches pdf.js's viewport at scale 1, so positions picked on a
 * pdf.js-rendered canvas can be written back with pdf-lib.
 */
import type { PDFPage } from 'pdf-lib';

export type Box = [x0: number, y0: number, x1: number, y1: number];

export interface ViewTransform {
  /** Size of the page as displayed, in points. */
  width: number;
  height: number;
  /** Page rotation, clockwise, 0/90/180/270. */
  rotation: number;
  toUser(vx: number, vy: number): { x: number; y: number };
  /** Counter-clockwise angle (degrees) that makes user-space content appear upright in the view. */
  textAngle: number;
}

export function makeViewTransform(box: Box, rotation: number): ViewTransform {
  const [x0, y0, x1, y1] = box;
  const r = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  const w = x1 - x0;
  const h = y1 - y0;
  switch (r) {
    case 90:
      return { width: h, height: w, rotation: r, textAngle: 90, toUser: (vx, vy) => ({ x: x0 + vy, y: y0 + vx }) };
    case 180:
      return { width: w, height: h, rotation: r, textAngle: 180, toUser: (vx, vy) => ({ x: x1 - vx, y: y0 + vy }) };
    case 270:
      return { width: h, height: w, rotation: r, textAngle: 270, toUser: (vx, vy) => ({ x: x1 - vy, y: y1 - vx }) };
    default:
      return { width: w, height: h, rotation: 0, textAngle: 0, toUser: (vx, vy) => ({ x: x0 + vx, y: y1 - vy }) };
  }
}

export function viewTransformForPage(page: PDFPage): ViewTransform {
  const cb = page.getCropBox();
  return makeViewTransform([cb.x, cb.y, cb.x + cb.width, cb.y + cb.height], page.getRotation().angle);
}
