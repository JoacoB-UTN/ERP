'use client';

import { useEffect, useRef } from 'react';

const LINES = 22;
/** Horizontal sampling step in viewBox units; smaller is smoother and costlier. */
const STEP = 2;
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
    // Cached, not measured per pointermove: getBoundingClientRect() inside a
    // high-frequency handler forces a layout on every event.
    let rect = panel.getBoundingClientRect();
    let frame = 0;
    let last = 0;
    let dirty = true;

    function draw(time: number) {
      const aspect = rect.width / rect.height;
      const pushing = current.on > 0.01;
      paths.forEach((path, i) => {
        const base = 30 + i * 3.4;
        const amplitude = 1.2 + i * 0.12;
        const phase = time * 0.00022 + i * 0.18;
        let d = 'M';
        for (let x = -2; x <= 102; x += STEP) {
          let y =
            base +
            amplitude * Math.sin(x * 0.07 + phase) +
            amplitude * 0.6 * Math.sin(x * 0.023 - phase * 0.7);
          if (pushing) {
            const dx = (x - current.x) * aspect;
            const dy = y - current.y;
            const falloff = Math.exp(-(dx * dx + dy * dy) / RADIUS_SQ);
            // A smooth sign, not Math.sign: a hard flip makes a thread jump
            // across the pointer the moment it lines up with it.
            y += PUSH * falloff * current.on * (dy / Math.sqrt(dy * dy + 9));
          }
          d += `${x} ${Math.round(y * 100) / 100} `;
        }
        path.setAttribute('d', d);
      });
    }

    function onPointerMove(event: PointerEvent) {
      target.x = ((event.clientX - rect.left) / rect.width) * 100;
      target.y = ((event.clientY - rect.top) / rect.height) * 100;
      target.on = 1;
    }

    function onPointerEnter() {
      rect = panel!.getBoundingClientRect();
    }

    function onPointerLeave() {
      target.on = 0;
    }

    function onResize() {
      rect = panel!.getBoundingClientRect();
      dirty = true;
    }

    function loop(time: number) {
      // Frame-rate independent easing: the same response time at 60Hz and
      // 144Hz. ~50ms to close most of the gap to the pointer, ~80ms to fade
      // the push in or out — quick enough to feel attached to the cursor,
      // still soft enough to read as fabric rather than a snap.
      const dt = Math.min(time - last, 64);
      last = time;
      const follow = 1 - Math.exp(-dt / 50);
      const fade = 1 - Math.exp(-dt / 80);
      const moving =
        Math.abs(target.x - current.x) > 0.05 ||
        Math.abs(target.y - current.y) > 0.05 ||
        Math.abs(target.on - current.on) > 0.002;
      current.x += (target.x - current.x) * follow;
      current.y += (target.y - current.y) * follow;
      current.on += (target.on - current.on) * fade;

      // Reduced motion freezes the ambient drift, so the threads only need
      // redrawing while they are answering the pointer; the rest of the time
      // the loop costs a few comparisons. The pointer response stays on: that
      // motion is the user's own gesture, not something the page does alone.
      if (!document.hidden && (!reduced || moving || dirty)) {
        draw(reduced ? 0 : time);
        dirty = false;
      }
      frame = requestAnimationFrame(loop);
    }

    draw(0);
    frame = requestAnimationFrame(loop);
    panel.addEventListener('pointermove', onPointerMove, { passive: true });
    panel.addEventListener('pointerenter', onPointerEnter);
    panel.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      panel.removeEventListener('pointermove', onPointerMove);
      panel.removeEventListener('pointerenter', onPointerEnter);
      panel.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', onResize);
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
