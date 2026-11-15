/**
 * Зона доставки в настройках: карта с кругами и список кругов (название, радиус).
 * На карте круг выбирают кликом, двигают за центр, размер меняют за точку на краю.
 * Карта — MapLibre + OpenFreeMap, как в магазине (без ключа); грузится только здесь.
 */
import {
  DELIVERY_CIRCLES_MAX,
  type DeliveryCircle,
  type DeliveryZone,
  distanceKm,
} from "@store/schema";
import { Plus, Trash2 } from "lucide-react";
import type { GeoJSONSource, Marker, Map as MlMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { FIELD_LABEL, FieldError, TextField, Toggle } from "./ui.tsx";

/** Где открыть карту, пока кругов нет. Для другого города — поменять здесь (и в магазине). */
const DEFAULT_CENTER = { lat: 15.97, lng: 108.27 };
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const ACCENT = "#b5482a";

type GeoData = Parameters<GeoJSONSource["setData"]>[0];

const round = (n: number, d = 5) => Math.round(n * 10 ** d) / 10 ** d;
const kmPerDegLng = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);

function ring(c: DeliveryCircle): [number, number][] {
  const coords: [number, number][] = [];
  const dLat = c.radiusKm / 110.574;
  const dLng = c.radiusKm / kmPerDegLng(c.lat);
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    coords.push([c.lng + dLng * Math.cos(a), c.lat + dLat * Math.sin(a)]);
  }
  return coords;
}

function circlesData(circles: DeliveryCircle[], selected: number): GeoData {
  return {
    type: "FeatureCollection",
    features: circles
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => Number.isFinite(c.radiusKm) && c.radiusKm > 0)
      .map(({ c, i }) => ({
        type: "Feature" as const,
        properties: { i, selected: i === selected },
        geometry: { type: "Polygon" as const, coordinates: [ring(c)] },
      })),
  };
}

/** Точка на восточном краю круга — за неё тянут радиус. */
const edgeOf = (c: DeliveryCircle): [number, number] => [
  c.lng + (Number.isFinite(c.radiusKm) ? c.radiusKm : 1) / kmPerDegLng(c.lat),
  c.lat,
];

function dot(kind: "center" | "edge"): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText =
    kind === "center"
      ? `width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid ${ACCENT};box-shadow:0 1px 3px rgba(0,0,0,.3);cursor:move`
      : `width:14px;height:14px;border-radius:50%;background:${ACCENT};border:2.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);cursor:ew-resize`;
  return el;
}

export function ZoneEditor({
  value,
  onChange,
  errors,
}: {
  value: DeliveryZone;
  onChange: (zone: DeliveryZone) => void;
  errors: Record<string, string>;
}) {
  const [selected, setSelected] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const centers = useRef<Marker[]>([]);
  const edge = useRef<Marker | null>(null);
  const edgeDragging = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ value, onChange, selected });
  latest.current = { value, onChange, selected };
  const initial = useRef(value.circles);

  const setCircle = (i: number, patch: Partial<DeliveryCircle>) => {
    const { value: v, onChange: change } = latest.current;
    change({ ...v, circles: v.circles.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  };

  // Карта — один раз.
  useEffect(() => {
    let cancelled = false;
    let m: MlMap | null = null;
    (async () => {
      try {
        const [maplibre, worker] = await Promise.all([
          import("maplibre-gl"),
          // Vite 8: воркер MapLibre подключается отдельным файлом (документация MapLibre v6).
          import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
          import("maplibre-gl/dist/maplibre-gl.css"),
        ]);
        maplibre.setWorkerUrl(worker.default);
        if (cancelled || !box.current) return;
        lib.current = maplibre;
        const start = initial.current;
        const instance = new maplibre.Map({
          container: box.current,
          style: MAP_STYLE,
          center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
          zoom: 10,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
        });
        m = instance;
        instance.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        if (start.length > 0) {
          const bounds = new maplibre.LngLatBounds();
          for (const c of start) for (const p of ring(c)) bounds.extend(p);
          instance.fitBounds(bounds, { padding: 32, duration: 0 });
        }
        instance.on("load", () => {
          instance.addSource("zone", { type: "geojson", data: circlesData([], 0) });
          instance.addLayer({
            id: "zone-fill",
            type: "fill",
            source: "zone",
            paint: {
              "fill-color": ACCENT,
              "fill-opacity": ["case", ["get", "selected"], 0.18, 0.1],
            },
          });
          instance.addLayer({
            id: "zone-line",
            type: "line",
            source: "zone",
            paint: {
              "line-color": ACCENT,
              "line-width": ["case", ["get", "selected"], 2.5, 1.5],
            },
          });
          instance.on("click", "zone-fill", (e) => {
            const i = e.features?.at(-1)?.properties?.i;
            if (typeof i === "number") setSelected(i);
          });
          instance.on("mouseenter", "zone-fill", () => {
            instance.getCanvas().style.cursor = "pointer";
          });
          instance.on("mouseleave", "zone-fill", () => {
            instance.getCanvas().style.cursor = "";
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

  const sel = Math.min(selected, Math.max(0, value.circles.length - 1));

  // Круги, центры и точка радиуса — по текущему значению.
  useEffect(() => {
    const m = map.current;
    const ml = lib.current;
    if (!m || !ml || !ready) return;
    (m.getSource("zone") as GeoJSONSource | undefined)?.setData(circlesData(value.circles, sel));

    while (centers.current.length > value.circles.length) centers.current.pop()?.remove();
    value.circles.forEach((c, i) => {
      let marker = centers.current[i];
      if (!marker) {
        marker = new ml.Marker({ element: dot("center"), draggable: true })
          .setLngLat([c.lng, c.lat])
          .addTo(m);
        const mk = marker;
        mk.on("dragstart", () => setSelected(i));
        mk.on("drag", () => {
          const p = mk.getLngLat();
          setCircle(i, { lat: round(p.lat), lng: round(p.lng) });
        });
        centers.current[i] = mk;
      } else {
        marker.setLngLat([c.lng, c.lat]);
      }
    });

    const current = value.circles[sel];
    if (!current) {
      edge.current?.remove();
      edge.current = null;
      return;
    }
    if (!edge.current) {
      const mk = new ml.Marker({ element: dot("edge"), draggable: true })
        .setLngLat(edgeOf(current))
        .addTo(m);
      mk.on("dragstart", () => {
        edgeDragging.current = true;
      });
      mk.on("drag", () => {
        const { value: v, selected: s } = latest.current;
        const i = Math.min(s, v.circles.length - 1);
        const c = v.circles[i];
        if (!c) return;
        const p = mk.getLngLat();
        const km = Math.max(0.3, Math.min(100, distanceKm(c, { lat: p.lat, lng: p.lng })));
        setCircle(i, { radiusKm: round(km, 1) });
      });
      mk.on("dragend", () => {
        edgeDragging.current = false;
        const { value: v, selected: s } = latest.current;
        const c = v.circles[Math.min(s, v.circles.length - 1)];
        if (c) mk.setLngLat(edgeOf(c));
      });
      edge.current = mk;
    } else if (!edgeDragging.current) {
      edge.current.setLngLat(edgeOf(current));
    }
  }, [value.circles, sel, ready]);

  const add = () => {
    const c = map.current?.getCenter();
    const circle: DeliveryCircle = {
      name: `Круг ${value.circles.length + 1}`,
      lat: round(c?.lat ?? DEFAULT_CENTER.lat),
      lng: round(c?.lng ?? DEFAULT_CENTER.lng),
      radiusKm: 3,
    };
    onChange({ ...value, circles: [...value.circles, circle] });
    setSelected(value.circles.length);
  };

  const remove = (i: number) => {
    const circles = value.circles.filter((_, j) => j !== i);
    // Без кругов ограничивать заказы нечем — зона выключается сама.
    onChange({ ...value, circles, enabled: value.enabled && circles.length > 0 });
    setSelected(0);
  };

  const zoneError = Object.entries(errors).find(([k]) => k.startsWith("delivery"))?.[1];

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 flex-col">
          <span className="font-semibold">Принимать заказы только в зоне</span>
          {value.circles.length === 0 && (
            <span className="text-xs text-hint">Сначала добавьте круг на карте</span>
          )}
        </div>
        <Toggle
          checked={value.enabled}
          disabled={value.circles.length === 0 && !value.enabled}
          onChange={(enabled) => onChange({ ...value, enabled })}
          label="Принимать заказы только в зоне"
        />
      </div>

      <div className="flex flex-wrap items-stretch gap-4">
        <div className="relative h-[380px] min-w-0 flex-[2_1_480px] overflow-hidden rounded-[10px] bg-muted shadow-[inset_0_0_0_1px_var(--line)]">
          {/* Свой CSS MapLibre ставит контейнеру position: relative — позиционируем обёртку. */}
          <div className="absolute inset-0">
            <div ref={box} className="h-full w-full" />
          </div>
          {failed && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] text-hint">
              Карта не загрузилась. Обновите страницу.
            </div>
          )}
          {value.circles.length > 0 && (
            <span className="pointer-events-none absolute bottom-2.5 left-2.5 flex h-7 items-center rounded-full bg-white/95 px-2.5 text-xs font-medium text-[#09090b] shadow">
              Тащите центр — круг переедет. Край — меняет размер.
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
          <TextField
            label="Как называть зону покупателям"
            value={value.label}
            onChange={(label) => onChange({ ...value, label })}
            placeholder="Дананг и Хойан"
            maxLength={60}
            hint={`В шапке магазина: «Доставка: ${value.label || "…"}». Показывается, даже если заказы не ограничены кругами.`}
            error={errors["delivery.label"]}
          />
          <div className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>Круги на карте</span>
            {value.circles.map((c, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 rounded-lg p-2 ${
                  i === sel
                    ? "bg-accent-soft shadow-[inset_0_0_0_1px_#e9cdbf]"
                    : "shadow-[inset_0_0_0_1px_var(--line)]"
                }`}
              >
                <button
                  type="button"
                  aria-label={`Показать круг ${c.name}`}
                  onClick={() => {
                    setSelected(i);
                    map.current?.easeTo({ center: [c.lng, c.lat], duration: 400 });
                  }}
                  className="h-3 w-3 flex-none rounded-full bg-[rgb(181_72_42/0.25)] shadow-[inset_0_0_0_2px_var(--accent)]"
                />
                <input
                  aria-label="Название круга"
                  value={c.name}
                  maxLength={40}
                  onFocus={() => setSelected(i)}
                  onChange={(e) => setCircle(i, { name: e.target.value })}
                  className="h-[34px] min-w-0 flex-1 rounded-lg border border-line bg-card px-2.5 outline-none"
                />
                <input
                  aria-label="Радиус, км"
                  type="number"
                  step="any"
                  min="0.3"
                  max="100"
                  value={Number.isFinite(c.radiusKm) ? c.radiusKm : ""}
                  onFocus={() => setSelected(i)}
                  onChange={(e) => setCircle(i, { radiusKm: e.target.valueAsNumber })}
                  className="h-[34px] w-16 rounded-lg border border-line bg-card px-2 text-right outline-none"
                />
                <span className="text-hint">км</span>
                <button
                  type="button"
                  aria-label={`Удалить круг ${c.name}`}
                  onClick={() => remove(i)}
                  className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-lg text-hint"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {value.circles.length < DELIVERY_CIRCLES_MAX && (
              <button
                type="button"
                onClick={add}
                className="flex h-9 items-center gap-1.5 self-start rounded-lg bg-muted px-3 font-medium"
              >
                <Plus size={15} strokeWidth={2.2} />
                Добавить круг
              </button>
            )}
          </div>
          <FieldError message={zoneError} />
          <p className="m-0 flex flex-col text-xs leading-[17px] text-hint">
            <span>Новый круг появится в центре карты — подвиньте его на место.</span>
            <span>Круги могут перекрываться: зона — всё, что внутри любого из них.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
