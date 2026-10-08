"use client";
import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import {
  Activity,
  BarChart3,
  Layers3,
  SlidersHorizontal,
  Wallet,
  FlaskConical,
  Search,
  Upload,
  Download,
  Sun,
  Moon,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  CircleHelp,
  Check,
  AlertTriangle,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { AllocationChart, SectorChart, FactorChart } from "@/components/charts";
import {
  scoreUniverse,
  effectiveWeights,
  changeWeight,
  validateWeights,
} from "@/lib/scoring";
import { allocatePortfolio, validateConstraints } from "@/lib/portfolio";
import { demoData, DEMO_DATE } from "@/lib/demo";
import { todayIn, validDate } from "@/lib/dates";
import {
  parseStockInput,
  parseCsv,
  stockQueriesFromCsv,
  validateImport,
} from "@/lib/input";
import {
  DATASETS,
  DEFAULT_WEIGHTS,
  FACTORS,
  FACTOR_LABELS,
  METHOD_LABELS,
  type StockData,
  type ScoredStock,
  type Weights,
  type Mode,
  type SourceMode,
  type Security,
  type Imports,
  type Dataset,
  type AllocationMethod,
  type Constraints,
} from "@/lib/types";
const fmt = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
const pct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? "—" : `${fmt(n * 100, digits)}%`;
const money = (n: number | null, digits = 0) =>
  n === null ? "—" : `$${fmt(n, digits)}`;
const defaultConstraints: Constraints = {
  capital: 1e6,
  positionCap: 0.07,
  sectorCap: 0.25,
  cashReserve: 0.1,
};
const METHODS: AllocationMethod[] = ["equal", "inverse", "factor"];
interface Match {
  query: string;
  matches: Security[];
  error: string | null;
}
interface Snapshot {
  stocks: StockData[];
  asOf: string;
  cutoff: string;
  source: SourceMode;
}
interface Settings {
  weights: Weights;
  mode: Mode;
  constraints: Constraints;
  watchlist: string;
  qualityWeights: number[];
  light: boolean;
}
async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}
function Score({ value }: { value: number | null }) {
  return value === null ? (
    <span className="muted">—</span>
  ) : (
    <span
      className={`num ${value >= 70 ? "positive" : value < 30 ? "negative" : ""}`}
    >
      {fmt(value)}
    </span>
  );
}
function Stat({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Activity;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="muted text-sm">{label}</span>
        <Icon size={16} className="muted" />
      </div>
      <div className="num text-2xl font-semibold mt-3 tracking-tight">
        {value}
      </div>
      <div className="muted text-xs mt-2">{note}</div>
    </Card>
  );
}
export default function Dashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    stocks: demoData(),
    asOf: DEMO_DATE,
    cutoff: DEMO_DATE,
    source: "demo",
  });
  const [settings, setSettings] = useState<Settings>({
    weights: DEFAULT_WEIGHTS,
    mode: "full",
    constraints: defaultConstraints,
    watchlist: "NVDA, MSFT, AAPL, AMD, JPM, V, UNH, JNJ, XOM, CVX, COST, WMT",
    qualityWeights: [40, 40, 20],
    light: false,
  });
  const [hydrated, setHydrated] = useState(false);
  const [source, setSource] = useState<SourceMode>("demo");
  const [asOf, setAsOf] = useState(DEMO_DATE);
  const [today, setToday] = useState(DEMO_DATE);
  const [imports, setImports] = useState<Imports>({});
  const [dataset, setDataset] = useState<Dataset>("prices");
  const [matches, setMatches] = useState<Match[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [health, setHealth] = useState<{
    configured: boolean;
    requestsToday: number;
    budget: number;
  } | null>(null);
  const [tab, setTab] = useState<"research" | "portfolio" | "data">("research");
  const [method, setMethod] = useState<AllocationMethod>("factor");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sector, setSector] = useState("all");
  const [minScore, setMinScore] = useState(0);
  const [filterFactor, setFilterFactor] = useState("score");
  const [maxVol, setMaxVol] = useState(200);
  const [minLiquidity, setMinLiquidity] = useState(0);
  const [sort, setSort] = useState({ key: "score", desc: true });
  const [showImport, setShowImport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [savedNote, setSavedNote] = useState("");
  const tickerFile = useRef<HTMLInputElement>(null),
    dataFile = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setToday(todayIn());
    try {
      const saved = localStorage.getItem("factorlab-settings-v1");
      if (saved) {
        const parsed = JSON.parse(saved);
        validateWeights(parsed.weights);
        validateConstraints(parsed.constraints);
        effectiveWeights(parsed.weights, parsed.mode);
        if (
          typeof parsed.watchlist === "string" &&
          ["full", "price"].includes(parsed.mode) &&
          parsed.constraints?.capital > 0 &&
          ["positionCap", "sectorCap", "cashReserve"].every(
            (k) => parsed.constraints[k] >= 0 && parsed.constraints[k] <= 1,
          ) &&
          Array.isArray(parsed.qualityWeights) &&
          parsed.qualityWeights.length === 3 &&
          parsed.qualityWeights.every(
            (n: number) => typeof n === "number" && n >= 0,
          ) &&
          parsed.qualityWeights.some((n: number) => n > 0)
        )
          setSettings(parsed);
      }
      const localImports = localStorage.getItem("factorlab-imports-v1");
      if (localImports) {
        const parsed = JSON.parse(localImports);
        Object.entries(parsed).forEach(([key, rows]) =>
          validateImport(rows as Record<string, unknown>[], key as Dataset),
        );
        setImports(parsed);
      }
    } catch {
      setMessages([
        "Saved settings could not be restored. Defaults are loaded.",
      ]);
    }
    setHydrated(true);
    fetch("/api/status")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (hydrated) {
      try {
        localStorage.setItem("factorlab-settings-v1", JSON.stringify(settings));
      } catch {
        setSavedNote("Browser storage is full; settings will not persist.");
      }
    }
  }, [settings, hydrated]);
  const weights = useMemo(() => {
    try {
      return effectiveWeights(settings.weights, settings.mode);
    } catch {
      return effectiveWeights(DEFAULT_WEIGHTS, settings.mode);
    }
  }, [settings.weights, settings.mode]);
  const scored = useMemo(
    () =>
      scoreUniverse(
        snapshot.stocks,
        snapshot.cutoff,
        settings.weights,
        settings.mode,
        settings.qualityWeights,
      ),
    [snapshot, settings.weights, settings.mode, settings.qualityWeights],
  );
  const portfolios = useMemo(
    () =>
      METHODS.map((m) => allocatePortfolio(scored, m, settings.constraints)),
    [scored, settings.constraints],
  );
  const portfolio = portfolios.find((p) => p.method === method)!;
  const complete = scored.filter((s) => s.score !== null);
  const sectors = [...new Set(scored.map((s) => s.sector))].sort();
  const visible = useMemo(() => {
    const result = scored.filter(
      (s) =>
        (sector === "all" || s.sector === sector) &&
        (minScore === 0 ||
          (filterFactor === "score"
            ? (s.score ?? -1)
            : (s.factors[filterFactor as keyof Weights] ?? -1)) >= minScore) &&
        (s.metrics.volatility === null
          ? maxVol >= 200
          : s.metrics.volatility * 100 <= maxVol) &&
        (s.metrics.dollarVolume ?? 0) >= minLiquidity * 1e6,
    );
    const value = (s: ScoredStock) =>
      sort.key === "symbol"
        ? s.security.symbol
        : sort.key === "name"
          ? s.security.name
          : sort.key === "sector"
            ? s.sector
            : sort.key === "price"
              ? s.price
              : sort.key in s.metrics
                ? s.metrics[sort.key as keyof typeof s.metrics]
                : sort.key in s.factors
                  ? s.factors[sort.key as keyof Weights]
                  : sort.key === "rank"
                    ? s.rank
                    : s.score;
    return result.sort((a, b) => {
      const av = value(a),
        bv = value(b);
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      const compare =
        typeof av === "string"
          ? av.localeCompare(String(bv))
          : Number(av) - Number(bv);
      return sort.desc ? -compare : compare;
    });
  }, [scored, sector, minScore, filterFactor, maxVol, minLiquidity, sort]);
  const stale = scored.filter((s) => s.warnings.some((w) => /stale/i.test(w)));
  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }
  function setConstraint(key: keyof Constraints, value: number) {
    if (!Number.isFinite(value)) return;
    const bounded =
      key === "capital"
        ? Math.max(1, Math.min(1e12, value))
        : Math.max(0, Math.min(1, value));
    setSettings((s) => ({
      ...s,
      constraints: { ...s.constraints, [key]: bounded },
    }));
  }
  async function resolve() {
    setError("");
    setMessages([]);
    const queries = parseStockInput(settings.watchlist);
    if (!queries.length || queries.length > 40) {
      setError("Enter between 1 and 40 symbols or company names.");
      return;
    }
    setBusy("Resolving securities…");
    try {
      const result = await post<{ results: Match[] }>("/api/resolve", {
        queries,
        source,
        imports,
      });
      setMatches(result.results);
      const selected = Object.fromEntries(
        result.results
          .filter((r) => r.matches.length === 1)
          .map((r) => [
            r.query,
            `${r.matches[0].symbol}:${r.matches[0].exchange}`,
          ]),
      );
      setSelections(selected);
      if (result.results.every((r) => r.matches.length === 1))
        await analyze(result.results.map((r) => r.matches[0]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setBusy("");
    }
  }
  async function analyze(selected: Security[]) {
    if (!selected.length) {
      setError("Select at least one resolved security.");
      return;
    }
    setBusy("Retrieving datasets… FMP requests are paced to your plan.");
    try {
      const result = await post<{
        stocks: StockData[];
        errors: string[];
        cutoff: string;
      }>("/api/analyze", { securities: selected, source, asOf, imports });
      if (!result.stocks.length)
        throw new Error(
          result.errors.join(" ") || "No stock datasets are available.",
        );
      setSnapshot({
        stocks: result.stocks,
        asOf,
        cutoff: result.cutoff,
        source,
      });
      setMessages(result.errors);
      setMatches([]);
      setTab("research");
      if (source !== "demo" && asOf < today) update("mode", "price");
      fetch("/api/status")
        .then((r) => r.json())
        .then(setHealth)
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setBusy("");
    }
  }
  async function importFile(
    file: File | undefined,
    kind: "tickers" | "dataset",
  ) {
    if (!file) return;
    setError("");
    if (file.size > 5 * 1024 * 1024) {
      setError("CSV must be smaller than 5 MB.");
      return;
    }
    try {
      const text = await file.text();
      if (kind === "tickers") {
        const queries = stockQueriesFromCsv(text);
        if (!queries.length)
          throw new Error("Use a ticker, symbol, name, or company column.");
        update(
          "watchlist",
          queries
            .map((q) => (q.includes(",") ? JSON.stringify(q) : q))
            .join(", "),
        );
        setSavedNote(
          `${queries.length} watchlist entries imported. Click Analyze universe.`,
        );
      } else {
        const rows = parseCsv(text);
        validateImport(rows, dataset);
        const next = { ...imports, [dataset]: rows };
        setImports(next);
        try {
          localStorage.setItem("factorlab-imports-v1", JSON.stringify(next));
          setSavedNote(
            `${rows.length} ${dataset} rows saved locally. Analyze to apply them.`,
          );
        } catch {
          setSavedNote("CSV loaded for this session. Browser storage is full.");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    }
  }
  function exportPortfolio() {
    const rows = [
      [
        "source",
        "asOf",
        "scoring_mode",
        "method",
        "symbol",
        "sector",
        "target_weight",
        "whole_share_weight",
        "shares",
        "price_usd",
        "dollars_usd",
        "score",
      ],
      ...portfolio.positions.map((p) => [
        snapshot.source,
        snapshot.asOf,
        settings.mode,
        method,
        p.symbol,
        p.sector,
        p.targetWeight,
        p.weight,
        p.shares,
        p.price,
        p.dollars,
        p.score,
      ]),
      [
        snapshot.source,
        snapshot.asOf,
        settings.mode,
        method,
        "CASH",
        "",
        portfolio.targetCashWeight,
        portfolio.cashWeight,
        "",
        "",
        portfolio.cash,
        "",
      ],
    ];
    const csv = rows
      .map((row) =>
        row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `factorlab-${snapshot.source}-${snapshot.asOf}-${method}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function toggleSort(key: string) {
    setSort((s) => ({
      key,
      desc:
        s.key === key
          ? !s.desc
          : !["symbol", "name", "sector", "rank"].includes(key),
    }));
  }
  const outstanding = matches.some(
    (r) => r.matches.length > 1 && !selections[r.query],
  );
  return (
    <div
      className={`${settings.light ? "light" : ""} min-h-screen bg-[var(--bg)] text-[var(--text)]`}
    >
      <aside className="fixed inset-y-0 left-0 w-16 border-r border-[var(--border)] bg-[var(--panel)] hidden lg:flex flex-col items-center z-20">
        <div className="mt-5 size-9 flex items-center justify-center bg-teal-400 rounded-lg text-slate-950">
          <FlaskConical size={21} />
        </div>
        <div className="flex flex-col gap-4 mt-12">
          {(
            [
              { id: "research", icon: BarChart3, label: "Research" },
              { id: "portfolio", icon: Wallet, label: "Portfolio" },
              { id: "data", icon: Layers3, label: "Data sources" },
            ] as const
          ).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              aria-label={label}
              title={label}
              onClick={() => setTab(id)}
              className={`p-3 rounded-lg ${tab === id ? "text-teal-400 bg-teal-400/10" : "muted hover:bg-[var(--hover)]"}`}
            >
              <Icon size={20} />
            </button>
          ))}
        </div>
        <button
          className="mt-auto mb-5 muted"
          aria-label="Scoring methodology"
          onClick={() => setShowHelp((v) => !v)}
        >
          <CircleHelp size={20} />
        </button>
      </aside>
      <div className="lg:ml-16">
        <header className="border-b border-[var(--border)] bg-[var(--panel)] px-5 md:px-8 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FlaskConical size={22} className="positive lg:hidden" />
            <span className="font-bold tracking-tight text-xl">
              Factor<span className="positive">Lab</span>
            </span>
            <span className="hidden md:inline border-l border-[var(--border)] pl-4 muted text-sm">
              Investment research workspace
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`chip ${snapshot.source === "demo" ? "text-amber-300 bg-amber-300/5" : "positive"}`}
            >
              <span className="size-1.5 rounded-full bg-current" />
              {snapshot.source === "demo"
                ? "SYNTHETIC DEMO"
                : snapshot.source === "csv"
                  ? "USER CSV"
                  : "FMP DATA"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                settings.light ? "Switch to dark mode" : "Switch to light mode"
              }
              onClick={() => update("light", !settings.light)}
            >
              {settings.light ? <Moon size={17} /> : <Sun size={17} />}
            </Button>
          </div>
        </header>
        <main className="max-w-[1800px] mx-auto px-4 md:px-8 py-7 space-y-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="muted text-xs tracking-[.18em] mb-2">
                RESEARCH / FACTOR MODEL
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
                Factor research
              </h1>
              <p className="muted text-sm mt-2">
                Rank your universe and turn factor signals into a constrained
                portfolio.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label htmlFor="asof">As of date</label>
              <input
                id="asof"
                aria-label="As of date"
                type="date"
                max={today}
                value={asOf}
                onChange={(e) => {
                  if (validDate(e.target.value) && e.target.value <= today)
                    setAsOf(e.target.value);
                }}
                className="!w-40 num"
              />
            </div>
          </div>
          {snapshot.source === "demo" && (
            <div className="border border-amber-400/20 bg-amber-400/5 rounded-md px-4 py-3 flex gap-3 text-sm">
              <FlaskConical
                size={17}
                className="text-amber-300 shrink-0 mt-0.5"
              />
              <span>
                <strong className="text-amber-300">Demo workspace.</strong> All
                displayed prices and financials are synthetic. Select FMP or
                import CSV to analyze actual data.
              </span>
            </div>
          )}
          <Card>
            <CardContent>
              <div className="flex flex-col xl:flex-row gap-4">
                <div className="flex-1">
                  <label htmlFor="watchlist" className="block mb-2">
                    Stock universe{" "}
                    <span className="muted text-xs ml-2">
                      Tickers or company names · commas, lines, or uppercase
                      ticker spaces
                    </span>
                  </label>
                  <textarea
                    id="watchlist"
                    rows={2}
                    value={settings.watchlist}
                    onChange={(e) => update("watchlist", e.target.value)}
                    placeholder="AAPL, Microsoft, Yonex JPY, 7906.T"
                  />
                  <p className="muted text-xs mt-2">
                    Add a currency to select its listing, e.g. Yonex JPY.
                    Separate entries with commas or new lines. Search results do
                    not confirm FMP dataset access. JPY stocks can be ranked;
                    portfolio allocation currently requires USD prices.
                  </p>
                </div>
                <div className="xl:w-60">
                  <label htmlFor="source" className="block mb-2">
                    Data source
                  </label>
                  <select
                    id="source"
                    value={source}
                    onChange={(e) => {
                      setSource(e.target.value as SourceMode);
                      setMatches([]);
                      if (e.target.value === "fmp") setAsOf(today);
                    }}
                  >
                    <option value="demo">Synthetic demo · no API key</option>
                    <option value="fmp">Financial Modeling Prep</option>
                    <option value="csv">CSV only · your data</option>
                  </select>
                  <div className="flex gap-2 mt-2">
                    <Button
                      onClick={resolve}
                      disabled={!!busy}
                      className="flex-1"
                    >
                      <Search size={15} />
                      Analyze universe
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      title="Upload watchlist CSV"
                      aria-label="Upload watchlist CSV"
                      onClick={() => tickerFile.current?.click()}
                    >
                      <Upload size={16} />
                    </Button>
                  </div>
                </div>
              </div>
              <input
                type="file"
                accept=".csv,text/csv"
                hidden
                ref={tickerFile}
                onChange={(e) => {
                  void importFile(e.target.files?.[0], "tickers");
                  e.target.value = "";
                }}
              />
              <div className="flex flex-wrap justify-between gap-2 mt-3 text-xs muted">
                <span>
                  {source === "fmp"
                    ? health?.configured
                      ? `Server key configured · ${health.requestsToday}/${health.budget} local requests today · actual entitlements checked on retrieval`
                      : "FMP key not configured. Add FMP_API_KEY to your host's server environment (Vercel Settings → Environment Variables), or .env.local for local use; redeploy or restart. CSV is supported."
                    : source === "csv"
                      ? "Import profiles and prices first. Optional datasets complete fundamental scores."
                      : "12 illustrative stocks · fixed synthetic dataset ending October 7, 2026"}
                </span>
                <button
                  className="positive"
                  onClick={() => setShowImport((v) => !v)}
                >
                  {showImport
                    ? "Close CSV import"
                    : "Import financial datasets"}
                </button>
              </div>
            </CardContent>
          </Card>
          {showImport && (
            <Card>
              <CardHeader>
                <h2 className="section-title">CSV dataset import</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close import"
                  onClick={() => setShowImport(false)}
                >
                  <X size={16} />
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-[1fr_auto_auto] items-end gap-3">
                  <div>
                    <label htmlFor="dataset" className="block mb-2">
                      Dataset to replace
                    </label>
                    <select
                      id="dataset"
                      value={dataset}
                      onChange={(e) => setDataset(e.target.value as Dataset)}
                    >
                      {DATASETS.map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <Button variant="outline" asChild>
                    <a href={`/templates/${dataset}.csv`} download>
                      <Download size={15} />
                      CSV template
                    </a>
                  </Button>
                  <Button onClick={() => dataFile.current?.click()}>
                    <Upload size={15} />
                    Import {dataset}
                  </Button>
                </div>
                <input
                  hidden
                  ref={dataFile}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    void importFile(e.target.files?.[0], "dataset");
                    e.target.value = "";
                  }}
                />
                <p className="muted text-sm mt-3">
                  CSV overrides the selected dataset for matching symbols.
                  Import complete histories; prices need 127 sessions for
                  momentum. Ratios use decimals, not percentages. Publication
                  dates are required. Historical full scoring remains disabled.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {Object.entries(imports).map(([d, rows]) => (
                    <span className="chip" key={d}>
                      {d}: {rows?.length} rows{" "}
                      <button
                        aria-label={`Remove ${d} import`}
                        onClick={() => {
                          const next = { ...imports };
                          delete next[d as Dataset];
                          setImports(next);
                          try {
                            localStorage.setItem(
                              "factorlab-imports-v1",
                              JSON.stringify(next),
                            );
                          } catch {}
                        }}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {!!busy && (
            <div
              role="status"
              className="flex items-center gap-3 text-sm positive"
            >
              <Loader2 className="animate-spin" size={18} />
              {busy}
            </div>
          )}
          {!!error && (
            <div
              role="alert"
              className="border border-rose-400/30 rounded-md bg-rose-400/5 p-4 text-sm negative"
            >
              {error}
            </div>
          )}
          {!!savedNote && (
            <div role="status" className="muted text-sm flex justify-between">
              {savedNote}
              <button
                aria-label="Dismiss notice"
                onClick={() => setSavedNote("")}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {messages.map((m) => (
            <div className="text-sm text-amber-400" key={m}>
              {m}
            </div>
          ))}
          {matches.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="section-title">Resolve securities</h2>
                <span className="muted text-xs">
                  Choose the correct exchange listing
                </span>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {matches.map((r) => (
                    <div
                      key={r.query}
                      className="grid md:grid-cols-[180px_1fr] gap-3 items-center"
                    >
                      <span className="font-medium text-sm">{r.query}</span>
                      {r.error ? (
                        <span className="negative text-sm">{r.error}</span>
                      ) : (
                        <select
                          aria-label={`Select listing for ${r.query}`}
                          value={selections[r.query] ?? ""}
                          onChange={(e) =>
                            setSelections((s) => ({
                              ...s,
                              [r.query]: e.target.value,
                            }))
                          }
                        >
                          <option value="" disabled>
                            Choose a security…
                          </option>
                          {r.matches.map((s) => (
                            <option
                              key={`${s.symbol}:${s.exchange}`}
                              value={`${s.symbol}:${s.exchange}`}
                            >
                              {s.symbol} · {s.name} · {s.exchange} ·{" "}
                              {s.currency}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
                <Button
                  className="mt-4"
                  disabled={!!busy || outstanding}
                  onClick={() => {
                    const chosen = matches.flatMap((r) =>
                      r.matches.filter(
                        (s) =>
                          `${s.symbol}:${s.exchange}` === selections[r.query],
                      ),
                    );
                    void analyze(chosen);
                  }}
                >
                  Analyze selected securities
                </Button>
              </CardContent>
            </Card>
          )}
          {(asOf !== snapshot.asOf || source !== snapshot.source) && (
            <div className="text-amber-400 text-sm">
              Controls changed. Click Analyze universe to update results.
              Displayed results remain {snapshot.source} as of {snapshot.asOf}.
            </div>
          )}
          {snapshot.source !== "demo" &&
            snapshot.stocks.some((s) => !s.historicalFullAllowed) && (
              <div className="text-sm text-amber-400">
                Historical evaluation uses price-only scoring. Full scoring is
                disabled because historical financial data vintages and estimate
                publication dates cannot be verified.
              </div>
            )}
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Stat
              label="Portfolio capital"
              value={money(settings.constraints.capital)}
              note="Hypothetical starting value · USD"
              icon={Wallet}
            />
            <Stat
              label="Scored securities"
              value={`${complete.length} / ${scored.length}`}
              note={`${settings.mode === "full" ? "Full five-factor" : "Price-only three-factor"} model · submitted universe`}
              icon={Layers3}
            />
            <Stat
              label="Average factor score"
              value={fmt(
                complete.length
                  ? complete.reduce((sum, s) => sum + s.score!, 0) /
                      complete.length
                  : null,
              )}
              note="Percentile scores relative to your universe"
              icon={BarChart3}
            />
            <Stat
              label="Estimated portfolio volatility"
              value={pct(portfolio.volatility)}
              note={`${METHOD_LABELS[method]} · ${portfolio.covarianceSessions} aligned sessions · cash included`}
              icon={Activity}
            />
          </div>
          <nav
            className="flex gap-6 border-b border-[var(--border)] overflow-x-auto"
            aria-label="Workspace views"
          >
            {(
              [
                { key: "research", text: "Factor research", icon: BarChart3 },
                {
                  key: "portfolio",
                  text: "Portfolio allocation",
                  icon: Wallet,
                },
                { key: "data", text: "Data & methodology", icon: Layers3 },
              ] as const
            ).map(({ key, text, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex whitespace-nowrap items-center gap-2 pb-3 text-sm border-b-2 ${tab === key ? "positive border-teal-400" : "muted border-transparent"}`}
              >
                <Icon size={16} />
                {text}
              </button>
            ))}
          </nav>
          <div className="grid xl:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
            <div className="min-w-0 space-y-6">
              {tab === "research" && (
                <>
                  <div className="grid md:grid-cols-3 gap-4">
                    {complete.slice(0, 3).map((s, i) => (
                      <Card
                        key={s.security.symbol}
                        className="p-5 relative overflow-hidden"
                      >
                        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-teal-400/70 to-transparent" />
                        <div className="flex justify-between items-center">
                          <span className="muted text-xs">
                            #{s.rank} ·{" "}
                            {i === 0 ? "TOP RANKED" : "LEADING SIGNAL"}
                          </span>
                          <span className="num text-2xl positive font-semibold">
                            {fmt(s.score)}
                          </span>
                        </div>
                        <div className="mt-3 flex items-end justify-between gap-2">
                          <div>
                            <div className="font-bold text-lg">
                              {s.security.symbol}
                            </div>
                            <div className="muted text-xs mt-1 truncate max-w-44">
                              {s.security.name}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="num">
                              {s.security.currency === "USD"
                                ? money(s.price, 2)
                                : `${fmt(s.price, 2)} ${s.security.currency}`}
                            </div>
                            <div
                              className={`num text-xs mt-1 ${(s.metrics.return3m ?? 0) >= 0 ? "positive" : "negative"}`}
                            >
                              {pct(s.metrics.return3m)} 3M
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                  <Card>
                    <CardHeader>
                      <div>
                        <h2 className="section-title">Universe rankings</h2>
                        <p className="muted text-xs mt-1">
                          {settings.mode === "full"
                            ? "Full model"
                            : "Price-only model"}{" "}
                          · {visible.length} shown · {snapshot.asOf} · relative
                          to all {scored.length} submitted securities
                        </p>
                      </div>
                      <span className="chip">{complete.length} complete</span>
                    </CardHeader>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 border-b border-[var(--border)]">
                      <div>
                        <label
                          htmlFor="sector-filter"
                          className="block mb-1 text-xs"
                        >
                          Sector
                        </label>
                        <select
                          id="sector-filter"
                          value={sector}
                          onChange={(e) => setSector(e.target.value)}
                        >
                          <option value="all">All sectors</option>
                          {sectors.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label
                          htmlFor="factor-filter"
                          className="block mb-1 text-xs"
                        >
                          Score to filter
                        </label>
                        <select
                          id="factor-filter"
                          value={filterFactor}
                          onChange={(e) => setFilterFactor(e.target.value)}
                        >
                          <option value="score">Total score</option>
                          {FACTORS.map((f) => (
                            <option key={f} value={f}>
                              {FACTOR_LABELS[f]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label
                          htmlFor="minscore"
                          className="block mb-1 text-xs"
                        >
                          Minimum score
                        </label>
                        <input
                          id="minscore"
                          type="number"
                          min="0"
                          max="100"
                          value={minScore}
                          onChange={(e) =>
                            setMinScore(
                              Math.max(
                                0,
                                Math.min(100, Number(e.target.value)),
                              ),
                            )
                          }
                        />
                      </div>
                      <div>
                        <label htmlFor="maxvol" className="block mb-1 text-xs">
                          Max volatility %
                        </label>
                        <input
                          id="maxvol"
                          type="number"
                          min="0"
                          value={maxVol}
                          onChange={(e) =>
                            setMaxVol(Math.max(0, Number(e.target.value)))
                          }
                        />
                      </div>
                      <div>
                        <label htmlFor="minliq" className="block mb-1 text-xs">
                          Min volume $M/day
                        </label>
                        <input
                          id="minliq"
                          type="number"
                          min="0"
                          value={minLiquidity}
                          onChange={(e) =>
                            setMinLiquidity(Math.max(0, Number(e.target.value)))
                          }
                        />
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="data-table">
                        <thead>
                          <tr>
                            {[
                              ["rank", "#"],
                              ["symbol", "Security"],
                              ["name", "Company"],
                              ["sector", "Sector"],
                              ["price", "Close"],
                              ["return3m", "3M return"],
                              ["return6m", "6M return"],
                              ["volatility", "Volatility"],
                              ...FACTORS.map((f) => [f, FACTOR_LABELS[f]]),
                              ["score", "Total score"],
                              ["status", "Data / updated"],
                            ].map(([key, text]) => (
                              <th key={key}>
                                {key === "status" ? (
                                  text
                                ) : (
                                  <button
                                    onClick={() => toggleSort(key)}
                                    className="flex items-center gap-1 justify-end w-full"
                                  >
                                    {text}
                                    {sort.key === key && (
                                      <span>{sort.desc ? "↓" : "↑"}</span>
                                    )}
                                  </button>
                                )}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {visible.map((s) => (
                            <Fragment key={s.security.symbol}>
                              <tr>
                                <td className="num muted">{s.rank ?? "—"}</td>
                                <td>
                                  <button
                                    aria-label={`Factor breakdown for ${s.security.symbol}`}
                                    aria-expanded={
                                      expanded === s.security.symbol
                                    }
                                    className="flex items-center gap-2 font-semibold"
                                    onClick={() =>
                                      setExpanded(
                                        expanded === s.security.symbol
                                          ? null
                                          : s.security.symbol,
                                      )
                                    }
                                  >
                                    {expanded === s.security.symbol ? (
                                      <ChevronDown size={13} />
                                    ) : (
                                      <ChevronRight size={13} />
                                    )}
                                    {s.security.symbol}
                                  </button>
                                  <div className="muted text-xs ml-5 mt-1">
                                    {s.security.exchange}
                                  </div>
                                </td>
                                <td className="max-w-48 truncate">
                                  {s.security.name}
                                </td>
                                <td className="muted">{s.sector}</td>
                                <td className="num">
                                  {s.security.currency === "USD"
                                    ? money(s.price, 2)
                                    : `${fmt(s.price, 2)} ${s.security.currency}`}
                                </td>
                                <td
                                  className={`num ${(s.metrics.return3m ?? 0) >= 0 ? "positive" : "negative"}`}
                                >
                                  {pct(s.metrics.return3m)}
                                </td>
                                <td
                                  className={`num ${(s.metrics.return6m ?? 0) >= 0 ? "positive" : "negative"}`}
                                >
                                  {pct(s.metrics.return6m)}
                                </td>
                                <td className="num">
                                  {pct(s.metrics.volatility)}
                                </td>
                                {FACTORS.map((f) => (
                                  <td key={f}>
                                    <Score
                                      value={
                                        settings.mode === "price" &&
                                        ["quality", "earnings"].includes(f)
                                          ? null
                                          : s.factors[f]
                                      }
                                    />
                                  </td>
                                ))}
                                <td>
                                  <span className="inline-flex rounded px-2 py-1 bg-teal-400/10">
                                    <Score value={s.score} />
                                  </span>
                                </td>
                                <td>
                                  <span
                                    className={`text-xs ${s.score === null ? "text-amber-400" : "positive"}`}
                                  >
                                    {s.score === null
                                      ? "Incomplete"
                                      : "Complete"}
                                  </span>
                                  <div className="muted text-xs mt-1">
                                    Price {s.priceDate ?? "missing"}
                                  </div>
                                  <div className="muted text-xs mt-1">
                                    Fetched{" "}
                                    {s.fetchedAt.slice(0, 16).replace("T", " ")}{" "}
                                    UTC
                                  </div>
                                </td>
                              </tr>
                              {expanded === s.security.symbol && (
                                <tr>
                                  <td colSpan={15} className="breakdown">
                                    <Breakdown stock={s} weights={weights} />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                          {visible.length === 0 && (
                            <tr>
                              <td
                                colSpan={15}
                                className="!text-center muted !py-10"
                              >
                                No securities match these filters.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="p-4 muted text-xs flex gap-2">
                      <CircleHelp size={14} className="shrink-0" />
                      <span>
                        Filters change the view only; percentiles and portfolio
                        eligibility use the full submitted universe. Expand a
                        ticker to inspect its calculation.
                      </span>
                    </div>
                  </Card>
                  <Card>
                    <CardHeader>
                      <h2 className="section-title">Factor comparison</h2>
                      <span className="muted text-xs">
                        Top 3 complete securities · 0–100
                      </span>
                    </CardHeader>
                    <CardContent>
                      {complete.length ? (
                        <FactorChart stocks={scored} />
                      ) : (
                        <p className="muted text-sm">
                          No complete scores. Import missing data or select
                          price-only mode.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
              {tab === "portfolio" && (
                <>
                  <Card>
                    <CardHeader>
                      <h2 className="section-title">
                        Position-sizing comparison
                      </h2>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={exportPortfolio}
                      >
                        <Download size={14} />
                        Export CSV
                      </Button>
                    </CardHeader>
                    <CardContent>
                      <div className="grid md:grid-cols-3 gap-4">
                        {portfolios.map((p) => (
                          <button
                            key={p.method}
                            className={`text-left rounded-lg border p-4 transition-colors ${method === p.method ? "border-teal-400/60 bg-teal-400/5" : "border-[var(--border)] hover:bg-[var(--hover)]"}`}
                            onClick={() => setMethod(p.method)}
                          >
                            <div className="flex justify-between text-sm font-semibold">
                              {METHOD_LABELS[p.method]}
                              {method === p.method && (
                                <Check size={16} className="positive" />
                              )}
                            </div>
                            <div className="num text-xl mt-4">
                              {pct(p.volatility)}
                            </div>
                            <div className="muted text-xs mt-1">
                              Estimated portfolio volatility
                            </div>
                            <div className="flex justify-between text-xs mt-4">
                              <span className="muted">Factor score</span>
                              <Score value={p.weightedScore} />
                            </div>
                            <div className="flex justify-between text-xs mt-2">
                              <span className="muted">Remaining cash</span>
                              <span className="num">{pct(p.cashWeight)}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                      <p className="muted text-xs mt-4">
                        All methods use the same eligible securities and
                        constraints. Risk uses aligned daily-return covariance;
                        the factor score is weighted over invested stocks.
                      </p>
                    </CardContent>
                  </Card>
                  <div className="grid md:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader>
                        <h2 className="section-title">Portfolio allocation</h2>
                        <span className="chip">{METHOD_LABELS[method]}</span>
                      </CardHeader>
                      <CardContent>
                        <AllocationChart portfolio={portfolio} />
                        <div className="flex justify-between border-t border-[var(--border)] pt-4 text-sm">
                          <span className="muted">
                            Cash after whole-share rounding
                          </span>
                          <span className="num">{money(portfolio.cash)}</span>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <h2 className="section-title">Sector exposure</h2>
                        <span className="muted text-xs">
                          Cap {pct(settings.constraints.sectorCap, 0)}
                        </span>
                      </CardHeader>
                      <CardContent>
                        <SectorChart
                          portfolio={portfolio}
                          cap={settings.constraints.sectorCap}
                        />
                        <p className="muted text-xs mt-3">
                          Sector weights are fractions of total capital,
                          including cash.
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                  <Card>
                    <CardHeader>
                      <h2 className="section-title">Target positions</h2>
                      <span className="muted text-xs">
                        Whole shares · latest available close · USD
                      </span>
                    </CardHeader>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[700px] text-sm">
                        <thead className="muted bg-[var(--soft)] text-xs">
                          <tr>
                            {[
                              "Security",
                              "Sector",
                              "Target weight",
                              "Actual weight",
                              "Dollar allocation",
                              "Shares",
                              "Close",
                              "Score",
                            ].map((t) => (
                              <th
                                key={t}
                                className="p-3 text-right first:text-left"
                              >
                                {t}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {portfolio.positions.map((p) => (
                            <tr
                              key={p.symbol}
                              className="border-t border-[var(--border)]"
                            >
                              <td className="p-3 font-semibold">{p.symbol}</td>
                              <td className="p-3 text-right muted">
                                {p.sector}
                              </td>
                              <td className="p-3 text-right num">
                                {pct(p.targetWeight, 2)}
                              </td>
                              <td className="p-3 text-right num">
                                {pct(p.weight, 2)}
                              </td>
                              <td className="p-3 text-right num">
                                {money(p.dollars, 2)}
                              </td>
                              <td className="p-3 text-right num">
                                {fmt(p.shares, 0)}
                              </td>
                              <td className="p-3 text-right num">
                                {money(p.price, 2)}
                              </td>
                              <td className="p-3 text-right">
                                <Score value={p.score} />
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t border-[var(--border)] bg-[var(--soft)]">
                            <td className="p-3 font-semibold">CASH</td>
                            <td className="p-3 text-right muted">
                              Reserve + unallocated
                            </td>
                            <td className="p-3 text-right num">
                              {pct(portfolio.targetCashWeight, 2)}
                            </td>
                            <td className="p-3 text-right num">
                              {pct(portfolio.cashWeight, 2)}
                            </td>
                            <td className="p-3 text-right num">
                              {money(portfolio.cash, 2)}
                            </td>
                            <td colSpan={3} />
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </Card>
                  <Card>
                    <CardHeader>
                      <h2 className="section-title">Risk & data warnings</h2>
                      <AlertTriangle size={17} className="text-amber-400" />
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2 text-sm muted">
                        {portfolio.warnings.map((w) => (
                          <li key={w} className="flex gap-2">
                            <AlertTriangle
                              size={14}
                              className="text-amber-400 shrink-0 mt-1"
                            />
                            {w}
                          </li>
                        ))}
                        {stale.length > 0 && (
                          <li className="text-amber-400">
                            Stale prices:{" "}
                            {stale.map((s) => s.security.symbol).join(", ")}.
                            Check these before relying on target quantities.
                          </li>
                        )}
                        <li>
                          Risk estimate includes cash with zero volatility and
                          requires at least 30 aligned completed sessions. It is
                          a historical estimate, not a forecast.
                        </li>
                        <li>
                          Transaction costs, FX, taxes, market impact, and
                          future price movements are not modeled.
                        </li>
                      </ul>
                    </CardContent>
                  </Card>
                </>
              )}
              {tab === "data" && (
                <>
                  <Card>
                    <CardHeader>
                      <h2 className="section-title">
                        Data provenance & endpoint availability
                      </h2>
                      <span className="muted text-xs">
                        Evaluation cutoff {snapshot.cutoff}
                      </span>
                    </CardHeader>
                    <CardContent>
                      <p className="muted text-sm mb-4">
                        FMP access is checked per dataset and symbol. Failed or
                        empty datasets remain missing. Analyst-estimates are
                        shown for availability only; current forecasts are never
                        substituted for reported EPS surprise.
                      </p>
                      {scored.map((s) => (
                        <details
                          key={s.security.symbol}
                          className="border-t border-[var(--border)] py-3"
                        >
                          <summary className="cursor-pointer text-sm font-semibold">
                            {s.security.symbol}{" "}
                            <span className="muted font-normal">
                              · {s.source} · {s.priceDate ?? "no prices"}
                            </span>
                          </summary>
                          <div className="space-y-3 mt-4">
                            {s.statuses.map((d, i) => (
                              <div
                                key={`${d.dataset}-${i}`}
                                className="grid md:grid-cols-[130px_100px_1fr] gap-2 text-sm"
                              >
                                <span>{d.dataset}</span>
                                <span
                                  className={
                                    d.status === "available"
                                      ? "positive"
                                      : "text-amber-400"
                                  }
                                >
                                  {d.status}
                                </span>
                                <div>
                                  <span>{d.message}</span>
                                  <div className="muted text-xs mt-1">
                                    {d.source} · {d.fetchedAt}{" "}
                                  </div>
                                </div>
                              </div>
                            ))}
                            <div className="text-xs text-amber-400 space-y-1">
                              {s.warnings.map((w, i) => (
                                <p key={i}>{w}</p>
                              ))}
                            </div>
                          </div>
                        </details>
                      ))}
                    </CardContent>
                  </Card>
                  <Methodology />
                </>
              )}
            </div>
            <div className="space-y-5 xl:sticky xl:top-6">
              <Card>
                <CardHeader>
                  <h2 className="section-title flex gap-2 items-center">
                    <SlidersHorizontal size={16} />
                    Factor weights
                  </h2>
                  <button
                    className="muted hover:text-teal-400"
                    aria-label="Reset weights"
                    onClick={() => update("weights", DEFAULT_WEIGHTS)}
                  >
                    <RefreshCw size={14} />
                  </button>
                </CardHeader>
                <CardContent>
                  <label htmlFor="model" className="block mb-2">
                    Scoring model
                  </label>
                  <select
                    id="model"
                    value={settings.mode}
                    onChange={(e) => {
                      const mode = e.target.value as Mode;
                      if (
                        mode === "price" &&
                        settings.weights.momentum +
                          settings.weights.lowVolatility +
                          settings.weights.liquidity ===
                          0
                      )
                        update("weights", DEFAULT_WEIGHTS);
                      update("mode", mode);
                    }}
                  >
                    <option
                      value="full"
                      disabled={
                        snapshot.source !== "demo" &&
                        snapshot.stocks.some((s) => !s.historicalFullAllowed)
                      }
                    >
                      Full model · five factors
                    </option>
                    <option value="price">Price-only · three factors</option>
                  </select>
                  <div className="space-y-5 mt-6">
                    {FACTORS.map((f) => (
                      <div
                        key={f}
                        className={
                          settings.mode === "price" &&
                          ["quality", "earnings"].includes(f)
                            ? "opacity-50"
                            : ""
                        }
                      >
                        <div className="flex justify-between text-sm mb-2">
                          <label id={`weight-${f}`}>{FACTOR_LABELS[f]}</label>
                          <span className="num">{settings.weights[f]}%</span>
                        </div>
                        <Slider
                          aria-labelledby={`weight-${f}`}
                          min={0}
                          max={100}
                          step={1}
                          value={[settings.weights[f]]}
                          onValueChange={([value]) => {
                            const next = changeWeight(
                              settings.weights,
                              f,
                              value,
                            );
                            if (
                              settings.mode !== "price" ||
                              next.momentum +
                                next.lowVolatility +
                                next.liquidity >
                                0
                            )
                              update("weights", next);
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between border-t border-[var(--border)] mt-5 pt-4 text-sm">
                    <span className="muted">Total weight</span>
                    <span className="positive num">100%</span>
                  </div>
                  <p className="muted text-xs mt-3">
                    Other weights rebalance proportionally. Scores update
                    immediately from loaded data.
                  </p>
                  {settings.mode === "price" && (
                    <p className="text-xs positive mt-3">
                      Price-only effective weights: momentum{" "}
                      {fmt(weights.momentum)}%, low volatility{" "}
                      {fmt(weights.lowVolatility)}%, liquidity{" "}
                      {fmt(weights.liquidity)}%.
                    </p>
                  )}
                  <details className="mt-4 text-sm">
                    <summary className="cursor-pointer muted">
                      Quality sub-factor weights
                    </summary>
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      {["ROE", "Margin", "D/E"].map((name, i) => (
                        <div key={name}>
                          <label htmlFor={`qw-${i}`} className="text-xs">
                            {name}
                          </label>
                          <input
                            id={`qw-${i}`}
                            type="number"
                            min="0"
                            max="100"
                            value={settings.qualityWeights[i]}
                            onChange={(e) => {
                              const next = [...settings.qualityWeights];
                              next[i] = Math.max(
                                0,
                                Math.min(100, Number(e.target.value)),
                              );
                              if (next.some((n) => n > 0))
                                update("qualityWeights", next);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <p className="muted text-xs mt-2">
                      Normalized within quality.
                    </p>
                  </details>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <h2 className="section-title flex gap-2 items-center">
                    <Wallet size={16} />
                    Allocation constraints
                  </h2>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="capital" className="block mb-2">
                        Portfolio capital · USD
                      </label>
                      <input
                        id="capital"
                        type="number"
                        min="1"
                        max="1000000000000"
                        step="10000"
                        value={settings.constraints.capital}
                        onChange={(e) =>
                          setConstraint("capital", Number(e.target.value))
                        }
                        className="num"
                      />
                    </div>
                    {(
                      [
                        { key: "positionCap", name: "Maximum stock weight" },
                        { key: "sectorCap", name: "Maximum sector weight" },
                        { key: "cashReserve", name: "Initial cash reserve" },
                      ] as const
                    ).map(({ key, name }) => (
                      <div key={key}>
                        <label htmlFor={key} className="block mb-2">
                          {name} · %
                        </label>
                        <input
                          id={key}
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={Math.round(settings.constraints[key] * 100)}
                          onChange={(e) =>
                            setConstraint(key, Number(e.target.value) / 100)
                          }
                          className="num"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-5 text-xs muted">
                    <Check size={13} className="positive" />
                    <span>Long only · no leverage · whole shares</span>
                  </div>
                  <p className="muted text-xs mt-3">
                    Excess allocation stays in cash when position or sector caps
                    bind.
                  </p>
                </CardContent>
              </Card>
              <div className="px-1 muted text-xs leading-relaxed">
                Hypothetical research recommendations. FactorLab does not place
                trades. Settings, watchlists, and imported CSVs are saved in
                this browser.
              </div>
            </div>
          </div>
          {showHelp && <Methodology />}
          <footer className="border-t border-[var(--border)] pt-4 flex flex-wrap justify-between gap-3 text-xs muted">
            <span>
              FactorLab / competition research ·{" "}
              {settings.mode === "full" ? "Full model" : "Price-only model"}
            </span>
            <button
              onClick={() => setShowHelp((v) => !v)}
              className="hover:text-teal-400"
            >
              Scoring methodology
            </button>
            <span>
              {snapshot.source === "demo"
                ? "SYNTHETIC DEMO — not market data"
                : `${snapshot.source.toUpperCase()} · EOD cutoff ${snapshot.cutoff}`}
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Breakdown({
  stock: s,
  weights,
}: {
  stock: ScoredStock;
  weights: Weights;
}) {
  const metrics = [
    ["3M return", s.metrics.return3m, s.subScores.return3m, true],
    ["6M return", s.metrics.return6m, s.subScores.return6m, true],
    ["ROE", s.metrics.roe, s.subScores.roe, true],
    ["Operating margin", s.metrics.margin, s.subScores.margin, true],
    ["Debt / equity", s.metrics.debtEquity, s.subScores.debtEquity, false],
    ["YoY EPS growth", s.metrics.epsGrowth, s.subScores.epsGrowth, true],
    ["Reported EPS surprise", s.metrics.surprise, s.subScores.surprise, true],
    [
      "60-session volatility",
      s.metrics.volatility,
      s.subScores.volatility,
      true,
    ],
    [
      "20-session dollar volume",
      s.metrics.dollarVolume,
      s.subScores.dollarVolume,
      false,
    ],
  ] as const;
  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <h3 className="font-semibold text-sm mb-3">
            Observed metrics → universe percentiles
          </h3>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-2 text-sm">
            <span className="muted">Metric</span>
            <span className="muted">Value</span>
            <span className="muted">Score</span>
            {metrics.map(([label, value, score, percentage]) => (
              <Fragment key={label}>
                <span className="muted">{label}</span>
                <span className="num text-right">
                  {label.includes("dollar")
                    ? money(value)
                    : percentage
                      ? pct(value, 2)
                      : fmt(value, 2)}
                </span>
                <span className="text-right">
                  <Score value={score} />
                </span>
              </Fragment>
            ))}
          </div>
        </div>
        <div>
          <h3 className="font-semibold text-sm mb-3">
            Weighted calculation ·{" "}
            {s.mode === "full" ? "full model" : "price-only"}
          </h3>
          <div className="space-y-2">
            {FACTORS.filter((f) => weights[f] > 0).map((f) => (
              <div className="flex justify-between gap-3 text-sm" key={f}>
                <span className="muted">{FACTOR_LABELS[f]}</span>
                <span className="num">
                  {fmt(s.factors[f])} × {fmt(weights[f], 1)}% ={" "}
                  {s.factors[f] === null
                    ? "—"
                    : fmt((s.factors[f]! * weights[f]) / 100, 2)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--border)] flex justify-between text-sm font-semibold">
            <span>Total score</span>
            <Score value={s.score} />
          </div>
          <p className="muted text-xs mt-3">
            Financial period: {s.fundamentals.period ?? "unavailable"} ·
            published {s.fundamentals.publishedAt ?? "unavailable"} · latest
            reported earnings {s.fundamentals.earningsDate ?? "unavailable"}.
          </p>
        </div>
      </div>
      {s.missing.length > 0 && (
        <p className="text-amber-400 text-sm">
          Incomplete: {s.missing.join(", ")}. Missing required data is never
          scored as zero.
        </p>
      )}
      <ul className="text-xs muted space-y-1">
        {s.warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}
function Methodology() {
  return (
    <Card>
      <CardHeader>
        <h2 className="section-title">
          Scoring & historical evaluation policy
        </h2>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-6 text-sm muted">
          <div className="space-y-3">
            <p>
              Every sub-factor uses average-rank percentiles from 0 to 100
              across the submitted universe. Ties share a rank; one observation
              or a constant series receives 50. Missing values are excluded from
              that metric’s ranking. Percentiles limit the influence of outliers
              without deleting them.
            </p>
            <p>
              Momentum averages 63- and 126-session return scores. Quality
              combines ROE, operating margin, and inverse debt/equity
              percentiles. Nonpositive equity invalidates ROE and debt/equity.
              Earnings averages comparable YoY reported EPS growth and the
              latest reported surprise; nonpositive prior EPS makes growth
              unavailable.
            </p>
            <p>
              Volatility uses the sample standard deviation of 60 simple daily
              returns × √252 (61 closes). Liquidity averages closing price ×
              volume over 20 sessions and ranks log(1 + dollar volume). Low
              volatility and lower debt/equity rank higher.
            </p>
          </div>
          <div className="space-y-3">
            <p>
              Full scores require all five factors, even if a factor’s overall
              weight is zero. Price-only scores require momentum, volatility,
              and liquidity and normalize their weights independently. Financial
              reports use annual periods; EPS surprise uses the latest reported
              earnings event, typically quarterly.
            </p>
            <p>
              Historical evaluations exclude prices after the date. Current
              US-day EOD bars are always excluded as potentially provisional.
              Full historical scoring is disabled because current FMP datasets
              cannot establish historical data vintages, revised statements, or
              the publication history of estimates. Historical sector labels and
              adjusted price histories may reflect later revisions.
            </p>
            <p>
              Allocation uses deterministic proportional redistribution until
              the cash target is met or all available position and sector
              capacity is exhausted. Whole-share rounding leaves residual cash.
              Only complete scores, positive volatility, positive prices, and
              verified USD currencies are eligible.
            </p>
            <a
              className="positive underline"
              href="https://site.financialmodelingprep.com/developer/docs"
              target="_blank"
              rel="noreferrer"
            >
              FMP stable API documentation
            </a>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
