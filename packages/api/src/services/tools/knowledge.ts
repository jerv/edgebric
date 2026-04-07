/**
 * Knowledge Tools — 12 tools for searching, managing, and analyzing
 * documents and data sources via the local RAG pipeline.
 */
import type { Tool, ToolResult } from "../toolRunner.js";
import { registerTool } from "../toolRunner.js";
import { hybridMultiDatasetSearch } from "../searchService.js";
import {
  listAccessibleDataSources,
  getDataSource,
  createDataSource,
  deleteDataSource,
  refreshDocumentCount,
} from "../dataSourceStore.js";
import { getDocument, getDocumentsByDataSource, deleteDocument, setDocument } from "../documentStore.js";
import { vectorSearch, clearChunksForDocument } from "../chunkRegistry.js";
import { embed } from "../inferenceClient.js";
import { ingestDocument } from "../../jobs/ingestDocument.js";
import { rebuildDataset } from "../../jobs/rebuildDataset.js";
import { randomUUID } from "crypto";
import { writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { config } from "../../config.js";
import type { Document } from "@edgebric/types";

// ─── search_knowledge ───────────────────────────────────────────────────────

const searchKnowledge: Tool = {
  name: "search_knowledge",
  description: "Search the knowledge base using hybrid vector + keyword search. Returns ranked document chunks with citations.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
      sourceIds: { type: "array", items: { type: "string" }, description: "Optional: restrict search to specific source IDs" },
      topK: { type: "integer", description: "Maximum number of results to return (default: 5)" },
    },
    required: ["query"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const query = args["query"] as string;
    const sourceIds = args["sourceIds"] as string[] | undefined;
    const topK = (args["topK"] as number) ?? 5;

    const accessible = listAccessibleDataSources(ctx.userEmail, ctx.isAdmin, ctx.orgId);
    let datasetNames = accessible.map((ds) => ds.datasetName);

    if (sourceIds && sourceIds.length > 0) {
      const requestedSet = new Set(sourceIds);
      const filtered = accessible.filter((ds) => requestedSet.has(ds.id));
      if (filtered.length === 0) {
        return { success: false, error: "No accessible sources match the provided IDs" };
      }
      datasetNames = filtered.map((ds) => ds.datasetName);
    }

    const { results } = await hybridMultiDatasetSearch(datasetNames, query, topK * 2);
    const topResults = results.slice(0, topK).map((r) => ({
      chunkId: r.chunkId,
      content: r.chunk.slice(0, 500),
      similarity: Math.round(r.similarity * 100) / 100,
      documentName: r.metadata.documentName,
      sectionPath: r.metadata.sectionPath,
      heading: r.metadata.heading,
    }));

    return { success: true, data: { resultCount: topResults.length, results: topResults } };
  },
};

// ─── list_sources ───────────────────────────────────────────────────────────

const listSources: Tool = {
  name: "list_sources",
  description: "List all available data sources with their document counts.",
  parameters: { type: "object", properties: {}, required: [] },
  async execute(_args, ctx): Promise<ToolResult> {
    const sources = listAccessibleDataSources(ctx.userEmail, ctx.isAdmin, ctx.orgId);
    const data = sources.map((ds) => ({
      id: ds.id,
      name: ds.name,
      description: ds.description,
      type: ds.type,
      documentCount: ds.documentCount,
      status: ds.status,
    }));
    return { success: true, data: { sourceCount: data.length, sources: data } };
  },
};

// ─── list_documents ─────────────────────────────────────────────────────────

const listDocuments: Tool = {
  name: "list_documents",
  description: "List all documents in a specific data source.",
  parameters: {
    type: "object",
    properties: {
      sourceId: { type: "string", description: "The data source ID" },
    },
    required: ["sourceId"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const sourceId = args["sourceId"] as string;
    const ds = getDataSource(sourceId);
    if (!ds) return { success: false, error: "Source not found" };

    const accessible = listAccessibleDataSources(ctx.userEmail, ctx.isAdmin, ctx.orgId);
    if (!accessible.some((a) => a.id === sourceId)) {
      return { success: false, error: "Access denied" };
    }

    const docs = getDocumentsByDataSource(sourceId);
    const data = docs.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      status: d.status,
      pageCount: d.pageCount,
      uploadedAt: d.uploadedAt.toISOString(),
    }));
    return { success: true, data: { documentCount: data.length, documents: data } };
  },
};

// ─── get_source_summary ─────────────────────────────────────────────────────

const getSourceSummary: Tool = {
  name: "get_source_summary",
  description: "Get a summary of a data source's contents including document names and topics.",
  parameters: {
    type: "object",
    properties: {
      sourceId: { type: "string", description: "The data source ID" },
    },
    required: ["sourceId"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const sourceId = args["sourceId"] as string;
    const ds = getDataSource(sourceId);
    if (!ds) return { success: false, error: "Source not found" };

    const accessible = listAccessibleDataSources(ctx.userEmail, ctx.isAdmin, ctx.orgId);
    if (!accessible.some((a) => a.id === sourceId)) {
      return { success: false, error: "Access denied" };
    }

    const docs = getDocumentsByDataSource(sourceId);
    const summary = {
      sourceName: ds.name,
      description: ds.description,
      documentCount: docs.length,
      documents: docs.slice(0, 20).map((d) => ({
        name: d.name,
        type: d.type,
        status: d.status,
        sections: d.sectionHeadings.slice(0, 5),
      })),
    };
    return { success: true, data: summary };
  },
};

// ─── create_source ──────────────────────────────────────────────────────────

const createSourceTool: Tool = {
  name: "create_source",
  description: "Create a new data source (knowledge base).",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name for the new data source" },
      description: { type: "string", description: "Optional description" },
    },
    required: ["name"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const name = args["name"] as string;
    const description = args["description"] as string | undefined;
    const opts: Parameters<typeof createDataSource>[0] = {
      name,
      type: "organization",
      ownerId: ctx.userEmail,
    };
    if (description) opts.description = description;
    if (ctx.orgId) opts.orgId = ctx.orgId;
    const ds = createDataSource(opts);
    return { success: true, data: { id: ds.id, name: ds.name, datasetName: ds.datasetName } };
  },
};

// ─── upload_document ────────────────────────────────────────────────────────

const uploadDocument: Tool = {
  name: "upload_document",
  description: "Save text content as a document in a data source, then trigger ingestion for RAG indexing.",
  parameters: {
    type: "object",
    properties: {
      sourceId: { type: "string", description: "Target data source ID" },
      content: { type: "string", description: "The text content to save" },
      filename: { type: "string", description: "Filename (e.g. 'notes.md')" },
    },
    required: ["sourceId", "content", "filename"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const sourceId = args["sourceId"] as string;
    const content = args["content"] as string;
    const filename = args["filename"] as string;

    const ds = getDataSource(sourceId);
    if (!ds) return { success: false, error: "Source not found" };

    const accessible = listAccessibleDataSources(ctx.userEmail, ctx.isAdmin, ctx.orgId);
    if (!accessible.some((a) => a.id === sourceId)) {
      return { success: false, error: "Access denied" };
    }

    // Write content to file
    const uploadsDir = join(config.dataDir, "uploads");
    mkdirSync(uploadsDir, { recursive: true });
    const storageKey = join(uploadsDir, `${randomUUID()}.txt`);
    writeFileSync(storageKey, content, "utf-8");

    const docId = randomUUID();
    const ext = filename.split(".").pop()?.toLowerCase() ?? "txt";
    const docType = (["pdf", "docx", "md", "txt"].includes(ext) ? ext : "txt") as Document["type"];

    const doc: Document = {
      id: docId,
      name: filename,
      type: docType,
      classification: "policy",
      uploadedAt: new Date(),
      updatedAt: new Date(),
      status: "processing",
      sectionHeadings: [],
      storageKey,
      dataSourceId: sourceId,
    };
    setDocument(doc);

    // Trigger async ingestion
    void ingestDocument(doc, { datasetName: ds.datasetName, piiMode: ds.piiMode }).then(() => {
      refreshDocumentCount(sourceId);
    });

    return { success: true, data: { documentId: docId, filename, status: "processing" } };
  },
};

// ─── delete_document ────────────────────────────────────────────────────────

const deleteDocumentTool: Tool = {
  name: "delete_document",
  description: "Delete a document and its indexed chunks from the knowledge base.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "The document ID to delete" },
    },
    required: ["documentId"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const documentId = args["documentId"] as string;
    const doc = getDocument(documentId);
    if (!doc) return { success: false, error: "Document not found" };

    // Verify user has access to the document's data source
    if (doc.dataSourceId) {
      const accessible = listAccessibleDataSources(ctx.userEmail, ctx.isAdmin, ctx.orgId);
      if (!accessible.some((a) => a.id === doc.dataSourceId)) {
        return { success: false, error: "Access denied" };
      }
    }

    const dsId = doc.dataSourceId;
    const datasetName = doc.datasetName ?? (dsId ? getDataSource(dsId)?.datasetName : undefined);

    deleteDocument(doc.id);
    clearChunksForDocument(doc.id);

    if (dsId) refreshDocumentCount(dsId);

    try { unlinkSync(doc.storageKey); } catch { /* file may be gone */ }

    if (datasetName) void rebuildDataset(datasetName);

    return { success: true, data: { deleted: doc.name } };
  },
};

// ─── delete_source ──────────────────────────────────────────────────────────

const deleteSourceTool: Tool = {
  name: "delete_source",
  description: "Delete a data source and all its documents. This is destructive and cannot be undone.",
  parameters: {
    type: "object",
    properties: {
      sourceId: { type: "string", description: "The data source ID to delete" },
    },
    required: ["sourceId"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!ctx.isAdmin) return { success: false, error: "Admin access required" };

    const sourceId = args["sourceId"] as string;
    const ds = getDataSource(sourceId);
    if (!ds) return { success: false, error: "Source not found" };

    // Delete all documents first
    const docs = getDocumentsByDataSource(sourceId);
    for (const doc of docs) {
      deleteDocument(doc.id);
      clearChunksForDocument(doc.id);
      try { unlinkSync(doc.storageKey); } catch { /* ignore */ }
    }

    deleteDataSource(sourceId);
    return { success: true, data: { deleted: ds.name, documentsDeleted: docs.length } };
  },
};

// ─── save_to_vault ──────────────────────────────────────────────────────────

const saveToVault: Tool = {
  name: "save_to_vault",
  description: "Save content to the user's personal vault source mid-conversation.",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "The content to save" },
      title: { type: "string", description: "Title for the saved content" },
    },
    required: ["content", "title"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const content = args["content"] as string;
    const title = args["title"] as string;

    // Find or create user's personal vault source
    const personal = listAccessibleDataSources(ctx.userEmail, ctx.isAdmin, ctx.orgId)
      .filter((ds) => ds.type === "personal");

    let vaultSource = personal[0];
    if (!vaultSource) {
      const vaultOpts: Parameters<typeof createDataSource>[0] = {
        name: `${ctx.userEmail}'s Vault`,
        type: "personal",
        ownerId: ctx.userEmail.toLowerCase(),
      };
      if (ctx.orgId) vaultOpts.orgId = ctx.orgId;
      vaultSource = createDataSource(vaultOpts);
    }

    // Save as document
    const uploadsDir = join(config.dataDir, "uploads");
    mkdirSync(uploadsDir, { recursive: true });
    const storageKey = join(uploadsDir, `${randomUUID()}.md`);
    writeFileSync(storageKey, `# ${title}\n\n${content}`, "utf-8");

    const docId = randomUUID();
    const doc: Document = {
      id: docId,
      name: `${title}.md`,
      type: "md",
      classification: "policy",
      uploadedAt: new Date(),
      updatedAt: new Date(),
      status: "processing",
      sectionHeadings: [title],
      storageKey,
      dataSourceId: vaultSource.id,
    };
    setDocument(doc);

    void ingestDocument(doc, { datasetName: vaultSource.datasetName, piiMode: "off" }).then(() => {
      refreshDocumentCount(vaultSource!.id);
    });

    return { success: true, data: { documentId: docId, vaultSourceId: vaultSource.id, title } };
  },
};

// ─── compare_documents ──────────────────────────────────────────────────────

const compareDocuments: Tool = {
  name: "compare_documents",
  description: "Compare two documents by retrieving their chunks and highlighting key differences in topics covered.",
  parameters: {
    type: "object",
    properties: {
      docId1: { type: "string", description: "First document ID" },
      docId2: { type: "string", description: "Second document ID" },
    },
    required: ["docId1", "docId2"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const docId1 = args["docId1"] as string;
    const docId2 = args["docId2"] as string;

    const doc1 = getDocument(docId1);
    const doc2 = getDocument(docId2);
    if (!doc1) return { success: false, error: `Document ${docId1} not found` };
    if (!doc2) return { success: false, error: `Document ${docId2} not found` };

    // Verify user has access to both documents' data sources
    const accessible = listAccessibleDataSources(ctx.userEmail, ctx.isAdmin, ctx.orgId);
    const accessibleIds = new Set(accessible.map((a) => a.id));
    if (doc1.dataSourceId && !accessibleIds.has(doc1.dataSourceId)) {
      return { success: false, error: "Access denied to first document" };
    }
    if (doc2.dataSourceId && !accessibleIds.has(doc2.dataSourceId)) {
      return { success: false, error: "Access denied to second document" };
    }

    return {
      success: true,
      data: {
        document1: {
          name: doc1.name,
          sections: doc1.sectionHeadings,
          pageCount: doc1.pageCount,
        },
        document2: {
          name: doc2.name,
          sections: doc2.sectionHeadings,
          pageCount: doc2.pageCount,
        },
        // Let the LLM analyze the actual differences using section headings
        sectionsOnlyIn1: doc1.sectionHeadings.filter((s) => !doc2.sectionHeadings.includes(s)),
        sectionsOnlyIn2: doc2.sectionHeadings.filter((s) => !doc1.sectionHeadings.includes(s)),
        sharedSections: doc1.sectionHeadings.filter((s) => doc2.sectionHeadings.includes(s)),
      },
    };
  },
};

// ─── cite_check ─────────────────────────────────────────────────────────────

const citeCheck: Tool = {
  name: "cite_check",
  description: "Verify or contradict a claim by searching all data sources for supporting or contradicting evidence.",
  parameters: {
    type: "object",
    properties: {
      claim: { type: "string", description: "The claim to verify" },
    },
    required: ["claim"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const claim = args["claim"] as string;

    const accessible = listAccessibleDataSources(ctx.userEmail, ctx.isAdmin, ctx.orgId);
    const datasetNames = accessible.map((ds) => ds.datasetName);
    if (datasetNames.length === 0) {
      return { success: true, data: { evidence: [], verdict: "no_sources" } };
    }

    const { results } = await hybridMultiDatasetSearch(datasetNames, claim, 10);
    const evidence = results.slice(0, 5).map((r) => ({
      content: r.chunk.slice(0, 400),
      similarity: Math.round(r.similarity * 100) / 100,
      documentName: r.metadata.documentName,
      heading: r.metadata.heading,
    }));

    return {
      success: true,
      data: {
        claim,
        evidenceCount: evidence.length,
        evidence,
        // High similarity = likely supported; low = uncertain
        verdict: evidence.length > 0 && evidence[0]!.similarity > 0.6 ? "evidence_found" : "uncertain",
      },
    };
  },
};

// ─── find_related ───────────────────────────────────────────────────────────

const findRelated: Tool = {
  name: "find_related",
  description: "Find documents related to a given document using vector similarity search across all sources.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "The document ID to find related documents for" },
    },
    required: ["documentId"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const documentId = args["documentId"] as string;
    const doc = getDocument(documentId);
    if (!doc) return { success: false, error: "Document not found" };

    // Use document name + first section headings as query
    const queryText = [doc.name, ...doc.sectionHeadings.slice(0, 3)].join(" ");

    const accessible = listAccessibleDataSources(ctx.userEmail, ctx.isAdmin, ctx.orgId);
    const datasetNames = accessible.map((ds) => ds.datasetName);

    const queryEmbedding = await embed(queryText);
    const results = vectorSearch(queryEmbedding, datasetNames, 20);

    // Filter out chunks from the same document, deduplicate by source document
    const seen = new Set<string>();
    seen.add(documentId);
    const related: Array<{ documentId: string; documentName: string; similarity: number }> = [];

    for (const r of results) {
      const srcDocId = r.metadata.sourceDocument;
      if (seen.has(srcDocId)) continue;
      seen.add(srcDocId);

      const relatedDoc = getDocument(srcDocId);
      related.push({
        documentId: srcDocId,
        documentName: relatedDoc?.name ?? r.metadata.documentName ?? "Unknown",
        similarity: Math.round(r.similarity * 100) / 100,
      });

      if (related.length >= 5) break;
    }

    return { success: true, data: { sourceDocument: doc.name, related } };
  },
};

// ─── Register All Knowledge Tools ───────────────────────────────────────────

export function registerKnowledgeTools(): void {
  registerTool(searchKnowledge);
  registerTool(listSources);
  registerTool(listDocuments);
  registerTool(getSourceSummary);
  registerTool(createSourceTool);
  registerTool(uploadDocument);
  registerTool(deleteDocumentTool);
  registerTool(deleteSourceTool);
  registerTool(saveToVault);
  registerTool(compareDocuments);
  registerTool(citeCheck);
  registerTool(findRelated);
}
