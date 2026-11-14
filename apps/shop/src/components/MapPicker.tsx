/**
 * Точка доставки: пин по центру карты, карту двигают под ним (как в Grab и Яндекс Go).
 * Точка считается поставленной, когда покупатель подвинул карту, нажал «Я сейчас здесь»
 * или вставил ссылку.
 *
 * Карта — MapLibre + OpenFreeMap (векторные плитки OpenStreetMap, без ключа и лимитов).
 * tile.openstreetmap.org из Вьетнама открывается не всегда, CARTO требует ключ.
 * Библиотека грузится только здесь, чтобы меню открывалось быстро.
 */
import { Move } from "lucide-react";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { DraftLocation } from "../lib/cart.ts";

/** Где открыть карту, пока точки нет. Для другого города — поменять здесь. */
export const DEFAULT_CENTER = { lat: 15.8801, lng: 108.338 };
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const DEFAULT_ZOOM = 13;
const PIN_ZOOM = 17;

type Props = {
  value: DraftLocation | null;
  onChange: (location: DraftLocation) => void;
};

type GeoData = Parameters<GeoJSONSource["setData"]>[0];

/** Круг погрешности GPS — многоугольник из 64 точек. */
function circle(lat: number, lng: number, meters: number): GeoData {
  const coords: [number, number][] = [];
  const dLat = meters / 111_320;
  const dLng = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}

const EMPTY: GeoData = { type: "FeatureCollection", features: [] };

export function MapPicker({ value, onChange }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initial = useRef(value);
  /** Последняя точка, выставленная программно, — чтобы не принять её за движение пальцем. */
  const applied = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let m: MlMap | null = null;
    (async () => {
      try {
        const [{ Map: MapClass, setWorkerUrl }, worker] = await Promise.all([
          import("maplibre-gl"),
          // Vite 8: воркер MapLibre подключается отдельным файлом (документация MapLibre v6).
          import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
          import("maplibre-gl/dist/maplibre-gl.css"),
        ]);
        setWorkerUrl(worker.default);
        if (cancelled || !box.current) return;
        const start = initial.current ?? DEFAULT_CENTER;
        const instance = new MapClass({
          container: box.current,
          style: MAP_STYLE,
          center: [start.lng, start.lat],
          zoom: initial.current ? PIN_ZOOM : DEFAULT_ZOOM,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });
        m = instance;
        instance.touchZoomRotate.disableRotation();
        let userMoving = false;
        instance.on("movestart", (e) => {
          if (e.originalEvent) userMoving = true;
        });
        instance.on("moveend", () => {
          if (!userMoving) return;
          userMoving = false;
          (instance.getSource("accuracy") as GeoJSONSource | undefined)?.setData(EMPTY);
          const c = instance.getCenter();
          onChangeRef.current({ lat: round(c.lat), lng: round(c.lng), source: "pin" });
        });
        instance.on("load", () => {
          instance.addSource("accuracy", { type: "geojson", data: EMPTY });
          instance.addLayer({
            id: "accuracy-fill",
            type: "fill",
            source: "accuracy",
            paint: { "fill-color": "#b5482a", "fill-opacity": 0.1 },
          });
          instance.addLayer({
            id: "accuracy-line",
            type: "line",
            source: "accuracy",
            paint: { "line-color": "#b5482a", "line-width": 1.5, "line-opacity": 0.5 },
          });
          setReady(true);
        });
        map.current = instance;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      m?.remove();
      map.current = null;
    };
  }, []);

  // Точка пришла снаружи (GPS или ссылка) — переносим карту и рисуем круг погрешности.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !value || value.source === "pin") return;
    const key = `${value.lat},${value.lng},${value.accuracy ?? ""}`;
    if (applied.current === key) return;
    applied.current = key;
    const zoom = value.accuracy && value.accuracy > 150 ? 15 : PIN_ZOOM;
    m.easeTo({ center: [value.lng, value.lat], zoom, duration: 600 });
    (m.getSource("accuracy") as GeoJSONSource | undefined)?.setData(
      value.accuracy ? circle(value.lat, value.lng, value.accuracy) : EMPTY,
    );
  }, [value, ready]);

  return (
    <div className="relative h-[220px] overflow-hidden bg-muted">
      {/* Свой CSS MapLibre ставит контейнеру position: relative — позиционируем обёртку. */}
      <div className="absolute inset-0">
        <div ref={box} className="h-full w-full" />
      </div>
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] text-hint">
          Карта не загрузилась. Нажмите «Я сейчас здесь» или вставьте ссылку из Google Maps.
        </div>
      )}
      {/* Пин по центру: остриё — ровно в центре карты */}
      <svg
        width="34"
        height="44"
        viewBox="0 0 24 32"
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full drop-shadow"
      >
        <path d="M12 31s10-11.2 10-19A10 10 0 0 0 2 12c0 7.8 10 19 10 19Z" fill="var(--accent)" />
        <circle cx="12" cy="12" r="4" fill="#fff" />
      </svg>
      <span className="pointer-events-none absolute top-2.5 left-2.5 flex h-7 items-center gap-1.5 rounded-full bg-white/95 px-2.5 text-xs font-semibold text-[#0b0b0c] shadow">
        <Move size={14} strokeWidth={2.2} />
        Двигайте карту — пин встанет точно
      </span>
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
