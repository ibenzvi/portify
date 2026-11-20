import React, { useState, useEffect, useRef } from "react";
import {
  Instrument,
  ManualAsset,
  Holding,
  ManualAssetValue,
} from "@/entities/all";
import { supabase } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  ImagePlus,
  X,
  Loader2,
  Save,
  MessageSquare,
} from "lucide-react";
import { format } from "date-fns";
import { latestByKey } from "@/lib/latest";
import { instrumentCurrency, formatIls } from "@/lib/currency";
import { useUsdRate } from "@/lib/useUsdRate";
import { useToast } from "@/components/ui/use-toast";

// Downscale a screenshot so the upload stays well under the serverless body
// limit while keeping text readable for the vision model.
const MAX_IMAGE_DIM = 1568;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = objectUrl;
  });
}

export default function Chat() {
  const { toast } = useToast();
  const { rate: usdRate } = useUsdRate();
  const [assets, setAssets] = useState([]); // context sent to the model
  const [assetById, setAssetById] = useState(new Map());
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Upload a screenshot of your bank, pension or investment app and I will fill in the current balance for each account I recognize.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState(null); // data URL
  const [isSending, setIsSending] = useState(false);
  const [pendingValues, setPendingValues] = useState(null); // editable extraction
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    loadAssets();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingValues]);

  const loadAssets = async () => {
    try {
      const [instruments, manualAssets, holdings, manualValues] =
        await Promise.all([
          Instrument.list(),
          ManualAsset.list(),
          Holding.list(),
          ManualAssetValue.list(),
        ]);
      const latestHoldings = latestByKey(holdings, "instrument_id");
      const latestValues = latestByKey(manualValues, "manual_asset_id");
      const list = [
        ...(manualAssets || []).map((a) => ({
          kind: "manual",
          id: a.id,
          name: a.name,
          currency: instrumentCurrency(a),
          lastValue: latestValues.get(a.id)?.value_ils ?? null,
          lastDate: latestValues.get(a.id)?.date ?? null,
        })),
        ...(instruments || []).map((i) => ({
          kind: "instrument",
          id: i.id,
          name: i.name,
          symbol: i.symbol,
          currency: instrumentCurrency(i),
          lastValue: latestHoldings.get(i.id)?.total_value_ils ?? null,
          lastDate: latestHoldings.get(i.id)?.date ?? null,
        })),
      ];
      setAssets(list);
      setAssetById(new Map(list.map((a) => [String(a.id), a])));
    } catch (error) {
      console.error("Error loading assets:", error);
    }
  };

  const handleFilePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setImage(await fileToDataUrl(file));
    } catch {
      toast({ title: "Could not read that image", variant: "destructive" });
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if ((!text && !image) || isSending) return;
    const sentImage = image;
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text, image: sentImage },
    ]);
    setDraft("");
    setImage(null);
    setIsSending(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const history = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text,
          image: sentImage,
          messages: history,
          assets,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: body.reply || "(no reply)" },
      ]);
      if (Array.isArray(body.values) && body.values.length > 0) {
        const editable = {};
        body.values.forEach((v) => {
          editable[`${v.kind}:${v.id}`] = String(v.value);
        });
        setPendingValues(editable);
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Something went wrong: ${error.message}`,
          isError: true,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSaveAll = async () => {
    if (!pendingValues) return;
    setIsSaving(true);
    try {
      const today = format(new Date(), "yyyy-MM-dd");
      const holdingRows = [];
      const mavRows = [];
      for (const [key, raw] of Object.entries(pendingValues)) {
        if (raw === "" || raw == null) continue;
        const num = parseFloat(raw);
        if (Number.isNaN(num)) continue;
        const [kind, id] = key.split(":");
        if (kind === "instrument") {
          holdingRows.push({ instrument_id: id, date: today, total_value_ils: num });
        } else {
          mavRows.push({ manual_asset_id: id, date: today, value_ils: num });
        }
      }
      if (holdingRows.length > 0) await Holding.bulkCreate(holdingRows);
      if (mavRows.length > 0) await ManualAssetValue.bulkCreate(mavRows);
      const count = holdingRows.length + mavRows.length;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Saved ${count} updated ${count === 1 ? "value" : "values"} for today.`,
        },
      ]);
      setPendingValues(null);
      loadAssets();
    } catch (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const pendingRows = pendingValues
    ? Object.entries(pendingValues).map(([key, value]) => {
        const asset = assetById.get(key.split(":")[1]);
        return { key, value, asset };
      })
    : [];

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto flex flex-col h-[calc(100vh-2rem)]">
      <div className="mb-4">
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
          <MessageSquare className="w-7 h-7" />
          Balance Chat
        </h1>
        <p className="text-slate-600 mt-1">
          Upload a screenshot of one of your finance apps and the assistant
          fills in how much is in each account. Review, then save.
        </p>
      </div>

      <Card className="flex-1 min-h-0 flex flex-col bg-white shadow-sm border-slate-200 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-slate-900 text-white"
                    : m.isError
                      ? "bg-red-50 text-red-700 border border-red-200"
                      : "bg-slate-100 text-slate-900"
                }`}
              >
                {m.image && (
                  <img
                    src={m.image}
                    alt="uploaded screenshot"
                    className="rounded-lg mb-2 max-h-64 object-contain bg-white"
                  />
                )}
                {m.content}
              </div>
            </div>
          ))}
          {isSending && (
            <div className="flex justify-start">
              <div className="bg-slate-100 text-slate-500 rounded-2xl px-4 py-2.5 text-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Reading…
              </div>
            </div>
          )}

          {pendingValues && pendingRows.length > 0 && (
            <Card className="border-slate-300 bg-slate-50 overflow-hidden">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-b border-slate-200 bg-white">
                <div>
                  <p className="font-semibold text-slate-900">
                    Review extracted values
                  </p>
                  <p className="text-xs text-slate-500">
                    {format(new Date(), "EEEE, MMM d, yyyy")} · edit anything
                    that looks off · blanks are skipped
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setPendingValues(null)}
                    disabled={isSaving}
                  >
                    Dismiss
                  </Button>
                  <Button
                    onClick={handleSaveAll}
                    disabled={isSaving}
                    className="bg-slate-900 hover:bg-slate-800"
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    Save all
                  </Button>
                </div>
              </div>
              <div className="divide-y divide-slate-200">
                {pendingRows.map(({ key, value, asset }) => {
                  if (!asset) return null;
                  const isUsd = asset.currency === "USD";
                  const raw = parseFloat(value) || 0;
                  return (
                    <div
                      key={key}
                      className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[1fr_auto_150px] sm:items-center sm:gap-3"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-slate-900 truncate">
                          {asset.name}
                        </span>
                        {asset.symbol && (
                          <Badge variant="secondary" className="font-mono text-xs">
                            {asset.symbol}
                          </Badge>
                        )}
                        {isUsd && (
                          <Badge variant="outline" className="text-xs">
                            USD
                          </Badge>
                        )}
                      </div>
                      <div className="text-left sm:text-right text-xs text-slate-400 whitespace-nowrap">
                        {asset.lastValue != null ? (
                          <>
                            was{" "}
                            {isUsd
                              ? `$${Math.round(asset.lastValue).toLocaleString()}`
                              : formatIls(asset.lastValue)}
                            {asset.lastDate && (
                              <span className="block">
                                {format(new Date(asset.lastDate), "MMM d")}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="italic">no prior value</span>
                        )}
                        {isUsd && raw > 0 && (
                          <span className="block text-slate-500">
                            = {formatIls(raw * (usdRate || 1))}
                          </span>
                        )}
                      </div>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                          {isUsd ? "$" : "₪"}
                        </span>
                        <Input
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          value={value}
                          onChange={(e) =>
                            setPendingValues((prev) => ({
                              ...prev,
                              [key]: e.target.value,
                            }))
                          }
                          onFocus={(e) => e.target.select()}
                          className="text-right pl-7"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-slate-200 p-3 bg-white">
          {image && (
            <div className="relative inline-block mb-2">
              <img
                src={image}
                alt="screenshot to send"
                className="max-h-32 rounded-lg border border-slate-200"
              />
              <button
                onClick={() => setImage(null)}
                className="absolute -top-2 -right-2 bg-slate-900 text-white rounded-full p-1"
                aria-label="Remove image"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFilePick}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSending}
              aria-label="Upload screenshot"
            >
              <ImagePlus className="w-5 h-5" />
            </Button>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a note or ask something… (attach a screenshot to update balances)"
              className="min-h-[44px] max-h-32 resize-none"
              rows={1}
            />
            <Button
              onClick={handleSend}
              disabled={isSending || (!draft.trim() && !image)}
              className="bg-slate-900 hover:bg-slate-800"
              size="icon"
              aria-label="Send"
            >
              {isSending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
