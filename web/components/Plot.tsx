"use client";
// Renders a {data, layout} figure with plotly.js (loaded only in the browser).
import { useEffect, useRef } from "react";
import type { Fig } from "@/lib/planner/charts";

type ClickPoint = { customdata?: unknown };
type PlotEl = HTMLDivElement & { on?: (ev: string, cb: (e: { points: ClickPoint[] }) => void) => void; removeAllListeners?: (ev: string) => void };

export default function Plot({ fig, onClick, scrollZoom = false }: { fig: Fig; onClick?: (customdata: unknown) => void; scrollZoom?: boolean }) {
  const ref = useRef<PlotEl>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    let alive = true;
    const el = ref.current!;
    import("plotly.js-dist-min").then(({ default: Plotly }) => {
      if (!alive) return;
      Plotly.react(el, fig.data, fig.layout, { responsive: true, displayModeBar: false, scrollZoom }).then(() => {
        el.removeAllListeners?.("plotly_click");
        el.on?.("plotly_click", (e) => {
          const cd = e.points?.find((p) => p.customdata)?.customdata;
          if (cd && clickRef.current) clickRef.current(cd);
        });
      });
    });
    return () => {
      alive = false;
    };
  }, [fig, scrollZoom]);

  useEffect(() => {
    const el = ref.current!;
    return () => {
      import("plotly.js-dist-min").then(({ default: Plotly }) => Plotly.purge(el));
    };
  }, []);

  return <div ref={ref} className="plot" style={{ minHeight: fig.layout?.height ?? 400 }} />;
}
