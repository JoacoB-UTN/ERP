'use client';

import { useEffect, useRef } from 'react';

const LINES = 22;
/** Horizontal sampling step in viewBox units; smaller is smoother and costlier. */
const STEP = 1.5;
/** How far a thread moves away from the pointer, and how wide that area is. */
const PUSH = 7;
const RADIUS_SQ = 220;

/**
 * The login screen's brand-panel background: soft threads like the folds of a
 * sheet, drifting slowly and parting around the pointer.
 *
 * Paths are written straight to the DOM from a rAF loop instead of through
 * React state: it runs every frame, and re-rendering 22 paths through React
 * 60 times a second would be pure overhead for something no other component
 * reads. The pointer is tracked on the parent panel, not on the SVG, because
 * the panel's content sits above the SVG and would swallow the events.
 */
export function LoginWeave() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const panel = svg?.parentElement;
    if (!svg || !panel) return;

    const paths = Array.from(svg.querySelectorAll('path'));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = { x: 50, y: 50, on: 0 };
    const current = { x: 50, y: 50, on: 0 };
    let aspect = 1;
    let frame = 0;

    function draw(time: number) {
      // Eased toward the pointer so the fabric trails it instead of snapping.
      current.x += (target.x - current.x) * 0.08;
      current.y += (target.y - current.y) * 0.08;
      current.on += (target.on - current.on) * 0.05;

      paths.forEach((path, i) => {
        const base = 30 + i * 3.4;
        const amplitude = 1.2 + i * 0.12;
        const phase = time * 0.00022 + i * 0.18;
        let d = '';
        for (let x = -2; x <= 102; x += STEP) {
          let y =
            base +
            amplitude * Math.sin(x * 0.07 + phase) +
            amplitude * 0.6 * Math.sin(x * 0.023 - phase * 0.7);
          if (current.on > 0.01) {
            const dx = (x - current.x) * aspect;
            const dy = y - current.y;
            const falloff = Math.exp(-(dx * dx + dy * dy) / RADIUS_SQ);
            // A smooth sign, not Math.sign: a hard flip makes a thread jump
            // across the pointer the moment it lines up with it.
            y += PUSH * falloff * current.on * (dy / Math.sqrt(dy * dy + 9));
          }
          d += `${d ? ' L ' : 'M '}${x.toFixed(1)} ${y.toFixed(2)}`;
        }
        path.setAttribute('d', d);
      });
    }

    function onPointerMove(event: PointerEvent) {
      const rect = panel!.getBoundingClientRect();
      target.x = ((event.clientX - rect.left) / rect.width) * 100;
      target.y = ((event.clientY - rect.top) / rect.height) * 100;
      target.on = 1;
      aspect = rect.width / rect.height;
    }

    function onPointerLeave() {
      target.on = 0;
    }

    function loop(time: number) {
      if (!document.hidden) draw(time);
      frame = requestAnimationFrame(loop);
    }

    draw(0);
    if (reduced) return;

    frame = requestAnimationFrame(loop);
    panel.addEventListener('pointermove', onPointerMove);
    panel.addEventListener('pointerleave', onPointerLeave);
    return () => {
      cancelAnimationFrame(frame);
      panel.removeEventListener('pointermove', onPointerMove);
      panel.removeEventListener('pointerleave', onPointerLeave);
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="login-weave-in absolute inset-0 -z-10 size-full text-primary/20 dark:text-primary/25"
    >
      {Array.from({ length: LINES }, (_, i) => (
        <path key={i} fill="none" stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
