import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/acknowledgments")({
  component: Acknowledgments,
});

function Acknowledgments() {
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

        <h1 className="text-2xl font-semibold text-slate-900 dark:text-gray-100">Open Source Acknowledgments</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-gray-400">
          Edgebric is built with the help of these open-source projects.
        </p>

        <div className="mt-8 space-y-6">
          <ProjectCard
            name="Ollama"
            license="MIT"
            url="https://github.com/ollama/ollama"
            description="Local large language model runtime. Ollama powers Edgebric's on-device AI inference, ensuring all queries are processed privately without leaving your network."
          />

          <ProjectCard
            name="mimik edgeEngine"
            license="MIT"
            url="https://github.com/mimikgit"
            description="Edge computing platform providing mILM (inference), mKB (vector storage), and mAIChain (orchestration) microservices that form Edgebric's distributed AI backbone."
          />

          <ProjectCard
            name="React"
            license="MIT"
            url="https://github.com/facebook/react"
            description="User interface library used throughout Edgebric's web and desktop applications."
          />

          <ProjectCard
            name="Electron"
            license="MIT"
            url="https://github.com/electron/electron"
            description="Cross-platform desktop application framework powering the Edgebric desktop app."
          />

          <ProjectCard
            name="Express"
            license="MIT"
            url="https://github.com/expressjs/express"
            description="Web framework for the Edgebric API server."
          />

          <ProjectCard
            name="better-sqlite3"
            license="MIT"
            url="https://github.com/WiseLibs/better-sqlite3"
            description="SQLite database driver for local data persistence."
          />

          <ProjectCard
            name="Drizzle ORM"
            license="Apache-2.0"
            url="https://github.com/drizzle-team/drizzle-orm"
            description="TypeScript ORM for type-safe database queries."
          />

          <ProjectCard
            name="TanStack Router"
            license="MIT"
            url="https://github.com/TanStack/router"
            description="Type-safe routing for the web application."
          />

          <ProjectCard
            name="Tailwind CSS"
            license="MIT"
            url="https://github.com/tailwindlabs/tailwindcss"
            description="Utility-first CSS framework used for all Edgebric UI styling."
          />

          <ProjectCard
            name="Lucide"
            license="ISC"
            url="https://github.com/lucide-icons/lucide"
            description="Icon library used throughout the interface."
          />
        </div>

        <p className="mt-10 text-xs text-slate-400 dark:text-gray-600 leading-relaxed">
          This list includes major dependencies. Edgebric also uses many other open-source
          packages — see the project's package.json files for a complete list. We are grateful
          to the maintainers and contributors of all these projects.
        </p>
      </div>
    </div>
  );
}

function ProjectCard({ name, license, url, description }: {
  name: string;
  license: string;
  url: string;
  description: string;
}) {
  return (
    <div className="border border-slate-200 dark:border-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-gray-100">{name}</h2>
        <span className="text-xs font-mono text-slate-400 dark:text-gray-500 bg-slate-50 dark:bg-gray-900 px-2 py-0.5 rounded">
          {license}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-slate-600 dark:text-gray-400 leading-relaxed">{description}</p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block text-xs text-slate-500 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-300 underline"
      >
        View on GitHub
      </a>
    </div>
  );
}
