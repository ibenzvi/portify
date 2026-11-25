import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign } from "lucide-react";

export default function PortfolioSummary({ totalValue = 0 }) {
  const formatCurrency = (amount) => {
    const value = amount || 0;
    return `₪${Math.round(value).toLocaleString()}`;
  };

  return (
    <Card className="bg-white shadow-sm border-slate-200 mb-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
          <DollarSign className="w-4 h-4" />
          Total Value
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-slate-900">
          {formatCurrency(totalValue)}
        </div>
      </CardContent>
    </Card>
  );
}
