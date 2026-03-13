import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BarChart2,
  ThumbsUp,
  ThumbsDown,
  AlertTriangle,
  MessageSquare,
  Users,
  Download,
  TrendingUp,
  CheckCircle,
  Circle,
  ArrowUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AnalyticsSummary,
  QueryVolumeEntry,
  TopicCluster,
  UnansweredQuestion,
} from "@edgebric/types";

export type AnalyticsTab = "overview" | "topics" | "feedback";

export function AnalyticsDashboard({ tab }: { tab: AnalyticsTab }) {
  const navigate = useNavigate();

  function setTab(id: AnalyticsTab) {
    void navigate({ to: "/analytics", search: { tab: id }, replace: true });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Analytics</h1>
          <p className="text-sm text-slate-500 mt-1">
            Aggregate, anonymized insights. Individual employee queries are never shown.
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
          {(
            [
              { id: "overview", label: "Overview" },
              { id: "topics", label: "Topics" },
              { id: "feedback", label: "Feedback" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                tab === t.id
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-700",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && <OverviewTab />}
        {tab === "topics" && <TopicsTab />}
        {tab === "feedback" && <FeedbackTab />}
      </div>
    </div>
  );
}

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data: summary, isLoading } = useQuery<AnalyticsSummary>({
    queryKey: ["admin", "analytics", "summary"],
    queryFn: () =>
      fetch("/api/admin/analytics/summary", { credentials: "same-origin" })
        .then((r) => r.json() as Promise<AnalyticsSummary>),
    staleTime: 30_000,
  });

  const { data: volume } = useQuery<QueryVolumeEntry[]>({
    queryKey: ["admin", "analytics", "volume"],
    queryFn: () =>
      fetch("/api/admin/analytics/volume?days=30", { credentials: "same-origin" })
        .then((r) => r.json() as Promise<QueryVolumeEntry[]>),
    staleTime: 60_000,
  });

  if (isLoading || !summary) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
        Loading analytics...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<MessageSquare className="w-4 h-4" />}
          label="Total Queries"
          value={summary.overview.totalMessages}
        />
        <StatCard
          icon={<Users className="w-4 h-4" />}
          label="Unique Users"
          value={summary.overview.uniqueUsers}
        />
        <StatCard
          icon={<ThumbsUp className="w-4 h-4" />}
          label="Satisfaction"
          value={
            summary.satisfactionRate != null
              ? `${summary.satisfactionRate}%`
              : "N/A"
          }
          subtitle={
            summary.feedback.total > 0
              ? `${summary.feedback.up} up / ${summary.feedback.down} down`
              : "No feedback yet"
          }
        />
        <StatCard
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Escalations"
          value={summary.escalations.total}
          subtitle={
            summary.escalations.unread > 0
              ? `${summary.escalations.unread} unread`
              : undefined
          }
        />
      </div>

      {/* Query volume chart */}
      {volume && volume.length > 0 && (
        <div className="border border-slate-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-medium text-slate-700">Query Volume (30 days)</h3>
          </div>
          <VolumeChart data={volume} />
        </div>
      )}

      {/* Feedback breakdown */}
      {summary.feedback.total > 0 && (
        <div className="border border-slate-200 rounded-2xl p-5">
          <h3 className="text-sm font-medium text-slate-700 mb-4">Feedback Breakdown</h3>
          <div className="flex items-center gap-4">
            <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
              <div
                className="bg-green-500 h-full rounded-full"
                style={{
                  width: `${(summary.feedback.up / summary.feedback.total) * 100}%`,
                }}
              />
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-600 flex-shrink-0">
              <span className="flex items-center gap-1">
                <ThumbsUp className="w-3 h-3 text-green-500" />
                {summary.feedback.up}
              </span>
              <span className="flex items-center gap-1">
                <ThumbsDown className="w-3 h-3 text-red-400" />
                {summary.feedback.down}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Topics Tab ──────────────────────────────────────────────────────────────

function TopicsTab() {
  const { data: topics, isLoading } = useQuery<TopicCluster[]>({
    queryKey: ["admin", "analytics", "topics"],
    queryFn: () =>
      fetch("/api/admin/analytics/topics?min=5", { credentials: "same-origin" })
        .then((r) => r.json() as Promise<TopicCluster[]>),
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="py-16 text-center text-slate-400 text-sm">Loading topics...</div>;
  }

  if (!topics || topics.length === 0) {
    return (
      <div className="text-center py-16">
        <BarChart2 className="w-10 h-10 text-slate-200 mx-auto mb-3" />
        <p className="text-sm text-slate-500">No topic clusters yet.</p>
        <p className="text-xs text-slate-400 mt-1">
          Topics appear when at least 5 distinct queries contribute to a category.
        </p>
      </div>
    );
  }

  const maxCount = Math.max(...topics.map((t) => t.count));

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Only topics with 5+ queries are shown to protect individual privacy.
      </p>
      {topics.map((topic) => (
        <div
          key={topic.topic}
          className="border border-slate-200 rounded-xl p-4 flex items-center gap-4"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800 capitalize">{topic.topic}</p>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 bg-slate-100 rounded-full h-2 max-w-48">
                <div
                  className="bg-slate-400 h-full rounded-full"
                  style={{ width: `${(topic.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="text-xs text-slate-500">{topic.count} queries</span>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <span
              className={cn(
                "text-xs font-medium",
                topic.upRate >= 0.7
                  ? "text-green-600"
                  : topic.upRate >= 0.4
                    ? "text-amber-600"
                    : "text-red-500",
              )}
            >
              {Math.round(topic.upRate * 100)}% satisfied
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Feedback Tab ────────────────────────────────────────────────────────────

type SortMode = "newest" | "oldest" | "unresolved";

function FeedbackTab() {
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const queryClient = useQueryClient();

  const { data: summary } = useQuery<AnalyticsSummary>({
    queryKey: ["admin", "analytics", "summary"],
    queryFn: () =>
      fetch("/api/admin/analytics/summary", { credentials: "same-origin" })
        .then((r) => r.json() as Promise<AnalyticsSummary>),
    staleTime: 30_000,
  });

  const { data: questions, isLoading } = useQuery<UnansweredQuestion[]>({
    queryKey: ["admin", "analytics", "unanswered"],
    queryFn: () =>
      fetch("/api/admin/analytics/unanswered?limit=100", { credentials: "same-origin" })
        .then((r) => r.json() as Promise<UnansweredQuestion[]>),
    staleTime: 60_000,
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ messageId, resolve }: { messageId: string; resolve: boolean }) => {
      const method = resolve ? "POST" : "DELETE";
      const res = await fetch(`/api/admin/analytics/unanswered/${messageId}/resolve`, {
        method,
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "analytics", "unanswered"] });
    },
  });

  function handleExport() {
    window.open("/api/admin/analytics/unanswered/export", "_blank");
  }

  if (isLoading) {
    return <div className="py-16 text-center text-slate-400 text-sm">Loading...</div>;
  }

  const upCount = summary?.feedback.up ?? 0;
  const downCount = summary?.feedback.down ?? 0;
  const totalRatings = summary?.feedback.total ?? 0;
  const satisfactionPct = totalRatings > 0 ? Math.round((upCount / totalRatings) * 100) : 0;
  const commentCount = questions?.filter((q) => q.feedback?.comment).length ?? 0;

  const hasQuestions = questions && questions.length > 0;

  // Sort
  const sorted = hasQuestions
    ? [...questions].sort((a, b) => {
        if (sortMode === "unresolved") {
          if (a.resolvedAt && !b.resolvedAt) return 1;
          if (!a.resolvedAt && b.resolvedAt) return -1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        if (sortMode === "oldest") {
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
    : [];

  const unresolvedCount = questions?.filter((q) => !q.resolvedAt).length ?? 0;
  const resolvedCount = (questions?.length ?? 0) - unresolvedCount;

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="border border-slate-200 rounded-xl p-3 text-center">
          <p className="text-2xl font-semibold text-slate-900">{totalRatings}</p>
          <p className="text-xs text-slate-400 mt-0.5">Total Ratings</p>
        </div>
        <div className="border border-slate-200 rounded-xl p-3 text-center">
          <p className="text-2xl font-semibold text-green-600">{satisfactionPct}%</p>
          <p className="text-xs text-slate-400 mt-0.5">Satisfaction</p>
        </div>
        <div className="border border-slate-200 rounded-xl p-3 text-center">
          <div className="flex items-center justify-center gap-3">
            <span className="flex items-center gap-1 text-sm font-semibold text-green-600">
              <ThumbsUp className="w-3.5 h-3.5" /> {upCount}
            </span>
            <span className="flex items-center gap-1 text-sm font-semibold text-red-400">
              <ThumbsDown className="w-3.5 h-3.5" /> {downCount}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">Up / Down</p>
        </div>
        <div className="border border-slate-200 rounded-xl p-3 text-center">
          <p className="text-2xl font-semibold text-slate-900">{commentCount}</p>
          <p className="text-xs text-slate-400 mt-0.5">With Comments</p>
        </div>
      </div>

      {/* Satisfaction bar */}
      {totalRatings > 0 && (
        <div className="flex items-center gap-4">
          <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-green-500 h-full rounded-full transition-all"
              style={{ width: `${satisfactionPct}%` }}
            />
          </div>
          <span className="text-xs text-slate-500 flex-shrink-0">{satisfactionPct}% positive</span>
        </div>
      )}

      {/* Low-confidence questions with user feedback */}
      {hasQuestions ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              {unresolvedCount} unresolved, {resolvedCount} resolved &mdash; questions where the AI had low confidence.
            </p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="appearance-none text-xs border border-slate-200 rounded-lg pl-3 pr-7 py-1.5 bg-white text-slate-600 hover:border-slate-300 transition-colors cursor-pointer"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="unresolved">Unresolved first</option>
                </select>
                <ArrowUpDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 hover:border-slate-300 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            </div>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="w-8 px-3 py-2.5"></th>
                  <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5 w-24">Date</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5">Conversation</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5 w-32 hidden md:table-cell">Rating</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5 hidden lg:table-cell">Comment</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((q) => (
                  <tr
                    key={q.messageId}
                    className={cn(
                      "border-b border-slate-100 last:border-b-0 transition-colors",
                      q.resolvedAt ? "bg-slate-50/50" : "",
                    )}
                  >
                    {/* Resolve toggle */}
                    <td className="px-3 py-3 align-top">
                      <button
                        onClick={() =>
                          resolveMutation.mutate({
                            messageId: q.messageId,
                            resolve: !q.resolvedAt,
                          })
                        }
                        title={q.resolvedAt ? "Mark as unresolved" : "Mark as resolved"}
                      >
                        {q.resolvedAt ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <Circle className="w-4 h-4 text-slate-300 hover:text-slate-400" />
                        )}
                      </button>
                    </td>

                    {/* Date */}
                    <td className="px-4 py-3 align-top text-xs text-slate-400 whitespace-nowrap">
                      {new Date(q.createdAt).toLocaleDateString()}
                      {q.resolvedAt && (
                        <span className="block text-[11px] text-green-600 mt-0.5">Resolved</span>
                      )}
                    </td>

                    {/* Conversation */}
                    <td className="px-4 py-3 align-top">
                      <Link
                        to="/conversations/$id"
                        params={{ id: q.conversationId }}
                        search={{ msg: q.messageId }}
                        className="group"
                      >
                        <p className={cn(
                          "text-xs font-medium group-hover:underline",
                          q.resolvedAt ? "text-slate-400 line-through" : "text-slate-800",
                        )}>
                          {q.question}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                          {q.aiAnswer.slice(0, 200)}{q.aiAnswer.length > 200 ? "..." : ""}
                        </p>
                      </Link>
                    </td>

                    {/* Rating */}
                    <td className="px-4 py-3 align-top hidden md:table-cell">
                      {q.feedback ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded",
                            q.feedback.rating === "up"
                              ? "bg-green-50 text-green-600"
                              : "bg-red-50 text-red-500",
                          )}
                        >
                          {q.feedback.rating === "up" ? (
                            <ThumbsUp className="w-3 h-3" />
                          ) : (
                            <ThumbsDown className="w-3 h-3" />
                          )}
                          {q.feedback.rating === "up" ? "Helpful" : "Not helpful"}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-300">No rating</span>
                      )}
                    </td>

                    {/* Comment */}
                    <td className="px-4 py-3 align-top hidden lg:table-cell">
                      {q.feedback?.comment ? (
                        <p className="text-xs text-slate-500 italic line-clamp-2">
                          &ldquo;{q.feedback.comment}&rdquo;
                        </p>
                      ) : (
                        <span className="text-[11px] text-slate-300">&mdash;</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-10">
          <MessageSquare className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No feedback entries yet.</p>
          <p className="text-xs text-slate-400 mt-1">
            Feedback appears here when users rate responses.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Shared components ───────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subtitle?: string | undefined;
}) {
  return (
    <div className="border border-slate-200 rounded-2xl p-4">
      <div className="flex items-center gap-2 text-slate-400 mb-2">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
      {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
    </div>
  );
}

/** Simple CSS bar chart — no charting library needed. */
function VolumeChart({ data }: { data: QueryVolumeEntry[] }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="flex items-end gap-px h-32">
      {data.map((entry) => (
        <div key={entry.date} className="flex-1 flex flex-col items-center group relative">
          <div
            className="w-full bg-slate-200 hover:bg-slate-300 rounded-t transition-colors min-h-[2px]"
            style={{ height: `${Math.max((entry.count / maxCount) * 100, 2)}%` }}
          />
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-slate-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10 pointer-events-none">
            {entry.date}: {entry.count}
          </div>
        </div>
      ))}
    </div>
  );
}
