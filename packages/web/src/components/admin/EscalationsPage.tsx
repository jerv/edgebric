import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle,
  Download,
  Slack,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Escalation } from "@edgebric/types";

export function EscalationsPage() {
  const queryClient = useQueryClient();

  const { data: escalations = [], isLoading } = useQuery<Escalation[]>({
    queryKey: ["admin", "escalations"],
    queryFn: () =>
      fetch("/api/admin/escalations", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) return [];
        return r.json() as Promise<Escalation[]>;
      }),
    staleTime: 30_000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/admin/escalations/${id}/read`, {
        method: "PATCH",
        credentials: "same-origin",
      }).then((r) => {
        if (!r.ok) throw new Error("Mark read failed");
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "escalations"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "escalations", "unread-count"] });
    },
  });

  function handleEscalationClick(esc: Escalation) {
    if (!esc.readAt) {
      markReadMutation.mutate(esc.id);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Escalations</h1>
          <p className="text-sm text-slate-500 mt-1">
            Verification requests from employees. Click a row to view the conversation.
          </p>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Loading...</div>
        ) : escalations.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No escalations yet.</p>
            <p className="text-xs text-slate-400 mt-1">
              Escalations appear when employees request human verification of an AI answer.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">
                {escalations.filter((e) => !e.readAt).length} unread of {escalations.length} total
              </p>
              <a
                href="/api/admin/escalations/export"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 hover:border-slate-300 transition-colors flex-shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </a>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="w-6 px-3 py-2.5"></th>
                    <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5 w-24">Date</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5">Conversation</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5 w-28 hidden md:table-cell">Target</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5 w-24 hidden md:table-cell">Method</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5 w-20">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {escalations.map((esc) => {
                    const isUnread = !esc.readAt;
                    return (
                      <tr
                        key={esc.id}
                        className={cn(
                          "border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors",
                          isUnread && "bg-blue-50/30",
                        )}
                      >
                        <td className="px-3 py-3 align-top">
                          {isUnread && (
                            <div className="w-2 h-2 rounded-full bg-blue-500 mt-1" title="Unread" />
                          )}
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-slate-400 whitespace-nowrap">
                          {new Date(esc.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <Link
                            to="/conversations/$id"
                            params={{ id: esc.conversationId }}
                            search={{ msg: esc.messageId }}
                            onClick={() => handleEscalationClick(esc)}
                            className="group"
                          >
                            <p className={cn(
                              "text-xs group-hover:underline",
                              isUnread ? "text-slate-900 font-medium" : "text-slate-700",
                            )}>
                              {esc.question}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                              {esc.aiAnswer.slice(0, 200)}{esc.aiAnswer.length > 200 ? "..." : ""}
                            </p>
                          </Link>
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-slate-500 hidden md:table-cell">
                          {esc.targetName ?? "\u2014"}
                        </td>
                        <td className="px-4 py-3 align-top hidden md:table-cell">
                          <span className="inline-flex items-center gap-1 text-xs text-slate-500 capitalize">
                            {esc.method === "slack" ? (
                              <Slack className="w-3 h-3" />
                            ) : esc.method === "email" ? (
                              <Mail className="w-3 h-3" />
                            ) : null}
                            {esc.method ?? "\u2014"}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <EscalationStatusBadge status={esc.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EscalationStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide",
        status === "sent" && "bg-green-50 text-green-700",
        status === "failed" && "bg-red-50 text-red-600",
        status === "replied" && "bg-blue-50 text-blue-700",
        status === "resolved" && "bg-emerald-50 text-emerald-700",
        status === "logged" && "bg-slate-100 text-slate-500",
      )}
    >
      {status}
    </span>
  );
}
