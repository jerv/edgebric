import { createFileRoute, Link } from "@tanstack/react-router";
import numbatLight from "../assets/numbat-black.svg";
import numbatDark from "../assets/numbat-white.svg";

export const Route = createFileRoute("/terms")({
  component: TermsOfService,
});

function TermsOfService() {
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

        <h1 className="text-2xl font-semibold text-slate-900 dark:text-gray-100">Terms of Service</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-gray-400">Last updated: March 2026</p>

        <div className="mt-8 space-y-8 text-sm text-slate-700 dark:text-gray-300 leading-relaxed">
          <Section title="1. Software license">
            <p>
              Edgebric is open source under the{" "}
              <a href="https://github.com/edgebric/edgebric/blob/main/LICENSE" className="text-slate-900 dark:text-gray-100 underline">
                GNU Affero General Public License v3.0 (AGPL-3.0)
              </a>
              . You may use, modify, and distribute it for any purpose —
              without limitation on the number of users or features. No license key, subscription, or
              account is required. If you distribute modified versions or run them as a network service,
              you must share your source code under the same license. These terms govern your use of
              the Edgebric software, along with any updates or documentation provided with it.
            </p>
          </Section>

          <Section title="2. Deployment and data ownership">
            <p>
              Edgebric runs entirely on infrastructure you control. All data processed by
              Edgebric — including documents, queries, conversations, and embeddings — belongs
              to you. Edgebric's developers have no access to your data at any time.
            </p>
          </Section>

          <Section title="3. Permitted use">
            <p>You may use Edgebric to:</p>
            <ul className="mt-2 space-y-1.5 list-disc pl-5">
              <li>Build and manage internal sources for your organization</li>
              <li>Enable employees to query organizational knowledge through the AI-powered interface</li>
              <li>Process and embed documents for retrieval-augmented generation</li>
              <li>Manage user access and permissions through your identity provider</li>
            </ul>
          </Section>

          <Section title="4. Restrictions">
            <p>Under the AGPL 3.0 and these terms, you may not:</p>
            <ul className="mt-2 space-y-1.5 list-disc pl-5">
              <li>Remove or alter any license text, copyright notices, or attribution</li>
              <li>Use the &quot;Edgebric&quot; name or logos for derivative works (forks must use a different name)</li>
              <li>Distribute modified versions without making your source code available under the AGPL 3.0</li>
              <li>Use the software to process data in violation of applicable privacy laws</li>
            </ul>
          </Section>

          <Section title="5. AI-generated content">
            <p>
              Edgebric uses AI language models to generate responses based on your uploaded documents.
              AI-generated responses may contain inaccuracies. Your organization is responsible for
              verifying the accuracy of any information provided by Edgebric before acting on it.
              Edgebric includes source citations to help users verify responses against original documents.
            </p>
          </Section>

          <Section title="6. Administrator responsibilities">
            <p>
              Organization administrators are responsible for:
            </p>
            <ul className="mt-2 space-y-1.5 list-disc pl-5">
              <li>Ensuring uploaded documents comply with applicable laws and internal policies</li>
              <li>Managing user access and permissions appropriately</li>
              <li>Maintaining backups of the Edgebric data directory</li>
              <li>Keeping the software updated to receive security patches</li>
              <li>Configuring identity provider integration correctly</li>
            </ul>
          </Section>

          <Section title="7. Warranty disclaimer">
            <p>
              Edgebric is provided "as is" without warranty of any kind, express or implied,
              including but not limited to warranties of merchantability, fitness for a particular
              purpose, or non-infringement. The entire risk as to the quality and performance of
              the software is with you.
            </p>
          </Section>

          <Section title="8. Limitation of liability">
            <p>
              In no event shall Edgebric's developers be liable for any indirect, incidental,
              special, consequential, or punitive damages, including but not limited to loss of
              profits, data, or business opportunities, arising out of or in connection with your
              use of the software.
            </p>
          </Section>

          <Section title="9. Updates and support">
            <p>
              Software updates are provided on a best-effort basis. Community support is available
              through{" "}
              <a href="https://github.com/edgebric/edgebric/issues" className="text-slate-900 dark:text-gray-100 underline">
                GitHub Issues
              </a>
              . No SLA or guaranteed response times. For enterprise support contracts,
              contact support@edgebric.com.
            </p>
          </Section>

          <Section title="10. Termination">
            <p>
              These terms remain in effect until terminated. Your rights under these terms will
              terminate automatically if you fail to comply with any of them. Upon termination,
              you must cease all use of the software. Your data remains yours — you may export or
              delete it at any time.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              For questions about these terms, contact{" "}
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
