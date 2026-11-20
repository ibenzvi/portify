import React, { useState, useEffect, useRef } from "react";
import { Instrument, ManualAsset, Holding, ManualAssetValue } from "@/entities/all";
import { supabase } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Send, ImagePlus, X, Loader2, Save, MessageSquare, Plus, RotateCcw, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { latestByKey } from "@/lib/latest";
import { instrumentCurrency, formatIls } from "@/lib/currency";
import { useToast } from "@/components/ui/use-toast";

const ENTITY = "ChatThread";
const MAX_TURNS = 200;
const emptyThread = () => ({ id: crypto.randomUUID(), title: "שיחה חדשה", messages: [], pendingValues: null });
const timestamp = () => new Date().toISOString();
const titleFor = (message) => (message.content || "צילום מסך לעדכון יתרות").slice(0, 60);
const stableJson = (value) => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

// Only text and review state are stored. Screenshots stay in memory for this visit.
export function historyPayload(thread) {
  return {
    title: thread.title,
    messages: thread.messages.map(({ image: _image, ...message }) => message),
    pendingValues: thread.pendingValues,
    saveIds: thread.saveIds || null,
  };
}

export function requestHistory(messages) {
  return messages.filter((m) => !m.failed).slice(-20).map((m) => ({
    role: m.role,
    content: (m.content || (m.hasImage ? "[צורף צילום מסך בשלב זה]" : "")) + (m.values?.length ? `\n[ערכים שזוהו: ${JSON.stringify(m.values)}]` : ""),
  })).filter((m) => m.content);
}

function requestError(status) {
  if (status === 401) return "החיבור לחשבון פג. יש לרענן את הדף ולהתחבר שוב.";
  if (status === 429) return "מכסת הבקשות הגיעה למגבלה. כדאי לנסות שוב בעוד כמה דקות.";
  if (status === 503) return "שירות הצ'אט אינו זמין כרגע. אפשר לנסות שוב מאוחר יותר.";
  return "לא התקבלה תשובה מהצ'אט. ההודעה נשארה כאן ואפשר לנסות שוב.";
}

async function fileToDataUrl(file) {
  if (!file.type.startsWith("image/")) throw new Error("יש לבחור קובץ תמונה.");
  if (file.size > 20 * 1024 * 1024) throw new Error("התמונה גדולה מדי. יש לבחור תמונה עד 20MB.");
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const scale = Math.min(1, 1568 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch { reject(new Error("לא הצלחנו לקרוא את התמונה. נסו קובץ אחר.")); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("לא הצלחנו לקרוא את התמונה. נסו קובץ אחר.")); };
    img.src = url;
  });
}

export default function Chat() {
  const { toast } = useToast();
  const [threads, setThreads] = useState([]);
  const [thread, setThread] = useState(null);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [assetLoading, setAssetLoading] = useState(true);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [assetError, setAssetError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingValues, setSavingValues] = useState(false);
  const [historySaving, setHistorySaving] = useState(false);
  const saveQueue = useRef(Promise.resolve(true));
  const [saveError, setSaveError] = useState(false);
  const [requestFailure, setRequestFailure] = useState("");
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const fileRef = useRef(null);
  const bottomRef = useRef(null);
  const activeRef = useRef(null);
  const persistedRef = useRef(null);
  const lock = useRef(false);
  const abortRef = useRef(null);
  const mounted = useRef(true);
  const blocked = busy || loading || sending || savingValues || imageLoading || assetLoading;
  const messages = thread?.messages || [];
  const pendingValues = thread?.pendingValues;
  const assetByKey = new Map(assets.map((a) => [`${a.kind}:${a.id}`, a]));

  function activate(next) {
    activeRef.current = next;
    if (mounted.current) setThread(next);
  }

  async function loadAssets() {
    setAssetLoading(true);
    setAssetError(false);
    try {
      const [instruments, manualAssets, holdings, manualValues] = await Promise.all([
        Instrument.list(), ManualAsset.list(), Holding.list(), ManualAssetValue.list(),
      ]);
      const latestHoldings = latestByKey(holdings, "instrument_id");
      const latestValues = latestByKey(manualValues, "manual_asset_id");
      setAssets([
        ...manualAssets.map((a) => ({ kind: "manual", id: a.id, name: a.name, currency: instrumentCurrency(a), lastValue: latestValues.get(a.id)?.value_ils ?? null, lastDate: latestValues.get(a.id)?.date ?? null })),
        ...instruments.map((a) => ({ kind: "instrument", id: a.id, name: a.name, symbol: a.symbol, currency: instrumentCurrency(a), lastValue: latestHoldings.get(a.id)?.total_value_ils ?? null, lastDate: latestHoldings.get(a.id)?.date ?? null })),
      ]);
    } catch { setAssetError(true); }
    finally { setAssetLoading(false); }
  }

  async function loadThreads() {
    setLoading(true);
    setLoadError("");
    try {
      // Do not download every conversation's message bodies for the sidebar.
      const { data, error } = await supabase.from("records")
        .select("id,updated_date,title:data->>title").eq("entity", ENTITY)
        .order("updated_date", { ascending: false }).limit(100);
      if (error) throw error;
      setThreads(data);
      if (!activeRef.current) activate(emptyThread());
    } catch { setLoadError("לא הצלחנו לטעון את היסטוריית השיחות. אפשר לנסות שוב."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    mounted.current = true;
    loadThreads();
    loadAssets();
    return () => { mounted.current = false; abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: sending ? "smooth" : "auto", block: "end" });
  }, [messages.length, sending, thread?.id]);

  useEffect(() => {
    const warn = (e) => { if (saveError || sending || busy || historySaving || reviewDirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveError, sending, busy, historySaving, reviewDirty]);

  function persist(next) {
    setHistorySaving(true);
    const operation = saveQueue.current.then(() => persistNow(next));
    saveQueue.current = operation;
    operation.then((ok) => { if (ok && mounted.current && stableJson(next.pendingValues) === stableJson(activeRef.current?.pendingValues)) setReviewDirty(false); });
    operation.finally(() => { if (saveQueue.current === operation && mounted.current) setHistorySaving(false); });
    return operation;
  }

  async function persistNow(next) {
    setSaveError(false);
    const updated = timestamp();
    try {
      const row = { data: historyPayload(next), updated_date: updated };
      let result;
      if (persistedRef.current?.id === next.id) {
        // Compare-and-swap prevents another tab's newer conversation being overwritten.
        result = await supabase.from("records").update(row).eq("entity", ENTITY)
          .eq("id", next.id).eq("updated_date", persistedRef.current.updated_date)
          .select("id,updated_date").single();
      } else {
        result = await supabase.from("records").insert({ ...row, id: next.id, entity: ENTITY })
          .select("id,updated_date").single();
      }
      if (result.error) throw result.error;
      persistedRef.current = result.data;
      if (mounted.current) {
        setThreads((prev) => [{ ...result.data, title: next.title }, ...prev.filter((t) => t.id !== next.id)].slice(0, 100));
      }
      return true;
    } catch {
      // An insert/update can land even when its response is lost. Recover only
      // when the stored content is exactly the snapshot this operation wrote.
      try {
        const { data, error } = await supabase.from("records").select("id,data,updated_date")
          .eq("entity", ENTITY).eq("id", next.id).single();
        if (!error && stableJson(data.data) === stableJson(historyPayload(next))) {
          persistedRef.current = { id: data.id, updated_date: data.updated_date };
          if (mounted.current) setThreads((prev) => [{ ...persistedRef.current, title: next.title }, ...prev.filter((t) => t.id !== next.id)].slice(0, 100));
          return true;
        }
      } catch { /* Keep the unsaved snapshot visible for retry. */ }
      if (mounted.current) setSaveError(true);
      return false;
    }
  }

  async function changeThread(id) {
    if (lock.current || saveError) return;
    if (draft.trim() || image) {
      if (!window.confirm("יש טיוטה שלא נשלחה. לעבור שיחה ולוותר עליה?")) return;
    }
    lock.current = true;
    setBusy(true);
    setRequestFailure("");
    try {
      if (!await saveQueue.current) return;
      if (!id) {
        persistedRef.current = null;
        activate(emptyThread());
      } else {
        const { data, error } = await supabase.from("records").select("id,data,updated_date")
          .eq("entity", ENTITY).eq("id", id).single();
        if (error) throw error;
        persistedRef.current = { id: data.id, updated_date: data.updated_date };
        activate({ ...data.data, id: data.id });
      }
      setDraft(""); setImage(null); setDeleteId(null);
    } catch { toast({ title: "לא הצלחנו לפתוח את השיחה. נסו שוב.", variant: "destructive" }); }
    finally { lock.current = false; setBusy(false); }
  }

  async function retrySave() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    await persist(activeRef.current);
    lock.current = false; setBusy(false);
  }

  async function send(retry = false) {
    if (lock.current || blocked || saveError || assetError || !thread) return;
    if (!retry && (!draft.trim() && !image)) return;
    const current = activeRef.current;
    if (current.pendingValues) {
      toast({ title: "יש לאשר או לבטל קודם את הערכים שממתינים לבדיקה." }); return;
    }
    if (!retry && current.messages.length >= MAX_TURNS) {
      toast({ title: "השיחה ארוכה. פתחו שיחה חדשה כדי להמשיך." }); return;
    }
    const last = current.messages.at(-1);
    if (retry && (!last?.failed || (last.hasImage && !last.image && !image))) {
      toast({ title: "צילום המסך אינו נשמר בהיסטוריה. יש לצרף אותו שוב ואז ללחוץ על ניסיון חוזר." }); return;
    }
    lock.current = true; setSending(true); setRequestFailure("");
    const outgoing = retry ? { ...last, failed: false, image: image || last.image } : {
      id: crypto.randomUUID(), role: "user", content: draft.trim(), image,
      hasImage: !!image, at: timestamp(),
    };
    const prior = retry ? current.messages.slice(0, -1) : current.messages;
    let next = { ...current, title: prior.length ? current.title : titleFor(outgoing), messages: [...prior, { ...outgoing, failed: true }] };
    // Mark the unanswered message as retryable before the network call, including on reload.
    activate(next); setDraft(""); setImage(null);
    try {
      if (!await persist(next)) return;
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) throw new Error(requestError(401));
      const controller = new AbortController(); abortRef.current = controller;
      const timer = setTimeout(() => controller.abort(), 55000);
      let res;
      try {
        res = await fetch("/api/chat", {
          method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
          body: JSON.stringify({ text: outgoing.content, image: outgoing.image, messages: requestHistory(prior), assets }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(requestError(res.status));
        if (!body.reply || typeof body.reply !== "string") throw new Error(requestError(502));
        const values = {};
        for (const v of Array.isArray(body.values) ? body.values : []) {
          if (assetByKey.has(`${v.kind}:${v.id}`) && Number.isFinite(Number(v.value)) && Number(v.value) >= 0) values[`${v.kind}:${v.id}`] = String(v.value);
        }
        const reply = { id: crypto.randomUUID(), role: "assistant", content: body.reply, values: body.values, at: timestamp() };
        next = { ...next, messages: [...prior, outgoing, reply], saveIds: null, pendingValues: Object.keys(values).length ? values : null };
        if (mounted.current) activate(next);
        await persist(next);
      } finally { clearTimeout(timer); abortRef.current = null; }
    } catch (error) {
      if (mounted.current) setRequestFailure(error.name === "AbortError" ? "הבקשה ארכה יותר מדי זמן. אפשר לנסות שוב." : [401, 429, 503, 502].map(requestError).includes(error.message) ? error.message : requestError(502));
    } finally {
      lock.current = false;
      if (mounted.current) setSending(false);
    }
  }

  async function updateReview(nextValues) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    const next = { ...activeRef.current, pendingValues: nextValues, saveIds: nextValues ? activeRef.current.saveIds : null };
    activate(next); await persist(next);
    lock.current = false; setBusy(false);
  }

  async function saveValues() {
    if (lock.current || saveError || !pendingValues) return;
    const rows = Object.entries(pendingValues).filter(([, value]) => value !== "");
    if (!rows.length || rows.some(([key, value]) => !assetByKey.has(key) || !Number.isFinite(Number(value)) || Number(value) < 0)) {
      toast({ title: "יש להזין לפחות סכום תקין אחד, ללא מספרים שליליים.", variant: "destructive" }); return;
    }
    lock.current = true; setSavingValues(true);
    try {
      // One insert makes the mixed asset update atomic. Stable client IDs make retries
      // safe if the response is lost after the server committed the insert.
      const ids = activeRef.current.saveIds || Object.fromEntries(rows.map(([key]) => [key, crypto.randomUUID()]));
      const prepared = { ...activeRef.current, saveIds: ids };
      activate(prepared);
      if (!await persist({ ...prepared, pendingValues, saveIds: ids })) return;
      const today = format(new Date(), "yyyy-MM-dd");
      const payload = rows.map(([key, value]) => {
        const [kind, id] = key.split(":");
        return { id: ids[key], entity: kind === "instrument" ? "Holding" : "ManualAssetValue", data: kind === "instrument" ? { instrument_id: id, date: today, total_value_ils: Number(value) } : { manual_asset_id: id, date: today, value_ils: Number(value) } };
      });
      const { error } = await supabase.from("records").upsert(payload, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
      const { data: savedRows, error: verifyError } = await supabase.from("records").select("id,entity,data").in("id", payload.map((row) => row.id));
      if (verifyError || savedRows.length !== payload.length || payload.some((row) => !savedRows.some((saved) => saved.id === row.id && saved.entity === row.entity && Object.entries(row.data).every(([key, value]) => saved.data[key] === value)))) throw new Error("Could not confirm saved values");
      const next = { ...prepared, pendingValues: null, saveIds: null, messages: [...prepared.messages, { id: crypto.randomUUID(), role: "assistant", content: `נשמרו ${rows.length} יתרות לתאריך ${format(new Date(), "dd/MM/yyyy")}.`, at: timestamp() }] };
      activate(next); await persist(next); await loadAssets();
    } catch { toast({ title: "לא הצלחנו לאשר את השמירה. אפשר לנסות שוב בבטחה.", variant: "destructive" }); }
    finally { lock.current = false; setSavingValues(false); }
  }

  async function deleteThread(id) {
    if (lock.current || saveError) return;
    lock.current = true; setBusy(true);
    try {
      if (!await saveQueue.current) return;
      const { error } = await supabase.from("records").delete().eq("entity", ENTITY).eq("id", id);
      if (error) throw error;
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (activeRef.current?.id === id) { persistedRef.current = null; activate(emptyThread()); setDraft(""); setImage(null); }
      setDeleteId(null);
    } catch { toast({ title: "השיחה לא נמחקה. נסו שוב.", variant: "destructive" }); }
    finally { lock.current = false; setBusy(false); }
  }

  return (
    <div dir="rtl" className="p-3 sm:p-6 max-w-6xl mx-auto flex flex-col h-[calc(100dvh-5rem)] min-h-[480px] gap-3">
      <header className="flex items-center justify-between gap-2">
        <div><h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><MessageSquare className="w-6 h-6" />צ'אט יתרות</h1><p className="text-sm text-slate-500">מצרפים צילום מסך, בודקים את הסכומים ורק אז שומרים.</p></div>
        <Button variant="outline" onClick={() => changeThread(null)} disabled={blocked || saveError}><Plus className="w-4 h-4 ml-1" />שיחה חדשה</Button>
      </header>
      <div className="flex flex-col md:flex-row gap-3 flex-1 min-h-0">
        <aside aria-label="היסטוריית שיחות" className="md:w-56 shrink-0 border rounded-xl bg-white p-2 overflow-y-auto max-h-36 md:max-h-none">
          <div className="text-xs font-semibold text-slate-500 mb-2 px-1">היסטוריית שיחות</div>
          {loading && <p role="status" className="text-sm p-2">טוען שיחות...</p>}
          {loadError && <div role="alert" className="text-sm text-red-700 p-2">{loadError}<Button variant="ghost" onClick={loadThreads}>ניסיון חוזר</Button></div>}
          {!loading && !loadError && !threads.length && <p className="text-xs text-slate-500 p-2">השיחות יישמרו כאן אוטומטית אחרי ההודעה הראשונה.</p>}
          {threads.map((t) => <div key={t.id} className={`rounded-lg mb-1 ${t.id === thread?.id ? "bg-slate-100 ring-1 ring-slate-300" : "hover:bg-slate-50"}`}>
            <div className="flex items-center"><button className="text-right p-2 min-w-0 flex-1 disabled:opacity-50" disabled={blocked || saveError} onClick={() => changeThread(t.id)}><span className="block truncate text-sm">{t.title || "שיחה"}</span><span className="text-[11px] text-slate-400">{new Date(t.updated_date).toLocaleDateString("he-IL")}</span></button><button aria-label={`מחיקת שיחה: ${t.title || "שיחה"}`} disabled={blocked || saveError} className="p-2 text-slate-400 hover:text-red-600" onClick={() => setDeleteId(t.id)}><Trash2 className="w-4 h-4" /></button></div>
            {deleteId === t.id && <div className="p-2 text-xs border-t"><p>למחוק את השיחה? יתרות שכבר נשמרו לא יימחקו.</p><div className="flex gap-2 mt-2"><Button size="sm" variant="destructive" disabled={blocked} onClick={() => deleteThread(t.id)}>מחיקה</Button><Button size="sm" variant="ghost" onClick={() => setDeleteId(null)}>ביטול</Button></div></div>}
          </div>)}
          {threads.length === 100 && <p className="text-xs text-slate-500">מוצגות 100 השיחות האחרונות.</p>}
        </aside>
        <Card className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-white">
          <div className="border-b px-4 py-2 text-xs text-slate-500 flex justify-between gap-2"><span className="truncate">{thread?.title || "שיחה חדשה"}</span><span role="status" className="shrink-0">{saveError ? "לא נשמר" : sending ? "ממתין לתשובה..." : busy || historySaving ? "שומר..." : reviewDirty ? "תיקונים ממתינים לשמירה" : persistedRef.current ? "נשמר בחשבון" : ""}</span></div>
          {saveError && <div role="alert" className="p-3 bg-amber-50 text-amber-900 text-sm">השינויים האחרונים לא נשמרו. לא לעזוב את הדף. אם השיחה השתנתה בלשונית אחרת, צריך לרענן כדי לטעון את הגרסה האחרונה.<Button variant="outline" size="sm" onClick={retrySave} disabled={blocked} className="mr-2">לנסות לשמור שוב</Button></div>}
          {assetError && <div role="alert" className="p-3 bg-amber-50 text-sm">לא הצלחנו לטעון את הנכסים. השליחה מושבתת כדי לא להציע התאמות שגויות.<Button variant="ghost" size="sm" onClick={loadAssets}>ניסיון חוזר</Button></div>}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-4" aria-busy={sending || busy}>
            {!messages.length && !loading && <div className="text-center py-8 px-3 text-slate-600"><MessageSquare className="w-10 h-10 mx-auto mb-3 text-slate-300" /><h2 className="font-semibold text-lg text-slate-900 mb-2">איך אפשר לעזור?</h2><p className="text-sm mb-4">אפשר לשאול על הנכסים או לצרף צילום מסך מהבנק, הפנסיה או תיק ההשקעות.</p><Button variant="outline" disabled={blocked} onClick={() => setDraft("מה אפשר לעדכן באמצעות צילום מסך?")}>מה אפשר לעדכן?</Button><p className="text-xs text-slate-400 mt-4">הטקסט נשמר בחשבון שלך. צילומי המסך אינם נשמרים בהיסטוריה.<br />צילומי המסך נשלחים לשירות ה-AI רק בעת שליחה. יתרות לא משתנות ללא אישור.</p></div>}
            {messages.map((m, index) => <div key={m.id || index} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}><div className={`max-w-[92%] sm:max-w-[85%] rounded-2xl p-3 text-sm break-words ${m.role === "user" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-900"}`}>
              <div dir="auto" className="whitespace-pre-wrap">{m.image ? <img src={m.image} alt="צילום מסך שצורף לשיחה" className="rounded-lg mb-2 max-h-64 object-contain bg-white" /> : m.hasImage ? <p className="text-xs opacity-70 mb-1">צורף צילום מסך (אינו נשמר בהיסטוריה)</p> : null}{m.content}</div>
              {m.at && <p className="text-[10px] opacity-60 mt-1" dir="ltr">{new Date(m.at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}</p>}
              {m.failed && index === messages.length - 1 && !sending && <div className="mt-2 text-xs"><p>{requestFailure || "טרם התקבלה תשובה להודעה הזו."}</p><Button size="sm" variant="secondary" disabled={blocked || saveError || assetError} className="mt-2" onClick={() => send(true)}><RotateCcw className="w-3 h-3 ml-1" />ניסיון חוזר</Button></div>}
            </div></div>)}
            {sending && <div role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" />{image ? "קורא את התמונה..." : "מכין תשובה..."}</div>}
            {pendingValues && <Card className="bg-slate-50 border-slate-300 p-3 space-y-3"><div><h2 className="font-semibold">בדיקת הסכומים לפני שמירה</h2><p className="text-xs text-slate-500">הסכומים במטבע של כל נכס. אפשר לתקן או להשאיר ריק כדי לדלג.</p></div>
              {Object.entries(pendingValues).map(([key, value]) => {
                const asset = assetByKey.get(key);
                return <div key={key} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"><div className="min-w-0 flex-1"><p className="text-sm break-words">{asset?.name || "הנכס אינו זמין יותר"}</p><p className="text-xs text-slate-500">{asset?.lastValue != null ? `קודם: ${asset.currency === "USD" ? `$${Number(asset.lastValue).toLocaleString()}` : formatIls(asset.lastValue)}` : "אין סכום קודם"}</p></div><label className="flex items-center gap-1 text-sm"><span>{asset?.currency === "USD" ? "$" : "₪"}</span><Input aria-label={`סכום עבור ${asset?.name || key}`} type="number" min="0" step="0.01" inputMode="decimal" className="w-32 text-left" dir="ltr" disabled={blocked || saveError || !!thread?.saveIds} value={value} onChange={(e) => { setReviewDirty(true); activate({ ...activeRef.current, pendingValues: { ...activeRef.current.pendingValues, [key]: e.target.value } }); }} onBlur={() => persist(activeRef.current)} /></label></div>;
              })}
              {thread?.saveIds && !savingValues && <p className="text-xs text-amber-800">בקשת שמירה כבר נשלחה. הסכומים נעולים כדי שניסיון חוזר לא ישמור אותם פעמיים.</p>}
              <div className="flex gap-2"><Button onClick={saveValues} disabled={blocked || saveError || assetError}>{savingValues ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Save className="w-4 h-4 ml-1" />}שמירת יתרות</Button><Button variant="ghost" onClick={() => updateReview(null)} disabled={blocked || saveError}>ביטול</Button></div>
            </Card>}
            <div ref={bottomRef} />
          </div>
          <div className="border-t p-3 bg-white">
            {image && <div className="relative inline-block mb-2"><img src={image} alt="צילום מסך מוכן לשליחה" className="max-h-24 rounded-lg border" /><button className="absolute top-0 left-0 bg-slate-900 text-white rounded-full p-1" aria-label="הסרת תמונה" onClick={() => setImage(null)}><X className="w-3 h-3" /></button></div>}
            <div className="flex items-end gap-2"><input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; setImageLoading(true); try { setImage(await fileToDataUrl(file)); } catch (error) { toast({ title: error.message, variant: "destructive" }); } finally { setImageLoading(false); } }} />
              <Button size="icon" variant="outline" aria-label="צירוף צילום מסך" disabled={blocked || saveError} onClick={() => fileRef.current?.click()}>{imageLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}</Button>
              <Textarea dir="auto" aria-label="הודעה לצ'אט" placeholder="כתבו הודעה או צרפו צילום מסך..." value={draft} maxLength={4000} disabled={blocked || saveError || !!pendingValues || !!messages.at(-1)?.failed} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !window.matchMedia("(pointer: coarse)").matches) { e.preventDefault(); send(); } }} rows={1} className="min-h-[44px] max-h-32 resize-none" />
              <Button size="icon" aria-label="שליחת הודעה" disabled={blocked || saveError || !!pendingValues || !!messages.at(-1)?.failed || assetError || !!loadError || (!draft.trim() && !image)} onClick={() => send()}><Send className="w-5 h-5" /></Button>
            </div><p className="text-[10px] text-slate-400 mt-1">צילומי מסך לא נשמרים בהיסטוריה. {pendingValues ? "יש לבדוק ולאשר או לבטל את הסכומים לפני שממשיכים." : ""}</p>
          </div>
        </Card>
      </div>
    </div>
  );
  }
