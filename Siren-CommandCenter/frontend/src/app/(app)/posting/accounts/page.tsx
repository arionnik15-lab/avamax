"use client";

import { useEffect, useRef, useState } from "react";
import { api, type AdsPowerStatus, type PostingAccount, type PostingStatus } from "@/lib/api";
import PageHeader from "@/components/PageHeader";

const PLATFORMS = ["instagram", "tiktok", "twitter", "threads", "facebook", "reddit"] as const;
const PLATFORM_LABEL: Record<string, string> = { twitter: "X", tiktok: "TikTok", instagram: "Instagram", threads: "Threads", facebook: "Facebook", reddit: "Reddit" };

export default function AccountsPage() {
  const [status, setStatus] = useState<PostingStatus | null>(null);
  const [accounts, setAccounts] = useState<PostingAccount[]>([]);

  async function refresh() {
    const [s, a] = await Promise.all([api.postingStatus(), api.postingAccounts()]);
    setStatus(s);
    setAccounts(a);
  }
  useEffect(() => { refresh().catch(() => {}); }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Accounts"
        subtitle="Metricool is the hub that pushes each post out to Instagram, TikTok, X, Threads, Reddit, and more."
      />
      <div className="min-h-0 flex-1 overflow-auto px-6 py-7 md:px-8">
        <div className="mx-auto max-w-2xl space-y-7">
          <MetricoolConnect status={status} onChange={refresh} />
          <AdsPowerConnect />

          <section>
            <h2 className="headline mb-1 text-sm font-semibold">Models</h2>
            <p className="mb-4 text-sm text-[var(--color-muted)]">
              In Metricool each model is its own brand. Type the brand name exactly as it reads in
              Metricool, and choose whether it posts automatically or waits for your ok.
            </p>
            <div className="space-y-3">
              {accounts.length === 0 && (
                <p className="text-sm text-[var(--color-faint)]">No models yet. Add one in Models.</p>
              )}
              {accounts.map((a) => (
                <AccountRow key={a.id} account={a} onChange={refresh} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function MetricoolConnect({ status, onChange }: { status: PostingStatus | null; onChange: () => Promise<void> }) {
  const [connecting, setConnecting] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const loggedIn = !!status?.logged_in;

  useEffect(() => {
    if (status?.connecting) setConnecting(true);
    if (status?.logged_in && poll.current) { clearInterval(poll.current); poll.current = null; setConnecting(false); }
  }, [status?.connecting, status?.logged_in]);

  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  async function connect() {
    setConnecting(true);
    await api.metricoolLogin();
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(() => { onChange().catch(() => {}); }, 2000);
  }
  async function disconnect() {
    await api.metricoolLogout();
    await onChange();
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex items-center gap-2">
        <h2 className="headline text-sm font-semibold">Metricool</h2>
        <span className={`text-xs ${loggedIn ? "text-[var(--color-accent)]" : "text-[var(--color-faint)]"}`}>
          {loggedIn ? "connected" : "not connected"}
        </span>
      </div>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Siren posts by signing into your Metricool in its own browser window and uploading each file
        the same way you would by hand. Nothing needs a paid API plan, and your media is never made
        public: it stays on this machine and only leaves as the upload that publishes it. Sign in once
        below and the session is remembered.
      </p>

      <div className="mt-4">
        {loggedIn ? (
          <div className="flex items-center gap-2">
            <span className="chip on"><span className="dot" />signed in</span>
            <button className="btn h-8 px-3 text-xs" onClick={disconnect}>Disconnect</button>
          </div>
        ) : connecting ? (
          <p className="text-sm text-[var(--color-fg)]">
            A Metricool window opened on your desktop. Sign in there (Google, Facebook, or email), then
            this connects on its own.
          </p>
        ) : (
          <button className="btn btn-primary" onClick={connect}>Connect Metricool</button>
        )}
      </div>
    </section>
  );
}

function AdsPowerConnect() {
  const [st, setSt] = useState<AdsPowerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [adv, setAdv] = useState(false);

  function load() {
    api.adspowerStatus().then(setSt).catch(() => setSt(null));
  }
  useEffect(() => { load(); }, []);

  async function setProfile(id: string) {
    setBusy(true);
    try {
      if (id) await api.setSecret("adspower_user_id", id);
      else await api.deleteSecret("adspower_user_id");
      load();
    } finally { setBusy(false); }
  }

  const reachable = !!st?.health.ok;

  return (
    <section className="rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex items-center gap-2">
        <h2 className="headline text-sm font-semibold">AdsPower (anti-detect browser)</h2>
        <span className={`text-xs ${reachable ? "text-[var(--color-accent)]" : "text-[var(--color-faint)]"}`}>
          {st ? (reachable ? "reachable" : st.health.msg) : "checking…"}
        </span>
      </div>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Optional. Run Siren&apos;s posting inside an AdsPower profile so each account looks like its own
        real device. Turn on AdsPower&apos;s Local API in its settings (default port 50325), then pick the
        profile Metricool should run in. Leave it off to use Siren&apos;s built-in browser.
      </p>

      <div className="mt-4 space-y-3">
        {reachable && st.profiles.length > 0 ? (
          <label className="block text-xs text-[var(--color-faint)]">
            Profile Metricool runs in
            <select className="input mt-1 h-9 text-sm" disabled={busy} value={st.current}
                    onChange={(e) => setProfile(e.target.value)}>
              <option value="">Siren&apos;s own browser (no AdsPower)</option>
              {st.profiles.map((p) => (
                <option key={p.user_id} value={p.user_id}>{p.name ? `${p.name} — ${p.user_id}` : p.user_id}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block text-xs text-[var(--color-faint)]">
            AdsPower profile id {reachable ? "" : "(enter once the Local API is reachable)"}
            <input key={st?.current ?? ""} defaultValue={st?.current ?? ""} className="input mt-1 h-9 text-sm"
                   placeholder="e.g. k11abcd" disabled={busy}
                   onBlur={(e) => e.currentTarget.value.trim() !== (st?.current || "") && setProfile(e.currentTarget.value.trim())} />
          </label>
        )}

        <div className="flex items-center gap-3">
          <button className="btn h-8 px-3 text-xs" onClick={load} disabled={busy}>Recheck</button>
          <button className="text-xs text-[var(--color-faint)] hover:text-[var(--color-fg)]"
                  onClick={() => setAdv((v) => !v)}>{adv ? "Hide" : "Advanced"}</button>
        </div>

        {adv && (
          <div className="grid grid-cols-1 gap-2 border-t border-[var(--color-border)] pt-3 sm:grid-cols-2">
            <label className="text-xs text-[var(--color-faint)]">
              Local API URL
              <input key={st?.url ?? ""} defaultValue={st?.url ?? ""} className="input mt-1 h-8 text-xs"
                     placeholder="http://local.adspower.net:50325"
                     onBlur={async (e) => { const v = e.currentTarget.value.trim(); if (v && v !== st?.url) { await api.setSecret("adspower_api_url", v); load(); } }} />
            </label>
            <label className="text-xs text-[var(--color-faint)]">
              API key {st?.has_key ? "(set)" : "(optional)"}
              <input type="password" className="input mt-1 h-8 text-xs"
                     placeholder={st?.has_key ? "set, leave blank to keep" : "only if your AdsPower requires one"}
                     onBlur={async (e) => { const v = e.currentTarget.value.trim(); if (v) { await api.setSecret("adspower_api_key", v); e.currentTarget.value = ""; load(); } }} />
            </label>
          </div>
        )}
      </div>
    </section>
  );
}

function AccountRow({ account, onChange }: { account: PostingAccount; onChange: () => void }) {
  const [brand, setBrand] = useState(account.brand || "");
  const [drip, setDrip] = useState(account.drip_hours || "");
  const [promo, setPromo] = useState(account.promo_link || "");
  const [subs, setSubs] = useState(account.subreddits || "");
  const [anchor, setAnchor] = useState(account.gen_anchor || "");
  const [seed, setSeed] = useState(account.gen_seed || "");
  const [voice, setVoice] = useState(account.voice_id || "");
  const [busy, setBusy] = useState(false);

  const chosen = (account.default_platforms || "").split(",").map((s) => s.trim()).filter(Boolean);
  const effective = (account.effective_platforms || "").split(",").map((s) => s.trim()).filter(Boolean);
  const active = chosen.length ? chosen : effective;

  async function save(body: Parameters<typeof api.setPostingAccount>[1]) {
    setBusy(true);
    try { await api.setPostingAccount(account.id, body); await onChange(); }
    finally { setBusy(false); }
  }

  function togglePlatform(p: string) {
    const next = active.includes(p) ? active.filter((x) => x !== p) : [...active, p];
    save({ default_platforms: next.join(",") });
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">{account.name}</span>
          <span className={`text-xs ${account.has_brand ? "text-[var(--color-accent)]" : "text-[var(--color-faint)]"}`}>
            {account.has_brand ? "brand set" : "no brand"}
          </span>
        </div>
        <button
          onClick={() => save({ auto: !account.auto })}
          disabled={busy}
          className={`btn h-7 px-2.5 text-xs ${account.auto ? "btn-primary" : ""}`}
          title={account.auto ? "Posts without asking you (dripped across the day)" : "Waits for your approval"}
        >
          {account.auto ? "Auto" : "Approve first"}
        </button>
      </div>

      <div className="mt-2">
        <input
          className="input h-8 text-sm"
          placeholder="Metricool brand name (exactly as it reads there)"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          onBlur={() => brand !== (account.brand || "") && save({ brand })}
        />
      </div>

      <div className="mt-3">
        <div className="mb-1.5 text-xs text-[var(--color-faint)]">
          Where drops post{chosen.length ? "" : " (default)"}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map((p) => {
            const on = active.includes(p);
            return (
              <button
                key={p}
                disabled={busy}
                onClick={() => togglePlatform(p)}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  on
                    ? "border-transparent bg-[var(--color-accent)] text-black"
                    : "border-[var(--color-border)] text-[var(--color-muted)]"
                }`}
              >
                {PLATFORM_LABEL[p]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-xs text-[var(--color-faint)]">
          Posting hours
          <input className="input mt-1 h-8 text-xs" value={drip} onChange={(e) => setDrip(e.target.value)}
                 onBlur={() => save({ drip_hours: drip })} placeholder="10,14,19" />
        </label>
        <label className="text-xs text-[var(--color-faint)]">
          Story link (your page)
          <input className="input mt-1 h-8 text-xs" value={promo} onChange={(e) => setPromo(e.target.value)}
                 onBlur={() => save({ promo_link: promo })} placeholder="https://fanvue.com/…" />
        </label>
        <label className="text-xs text-[var(--color-faint)]">
          Go-to subreddits
          <input className="input mt-1 h-8 text-xs" value={subs} onChange={(e) => setSubs(e.target.value)}
                 onBlur={() => save({ subreddits: subs })} placeholder="gonewild, RealGirls" />
        </label>
      </div>

      <div className="mt-3 border-t border-[var(--color-border)] pt-3">
        <div className="mb-1.5 text-xs text-[var(--color-faint)]">Automation</div>
        <div className="flex flex-wrap gap-1.5">
          <button disabled={busy} onClick={() => save({ autosend: !account.autosend })}
            title="Free replies and PPV drafts send themselves. Only compliance-flagged text waits for you."
            className={`rounded-full border px-2.5 py-1 text-xs ${account.autosend
              ? "border-transparent bg-[var(--color-accent)] text-black" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}>
            Auto-send all chat (incl. PPV)
          </button>
          <button disabled={busy} onClick={() => save({ autogen: !account.autogen })}
            title="Generate content to fill what fans keep asking for but isn't in stock"
            className={`rounded-full border px-2.5 py-1 text-xs ${account.autogen
              ? "border-transparent bg-[var(--color-accent)] text-black" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}>
            Auto-generate to fill gaps
          </button>
          <button disabled={busy} onClick={() => save({ reddit_auto: !account.reddit_auto })}
            title="Draft posts to your due subreddits on their own cadence; still approve-first unless Auto is on"
            className={`rounded-full border px-2.5 py-1 text-xs ${account.reddit_auto
              ? "border-transparent bg-[var(--color-accent)] text-black" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}>
            Auto-propose Reddit posts
          </button>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="text-xs text-[var(--color-faint)] sm:col-span-1">
            Character lock (look)
            <input className="input mt-1 h-8 text-xs" value={anchor} onChange={(e) => setAnchor(e.target.value)}
                   onBlur={() => save({ gen_anchor: anchor })} placeholder="e.g. 22yo, freckles, auburn hair" />
          </label>
          <label className="text-xs text-[var(--color-faint)]">
            Seed
            <input className="input mt-1 h-8 text-xs" value={seed} onChange={(e) => setSeed(e.target.value)}
                   onBlur={() => save({ gen_seed: seed })} placeholder="fixed number" />
          </label>
          <label className="text-xs text-[var(--color-faint)]">
            Voice id
            <input className="input mt-1 h-8 text-xs" value={voice} onChange={(e) => setVoice(e.target.value)}
                   onBlur={() => save({ voice_id: voice })} placeholder="TTS voice" />
          </label>
        </div>
      </div>
    </div>
  );
}
