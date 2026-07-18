"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, mediaUrl, type ChatMessage, type ChatThread, type Notification, type Profile, type SendRecord } from "@/lib/api";
import PageHeader from "@/components/PageHeader";

const FILTERS = ["all", "unread", "whales"] as const;
type Filter = (typeof FILTERS)[number];

export default function InboxPage() {
  const [status, setStatus] = useState<{ enabled: boolean; connected: boolean } | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [modelFilter, setModelFilter] = useState<number | "all">("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [openThread, setOpenThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sent, setSent] = useState<SendRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [draftId, setDraftId] = useState<number | null>(null);
  const [draftPrice, setDraftPrice] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [fanText, setFanText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reqs, setReqs] = useState<Notification[]>([]);
  const [showRef, setShowRef] = useState(false);
  const [showContext, setShowContext] = useState(true);
  const [syncing, setSyncing] = useState(false);

  function refreshThreads() {
    api.chatThreads().then(setThreads).catch(() => {});
  }
  useEffect(() => {
    api.chatStatus().then(setStatus).catch(() => {});
    api.profiles().then((p) => { setProfiles(p); if (p.length) setModelFilter(p[0].id); }).catch(() => {});
    refreshThreads();
    api.notifications().then((n) => setReqs(n.items.filter((i) => i.kind === "content_request"))).catch(() => {});
  }, []);

  const modelById = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  const shownThreads = useMemo(() => {
    let list = modelFilter === "all" ? threads : threads.filter((t) => t.profile_id === modelFilter);
    if (filter === "unread") list = list.filter((t) => t.unread);
    else if (filter === "whales") list = list.filter((t) => t.tier === "whale" || t.tier === "dolphin");
    return list;
  }, [threads, modelFilter, filter]);
  const unreadCount = useMemo(() => threads.filter((t) => t.unread).length, [threads]);
  const activeModel: Profile | null = openThread?.profile_id != null ? modelById[openThread.profile_id] ?? null : null;
  const isTestThread = !!openThread?.fan_uuid?.startsWith("test-");

  async function openThreadById(id: number) {
    setSel(id);
    setErr("");
    setThreads((ts) => ts.map((x) => (x.id === id ? { ...x, unread: false } : x)));
    const d = await api.chatThread(id).catch(() => null);
    if (!d) return;
    setOpenThread(d.thread);
    setMessages(d.messages);
    setSent(d.sent || []);
    const draftMsg = [...d.messages].reverse().find((m) => m.status === "draft");
    setDraft(draftMsg?.text ?? "");
    setDraftId(draftMsg?.id ?? null);
    setDraftPrice(draftMsg?.price_cents ? String(draftMsg.price_cents / 100) : "");
    setDraftNote(draftMsg?.note ?? "");
  }

  async function sendFan() {
    if (!sel || !fanText.trim()) return;
    setBusy(true); setErr("");
    try { await api.chatFanMessage(sel, fanText.trim()); setFanText(""); await openThreadById(sel); refreshThreads(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not generate a draft."); }
    finally { setBusy(false); }
  }
  async function regenerate() {
    if (!sel) return;
    setBusy(true); setErr("");
    try { await api.chatRegenerate(sel); await openThreadById(sel); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not draft a reply."); }
    finally { setBusy(false); }
  }
  async function approve() {
    if (!draftId) return;
    setBusy(true);
    setErr("");
    try {
      const cents = Math.max(0, Math.round((parseFloat(draftPrice) || 0) * 100));
      await api.editDraft(draftId, { text: draft, price_cents: cents });
      await api.approveDraft(draftId);
      if (sel) await openThreadById(sel);
      refreshThreads();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send. Check Fanvue connection and write:chat scope.");
    } finally { setBusy(false); }
  }
  async function rate(r: string) { if (draftId) await api.rateMessage(draftId, r).catch(() => {}); }
  async function syncFanvue() {
    setSyncing(true);
    try { await api.chatSync(); refreshThreads(); } finally { setSyncing(false); }
  }
  async function toggleChat() {
    if (!status) return;
    const next = !status.enabled;
    await api.chatToggle(next).catch(() => {});
    setStatus({ ...status, enabled: next });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Chat inbox"
        subtitle="Your sales console. Review every draft in persona before it sends."
        actions={
          <div className="flex items-center gap-2">
            <span className={`chip ${status?.connected ? "on" : ""}`}><span className="dot" />{status?.connected ? "Fanvue live" : "Test mode"}</span>
            <button onClick={toggleChat} className={`chip ${status?.enabled ? "warn" : ""}`}><span className="dot" />{status?.enabled ? "Auto-pull on" : "Auto-pull off"}</button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1">
        {/* THREAD LIST */}
        <div className="flex w-80 shrink-0 flex-col">
          <div className="space-y-2.5 p-3">
            <select
              className="input py-2 text-sm"
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
            >
              <option value="all">All models</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {status?.connected && (
              <button className="btn btn-primary w-full" onClick={syncFanvue} disabled={syncing}>{syncing ? "Syncing…" : "Sync from Fanvue"}</button>
            )}
            <div className="flex gap-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] p-0.5 text-xs">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`flex-1 rounded-md py-1 capitalize transition-colors ${filter === f ? "bg-[var(--color-panel-raised)] text-[var(--color-fg)]" : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}
                >
                  {f === "unread" && unreadCount > 0 ? `Unread ${unreadCount}` : f}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-auto px-2 pb-2">
            {shownThreads.length === 0 && <p className="px-2 py-3 text-sm text-[var(--color-faint)]">Nothing here.</p>}
            {shownThreads.map((t) => {
              const initial = (t.fan_name || "?")[0]?.toUpperCase();
              const isDraft = t.last_status === "draft";
              const selected = sel === t.id;
              const preview = isDraft ? "Draft ready to review" : t.last_status === "sent" ? `You: ${t.last_text ?? ""}` : (t.last_text ?? "");
              return (
                <button
                  key={t.id}
                  onClick={() => openThreadById(t.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    selected
                      ? "bg-[var(--color-panel-2)] ring-1 ring-[color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
                      : "hover:bg-[var(--color-panel)]"
                  }`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white shadow-[0_4px_10px_-4px_rgba(0,0,0,0.8)]" style={{ background: fanColor(t.fan_uuid) }}>{initial}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {t.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]" aria-label="unread" />}
                      <span className="shrink-0 text-sm" title={t.tier}>{tierEmoji(t.tier)}</span>
                      <span className={`truncate text-sm ${t.unread ? "font-semibold text-[var(--color-fg)]" : ""}`}>{t.fan_name || "Fan"}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[0.6rem] text-[var(--color-faint)]">
                        <span className={t.fan_spend_cents > 0 ? "text-[var(--color-positive)]" : ""}>{fmtSpend(t.fan_spend_cents)}</span>
                        <span>{relTime(t.last_message_at)}</span>
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      {isDraft && <span className="shrink-0 rounded bg-[var(--color-accent)] px-1 py-0.5 text-[0.5rem] font-semibold uppercase text-white">Draft</span>}
                      <span className={`truncate text-xs ${isDraft ? "text-[var(--color-accent)]" : "text-[var(--color-faint)]"}`}>{preview}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* CONVERSATION */}
        <div className="flex min-w-0 flex-1 flex-col border-x border-[var(--color-border)]">
          {reqs.length > 0 && (
            <div className="bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] px-6 py-2 text-xs text-[var(--color-muted)]">
              {reqs.length} content request{reqs.length > 1 ? "s" : ""} waiting. {reqs[0].title}
            </div>
          )}

          {!sel ? (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <p className="max-w-sm text-sm text-[var(--color-muted)]">Pick a conversation. Her draft, the fan's spend tier, and the script all come up so you can close without thinking.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-panel-raised)_55%,transparent),transparent)] px-6 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: fanColor(openThread?.fan_uuid || "") }}>
                    {(openThread?.fan_name || "?")[0]?.toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                      <span>{tierEmoji(openThread?.tier || "new")}</span>
                      <span className="truncate">{openThread?.fan_name || "Fan"}</span>
                    </div>
                    <div className="text-xs text-[var(--color-faint)]">
                      <span className={openThread && openThread.fan_spend_cents > 0 ? "text-[var(--color-positive)]" : ""}>{fmtSpend(openThread?.fan_spend_cents ?? 0)} spent</span>
                      {" · "}{openThread?.funnel_stage || "new"} · as {activeModel?.name ?? "model"}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {activeModel && <button className="btn" onClick={() => setShowRef(true)}>Model</button>}
                  <button className="btn btn-ghost" onClick={() => setShowContext((s) => !s)} aria-label="Toggle context">{showContext ? "Hide" : "Info"}</button>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-auto px-6 py-5">
                {messages.filter((m) => m.status !== "draft").length === 0 && (
                  <p className="text-center text-sm text-[var(--color-faint)]">No messages yet.</p>
                )}
                {messages.filter((m) => m.status !== "draft").map((m) => {
                  const fan = m.role === "fan";
                  return (
                    <div key={m.id} className={`flex items-end gap-2 ${fan ? "" : "flex-row-reverse"}`}>
                      {fan ? (
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[0.6rem] font-semibold text-white" style={{ background: fanColor(openThread?.fan_uuid || "") }}>
                          {(openThread?.fan_name || "?")[0]?.toUpperCase()}
                        </span>
                      ) : activeModel?.avatar_media_id ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={mediaUrl(activeModel.avatar_media_id)} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--color-accent)] text-[0.6rem] text-white">{(activeModel?.name || "?")[0]?.toUpperCase()}</span>
                      )}
                      <div className={`max-w-[72%] rounded-2xl px-4 py-2.5 text-sm ${fan ? "rounded-bl-sm bg-[var(--color-panel-2)] text-[var(--color-fg)]" : "rounded-br-sm gradient-accent"}`}>
                        {m.text}
                        {m.price_cents > 0 && <span className="ml-2 text-xs opacity-80">PPV ${(m.price_cents / 100).toFixed(0)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {draftId ? (
                <div className="m-3 rounded-2xl border border-[var(--color-accent-soft)] bg-[color-mix(in_srgb,var(--color-accent)_8%,var(--color-panel))] p-3 shadow-[0_-2px_20px_-12px_var(--color-accent)]">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">Draft reply · not sent yet</span>
                    <div className="flex gap-2 text-xs">
                      <button onClick={() => rate("good")} className="text-[var(--color-muted)] hover:text-[var(--color-positive)]">good</button>
                      <button onClick={() => rate("bad")} className="text-[var(--color-muted)] hover:text-[var(--color-negative)]">bad</button>
                      <button onClick={regenerate} disabled={busy} className="text-[var(--color-muted)] hover:text-[var(--color-fg)]">regenerate</button>
                    </div>
                  </div>
                  <textarea className="input min-h-20 resize-y" value={draft} onChange={(e) => setDraft(e.target.value)} />
                  {draftNote && (
                    <div className="mt-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] p-2.5 text-xs">
                      <span className="font-semibold text-[var(--color-fg)]">Shoot this first: </span>
                      <span className="text-[var(--color-muted)]">{draftNote}</span>
                      <Link href="/studio/photo" className="ml-1.5 underline decoration-[var(--color-border-strong)] underline-offset-2 hover:text-[var(--color-fg)]">open studio</Link>
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-[var(--color-faint)]">
                      PPV $
                      <input className="input w-20 py-1 text-sm" inputMode="decimal" placeholder="free" value={draftPrice} onChange={(e) => setDraftPrice(e.target.value)} />
                    </label>
                    <button className="btn btn-primary" disabled={busy || !draft.trim()} onClick={approve}>{status?.connected && !isTestThread ? "Approve and send" : "Approve (test)"}</button>
                  </div>
                </div>
              ) : isTestThread ? (
                <div className="border-t border-[var(--color-border)] p-4">
                  <div className="flex gap-2">
                    <input className="input" placeholder="Type as the fan to test her reply…" value={fanText} onChange={(e) => setFanText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendFan(); }} />
                    <button className="btn" disabled={busy || !fanText.trim()} onClick={sendFan}>Send</button>
                  </div>
                  {busy && <p className="mt-2 text-xs text-[var(--color-faint)]">She is typing…</p>}
                </div>
              ) : (
                <div className="border-t border-[var(--color-border)] p-4">
                  <button className="btn btn-primary w-full" disabled={busy} onClick={regenerate}>{busy ? "Drafting…" : "Draft a reply"}</button>
                  <p className="mt-2 text-center text-xs text-[var(--color-faint)]">She drafts in {activeModel?.name ?? "her"} persona. You review before anything sends.</p>
                </div>
              )}
              {err && <p className="px-6 pb-3 text-sm text-[var(--color-danger)]">{err} <Link href="/settings" className="text-[var(--color-accent)]">Settings</Link></p>}
            </>
          )}
        </div>

        {/* FAN CONTEXT */}
        {sel && showContext && (
          <aside className="hidden w-72 shrink-0 overflow-auto p-4 lg:block">
            <div className="card p-5 text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full text-lg font-semibold text-white" style={{ background: fanColor(openThread?.fan_uuid || "") }}>
                {(openThread?.fan_name || "?")[0]?.toUpperCase()}
              </span>
              <div className="mt-2 text-sm font-semibold">{openThread?.fan_name || "Fan"}</div>
              <div className="mt-3 flex items-center justify-center gap-2">
                <span className="text-lg">{tierEmoji(openThread?.tier || "new")}</span>
                <span className="metric text-xl font-semibold text-[var(--color-positive)]">{fmtSpend(openThread?.fan_spend_cents ?? 0)}</span>
              </div>
              <div className="mt-1 text-[0.62rem] uppercase tracking-wider text-[var(--color-faint)]">{openThread?.tier} · lifetime spend</div>
            </div>

            <div className="card mt-4 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-muted)]">Funnel stage</span>
                <span className="font-medium capitalize">{openThread?.funnel_stage || "new"}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-[var(--color-muted)]">Sent to this fan</span>
                <span className="metric">{sent.length}</span>
              </div>
            </div>

            {activeModel?.funnel_script?.trim() && (
              <div className="card mt-4 p-4">
                <div className="mb-1.5 text-[0.62rem] uppercase tracking-wider text-[var(--color-faint)]">Her script</div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-muted)]">{activeModel.funnel_script}</p>
              </div>
            )}
          </aside>
        )}
      </div>

      {showRef && activeModel && <ModelReference model={activeModel} onClose={() => setShowRef(false)} />}
    </div>
  );
}

function ModelReference({ model, onClose }: { model: Profile; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card max-h-[85vh] w-full max-w-lg overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-4">
          {model.avatar_media_id ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={mediaUrl(model.avatar_media_id)} alt="" className="h-20 w-20 rounded-xl object-cover" />
          ) : (
            <span className="grid h-20 w-20 place-items-center rounded-xl bg-[var(--color-panel-2)] text-[var(--color-faint)]">?</span>
          )}
          <div>
            <div className="headline text-lg font-semibold">{model.name}</div>
            {model.niche && <div className="text-sm text-[var(--color-muted)]">{model.niche}</div>}
            <Link href="/models" className="mt-1 inline-block text-xs text-[var(--color-accent)]">Edit in Models</Link>
          </div>
        </div>
        <Ref label="Appearance" value={model.appearance} />
        <Ref label="Personality" value={model.persona} />
        <Ref label="Bio" value={model.bio} />
        <Ref label="Interests" value={model.interests} />
        <Ref label="Funnel and scripts" value={model.funnel_script} />
        <button className="btn mt-5 w-full" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function Ref({ label, value }: { label: string; value: string }) {
  if (!value?.trim()) return null;
  return (
    <div className="mt-4">
      <div className="text-xs uppercase tracking-wider text-[var(--color-faint)]">{label}</div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-fg)]">{value}</p>
    </div>
  );
}

function fanColor(seed: string): string {
  // Monochrome avatars: vary lightness only so fans stay distinguishable
  // without breaking the black-and-white palette. White initials sit on top.
  let h = 0;
  for (let i = 0; i < (seed || "").length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(0 0% ${20 + (h % 26)}%)`;
}
function tierEmoji(tier: string): string {
  return ({ whale: "🐋", dolphin: "🐬", shrimp: "🦐", new: "🌱" } as Record<string, string>)[tier] || "🌱";
}
function fmtSpend(cents: number): string {
  const d = (cents || 0) / 100;
  if (d >= 1000) return `$${(d / 1000).toFixed(1)}k`;
  return `$${Math.round(d)}`;
}
function relTime(iso?: string | null): string {
  if (!iso) return "";
  const t = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 604800)}w`;
}
