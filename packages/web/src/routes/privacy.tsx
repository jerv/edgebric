import { createFileRoute, Link } from "@tanstack/react-router";
import numbatLight from "../assets/numbat-black.svg";
import numbatDark from "../assets/numbat-white.svg";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPolicy,
});

function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 mb-8"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </Link>

        <h1 className="text-2xl font-semibold text-slate-900 dark:text-gray-100">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-gray-400">Last updated: March 2026</p>

        <div className="mt-8 space-y-8 text-sm text-slate-700 dark:text-gray-300 leading-relaxed">
          <Section title="How Edgebric is different">
            <p>
              Edgebric is <strong>software you run on your own infrastructure</strong>, not a
              cloud service. Your data never leaves your hardware. There is no Edgebric server
              that receives, processes, or stores your information. This fundamentally changes
              the privacy model: <strong>you are the data controller and the data processor</strong>.
            </p>
          </Section>

          <Section title="What data Edgebric processes">
            <p>When deployed within your organization, Edgebric processes:</p>
            <ul className="mt-2 space-y-1.5 list-disc pl-5">
              <li>
                <strong>Documents</strong> you upload to sources (PDFs, Word documents, text files).
                These are chunked and embedded locally for search.
              </li>
              <li>
                <strong>Queries</strong> employees submit through the chat interface. Queries are processed
                by a local language model and are not sent to any external service.
              </li>
              <li>
                <strong>Authentication tokens</strong> from your identity provider (e.g., Google Workspace, Okta)
                used solely for sign-in. Edgebric stores a session cookie — not your IdP credentials.
              </li>
              <li>
                <strong>Session tokens</strong> — after login, each session receives a random UUID.
                Queries cannot be traced back to individual users.
              </li>
            </ul>
          </Section>

          <Section title="Where data is stored">
            <p>All data is stored in a single directory on your server's filesystem:</p>
            <ul className="mt-2 space-y-1.5 list-disc pl-5">
              <li>SQLite database (users, conversations, source metadata)</li>
              <li>Uploaded document files</li>
              <li>Embedded vector data (via local vector database)</li>
              <li>Session files</li>
            </ul>
            <p className="mt-2">
              No data is transmitted to Edgebric's developers, third-party analytics services,
              or any external endpoint. The software operates entirely within your network.
            </p>
          </Section>

          <Section title="Third-party services">
            <p>
              By default, Edgebric uses <strong>no third-party services</strong>. All AI inference
              runs locally via llama.cpp, an open-source model runtime bundled with the application.
              If your administrator configures a custom LLM endpoint (e.g., an internal API gateway),
              queries will be sent to that endpoint — but this is an explicit opt-in configuration
              controlled by your organization.
            </p>
          </Section>

          <Section title="Data retention">
            <p>
              Data persists until you delete it. Administrators can remove documents, clear
              sources, and archive or delete conversations. When you uninstall Edgebric,
              deleting the data directory removes all stored information.
            </p>
          </Section>

          <Section title="PII protection">
            <p>Edgebric includes multiple layers of protection against personal data exposure:</p>
            <ul className="mt-2 space-y-1.5 list-disc pl-5">
              <li>Documents containing personal employee records should not be uploaded to shared sources.</li>
              <li>PII detection scans queries for names and sensitive terms before processing.</li>
              <li>System prompts instruct the AI model to never disclose personal information.</li>
              <li>Query-time filters provide an additional safety net.</li>
            </ul>
          </Section>

          <Section title="edgebric.com website">
            <p>
              The Edgebric marketing website (edgebric.com) is separate from the Edgebric software.
              If you purchase a download from edgebric.com, payment is processed by{" "}
              <a href="https://stripe.com/privacy" className="text-slate-900 dark:text-gray-100 underline">
                Stripe
              </a>
              . Edgebric does not store credit card numbers. Stripe retains your email address and
              payment details under their own privacy policy. No analytics, tracking pixels, or
              third-party scripts are used on edgebric.com.
            </p>
          </Section>

          <Section title="Your rights">
            <p>
              Since your organization controls the Edgebric deployment, data subject requests
              (access, deletion, portability) should be directed to your organization's data
              protection officer or IT administrator. They have full access to all stored data
              and can fulfill these requests directly.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              For questions about this privacy policy or Edgebric's data practices, contact
              your organization's IT administrator or the Edgebric team at{" "}
              <a href="mailto:support@edgebric.com" className="text-slate-900 dark:text-gray-100 underline">
                support@edgebric.com
              </a>.
            </p>
          </Section>
        </div>

        <div className="mt-16 mb-4 flex justify-center">
          <img src={numbatLight} alt="Edgebric" className="h-16 opacity-20 dark:hidden" />
          <img src={numbatDark} alt="Edgebric" className="h-16 opacity-20 hidden dark:block" />
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-slate-900 dark:text-gray-100 mb-2">{title}</h2>
      {children}
    </section>
  );
}
