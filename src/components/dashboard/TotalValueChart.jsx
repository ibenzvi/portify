import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";

// Total value (in shekels) on each date that has a record. Each instrument and
// manual asset counts at its latest value on or before that date. This only
// shows the amount; it does not say how much of a change is deposits or gains.
export function buildTotalValueSeries(holdings, manualValues) {
  const dates = new Set();
  holdings.forEach((h) => h.date && dates.add(h.date));
  manualValues.forEach((v) => v.date && dates.add(v.date));
  const sorted = [...dates].sort();
  const hs = [...holdings].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const ms = [...manualValues].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const latestH = new Map();
  const latestM = new Map();
  let hi = 0;
  let mi = 0;
  return sorted.map((date) => {
    while (hi < hs.length && hs[hi].date <= date) {
      latestH.set(hs[hi].instrument_id, hs[hi].total_value_ils || 0);
      hi++;
    }
    while (mi < ms.length && ms[mi].date <= date) {
      latestM.set(ms[mi].manual_asset_id, ms[mi].value_ils || 0);
      mi++;
    }
    let total = 0;
    latestH.forEach((v) => (total += v));
    latestM.forEach((v) => (total += v));
    return { date, total };
  });
}

const fmt = (n) => `₪${Math.round(n || 0).toLocaleString()}`;

export default function TotalValueChart({ holdings = [], manualValues = [] }) {
  const data = useMemo(
    () => buildTotalValueSeries(holdings, manualValues),
    [holdings, manualValues],
  );
  if (data.length < 2) return null;
  return (
    <Card className="bg-white shadow-sm border-slate-200" data-testid="total-value-chart">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-slate-900">
          Total Value Over Time
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-56 sm:h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(d) => format(parseISO(d), "MMM yy")}
                minTickGap={24}
              />
              <YAxis
                width={56}
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `₪${(v / 1000).toFixed(Math.abs(v) < 10000 ? 1 : 0)}k`}
                domain={["auto", "auto"]}
              />
              <Tooltip
                formatter={(v) => [fmt(v), "Total value"]}
                labelFormatter={(d) => format(parseISO(d), "MMM d, yyyy")}
              />
              <Line type="monotone" dataKey="total" stroke="#0f172a" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
