import { useId } from 'react';

export interface Bar {
  label: string; // axis label
  value: number | null; // 0..1, null = no data
  title: string; // full description used for tooltip and the accessible table
}

/** Accessible SVG bar chart of percentages (0-100%). Includes a screen-reader data table. */
export function BarChart({
  bars,
  ariaLabel,
  color,
  labelEvery = 1,
  showValues = false,
}: {
  bars: Bar[];
  ariaLabel: string;
  color?: string;
  labelEvery?: number;
  showValues?: boolean;
}) {
  const id = useId();
  const slot = 36;
  const gutter = 34;
  const plotH = 130;
  const top = 14;
  const W = gutter + bars.length * slot;
  const H = top + plotH + 24;
  const y = (v: number) => top + plotH - v * plotH;
  return (
    <figure className="chart" style={color ? ({ '--c': color } as React.CSSProperties) : undefined}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id} preserveAspectRatio="xMidYMid meet">
        <title id={id}>{ariaLabel}</title>
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line className="grid" x1={gutter} x2={W} y1={y(g)} y2={y(g)} />
            <text className="axis" x={gutter - 6} y={y(g) + 4} textAnchor="end">{Math.round(g * 100)}%</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = gutter + i * slot + (slot - 22) / 2;
          return (
            <g key={i}>
              {b.value === null ? (
                <rect className="bar empty" x={x} y={y(0) - 2} width={22} height={2} rx={1}>
                  <title>{b.title}</title>
                </rect>
              ) : (
                <rect className="bar" x={x} y={y(b.value)} width={22} height={Math.max(2, b.value * plotH)} rx={4}>
                  <title>{b.title}</title>
                </rect>
              )}
              {showValues && b.value !== null && (
                <text className="val" x={x + 11} y={y(b.value) - 4} textAnchor="middle">{Math.round(b.value * 100)}</text>
              )}
              {i % labelEvery === 0 && (
                <text className="axis" x={x + 11} y={top + plotH + 16} textAnchor="middle">{b.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="sr-only">
        <table>
        <caption>{ariaLabel}</caption>
        <tbody>
          {bars.map((b, i) => (
            <tr key={i}>
              <th scope="row">{b.label}</th>
              <td>{b.title}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </figure>
  );
}
