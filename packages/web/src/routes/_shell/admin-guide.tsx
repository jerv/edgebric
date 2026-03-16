import { createFileRoute } from "@tanstack/react-router";
import { useUser } from "@/contexts/UserContext";

export const Route = createFileRoute("/_shell/admin-guide")({
  component: AdminGuide,
});

function AdminGuide() {
  const user = useUser();
  const isAdmin = !!user?.isAdmin;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-xl font-semibold text-slate-900">Help & Admin Guide</h1>
        <p className="mt-1 text-sm text-slate-500">
          Everything you need to know about using Edgebric.
        </p>

        <div className="mt-8 space-y-10 text-sm text-slate-700 leading-relaxed">
          {/* Everyone sees this */}
          <GuideSection title="Getting started">
            <ol className="space-y-2 list-decimal pl-5">
              <li>Sign in with your organization's identity provider (Google, Okta, etc.).</li>
              <li>Start a new chat from the sidebar and ask a question.</li>
              <li>Edgebric searches your organization's knowledge bases and responds with cited answers.</li>
              <li>Click any citation to see the source document and the exact passage used.</li>
            </ol>
          </GuideSection>

          <GuideSection title="Privacy modes">
            <p>Edgebric offers three privacy levels, selectable from the privacy toggle in the chat header:</p>
            <ul className="mt-2 space-y-2 list-disc pl-5">
              <li>
                <strong>Standard</strong> — Conversations are saved and visible in your sidebar. Anonymous
                query analytics are collected (no user identity attached).
              </li>
              <li>
                <strong>Private</strong> — Conversations are not saved. No analytics recorded. The conversation
                disappears when you start a new one or close the browser.
              </li>
              <li>
                <strong>Vault</strong> — End-to-end encrypted conversations stored locally on your device.
                Protected by biometric authentication. Even server administrators cannot read vault conversations.
              </li>
            </ul>
          </GuideSection>

          <GuideSection title="Escalations">
            <p>
              If Edgebric can't answer your question or you need human verification, click "Ask HR to verify"
              below any response. This sends an anonymous escalation to your HR team. You'll receive a
              notification in the app when they respond.
            </p>
          </GuideSection>

          {/* Admin-only sections */}
          {isAdmin && (
            <>
              <div className="border-t border-slate-200 pt-8">
                <h2 className="text-base font-semibold text-slate-900 mb-1">Administrator Guide</h2>
                <p className="text-sm text-slate-500 mb-6">
                  These sections are only visible to organization administrators.
                </p>
              </div>

              <GuideSection title="Managing knowledge bases">
                <ol className="space-y-2 list-decimal pl-5">
                  <li>
                    Go to <strong>Library</strong> in the sidebar. Here you can create, rename, and manage
                    knowledge bases (KBs).
                  </li>
                  <li>
                    Click <strong>New KB</strong> to create a new knowledge base. Give it a descriptive name
                    (e.g., "Employee Handbook", "Benefits Guide").
                  </li>
                  <li>
                    Upload documents (PDF, DOCX, TXT, Markdown) to a KB. Documents are automatically
                    chunked, embedded, and indexed for search.
                  </li>
                  <li>
                    Configure KB access: by default, all organization members can query a KB. You can
                    restrict access to specific users.
                  </li>
                  <li>
                    Security toggles per KB: enable/disable PII detection and safety filters for
                    sensitive knowledge bases.
                  </li>
                </ol>
              </GuideSection>

              <GuideSection title="Managing users">
                <p>
                  Users are created automatically when they sign in via your identity provider. To manage roles:
                </p>
                <ul className="mt-2 space-y-2 list-disc pl-5">
                  <li>
                    Go to <strong>Organization &gt; Members</strong> to see all users.
                  </li>
                  <li>
                    Promote a user to admin or revoke admin access from this panel.
                  </li>
                  <li>
                    Initial admin emails are configured during setup (the <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">ADMIN_EMAILS</code> environment
                    variable). Additional admins can be added from the UI after first login.
                  </li>
                </ul>
              </GuideSection>

              <GuideSection title="Handling escalations">
                <p>
                  When employees escalate a question, it appears in <strong>Escalations</strong> in the
                  sidebar (with an unread badge count).
                </p>
                <ul className="mt-2 space-y-2 list-disc pl-5">
                  <li>Click an escalation to see the original question and AI response.</li>
                  <li>Write a reply — the employee will see it as a notification in their chat.</li>
                  <li>Mark escalations as resolved when handled.</li>
                  <li>
                    Escalations are anonymous by default — you see the question but not the employee's identity.
                  </li>
                </ul>
              </GuideSection>

              <GuideSection title="Analytics">
                <p>
                  The <strong>Analytics</strong> page shows aggregated, anonymous query data:
                </p>
                <ul className="mt-2 space-y-2 list-disc pl-5">
                  <li>Total queries over time (daily, weekly, monthly)</li>
                  <li>Topic clustering — see what subjects employees ask about most</li>
                  <li>Satisfaction ratings from the thumbs up/down feedback</li>
                  <li>Knowledge base coverage — identify gaps where questions go unanswered</li>
                </ul>
                <p className="mt-2">
                  All analytics data is anonymous. Individual queries cannot be traced to specific users.
                </p>
              </GuideSection>

              <GuideSection title="Backup and restore">
                <p>
                  All Edgebric data is stored in a single directory (configured during setup, typically{" "}
                  <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">~/.edgebric</code>). To back up:
                </p>
                <ol className="mt-2 space-y-2 list-decimal pl-5">
                  <li>
                    Stop Edgebric: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">edgebric stop</code>
                  </li>
                  <li>
                    Copy the entire data directory:{" "}
                    <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">
                      cp -r ~/.edgebric ~/.edgebric-backup-$(date +%Y%m%d)
                    </code>
                  </li>
                  <li>
                    Restart: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">edgebric start</code>
                  </li>
                </ol>
                <p className="mt-3">To restore from backup:</p>
                <ol className="mt-2 space-y-2 list-decimal pl-5">
                  <li>
                    Stop Edgebric: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">edgebric stop</code>
                  </li>
                  <li>
                    Replace the data directory with your backup:{" "}
                    <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">
                      rm -rf ~/.edgebric && cp -r ~/.edgebric-backup-20260315 ~/.edgebric
                    </code>
                  </li>
                  <li>
                    Start Edgebric: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">edgebric start</code>
                  </li>
                </ol>
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  <strong>Recommendation:</strong> Set up a cron job or scheduled task to back up the data
                  directory daily. Edgebric uses SQLite, which is safe to copy while the server is stopped.
                </div>
              </GuideSection>

              <GuideSection title="Server management (CLI)">
                <p>
                  Edgebric includes a CLI for server management:
                </p>
                <div className="mt-2 space-y-1.5 font-mono text-xs bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <div><span className="text-slate-400">$</span> edgebric setup    <span className="text-slate-400"># Interactive setup wizard</span></div>
                  <div><span className="text-slate-400">$</span> edgebric start    <span className="text-slate-400"># Start server (daemonized)</span></div>
                  <div><span className="text-slate-400">$</span> edgebric start -f <span className="text-slate-400"># Start in foreground</span></div>
                  <div><span className="text-slate-400">$</span> edgebric stop     <span className="text-slate-400"># Graceful shutdown</span></div>
                  <div><span className="text-slate-400">$</span> edgebric status   <span className="text-slate-400"># Show running state + health</span></div>
                  <div><span className="text-slate-400">$</span> edgebric logs     <span className="text-slate-400"># Tail server logs</span></div>
                  <div><span className="text-slate-400">$</span> edgebric logs -n 200 <span className="text-slate-400"># Last 200 lines</span></div>
                </div>
              </GuideSection>

              <GuideSection title="Troubleshooting">
                <div className="space-y-4">
                  <TroubleshootItem
                    problem="Server won't start"
                    solution='Run "edgebric status" to check for stale PID files. Check logs with "edgebric logs". Verify the port isn&apos;t already in use.'
                  />
                  <TroubleshootItem
                    problem="OIDC login fails"
                    solution="Verify your OIDC Client ID and Secret are correct. Ensure the redirect URI in your IdP matches exactly (including port). Check that the OIDC issuer URL is reachable from your server."
                  />
                  <TroubleshootItem
                    problem="Documents not appearing in search results"
                    solution="Check the document's processing status in Library. Large documents may take a few minutes to chunk and embed. Verify the mKB service is running by checking the health endpoint."
                  />
                  <TroubleshootItem
                    problem="AI responses are slow or empty"
                    solution="Verify the language model is running (mILM or llama-server). The first query after startup may be slow due to model loading. Check server logs for errors."
                  />
                  <TroubleshootItem
                    problem="Disk space warning in health check"
                    solution="Edgebric monitors disk usage. Warnings appear at 85% capacity, critical alerts at 95%. Free up space or expand storage to resolve."
                  />
                </div>
              </GuideSection>
            </>
          )}

          {/* Footer links */}
          <div className="border-t border-slate-200 pt-6 flex items-center gap-4 text-xs text-slate-400">
            <a href="/privacy" className="hover:text-slate-600 transition-colors">Privacy Policy</a>
            <a href="/terms" className="hover:text-slate-600 transition-colors">Terms of Service</a>
          </div>
        </div>
      </div>
    </div>
  );
}

function GuideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-900 mb-2">{title}</h3>
      {children}
    </section>
  );
}

function TroubleshootItem({ problem, solution }: { problem: string; solution: string }) {
  return (
    <div>
      <div className="font-medium text-slate-900">{problem}</div>
      <div className="mt-0.5 text-slate-600">{solution}</div>
    </div>
  );
}
